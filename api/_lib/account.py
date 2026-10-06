"""Where a signed-in Clerk user stands with GetHomeApps.

Clerk proves who someone is; this decides whether they have an account.
An account exists only once a project manager created one or approved a
request — signing in to Clerk alone grants nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from _lib import clerk
from _lib.auth import ClerkIdentity
from _lib.db import fetch_one, transaction

State = Literal["active", "deactivated", "pending", "rejected", "no_account"]

ROLE_LABEL = {
    "homeowner": "Homeowner",
    "project_manager": "Project Manager",
    "contractor": "Contractor Admin",
    "epc_team": "EPC Team",
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

    @property
    def uid(self) -> int:
        assert self.user is not None
        return int(self.user["uid"])

    @property
    def role(self) -> str | None:
        return self.user["user_type"] if self.user else None


def resolve(identity: ClerkIdentity) -> Account:
    # 1. Already linked — the common case, one indexed lookup.
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
            "select uid from users where lower(email) = any(%s) and clerk_user_id is null "
            "order by uid limit 1",
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
                return Account(
                    "active" if linked["active"] else "deactivated", identity, user=linked, clerk_user=cu
                )

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
