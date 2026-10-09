"""Account settings: each person manages their own name, email, mobile, password and role.

  PATCH  /me/name               a new display name
  POST   /me/email/sync         after Clerk has verified a new sign-in email, adopt it
  POST   /me/mobile/send        a code to a new mobile, by WhatsApp (SMS if that fails)
  POST   /me/mobile/verify      the code; the number changes only now
  POST   /me/password-changed   note a password change made in Clerk (for the audit log)
  POST   /me/role-request       ask a project manager for a different role
  DELETE /me/role-request       withdraw it
  POST   /role-requests/{id}/approve | reject   a project manager decides

Every change is written through the database's own rules (migration 0022)
and lands in the audit log under the person who made it.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _lib import clerk, demo, notify
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.profile import clean_phone
from _lib.rights import may_manage
from _lib.web import act_as_allowed, active, role

router = APIRouter()
pm_only = role("project_manager")

ROLES = tuple(ROLE_LABEL)


def _yourself(acct: Account) -> None:
    """Sign-in email and password belong to the Clerk login, which while acting is the PM's own."""
    if acct.demo:
        raise HTTPException(403, demo.OFF["sign_in"])
    if acct.acting_pm:
        raise HTTPException(403, "Not while testing as someone else: this changes the sign-in itself.")


CREW_ROLES = ("contractor", "epc_team")
CODE_MINUTES = 10
CODE_TRIES = 5
RESEND_SECONDS = 30
CODES_PER_HOUR = 5


# ------------------------------------------------------------------ name


class NameIn(BaseModel):
    fullName: str = ""


@router.patch("/me/name")
def change_name(body: NameIn, acct: Account = Depends(active)) -> dict[str, Any]:
    name = re.sub(r"\s+", " ", body.fullName).strip()
    if not 2 <= len(name) <= 80:
        raise HTTPException(400, "Enter your full name (2 to 80 characters).")
    with transaction(acct.uid) as cur:
        cur.execute("update users set full_name = %s, updated_at = now() where uid = %s", (name, acct.uid))
    return {"message": "Name updated.", "fullName": name}


# ------------------------------------------------------------------ email


@router.post("/me/email/sync")
def sync_email(acct: Account = Depends(active)) -> dict[str, Any]:
    """The browser changed the sign-in email in Clerk (with Clerk's code). Trust only what Clerk says now."""
    _yourself(acct)
    cu = clerk.get_user(acct.identity.clerk_user_id)
    new = cu.primary_email
    if not new or new not in cu.verified_emails:
        raise HTTPException(400, "Verify the new email address first.")
    old = acct.user["email"]
    if new == old.lower():
        return {"message": "That's already your email.", "email": old}
    if fetch_one("select 1 from users where lower(email) = %s and uid <> %s", (new, acct.uid)):
        raise HTTPException(409, "Another account already uses that email.")
    with transaction(acct.uid) as cur:
        cur.execute("select set_own_email(%s)", (new,))
    return {"message": f"Email changed to {new}. Use it to sign in from now on.", "email": new}


# ------------------------------------------------------------------ mobile


class MobileIn(BaseModel):
    number: str = ""
    channel: str = "auto"  # auto: WhatsApp, then SMS if that fails | sms: SMS only


class CodeIn(BaseModel):
    code: str = ""


def _hash(code: str, salt: str) -> str:
    return f"{salt}${hashlib.sha256(f'{salt}:{code}'.encode()).hexdigest()}"


def _matches(code: str, stored: str) -> bool:
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(_hash(code, salt), stored)


def mask(number: str) -> str:
    digits = re.sub(r"\D", "", number)
    return f"•••• {digits[-4:]}" if len(digits) >= 4 else number


