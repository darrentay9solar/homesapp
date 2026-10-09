"""Handover: the homeowner e-signs the installation certificate; a project manager closes the project.

  GET  /projects/{pid}/handover                  the certificate, its fingerprint, who signed, what's next
  POST /projects/{pid}/handover/request          a PM asks for the signature (normally automatic at Milestone 3)
  POST /projects/{pid}/handover/remind           a PM reminds the homeowner
  POST /projects/{pid}/handover/sign             the homeowner signs {fingerprint, signerName, signature, agree}
  GET  /projects/{pid}/handover/certificate.pdf  the signed certificate (anyone on the project)
  POST /projects/{pid}/close                     a PM closes the signed project; everyone is told

The flow, from the brief: when the project completes, the homeowner signs
the handover certificate on their phone; the project managers are alerted;
a PM checks it and closes the project, and the PM, the admin team and the
homeowner are told. The database enforces each step (migration 0029).
"""

from __future__ import annotations

import base64
import binascii
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from _lib import certificate, notify, storage
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active, role
from _routes import projects as proj
from _routes.project_work import _audience, _need, _pms, _project, _run, _state, ask_to_sign, request_signature

router = APIRouter()
pm_only = role("project_manager")


def _signature(pid: int) -> dict[str, Any] | None:
    return fetch_one(
        "select s.*, u.full_name as by_name from project_signatures s left join users u on u.uid = s.signed_by "
        "where s.project_id = %s",
        (pid,),
    )


def current_certificate(p: dict[str, Any], acct: Account) -> dict[str, Any]:
    """The certificate as it reads right now, from the project's fields."""
    row = proj._load(acct, p["project_id"])
    label = row[0]["contractor"]["label"] if row else (p.get("contractor_text") or "—")
    manager = row[0]["pm"]["name"] if row else None
    return certificate.build(p, contractor=label, manager=manager)


