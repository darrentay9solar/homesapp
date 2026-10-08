"""Where a signed-in Clerk user stands with GetHomeApps.

Clerk proves who someone is; this decides whether they have an account.
An account exists only once a project manager created one or approved a
request — signing in to Clerk alone grants nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from _lib import clerk
from _lib.auth import ClerkIdentity
from _lib.db import fetch_one, transaction

SG = timezone(timedelta(hours=8))

State = Literal["active", "deactivated", "pending", "rejected", "no_account"]

ROLE_LABEL = {
    "homeowner": "Homeowner",
    "project_manager": "Project Manager",
    "contractor": "Contractor Admin",
    "epc_team": "EPC Team",
    "superadmin": "Superadmin",
}


@dataclass
class Account:
    state: State
    identity: ClerkIdentity
    user: dict[str, Any] | None = None
    request: dict[str, Any] | None = None
    clerk_user: clerk.ClerkUser | None = field(default=None, repr=False)
    # Development only: the project manager who is acting as this account.
    acting_pm: dict[str, Any] | None = None
    # The demonstration site: a visitor trying the app as this sample person (_lib/demo.py).
    demo: bool = False

    @property
    def uid(self) -> int:
        assert self.user is not None
        return int(self.user["uid"])

    @property
    def role(self) -> str | None:
        return self.user["user_type"] if self.user else None


def schedule_due(user: dict[str, Any]) -> bool:
    """Has this account's disable (expiry) or enable date come, without being applied yet?"""
    today = datetime.now(SG).date()
    if user["active"] and user.get("disable_on") and user["disable_on"] <= today:
        return True
    return bool(not user["active"] and user.get("enable_on") and user["enable_on"] <= today)


def apply_schedule() -> int:
    """Disables expired accounts and enables ones whose date has come (migration 0025). Returns how many changed."""
    row = fetch_one("select apply_account_schedule() as n")
    return int(row["n"]) if row else 0


def resolve(identity: ClerkIdentity) -> Account:
    # 1. Already linked — the common case, one indexed lookup.
    user = fetch_one("select * from users where clerk_user_id = %s", (identity.clerk_user_id,))
    if user and schedule_due(user):
        # Their expiry (or re-enable) date has come: apply it before anything else.
        apply_schedule()
        user = fetch_one("select * from users where clerk_user_id = %s", (identity.clerk_user_id,))
    if user:
        return Account("active" if user["active"] else "deactivated", identity, user=user)

    # Everything below is the first visit (or a pending one), so it is fine
    # to ask Clerk for the person's verified email addresses.
    cu = clerk.get_user(identity.clerk_user_id)

    # 2. A PM created this account and is waiting for them. Match only on a
    #    VERIFIED email: anyone can type an address, only its owner can verify it.
    if cu.verified_emails:
        invited = fetch_one(
            "select uid from users where lower(email) = any(%s) and clerk_user_id is null " "order by uid limit 1",
            (cu.verified_emails,),
        )
        if invited:
            # Acting as themselves: the database lets a user set their own
            # clerk_user_id exactly once, from empty.
            with transaction(invited["uid"]) as cur:
                cur.execute(
                    "update users set clerk_user_id = %s, updated_at = now() "
                    "where uid = %s and clerk_user_id is null returning *",
                    (identity.clerk_user_id, invited["uid"]),
                )
                linked = cur.fetchone()
            if linked:
                return Account("active" if linked["active"] else "deactivated", identity, user=linked, clerk_user=cu)

    # 3. They asked for an account themselves.
    req = fetch_one(
        "select * from account_requests where clerk_user_id = %s order by created_at desc limit 1",
        (identity.clerk_user_id,),
    )
    if req and req["status"] == "pending":
        return Account("pending", identity, request=req, clerk_user=cu)
    if req and req["status"] == "rejected":
        return Account("rejected", identity, request=req, clerk_user=cu)

    return Account("no_account", identity, clerk_user=cu)
