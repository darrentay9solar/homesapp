"""Working on a project: approvals, details, milestone fields and their files.

The flow, from the brief:

  Draft ──link a homeowner account──▶ Awaiting Homeowner ──homeowner approves──▶
  Homeowner Approved ──a PM approves──▶ PM Approved ──first field filled──▶
  In Progress ──Milestone 1, 2, 3 complete──▶ (handover: e-sign, then close)

Milestone fields open only once a PM has approved, and each milestone's
fields only once the previous milestone is complete. When a milestone's
sections are all filled it is recorded (project_milestones) and everyone on
the project is told. A completed milestone's fields are then fixed for the
crew; a project manager can still correct them, or reopen the milestone.

Who may do what (the database enforces the same — migration 0019):
  homeowner        approve or decline their own project; see its checklist
  crew             fill in milestone fields and files on their projects
  project manager  everything, including details, dates and reopening
"""

from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel

from _lib import notify, onemap, project_fields, storage
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.project_fields import FIELDS, GROUPS, MILESTONES, Field
from _lib.web import active, role
from _routes import projects as proj

router = APIRouter()
pm_only = role("project_manager")

Relation = Literal["pm", "crew", "homeowner"]
SECTION_MILESTONE = {g: n for n, gs in MILESTONES.items() for g in gs}
BEFORE_APPROVAL = {"draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"}
FILE_CATEGORIES = {f.key for f in FIELDS if f.kind in project_fields.FILE_KINDS}
TEXT_LIMIT = {"sales": 160, "inverter_serial_number": 120}


# ------------------------------------------------------------------ helpers


def _project(pid: int) -> dict[str, Any]:
    p = fetch_one(
        """
        select p.*, r.name as retailer_name, h.full_name as h_name, h.email as h_email,
               h.ic_last4 is not null as h_has_ic
          from projects p
          left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id
          left join users h on h.uid = p.homeowner_id
         where p.project_id = %s
        """,
        (pid,),
    )
    if not p:
        raise HTTPException(404, "No such project, or it isn't one of yours.")
    return p


def relation(acct: Account, p: dict[str, Any]) -> Relation | None:
    if acct.role == "project_manager":
        return "pm"
    if acct.role == "homeowner":
        return "homeowner" if p["homeowner_id"] == acct.uid else None
    on = fetch_one(
        "select 1 from contractor_group_members where group_id = %(g)s and user_id = %(u)s "
        "union select 1 from project_assignments where project_id = %(p)s and user_id = %(u)s",
        {"g": p["contractor_group_id"], "u": acct.uid, "p": p["project_id"]},
    )
    return "crew" if on else None


def _need(acct: Account, p: dict[str, Any]) -> Relation:
    rel = relation(acct, p)
    if rel is None:
        raise HTTPException(404, "No such project, or it isn't one of yours.")
    return rel


def _file_counts(pid: int) -> dict[str, int]:
    rows = fetch_all(
        "select category::text as c, count(*)::int as n from project_files where project_id = %s group by 1", (pid,)
    )
    return {r["c"]: r["n"] for r in rows}


def _state(p: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], int, set[int]]:
    """The project as project_fields reads it, its sections, the milestone reached, and those recorded."""
    v = dict(p)
    v["_retailer_name"] = p["retailer_name"]
    # The IC itself never leaves the database; only whether it is recorded.
    v["_homeowner"] = {"ic_last4": "set" if p["h_has_ic"] else None, "email": p["h_email"]}
    groups = project_fields.group_status(v, _file_counts(p["project_id"]))
    recorded = {
        r["milestone_no"]
        for r in fetch_all("select milestone_no from project_milestones where project_id = %s", (p["project_id"],))
    }
    return v, groups, project_fields.milestone_reached(groups), recorded


def section_lock(p: dict[str, Any], section: str, reached: int) -> str | None:
    if p["status"] in BEFORE_APPROVAL:
        return "Opens once the homeowner and a project manager have approved the project."
    if p["status"] in ("awaiting_signature", "signed", "closed"):
        return "The project is at handover; its fields are now the signed record."
    n = SECTION_MILESTONE[section]
    if n == 2 and reached < 1:
        return "Opens once Milestone 1 is complete."
    if n == 3 and reached < 2:
        return "Opens once Milestone 2 is complete."
    return None