@router.get("/projects/{pid}/handover")
def handover(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    rel = _need(acct, p)
    s = p["status"]
    sig = _signature(pid)
    cert = sig["certificate"] if sig and sig["certificate"] else current_certificate(p, acct)
    _, _, _, recorded = _state(p)
    closer = fetch_one("select full_name from users where uid = %s", (p["closed_by"],)) if p["closed_by"] else None
    return {
        "status": s,
        "milestone3": 3 in recorded,
        "certificate": cert,
        "fingerprint": sig["certificate_hash"] if sig else certificate.fingerprint(cert),
        "signature": {
            "name": sig["signer_name"] or sig["by_name"],
            "at": sig["signed_at"].isoformat(),
        }
        if sig
        else None,
        "pdf": f"/api/py/projects/{pid}/handover/certificate.pdf" if sig and sig["certificate_url"] else None,
        "closed": {"at": p["closed_at"].isoformat(), "by": closer["full_name"] if closer else None}
        if s == "closed" and p["closed_at"]
        else None,
        "actions": {
            "sign": rel == "homeowner" and s == "awaiting_signature",
            "request": rel == "pm"
            and s in ("pm_approved", "in_progress")
            and 3 in recorded
            and bool(p["homeowner_id"]),
            "remind": rel == "pm" and s == "awaiting_signature",
            "close": rel == "pm" and s == "signed",
        },
    }


@router.post("/projects/{pid}/handover/request")
def ask(pid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    p = _run(pid, acct)
    if p["status"] not in ("pm_approved", "in_progress"):
        raise HTTPException(409, "The project isn't at the point of asking for a signature.")
    if not p["homeowner_id"]:
        raise HTTPException(409, "Link the homeowner's account first.")
    _, _, _, recorded = _state(p)
    if 3 not in recorded:
        raise HTTPException(409, "Milestone 3 isn't complete yet.")
    if not request_signature(pid, acct):
        raise HTTPException(409, "The project isn't at the point of asking for a signature.")
    return {"message": f"{p['h_name'] or 'The homeowner'} has been asked to sign the handover certificate."}


@router.post("/projects/{pid}/handover/remind")
def remind(pid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    p = _run(pid, acct)
    if p["status"] != "awaiting_signature":
        raise HTTPException(409, "The project isn't waiting for the homeowner's signature.")
    ask_to_sign(p)
    return {"message": f"{p['h_name'] or 'The homeowner'} has been reminded to sign."}


class SignIn(BaseModel):
    fingerprint: str = ""
    signerName: str = ""
    signature: str = ""  # a JPEG, base64 or as a data: URL
    agree: bool = False


def _jpeg(raw: str) -> bytes:
    if raw.startswith("data:"):
        head, _, raw = raw.partition(",")
        if head != "data:image/jpeg;base64":
            raise HTTPException(400, "The signature didn't come through. Clear it and sign again.")
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, "The signature didn't come through. Clear it and sign again.") from exc


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    return ip[:45] if ip else None


@router.post("/projects/{pid}/handover/sign")
def sign(pid: int, body: SignIn, request: Request, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    if _need(acct, p) != "homeowner":
        raise HTTPException(403, "Only the homeowner signs the handover certificate.")
    if p["status"] != "awaiting_signature":
        raise HTTPException(409, "This project isn't waiting for your signature.")
    if not body.agree:
        raise HTTPException(400, "Tick the box to confirm you accept the installation.")
    name = " ".join(body.signerName.split())[:120]
    if len(name) < 2:
        raise HTTPException(400, "Type your full name under your signature.")
    cert = current_certificate(p, acct)
    fp = certificate.fingerprint(cert)
    if body.fingerprint != fp:
        raise HTTPException(409, "The certificate changed while you were reading it. Check it again, then sign.")
    image = _jpeg(body.signature)
    why = certificate.check_signature(image)
    if why:
        raise HTTPException(400, why)
    if not storage.mode():
        raise HTTPException(503, str(storage.StorageNotConfiguredError()))

    pdf_key, sig_key = storage.handover_keys(pid)
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_signatures (project_id, signed_by, signature_url, certificate_hash, certificate_url, "
            "signed_ip, signed_user_agent, signer_name, certificate) values (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "returning signed_at",
            (pid, acct.uid, sig_key, fp, pdf_key, _client_ip(request),
             (request.headers.get("user-agent") or "")[:400], name, json.dumps(cert, ensure_ascii=False)),
        )  # fmt: skip
        signed_at = cur.fetchone()["signed_at"]
        document = certificate.pdf(cert, signature=image, signer=name, signed_at=signed_at, fingerprint_hex=fp)
        storage.put(sig_key, image, "image/jpeg")
        storage.put(pdf_key, document, "application/pdf")
        cur.execute("update projects set status = 'signed', updated_at = now() where project_id = %s", (pid,))

    for uid in _pms(p):
        notify.notify(uid, "signed", f"Handover signed · {p['name']}",
                      f"{name} signed the installation certificate. Check it and close the project.",
                      project_id=pid)  # fmt: skip
    return {"message": "Signed. Thank you! 9 Solar Home will check the certificate and close the project."}


@router.get("/projects/{pid}/handover/certificate.pdf")
def certificate_pdf(pid: int, acct: Account = Depends(active)) -> Response:
    _need(acct, _project(pid))
    sig = _signature(pid)
    if not sig or not sig["certificate_url"]:
        raise HTTPException(404, "The certificate hasn't been signed yet.")
    name = f"Installation certificate {certificate.number(pid)}.pdf"
    try:
        return RedirectResponse(storage.view_link(sig["certificate_url"], name), status_code=302)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/projects/{pid}/close")
def close(pid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    p = _run(pid, acct)
    if p["status"] == "closed":
        raise HTTPException(409, "The project is already closed.")
    if p["status"] != "signed":
        raise HTTPException(409, "A project closes once the homeowner has signed its handover certificate.")
    with transaction(acct.uid) as cur:
        cur.execute("update projects set status = 'closed', updated_at = now() where project_id = %s", (pid,))

    # The brief: the PM, the admin team and the homeowner are told.
    admins = {r["uid"] for r in fetch_all("select uid from users where user_type = 'superadmin' and active")}
    url = f"{notify.app_url()}/projects/{pid}"
    for uid in (_audience(p) | admins) - {acct.uid}:
        if uid == p["homeowner_id"]:
            h = fetch_one("select full_name, email, language from users where uid = %s", (uid,))
            assert h is not None
            m = notify.msg_project_closed(h["full_name"], p["name"], url, h["language"])
            notify.notify(uid, "project_closed", m["title"], m["body"], project_id=pid, email=(h["email"], *m["email"]))
        else:
            notify.notify(uid, "project_closed", f"Project closed · {p['name']}",
                          "The homeowner signed the handover certificate and the project is closed.",
                          project_id=pid)  # fmt: skip
    return {"message": "Closed. Everyone on the project has been told."}
