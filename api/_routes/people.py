"""People: accounts, sign-up requests and contractor groups. Project managers only.

Every write runs as the PM (app.actor_uid), so the audit log attributes it
and the database's own guards (0012, 0015) judge it — this module checks the
same rules first only so people get a clear message.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _lib import clerk, notify
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.profile import ROLES, ProfileIn, clean_email, clean_profile
from _lib.web import role

router = APIRouter()
pm_only = role("project_manager")

CREW_ROLES = ("contractor", "epc_team")


def _user_row(u: dict[str, Any], groups: list[int]) -> dict[str, Any]:
    return {
        "uid": u["uid"],
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


@router.post("/people")
def create_user(body: NewUserIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    email = clean_email(body.email)
    p = clean_profile(body)
    if fetch_one("select 1 from users where lower(email) = %s", (email,)):
        raise HTTPException(409, "An account with that email already exists.")

    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into users (full_name, user_type, contact_no, ic_last4, email, address, postal_code, "
            "invited_at, invited_by) values (%s,%s,%s,%s,%s,%s,%s, now(), %s) returning uid",
            (
                p["full_name"],
                p["user_type"],
                p["contact_no"],
                p["ic_last4"],
                email,
                p["address"],
                p["postal_code"],
                acct.uid,
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


@router.patch("/people/{uid}")
def update_user(uid: int, body: UserPatch, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    user = fetch_one("select uid, user_type, active, full_name from users where uid = %s", (uid,))
    if not user:
        raise HTTPException(404, "No such account.")
    if body.role is not None and body.role not in ROLES:
        raise HTTPException(400, "Choose a role.")

    with transaction(acct.uid) as cur:
        if body.role is not None and body.role != user["user_type"]:
            cur.execute("update users set user_type = %s, updated_at = now() where uid = %s", (body.role, uid))
            # Only crews belong in contractor groups; leaving the role leaves the groups.
            if body.role not in CREW_ROLES:
                cur.execute("delete from contractor_group_members where user_id = %s", (uid,))
        if body.active is not None and body.active != user["active"]:
            if uid == acct.uid and not body.active:
                raise HTTPException(400, "You can't disable your own account.")
            cur.execute("update users set active = %s, updated_at = now() where uid = %s", (body.active, uid))

    name = user["full_name"] or "Account"
    if body.active is False:
        return {"message": f"{name} disabled — sign-in blocked. Their history stays in the audit log."}
    if body.active is True:
        return {"message": f"{name} re-enabled."}
    return {"message": f"{name} is now {ROLE_LABEL[body.role or user['user_type']]}."}


# -------------------------------------------------------------- requests


class DecisionIn(BaseModel):
    role: str | None = None
    note: str | None = None


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

    # One statement: the account and the approval exist together or not at all.
    with transaction(acct.uid) as cur:
        cur.execute(
            "select approve_account_request(%s, %s, %s) as uid",
            (request_id, body.role, (body.note or "").strip() or None),
        )
        uid = cur.fetchone()["uid"]
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