@router.post("/me/mobile/send")
def send_mobile_code(body: MobileIn, acct: Account = Depends(active)) -> dict[str, Any]:
    number = clean_phone(body.number)
    if not number:
        raise HTTPException(400, "Enter your mobile number.")
    to = notify.to_whatsapp_number(number)
    if not to:
        raise HTTPException(400, "That doesn't look like a mobile number.")
    if number == acct.user["contact_no"]:
        raise HTTPException(400, "That's already your mobile number.")

    recent = fetch_all(
        "select created_at, extract(epoch from now() - created_at) as age from verification_codes "
        "where uid = %s and purpose = 'mobile' and created_at > now() - interval '1 hour' order by created_at desc",
        (acct.uid,),
    )
    if recent and recent[0]["age"] < RESEND_SECONDS:
        wait = int(RESEND_SECONDS - recent[0]["age"]) + 1
        raise HTTPException(429, f"Please wait {wait} seconds before asking for another code.")
    if len(recent) >= CODES_PER_HOUR:
        raise HTTPException(429, "Too many codes in the last hour. Please try again later.")

    code = f"{secrets.randbelow(10**6):06d}"
    lang = acct.user.get("language") or "en"
    text = notify.msg_verification_code(code, CODE_MINUTES, lang)
    results: dict[str, notify.SendResult] = {}
    dev_code, sent_by = None, None
    if demo.enabled():
        # Nothing leaves the demo, so the code is shown on screen instead.
        sent_by, dev_code = "demo", code
    else:
        if body.channel != "sms":
            results["whatsapp"] = notify.send_whatsapp(to, "verification_code", [code], copy_code=code, lang=lang)
        if results.get("whatsapp") is None or results["whatsapp"].status != "sent":
            results["sms"] = notify.send_sms(to, text)
        sent_by = next((ch for ch, r in results.items() if r.status == "sent"), None)

    if not sent_by:
        # On a laptop, against a database that isn't production, the code is
        # shown on screen so the flow can be tried before WhatsApp/SMS exist.
        if not act_as_allowed():
            print(f"[settings] mobile code not sent: {notify.describe(results)}")
            raise HTTPException(503, "We couldn't send a code right now: WhatsApp and SMS aren't set up yet.")
        sent_by, dev_code = "dev", code

    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into verification_codes (uid, purpose, target, code_hash, channel, expires_at) "
            "values (%s, 'mobile', %s, %s, %s, now() + make_interval(mins => %s))",
            (
                acct.uid,
                number,
                _hash(code, secrets.token_hex(8)),
                "dev" if sent_by == "demo" else sent_by,
                CODE_MINUTES,
            ),  # fmt: skip
        )
    where = {
        "whatsapp": "by WhatsApp",
        "sms": "by SMS",
        "dev": "(shown here: messaging isn't set up)",
        "demo": "(shown here: the demo sends no messages)",
    }[sent_by]
    out: dict[str, Any] = {"sentBy": sent_by, "to": mask(number), "message": f"Code sent to {mask(number)} {where}."}
    if dev_code:
        out["devCode"] = dev_code
    return out


@router.post("/me/mobile/verify")
def verify_mobile_code(body: CodeIn, acct: Account = Depends(active)) -> dict[str, Any]:
    code = re.sub(r"\D", "", body.code)
    row = fetch_one(
        "select * from verification_codes where uid = %s and purpose = 'mobile' and consumed_at is null "
        "order by created_at desc limit 1",
        (acct.uid,),
    )
    if not row or row["expires_at"].timestamp() < time.time():
        raise HTTPException(400, "That code has expired. Ask for a new one.")
    if row["attempts"] >= CODE_TRIES:
        raise HTTPException(429, "Too many wrong tries. Ask for a new code.")
    if len(code) != 6 or not _matches(code, row["code_hash"]):
        with transaction(acct.uid) as cur:
            cur.execute("update verification_codes set attempts = attempts + 1 where code_id = %s", (row["code_id"],))
        left = CODE_TRIES - row["attempts"] - 1
        raise HTTPException(400, f"That code isn't right. {left} {'try' if left == 1 else 'tries'} left." if left
                            else "That code isn't right. Ask for a new code.")  # fmt: skip
    with transaction(acct.uid) as cur:
        cur.execute("update verification_codes set consumed_at = now() where code_id = %s", (row["code_id"],))
        cur.execute("select set_own_mobile(%s)", (row["target"],))
    return {"message": f"Mobile number changed to {row['target']}.", "contactNo": row["target"]}


# ---------------------------------------------------------------- password


@router.post("/me/password-changed")
def password_changed(acct: Account = Depends(active)) -> dict[str, Any]:
    """Clerk changed the password (old one checked there). Record when, never what."""
    _yourself(acct)
    cu = clerk.get_user(acct.identity.clerk_user_id)
    if not cu.password_enabled or time.time() * 1000 - cu.updated_at_ms > 5 * 60 * 1000:
        raise HTTPException(409, "No recent password change found.")
    with transaction(acct.uid) as cur:
        cur.execute("select record_password_change()")
    return {"message": "Password changed. You've been signed out on your other devices."}


# ------------------------------------------------------------------ role


class RoleIn(BaseModel):
    role: str = ""
    reason: str = ""


class DecisionIn(BaseModel):
    role: str | None = None
    groupId: int | None = None
    note: str | None = None


def _pms() -> list[dict[str, Any]]:
    return fetch_all("select uid, email from users where user_type in ('project_manager', 'superadmin') and active")