def why_not_editable(rel: Relation, p: dict[str, Any], f: Field, reached: int, recorded: set[int]) -> str | None:
    if rel == "homeowner":
        return "Filled in by 9 Solar Home and the contractor."
    if f.kind == "auto":
        return "Calculated by the system."
    if f.key == "homeowner.email":
        return "From the homeowner's account."
    if f.key.startswith("homeowner.") and not p["homeowner_id"]:
        return "Link the homeowner's account first."
    lock = section_lock(p, f.group, reached)
    if lock:
        return lock
    n = SECTION_MILESTONE[f.group]
    if rel == "crew" and n in recorded:
        return f"Milestone {n} is complete. A project manager can correct it or reopen the milestone."
    return None


def _value(f: Field, v: dict[str, Any]) -> Any:
    if f.kind == "retailer":
        rid = v["electricity_retailer_id"]
        return {"id": rid, "name": v["_retailer_name"]} if rid else None
    if f.key == "homeowner.ic_last4":
        return "Recorded" if v["_homeowner"]["ic_last4"] else None
    if f.key == "homeowner.email":
        return v["_homeowner"]["email"] if v.get("homeowner_id") else None
    if f.key == "sp_pending_days":
        d = v.get("sp_submission_date")
        return f"{(proj.today() - d).days} days" if d else None
    if f.kind in project_fields.FILE_KINDS:
        return None
    x = v.get(f.key)
    return x.isoformat() if isinstance(x, date) else x


def _files(pid: int) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in fetch_all(
        "select f.file_id, f.category::text as category, f.file_name, f.content_type, f.size_bytes, f.uploaded_at, "
        "u.full_name as by_name from project_files f left join users u on u.uid = f.uploaded_by "
        "where f.project_id = %s order by f.uploaded_at",
        (pid,),
    ):
        out.setdefault(r["category"], []).append(
            {
                "id": r["file_id"],
                "name": r["file_name"],
                "type": r["content_type"],
                "size": r["size_bytes"],
                "at": r["uploaded_at"].isoformat(),
                "by": r["by_name"],
            }  # fmt: skip
        )
    return out


# ------------------------------------------------------------------ reading


@router.get("/projects/{pid}/fields")
def fields(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    rel = _need(acct, p)
    v, groups, reached, recorded = _state(p)
    files = _files(pid)
    sections = []
    for key, name, sub in GROUPS:
        out = []
        for f in FIELDS:
            if f.group != key:
                continue
            shown = f.when is None or f.when(v)
            out.append(
                {
                    "key": f.key,
                    "label": f.label,
                    "kind": f.kind,
                    "required": f.required and f.kind != "auto",
                    "note": f.note,
                    "shown": shown,
                    "filled": project_fields.is_filled(f, v, {k: len(x) for k, x in files.items()}),
                    "value": _value(f, v),
                    "files": files.get(f.key, []) if f.kind in project_fields.FILE_KINDS else None,
                    "lockedReason": why_not_editable(rel, p, f, reached, recorded),
                }
            )
        sections.append(
            {
                "key": key,
                "name": name,
                "sub": sub,
                "milestone": SECTION_MILESTONE[key],
                "lockedReason": section_lock(p, key, reached),
                **groups[key],
                "fields": out,
            }  # fmt: skip
        )
    retailers = fetch_all("select retailer_id as id, name from electricity_retailers order by name")
    s = p["status"]
    return {
        "relation": rel,
        "sections": sections,
        "milestoneReached": reached,
        "recordedMilestones": sorted(recorded),
        "retailers": retailers,
        "storage": storage.mode(),
        "actions": {
            "approve": (rel == "homeowner" and s in ("awaiting_homeowner", "homeowner_declined"))
            or (rel == "pm" and s == "homeowner_approved"),
            "decline": rel == "homeowner" and s == "awaiting_homeowner",
            "remind": rel == "pm" and s in ("awaiting_homeowner", "homeowner_declined"),
            "editDetails": rel == "pm",
            "reopen": sorted(recorded) if rel == "pm" else [],
        },
    }


# ------------------------------------------------------------ saving fields


class FieldIn(BaseModel):
    key: str
    value: Any = None


def _coerce(f: Field, value: Any) -> Any:
    if value is None or value == "":
        return None
    try:
        if f.kind == "number":
            n = int(value)
            if n < 0 or n > 1_000_000:
                raise ValueError
            return n
        if f.kind == "date":
            return date.fromisoformat(str(value))
        if f.kind == "yesno":
            if not isinstance(value, bool):
                raise ValueError
            return value
        if f.kind == "select":
            if int(value) not in (1, 2, 3):
                raise ValueError
            return int(value)
        if f.kind == "text":
            text = str(value).strip()
            return text[: TEXT_LIMIT.get(f.key, 200)] or None
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"That isn't a valid value for {f.label}.") from exc
    return value


