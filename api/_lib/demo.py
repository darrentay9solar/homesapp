"""The demonstration site: try GetHomeApps as any sample person, no password.

The demo deployment (its own Vercel project and link) points at the dev
database. Visitors pick a sample person on the sign-in page; every request
then carries ``X-Demo-As: <uid>`` instead of a Clerk session.

Two locks, both needed, so production can never become a demo:
  1. the deployment says so: ``DEMO_MODE=1`` (set only on the demo project);
  2. the database says so: its comment is ``gethomeapps:demo``. Only the
     database's owner can set that, and only scripts/reset_and_seed.py
     --target dev does, on the dev database.
And only sample people (``users.is_demo``, which only the database owner can
set) can be picked.

What stays off in the demo, because everyone shares the same sample people:
sign-in changes (email, password), and anything leaving the app by email,
WhatsApp, SMS or Clerk invitation. Phone notifications work (the demo has its
own VAPID keys): a phone that turns them on gets the alerts of the sample
person it's on, until it turns them off or picks someone else; resetting the
demo forgets every phone.
"""

from __future__ import annotations

import os
import time

from _lib.db import fetch_one

# The dev database's comment (COMMENT ON DATABASE), which marks it as the demo's.
MARKER = "gethomeapps:demo"

_cache: tuple[float, bool] | None = None


def deployment_is_demo() -> bool:
    return os.environ.get("DEMO_MODE", "").strip() == "1"


def database_is_demo() -> bool:
    """The database's own marker, checked at most once a minute."""
    global _cache
    if _cache and time.monotonic() - _cache[0] < 60:
        return _cache[1]
    try:
        row = fetch_one(
            "select shobj_description(oid, 'pg_database') as note from pg_database where datname = current_database()"
        )
        ok = bool(row and row["note"] == MARKER)
    except Exception:
        ok = False
    _cache = (time.monotonic(), ok)
    return ok


def enabled() -> bool:
    return deployment_is_demo() and database_is_demo()


OFF = {
    "sign_in": "Not in the demo: everyone here shares the same sample people, so their sign-in can't be changed.",
}