@router.post("/me/role-request")
def request_role(body: RoleIn, acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.user["user_type"] == "superadmin":
        raise HTTPException(400, "Superadmin accounts are managed directly in the database.")
    if acct.user["user_type"] == "project_manager":
        raise HTTPException(400, "Ask a superadmin to change a project manager's role.")
    if body.role not in ROLES:
        raise HTTPException(400, "Choose the role you need.")
    if body.role == acct.user["user_type"]:
        raise HTTPException(400, "That's already your role.")
    reason = body.reason.strip()[:500]
    if len(reason) < 5:
        raise HTTPException(400, "Tell the project manager why you need it (a sentence is enough).")
    if fetch_one("select 1 from role_change_requests where uid = %s and status = 'pending'", (acct.uid,)):
        raise HTTPException(409, "You already have a request waiting. Withdraw it first to ask for something else.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into role_change_requests (uid, from_type, requested_type, reason) values (%s, %s, %s, %s)",
            (acct.uid, acct.user["user_type"], body.role, reason),
        )
    name = acct.user["full_name"] or acct.user["email"]
    for pm in _pms():
        m = notify.msg_role_requested(
            name, ROLE_LABEL[acct.user["user_type"]], ROLE_LABEL[body.role], reason,
            f"{notify.app_url()}/people?tab=requests", notify.lang_of(pm["uid"]),
        )  # fmt: skip
        try:
            notify.notify(pm["uid"], "role_request", m["title"], m["body"], email=(pm["email"], *m["email"]))
        except Exception as exc:  # one PM's failure must not lose the request
            print(f"[settings] notify PM {pm['uid']} failed: {exc}")
    return {"message": f"Asked to become {ROLE_LABEL[body.role]}. A project manager will review it."}


@router.delete("/me/role-request")
def withdraw_role_request(acct: Account = Depends(active)) -> dict[str, Any]:
    with transaction(acct.uid) as cur:
        cur.execute(
            "update role_change_requests set status = 'cancelled' where uid = %s and status = 'pending' returning 1",
            (acct.uid,),
        )
        if not cur.fetchone():
            raise HTTPException(404, "You have no request waiting.")
    return {"message": "Request withdrawn."}


def _pending(request_id: int) -> dict[str, Any]:
    r = fetch_one(
        "select r.*, u.full_name, u.email, u.contact_no, u.active from role_change_requests r "
        "join users u on u.uid = r.uid where r.request_id = %s",
        (request_id,),
    )
    if not r:
        raise HTTPException(404, "No such request.")
    if r["status"] != "pending":
        raise HTTPException(409, f"This request has already been {r['status']}.")
    return r


def _tell(r: dict[str, Any], role_key: str, approved: bool, note: str | None) -> str:
    m = notify.msg_role_decided(
        r["full_name"] or r["email"], ROLE_LABEL[role_key], approved, note, notify.app_url(), notify.lang_of(r["uid"])
    )
    report = notify.notify(
        r["uid"],
        "role_approved" if approved else "role_rejected",
        m["title"],
        m["body"],
        email=(r["email"], *m["email"]),
        mobile=(r["contact_no"], *m["whatsapp"], m["sms"]),
    )
    return notify.describe(report)


@router.post("/role-requests/{request_id}/approve")
def approve_role(request_id: int, body: DecisionIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    r = _pending(request_id)
    grant = body.role or r["requested_type"]
    if grant not in ROLES:
        raise HTTPException(400, "Choose a role to grant.")
    may_manage(acct, r["from_type"], r["requested_type"], grant)
    if not r["active"]:
        raise HTTPException(409, "This account is disabled. Re-enable it first.")
    note = (body.note or "").strip()[:500] or None
    with transaction(acct.uid) as cur:
        cur.execute(
            "update role_change_requests set status = 'approved', decided_at = now(), decided_by = %s, "
            "decision_note = %s where request_id = %s",
            (acct.uid, note, request_id),
        )
        cur.execute("update users set user_type = %s, updated_at = now() where uid = %s", (grant, r["uid"]))
        if grant not in CREW_ROLES:
            cur.execute("delete from contractor_group_members where user_id = %s", (r["uid"],))
        elif body.groupId:
            cur.execute(
                "insert into contractor_group_members (group_id, user_id, added_by) values (%s, %s, %s) "
                "on conflict do nothing",
                (body.groupId, r["uid"], acct.uid),
            )
    sent = _tell(r, grant, True, note)
    return {"message": f"{r['full_name']} is now {ROLE_LABEL[grant]}. {sent}"}


@router.post("/role-requests/{request_id}/reject")
def reject_role(request_id: int, body: DecisionIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    r = _pending(request_id)
    may_manage(acct, r["from_type"], r["requested_type"])
    note = (body.note or "").strip()[:500] or None
    with transaction(acct.uid) as cur:
        cur.execute(
            "update role_change_requests set status = 'rejected', decided_at = now(), decided_by = %s, "
            "decision_note = %s where request_id = %s",
            (acct.uid, note, request_id),
        )
    sent = _tell(r, r["requested_type"], False, note)
    return {"message": f"Declined {r['full_name']}'s request. {sent}"}