@router.patch("/projects/{pid}/fields")
def save_field(pid: int, body: FieldIn, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    rel = _need(acct, p)
    f = next((x for x in FIELDS if x.key == body.key), None)
    if not f or f.kind in project_fields.FILE_KINDS:
        raise HTTPException(400, "Unknown field.")
    _, _, reached, recorded = _state(p)
    why = why_not_editable(rel, p, f, reached, recorded)
    if why:
        raise HTTPException(403, why)

    with transaction(acct.uid) as cur:
        if f.key == "homeowner.ic_last4":
            ic = str(body.value or "").strip().upper()
            if ic and not re.fullmatch(r"\d{3}[A-Z]", ic):
                raise HTTPException(400, "Enter only the last 4 of the IC: three digits and a letter, e.g. 567D.")
            cur.execute("select set_homeowner_ic(%s, %s)", (pid, ic))
        else:
            value = _retailer(cur, body.value) if f.kind == "retailer" else _coerce(f, body.value)
            n = SECTION_MILESTONE[f.group]
            if value is None and f.required and n in recorded:
                raise HTTPException(400, f"Milestone {n} is complete, so {f.label} can't be emptied. Reopen it first.")
            cur.execute(
                f"update projects set {f.key} = %s, updated_at = now() where project_id = %s",  # key from FIELDS only
                (value, pid),
            )
        _start(cur, p)
    done = _after_change(pid, acct)
    return {"message": done or f"{f.label} saved."}


def _retailer(cur: Any, value: Any) -> int | None:
    """A retailer from the list (its id), or a new one by name."""
    if value in (None, ""):
        return None
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        return int(value)
    name = str(value.get("name") if isinstance(value, dict) else value).strip()[:120]
    if len(name) < 2:
        raise HTTPException(400, "Enter the retailer's name.")
    cur.execute(
        "insert into electricity_retailers (name) values (%s) on conflict (name) do update set name = excluded.name "
        "returning retailer_id",
        (name,),
    )
    return int(cur.fetchone()["retailer_id"])


def _start(cur: Any, p: dict[str, Any]) -> None:
    """The first piece of work on an approved project starts it."""
    if p["status"] == "pm_approved":
        cur.execute("update projects set status = 'in_progress' where project_id = %s", (p["project_id"],))


def _audience(p: dict[str, Any]) -> set[int]:
    uids = {r["user_id"] for r in fetch_all(
        "select user_id from contractor_group_members where group_id = %(g)s "
        "union select user_id from project_assignments where project_id = %(p)s",
        {"g": p["contractor_group_id"], "p": p["project_id"]})}  # fmt: skip
    if p["homeowner_id"]:
        uids.add(p["homeowner_id"])
    if p["project_manager_id"]:
        uids.add(p["project_manager_id"])
    return uids


MILESTONE_NEWS = {
    1: ("Milestone 1 complete", "Panels installed and scaffolding removed. The SP application has been submitted."),
    2: ("Milestone 2 complete", "The inverter is commissioned and the grid connection is in hand."),
    3: ("Ready for handover", "Every milestone is complete. Next: the handover certificate for e-signature."),
}


def _after_change(pid: int, acct: Account) -> str | None:
    """Record any milestone the change completed, and tell everyone on the project."""
    p = _project(pid)
    _, _, reached, recorded = _state(p)
    new = [n for n in (1, 2, 3) if n <= reached and n not in recorded]
    if not new:
        return None
    with transaction(acct.uid) as cur:
        for n in new:
            cur.execute(
                "insert into project_milestones (project_id, milestone_no, completed_by) values (%s, %s, %s) "
                "on conflict do nothing",
                (pid, n, acct.uid),
            )
    for n in new:
        title, text = MILESTONE_NEWS[n]
        for uid in _audience(p) - {acct.uid}:
            notify.notify(uid, "milestone_complete", f"{title} · {p['name']}", text, project_id=pid)
    last = max(new)
    return f"{MILESTONE_NEWS[last][0]}. Everyone on the project has been told."


# ------------------------------------------------------------------- files


class LinkIn(BaseModel):
    category: str
    fileName: str = ""
    contentType: str = ""
    size: int = 0


class FileIn(BaseModel):
    category: str
    key: str
    fileName: str = ""


def _file_field(category: str) -> Field:
    f = next((x for x in FIELDS if x.key == category and x.kind in project_fields.FILE_KINDS), None)
    if not f:
        raise HTTPException(400, "Unknown kind of file.")
    return f


@router.post("/projects/{pid}/files/upload-link")
def upload_link(pid: int, body: LinkIn, acct: Account = Depends(active)) -> dict[str, Any]:
    """Step 1: permission to upload one file, as a five-minute link locked to its type and size."""
    p = _project(pid)
    rel = _need(acct, p)
    f = _file_field(body.category)
    _, _, reached, recorded = _state(p)
    why = why_not_editable(rel, p, f, reached, recorded)
    if why:
        raise HTTPException(403, why)
    ext = storage.ALLOWED_TYPES.get(body.contentType)
    if not ext:
        raise HTTPException(400, "Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be uploaded.")
    if not 0 < body.size <= storage.MAX_BYTES:
        raise HTTPException(400, f"Files must be under {storage.MAX_BYTES // 1024 // 1024} MB.")
    # The key is chosen here, never by the browser, so an upload can only ever land in its own slot.
    key = f"projects/{pid}/{body.category}/{uuid.uuid4()}.{ext}"
    try:
        url = storage.upload_link(key, body.contentType, body.size)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"key": key, "uploadUrl": url, "headers": {"Content-Type": body.contentType}}


