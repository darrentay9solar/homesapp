"""Self sign-up: someone with a Clerk login asks for an account.

POST /api/py/account-requests  — nothing is granted; the row lands as
"pending" (the database forces that whatever is sent) and every active
project manager is told.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from _lib import notify
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, transaction
from _lib.i18n import LANGS
from _lib.profile import ProfileIn, clean_profile
from _lib.web import account

router = APIRouter()


class RequestIn(ProfileIn):
    note: str | None = None
    # The language the app was in when they asked; their messages follow it.
    language: str = "en"


@router.post("/account-requests")
def request_account(body: RequestIn, acct: Account = Depends(account)) -> dict[str, Any]:
    if acct.state not in ("no_account", "rejected"):
        raise HTTPException(409, "You already have an account or a request in progress.")
    cu = acct.clerk_user
    if not cu or not cu.primary_email or cu.primary_email not in cu.verified_emails:
        raise HTTPException(400, "Verify your email address first.")

    p = clean_profile(body, require_mobile=True)
    note = (body.note or "").strip()[:500] or None

    # No actor: the requester has no account yet.
    with transaction(None) as cur:
        cur.execute(
            "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no, "
            "ic_last4, address, postal_code, note, language) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                acct.identity.clerk_user_id,
                cu.primary_email,
                p["full_name"],
                p["user_type"],
                p["contact_no"],
                p["ic_last4"],
                p["address"],
                p["postal_code"],
                note,
                body.language if body.language in LANGS else "en",
            ),
        )

    # Tell the project managers: in-app and email. WhatsApp to staff for every
    # sign-up would be noise.
    admins = "select uid, email, language from users where user_type in ('project_manager', 'superadmin') and active"
    for pm in fetch_all(admins):
        m = notify.msg_account_requested(
            p["full_name"], cu.primary_email, ROLE_LABEL[p["user_type"]], f"{notify.app_url()}/people?tab=requests",
            pm["language"],
        )  # fmt: skip
        try:
            notify.notify(pm["uid"], "account_request", m["title"], m["body"], email=(pm["email"], *m["email"]))
        except Exception as exc:  # one PM's failure must not lose the request
            print(f"[onboarding] notify PM {pm['uid']} failed: {exc}")

    return {"ok": True}
