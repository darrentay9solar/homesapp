"""The signed-in person: GET /api/py/me."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from _lib.account import ROLE_LABEL, Account
from _lib.web import account

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
    if acct.clerk_user:
        out["clerk"] = {
            "fullName": acct.clerk_user.full_name,
            "email": acct.clerk_user.primary_email,
            "phone": acct.clerk_user.phone,
        }
    return out