@router.post("/projects/{pid}/files")
def file_done(pid: int, body: FileIn, acct: Account = Depends(active)) -> dict[str, Any]:
    """Step 2: the upload finished. Trust nothing but what actually arrived in storage."""
    p = _project(pid)
    rel = _need(acct, p)
    f = _file_field(body.category)
    _, _, reached, recorded = _state(p)
    why = why_not_editable(rel, p, f, reached, recorded)
    if why:
        raise HTTPException(403, why)
    exts = "|".join(storage.ALLOWED_TYPES.values())
    if not re.fullmatch(rf"projects/{pid}/{body.category}/[0-9a-f-]{{36}}\.({exts})", body.key):
        raise HTTPException(400, "That upload doesn't belong to this project.")
    got = storage.head(body.key)
    if not got:
        raise HTTPException(400, "The file never arrived. Please upload it again.")
    size, ctype = got
    if size > storage.MAX_BYTES or ctype not in storage.ALLOWED_TYPES:
        storage.delete(body.key)
        raise HTTPException(400, "That file is too large or not an allowed type.")
    name = (body.fileName or "file").strip()[:200]
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by) "
            "values (%s, %s, %s, %s, %s, %s, %s) returning file_id",
            (pid, body.category, body.key, name, ctype, size, acct.uid),
        )
        fid = cur.fetchone()["file_id"]
        _start(cur, p)
    done = _after_change(pid, acct)
    return {"id": fid, "message": done or f"{name} added to {f.label}."}


@router.get("/files/{file_id}")
def view_file(file_id: int, acct: Account = Depends(active)) -> Response:
    """Open a file: checks access, then sends the browser to a five-minute link."""
    row = fetch_one("select project_id, url, file_name from project_files where file_id = %s", (file_id,))
    if not row:
        raise HTTPException(404, "No such file.")
    _need(acct, _project(row["project_id"]))
    try:
        return RedirectResponse(storage.view_link(row["url"], row["file_name"]), status_code=302)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.delete("/projects/{pid}/files/{file_id}")
