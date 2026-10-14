"""The signed-in person: GET /api/py/me."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from _lib import prefs
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one
from _lib.web import account, act_as_allowed, role
from _routes.people import avatar_url

router = APIRouter()


def public_user(u: dict[str, Any]) -> dict[str, Any]:
    """What the browser may see about a user. Never the NRIC fragment."""
    return {
        "uid": u["uid"],
        "fullName": u["full_name"],
        "email": u["email"],
        "role": u["user_type"],
        "roleLabel": ROLE_LABEL[u["user_type"]],
        "contactNo": u["contact_no"],
        "address": u["address"],
        "postalCode": u["postal_code"],
        "active": u["active"],
        "avatar": avatar_url(u),
    }


@router.get("/me")
def me(acct: Account = Depends(account)) -> dict[str, Any]:
    out: dict[str, Any] = {"state": acct.state}
    if acct.user:
        out["user"] = public_user(acct.user)
    if acct.request:
        r = acct.request
        out["request"] = {
            "requestedRole": r["requested_type"],
            "requestedRoleLabel": ROLE_LABEL[r["requested_type"]],
            "decisionNote": r["decision_note"],
            "createdAt": r["created_at"].isoformat(),
        }
    if acct.user:
        u = acct.user
        unread = fetch_one(
            "select count(*)::int as n from notifications where recipient_uid = %s and read_at is null",
            (u["uid"],),
            actor_uid=u["uid"],
        )
        out["unread"] = unread["n"] if unread else 0
        # Support conversations with something new from someone else: the Help and Support badges.
        waiting = fetch_one(
            "select count(distinct m.thread_id)::int as n from support_members x "
            "join support_messages m on m.thread_id = x.thread_id and m.message_id > x.last_read_id "
            "where x.user_id = %s and m.sender_uid is distinct from %s and m.kind <> 'event'",
            (u["uid"], u["uid"]),
        )
        out["supportUnread"] = waiting["n"] if waiting else 0
        # Managers: people waiting for a first answer from them (a superadmin: anyone waiting).
        if u["user_type"] in ("project_manager", "superadmin"):
            asked = fetch_one(
                "select count(*)::int as n from support_threads t left join projects p on p.project_id = t.project_id "
                "where t.status = 'waiting' and (%(sa)s or t.handled_by = %(me)s "
                "or (t.handled_by is null and p.project_manager_id = %(me)s))",
                {"sa": u["user_type"] == "superadmin", "me": u["uid"]},
            )
            out["supportWaiting"] = asked["n"] if asked else 0
        rr = fetch_one(
            "select requested_type, reason, created_at from role_change_requests where uid = %s and status = 'pending'",
            (u["uid"],),
        )
        out["settings"] = {
            "language": u.get("language") or "en",
            "notificationPrefs": prefs.normalise(u.get("notification_prefs")),
            "mobileVerifiedAt": u["mobile_verified_at"].isoformat() if u.get("mobile_verified_at") else None,
            "passwordChangedAt": u["password_changed_at"].isoformat() if u.get("password_changed_at") else None,
            "roleRequest": {
                "role": rr["requested_type"],
                "roleLabel": ROLE_LABEL[rr["requested_type"]],
                "reason": rr["reason"],
                "createdAt": rr["created_at"].isoformat(),
            }
            if rr
            else None,
        }
    if acct.state == "deactivated" and acct.user:
        u = acct.user
        out["disabled"] = {
            "reason": u.get("disabled_reason") or "manual",
            "expiredOn": u["disable_on"].isoformat() if u.get("disable_on") else None,
            "enableOn": u["enable_on"].isoformat() if u.get("enable_on") else None,
        }
    if acct.acting_pm:
        out["actingAs"] = {"byName": acct.acting_pm["full_name"], "byUid": acct.acting_pm["uid"]}
    if acct.demo:
        out["demo"] = True
    if acct.clerk_user:
        out["clerk"] = {
            "fullName": acct.clerk_user.full_name,
            "email": acct.clerk_user.primary_email,
            "phone": acct.clerk_user.phone,
        }
    return out


@router.get("/dev/act-as")
def act_as_options(_acct: Account = Depends(role("project_manager"))) -> dict[str, Any]:
    """Development only: the accounts a PM can act as to test other roles."""
    if not act_as_allowed():
        return {"allowed": False, "people": []}
    rows = fetch_all("select * from users where active order by user_type, full_name nulls last, email")
    return {"allowed": True, "people": [public_user(u) for u in rows]}
