"""People: accounts, sign-up requests and contractor groups. Project managers only.

Every write runs as the PM (app.actor_uid), so the audit log attributes it
and the database's own guards (0012, 0015) judge it — this module checks the
same rules first only so people get a clear message.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _lib import clerk, notify
from _lib.account import ROLE_LABEL, SG, Account, apply_schedule
from _lib.db import fetch_all, fetch_one, transaction
from _lib.profile import ROLES, ProfileIn, clean_email, clean_profile
from _lib.web import role

router = APIRouter()
pm_only = role("project_manager")

CREW_ROLES = ("contractor", "epc_team")


def avatar_url(u: dict[str, Any]) -> str | None:
    """Where a person's picture loads from; the version changes whenever it does."""
    if not u.get("avatar_key"):
        return None
    v = int(u["avatar_updated_at"].timestamp()) if u.get("avatar_updated_at") else 0
    return f"/api/py/avatars/{u['uid']}?v={v}"


def iso_day(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _user_row(u: dict[str, Any], groups: list[int]) -> dict[str, Any]:
    return {
        "uid": u["uid"],
        "avatar": avatar_url(u),
        "disableOn": iso_day(u.get("disable_on")),
        "enableOn": iso_day(u.get("enable_on")),
        "disabledReason": u.get("disabled_reason"),
        "fullName": u["full_name"],
        "email": u["email"],
        "role": u["user_type"],
        "roleLabel": ROLE_LABEL[u["user_type"]],
        "contactNo": u["contact_no"],
        "active": u["active"],
        "linked": u["clerk_user_id"] is not None,
        "invitedAt": u["invited_at"].isoformat() if u["invited_at"] else None,
        "groups": groups,
    }


# ------------------------------------------------------------------ read


@router.get("/people")
def people(acct: Account = Depends(pm_only)) -> dict[str, Any]:
    apply_schedule()  # anyone whose expiry or enable date has come shows as they now are
    users = fetch_all("select * from users order by active desc, full_name nulls last, email")
    members = fetch_all("select group_id, user_id from contractor_group_members")
    by_user: dict[int, list[int]] = {}
    by_group: dict[int, list[int]] = {}
    for m in members:
        by_user.setdefault(m["user_id"], []).append(m["group_id"])
        by_group.setdefault(m["group_id"], []).append(m["user_id"])

    groups = fetch_all(
        "select g.group_id, g.name, (select count(*) from projects p where p.contractor_group_id = g.group_id)::int "
        "as projects from contractor_groups g order by g.name"
    )
    requests = fetch_all(
        "select request_id, full_name, email, requested_type, contact_no, address, postal_code, note, created_at "
        "from account_requests where status = 'pending' order by created_at"
    )
    role_requests = fetch_all(
        "select r.request_id, r.uid, r.from_type, r.requested_type, r.reason, r.created_at, u.full_name, u.email, "
        "u.contact_no from role_change_requests r join users u on u.uid = r.uid where r.status = 'pending' "
        "order by r.created_at"
    )
    return {
        "me": acct.uid,
        "users": [_user_row(u, by_user.get(u["uid"], [])) for u in users],
        "groups": [
            {
                "id": g["group_id"],
                "name": g["name"],
                "members": by_group.get(g["group_id"], []),
                "projects": g["projects"],
            }
            for g in groups
        ],
        "requests": [
            {
                "id": r["request_id"],
                "fullName": r["full_name"],
                "email": r["email"],
                "role": r["requested_type"],
                "roleLabel": ROLE_LABEL[r["requested_type"]],
                "contactNo": r["contact_no"],
                "address": r["address"],
                "postalCode": r["postal_code"],
                "note": r["note"],
                "createdAt": r["created_at"].isoformat(),
            }
            for r in requests
        ],
        "roleRequests": [
            {
                "id": r["request_id"],
                "uid": r["uid"],
                "fullName": r["full_name"] or r["email"],
                "email": r["email"],
                "contactNo": r["contact_no"],
                "from": r["from_type"],
                "fromLabel": ROLE_LABEL[r["from_type"]],
                "role": r["requested_type"],
                "roleLabel": ROLE_LABEL[r["requested_type"]],
                "reason": r["reason"],
                "createdAt": r["created_at"].isoformat(),
            }
            for r in role_requests
        ],
    }


@router.get("/people/{uid}/projects")
def visible_projects(uid: int, _acct: Account = Depends(pm_only)) -> list[dict[str, Any]]:
    """The projects this person can open — as a homeowner, named on them, or through a group."""
    rows = fetch_all(
        """
        select p.project_id, p.name, p.status from projects p
         where p.homeowner_id = %(u)s
            or exists (select 1 from project_assignments a where a.project_id = p.project_id and a.user_id = %(u)s)
            or exists (select 1 from contractor_group_members m
                        where m.group_id = p.contractor_group_id and m.user_id = %(u)s)
         order by p.name
        """,
        {"u": uid},
    )
    return [{"id": r["project_id"], "name": r["name"], "status": r["status"]} for r in rows]


# ----------------------------------------------------------- create user


class NewUserIn(ProfileIn):
    email: str = ""
    groupId: int | None = None
    # Asked when an account is made: when it expires, or that it doesn't.
    expiresOn: str | None = None
    noExpiry: bool = False


def sg_today() -> date:
    return datetime.now(SG).date()


def parse_day(raw: str | None, what: str) -> date | None:
    if not raw:
        return None
    try:
        d = date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(400, f"The {what} isn't a date.") from exc
    if d <= sg_today():
        raise HTTPException(400, f"The {what} must be after today.")
    return d


def expiry_from(expires_on: str | None, no_expiry: bool) -> date | None:
    """A new account's expiry: a date after today, or explicitly none."""
    if no_expiry:
        return None
    d = parse_day(expires_on, "expiry date")
    if not d:
        raise HTTPException(400, "Set when the account expires, or tick No expiry.")
    return d


@router.post("/people")
def create_user(body: NewUserIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    email = clean_email(body.email)
    p = clean_profile(body, require_mobile=True)
    expires = expiry_from(body.expiresOn, body.noExpiry)
    if fetch_one("select 1 from users where lower(email) = %s", (email,)):
        raise HTTPException(409, "An account with that email already exists.")

    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into users (full_name, user_type, contact_no, ic_last4, email, address, postal_code, "
            "invited_at, invited_by, disable_on) values (%s,%s,%s,%s,%s,%s,%s, now(), %s, %s) returning uid",
            (
                p["full_name"],
                p["user_type"],
                p["contact_no"],
                p["ic_last4"],
                email,
                p["address"],
                p["postal_code"],
                acct.uid,
                expires,
            ),
        )
        uid = cur.fetchone()["uid"]
        if body.groupId and p["user_type"] in CREW_ROLES:
            cur.execute(
                "insert into contractor_group_members (group_id, user_id, added_by) values (%s, %s, %s)",
                (body.groupId, uid, acct.uid),
            )

    # The sign-up link. If the address already has a Clerk login, there is
    # nothing to invite — the account links itself on their next sign-in.
    link = f"{notify.app_url()}/sign-in"
    try:
        inv = clerk.create_invitation(email, f"{notify.app_url()}/sign-up")
        link = inv.get("url") or link
        with transaction(acct.uid) as cur:
            cur.execute("update users set clerk_invitation_id = %s where uid = %s", (inv.get("id"), uid))
    except clerk.ClerkApiError as exc:
        print(f"[people] invitation not created for uid {uid}: {exc}")

    role_label = ROLE_LABEL[p["user_type"]]
    m = notify.msg_account_created(p["full_name"], role_label, link)
    report = notify.notify(
        uid,
        "account_created",
        m["title"],
        m["body"],
        email=(email, *m["email"]),
        mobile=(p["contact_no"], *m["whatsapp"], m["sms"]),
    )
    return {"uid": uid, "message": f"Created {p['full_name']} as {role_label}. {notify.describe(report)}"}


# ----------------------------------------------------------- edit user


class UserPatch(BaseModel):
    role: str | None = None
    active: bool | None = None
    # Dates (YYYY-MM-DD) or null to clear; leave out to keep. disableOn is the
    # expiry: the account disables itself that day. enableOn re-enables a
    # disabled account that day.
    disableOn: str | None = None
    enableOn: str | None = None


def day_text(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


@router.patch("/people/{uid}")
def update_user(uid: int, body: UserPatch, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    user = fetch_one("select * from users where uid = %s", (uid,))
    if not user:
        raise HTTPException(404, "No such account.")
    if body.role is not None and body.role not in ROLES:
        raise HTTPException(400, "Choose a role.")
    sent = body.model_fields_set
    today = sg_today()
    disable_on = parse_day(body.disableOn, "expiry date") if "disableOn" in sent else user["disable_on"]
    enable_on = parse_day(body.enableOn, "enable date") if "enableOn" in sent else user["enable_on"]
    active = user["active"] if body.active is None else body.active
    if uid == acct.uid and (active is False or (disable_on and "disableOn" in sent)):
        raise HTTPException(400, "You can't disable your own account, or set it to expire.")
    if enable_on and disable_on and enable_on >= disable_on:
        raise HTTPException(400, "The enable date must be before the expiry date.")
    reason = user["disabled_reason"]
    messages: list[str] = []
    name = user["full_name"] or "Account"

    if body.active is True and not user["active"]:
        if disable_on and disable_on <= today:
            raise HTTPException(400, "Their expiry date has passed. Move it later or clear it first.")
        reason, enable_on = None, None
        messages.append(f"{name} re-enabled.")
    elif body.active is False and user["active"]:
        reason = "manual"
        messages.append(f"{name} disabled — sign-in blocked. Their history stays in the audit log.")
    elif not user["active"] and user["disabled_reason"] == "scheduled" and "disableOn" in sent and body.active is None:
        # Moving an expired account's expiry later (or clearing it) re-enables it.
        if not disable_on or disable_on > today:
            active, reason = True, None
            messages.append(f"{name} re-enabled: the expiry date moved.")
    if "disableOn" in sent:
        messages.append(
            f"{name}'s account expires on {day_text(disable_on)}."
            if disable_on
            else f"{name}'s account doesn't expire."
        )
    if "enableOn" in sent:
        messages.append(
            f"{name}'s account enables itself on {day_text(enable_on)}."
            if enable_on
            else f"{name}'s account won't enable itself."
        )

    with transaction(acct.uid) as cur:
        if body.role is not None and body.role != user["user_type"]:
            cur.execute("update users set user_type = %s, updated_at = now() where uid = %s", (body.role, uid))
            # Only crews belong in contractor groups; leaving the role leaves the groups.
            if body.role not in CREW_ROLES:
                cur.execute("delete from contractor_group_members where user_id = %s", (uid,))
            messages.append(f"{name} is now {ROLE_LABEL[body.role]}.")
        cur.execute(
            "update users set active = %s, disabled_reason = %s, disable_on = %s, enable_on = %s, updated_at = now() "
            "where uid = %s and (active, disabled_reason, disable_on, enable_on) "
            "is distinct from (%s, %s, %s, %s)",
            (active, reason, disable_on, enable_on, uid, active, reason, disable_on, enable_on),
        )
    apply_schedule()  # an expiry of today, say, takes effect now
    return {"message": " ".join(messages) or "Nothing changed."}


# -------------------------------------------------------------- requests


class DecisionIn(BaseModel):
    role: str | None = None
    note: str | None = None
    expiresOn: str | None = None
    noExpiry: bool = False
    # Contractor admins and EPC crew can be put into a group as they're approved,
    # the same as when a PM creates their account directly.
    groupId: int | None = None


@router.post("/account-requests/{request_id}/approve")
def approve(request_id: int, body: DecisionIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    if body.role not in ROLES:
        raise HTTPException(400, "Choose a role to grant.")
    req = fetch_one("select email, status from account_requests where request_id = %s", (request_id,))
    if not req:
        raise HTTPException(404, "No such request.")
    if req["status"] != "pending":
        raise HTTPException(409, f"This request has already been {req['status']}.")
    if fetch_one("select 1 from users where lower(email) = lower(%s)", (req["email"],)):
        raise HTTPException(409, "An account with that email already exists. Decline this request instead.")
    expires = expiry_from(body.expiresOn, body.noExpiry)

    # One transaction: the account, the approval and any group membership
    # exist together or not at all.
    with transaction(acct.uid) as cur:
        cur.execute(
            "select approve_account_request(%s, %s, %s) as uid",
            (request_id, body.role, (body.note or "").strip() or None),
        )
        uid = cur.fetchone()["uid"]
        if expires:
            cur.execute("update users set disable_on = %s where uid = %s", (expires, uid))
        if body.groupId and body.role in CREW_ROLES:
            cur.execute(
                "insert into contractor_group_members (group_id, user_id, added_by) values (%s, %s, %s)",
                (body.groupId, uid, acct.uid),
            )
    user = fetch_one("select full_name, email, contact_no from users where uid = %s", (uid,))
    assert user is not None
    role_label = ROLE_LABEL[body.role]
    m = notify.msg_account_approved(user["full_name"], role_label, notify.app_url())
    report = notify.notify(
        uid,
        "account_approved",
        m["title"],
        m["body"],
        email=(user["email"], *m["email"]),
        mobile=(user["contact_no"], *m["whatsapp"], m["sms"]),
    )
    return {"uid": uid, "message": f"Approved {user['full_name']} as {role_label}. {notify.describe(report)}"}


@router.post("/account-requests/{request_id}/reject")
def reject(request_id: int, body: DecisionIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    note = (body.note or "").strip()[:500] or None
    with transaction(acct.uid) as cur:
        cur.execute(
            "update account_requests set status = 'rejected', decision_note = %s "
            "where request_id = %s and status = 'pending' returning full_name, email, contact_no",
            (note, request_id),
        )
        req = cur.fetchone()
    if not req:
        raise HTTPException(409, "That request has already been decided.")
    # No account exists, so no in-app notification — email and mobile only.
    m = notify.msg_account_rejected(req["full_name"], note)
    results = {"email": notify.send_email(req["email"], *m["email"])}
    results.update(notify.send_mobile(req["contact_no"], *m["whatsapp"], m["sms"]))
    return {"message": f"Declined {req['full_name']}. {notify.describe(results)}"}


# ---------------------------------------------------------------- groups


class GroupIn(BaseModel):
    name: str = ""


class MemberIn(BaseModel):
    uid: int


@router.post("/groups")
def create_group(body: GroupIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    name = body.name.strip()
    if len(name) < 3:
        raise HTTPException(400, "Enter the group's name.")
    if fetch_one("select 1 from contractor_groups where lower(name) = lower(%s)", (name,)):
        raise HTTPException(409, "A group with that name already exists.")
    with transaction(acct.uid) as cur:
        cur.execute("insert into contractor_groups (name) values (%s) returning group_id", (name,))
        gid = cur.fetchone()["group_id"]
    return {"id": gid, "message": f"{name} created. Add members to it next."}


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    g = fetch_one(
        "select name, (select count(*) from projects where contractor_group_id = %(g)s)::int as used "
        "from contractor_groups where group_id = %(g)s",
        {"g": group_id},
    )
    if not g:
        raise HTTPException(404, "No such group.")
    if g["used"]:
        raise HTTPException(409, f"Can't delete — {g['name']} is assigned to {g['used']} project(s).")
    with transaction(acct.uid) as cur:
        cur.execute("delete from contractor_group_members where group_id = %s", (group_id,))
        cur.execute("delete from contractor_groups where group_id = %s", (group_id,))
    return {"message": f"{g['name']} deleted."}


@router.post("/groups/{group_id}/members")
def add_member(group_id: int, body: MemberIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    g = fetch_one("select name from contractor_groups where group_id = %s", (group_id,))
    u = fetch_one("select full_name, user_type from users where uid = %s", (body.uid,))
    if not g or not u:
        raise HTTPException(404, "No such group or person.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into contractor_group_members (group_id, user_id, added_by) values (%s, %s, %s) "
            "on conflict do nothing",
            (group_id, body.uid, acct.uid),
        )
    notify.notify(body.uid, "assignment", f"Added to {g['name']}", "You now have access to this group's projects.")
    return {"message": f"{u['full_name']} added to {g['name']}."}


@router.delete("/groups/{group_id}/members/{uid}")
def remove_member(group_id: int, uid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    with transaction(acct.uid) as cur:
        cur.execute(
            "delete from contractor_group_members where group_id = %s and user_id = %s returning user_id",
            (group_id, uid),
        )
        gone = cur.fetchone()
    if not gone:
        raise HTTPException(404, "They weren't in that group.")
    return {"message": "Removed from the group."}