def remove_file(pid: int, file_id: int, acct: Account = Depends(active)) -> dict[str, Any]:
    """Takes a file off the project. The stored copy is kept, so the removal can be restored from the audit log."""
    p = _project(pid)
    rel = _need(acct, p)
    row = fetch_one("select category::text as c, file_name from project_files where file_id = %s and project_id = %s",
                    (file_id, pid))  # fmt: skip
    if not row:
        raise HTTPException(404, "No such file.")
    f = _file_field(row["c"])
    _, _, reached, recorded = _state(p)
    why = why_not_editable(rel, p, f, reached, recorded)
    if why:
        raise HTTPException(403, why)
    with transaction(acct.uid) as cur:
        cur.execute("delete from project_files where file_id = %s", (file_id,))
    return {"message": f"{row['file_name']} removed. It can be restored from the audit log."}


@router.get("/storage/check")
def storage_check(acct: Account = Depends(role("project_manager"))) -> dict[str, Any]:
    """For a PM after setting up R2: does this deployment reach the right bucket with a working key?"""
    return storage.check()


@router.put("/dev-storage/{token}")
async def dev_put(token: str, request: Request) -> dict[str, Any]:
    """Laptop storage only: receives one upload, if the link is genuine, unexpired and the file matches it."""
    t = storage.read_token(token)
    if storage.mode() != "local" or not t or t.get("op") != "put":
        raise HTTPException(403, "This upload link isn't valid any more. Try again.")
    data = await request.body()
    if request.headers.get("content-type") != t["type"] or len(data) != t["size"]:
        raise HTTPException(400, "The file doesn't match what was approved.")
    path = storage.local_path(str(t["key"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.with_suffix(path.suffix + ".type").write_text(str(t["type"]))
    return {"ok": True}


@router.get("/dev-storage/{token}")
def dev_get(token: str) -> Response:
    t = storage.read_token(token)
    if storage.mode() != "local" or not t or t.get("op") != "get":
        raise HTTPException(403, "This link has expired. Open the file again.")
    path = storage.local_path(str(t["key"]))
    if not path.exists():
        raise HTTPException(404, "That file isn't in local storage.")
    meta = path.with_suffix(path.suffix + ".type")
    return FileResponse(path, media_type=meta.read_text() if meta.exists() else None,
                        content_disposition_type="inline", filename=str(t.get("name") or path.name))  # fmt: skip


# --------------------------------------------------------------- approvals


class ReasonIn(BaseModel):
    reason: str = ""


def _pms(p: dict[str, Any]) -> set[int]:
    if p["project_manager_id"]:
        return {p["project_manager_id"]}
    return {r["uid"] for r in fetch_all("select uid from users where user_type = 'project_manager' and active")}


@router.post("/projects/{pid}/approve")
def approve(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    rel = _need(acct, p)
    if rel == "homeowner" and p["status"] in ("awaiting_homeowner", "homeowner_declined"):
        with transaction(acct.uid) as cur:
            cur.execute("update projects set status = 'homeowner_approved' where project_id = %s", (pid,))
        for uid in _pms(p):
            notify.notify(uid, "approval_request", f"Approve {p['name']}",
                          f"{p['h_name'] or 'The homeowner'} approved the project. Approve it to start the work.",
                          project_id=pid)  # fmt: skip
        return {"message": "Thank you. 9 Solar Home will confirm and schedule your installation."}
    if rel == "pm" and p["status"] == "homeowner_approved":
        with transaction(acct.uid) as cur:
            cur.execute("update projects set status = 'pm_approved' where project_id = %s", (pid,))
        for uid in _audience(p) - {acct.uid}:
            notify.notify(uid, "approval_granted", f"{p['name']} is approved",
                          "The project is approved. Milestone 1 fields are open.", project_id=pid)  # fmt: skip
        return {"message": "Approved. Milestone 1 is open and everyone on the project has been told."}
    raise HTTPException(409, "There's nothing for you to approve on this project right now.")


@router.post("/projects/{pid}/decline")
def decline(pid: int, body: ReasonIn, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    if _need(acct, p) != "homeowner" or p["status"] != "awaiting_homeowner":
        raise HTTPException(409, "This project isn't waiting for your approval.")
    reason = body.reason.strip()[:500]
    with transaction(acct.uid) as cur:
        cur.execute("update projects set status = 'homeowner_declined' where project_id = %s", (pid,))
    for uid in _pms(p):
        notify.notify(uid, "approval_declined", f"{p['name']} was declined",
                      f"{p['h_name'] or 'The homeowner'} declined" + (f": “{reason}”" if reason else "."),
                      project_id=pid)  # fmt: skip
    return {"message": "Declined. 9 Solar Home has been told and will be in touch."}


@router.post("/projects/{pid}/remind")
def remind(pid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    p = _project(pid)
    if p["status"] not in ("awaiting_homeowner", "homeowner_declined") or not p["homeowner_id"]:
        raise HTTPException(409, "The project isn't waiting on the homeowner.")
    with transaction(acct.uid) as cur:
        cur.execute("update projects set status = 'awaiting_homeowner' where project_id = %s", (pid,))
    proj._announce(pid, {"homeowner_id": p["homeowner_id"], "name": p["name"], "address": p["address"],
                      "user_ids": [], "group_id": None}, acct)  # fmt: skip
    return {"message": f"{p['h_name'] or 'The homeowner'} has been asked again to approve."}


# ------------------------------------------------------------------ details


@router.patch("/projects/{pid}")
def edit_details(pid: int, body: proj.ProjectIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """A project manager changes the project's details or dates. Every change is in the audit log."""
    p = _project(pid)
    v = proj._validate(body)
    geo: dict[str, Any] = {}
    note = ""
    if v["postal"] != p["postal_code"]:
        try:
            loc = onemap.resolve(None, v["postal"])
            geo = {"site_lat": loc.lat, "site_lng": loc.lng, "geocoded_address": v["address"],
                   "geocode_source": "onemap"}  # fmt: skip
        except onemap.GeocodeError as exc:
            if exc.reason in ("not_found", "invalid_query"):
                raise HTTPException(400, exc.for_people()) from exc
            note = " The new site's GPS location couldn't be looked up yet, so check-in is off until it is."

    linking = v["homeowner_id"] and v["homeowner_id"] != p["homeowner_id"]
    status = p["status"]
    if status == "draft" and v["homeowner_id"]:
        status = "awaiting_homeowner"
    elif not v["homeowner_id"] and status in BEFORE_APPROVAL:
        status = "draft"

    before_crew = _audience(p)
    with transaction(acct.uid) as cur:
        sets = {
            "name": v["name"], "address": v["address"], "postal_code": v["postal"], "homeowner_id": v["homeowner_id"],
            "homeowner_name": v["homeowner_name"], "homeowner_contact_no": v["contact"],
            "contractor_group_id": v["group_id"], "contractor_text": v["contractor_text"],
            "installation_start_date": v["start"], "target_end_date": v["end"], "status": status, **geo,
        }  # fmt: skip
        cols = ", ".join(f"{k} = %({k})s" for k in sets)
        cur.execute(f"update projects set {cols}, updated_at = now() where project_id = %(pid)s", {**sets, "pid": pid})
        if geo:
            cur.execute("update projects set geocoded_at = now() where project_id = %s", (pid,))
        cur.execute("delete from project_assignments where project_id = %s and not (user_id = any(%s))",
                    (pid, v["user_ids"]))  # fmt: skip
        for uid in v["user_ids"]:
            cur.execute(
                "insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s) "
                "on conflict do nothing",
                (pid, uid, acct.uid),
            )

    after = _project(pid)
    for uid in _audience(after) - before_crew - {acct.uid, after["homeowner_id"]}:
        text = f"{after['name']} — {after['address']}"
        notify.notify(uid, "assignment", "New project assigned", text, project_id=pid)
    if linking and status == "awaiting_homeowner":
        proj._announce(pid, {"homeowner_id": v["homeowner_id"], "name": v["name"], "address": v["address"],
                          "user_ids": [], "group_id": None}, acct)  # fmt: skip
        return {"message": "Saved. The homeowner's account is linked and they've been asked to approve." + note}
    return {"message": "Saved. Every change is in the audit log." + note}


@router.post("/projects/{pid}/milestones/{n}/reopen")
def reopen(pid: int, n: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Reopens a completed milestone (and any after it) so its fields can change again."""
    if n not in (1, 2, 3):
        raise HTTPException(400, "There are three milestones.")
    _project(pid)
    with transaction(acct.uid) as cur:
        cur.execute(
            "delete from project_milestones where project_id = %s and milestone_no >= %s returning milestone_no",
            (pid, n),
        )
        gone = cur.fetchall()
    if not gone:
        raise HTTPException(409, f"Milestone {n} isn't recorded as complete.")
    return {"message": f"Milestone {n} reopened. The crew can change its fields again."}
