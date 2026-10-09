"""Clearing out abandoned uploads.

An upload is two steps: the app hands out a five-minute link, the browser
sends the file straight to storage, then tells the app it finished. If the
second step never comes (the phone lost signal, the tab was closed), a file
sits in storage that no project or profile knows about.

Each link handed out is written down (upload_intents) and crossed off when
its file is registered. The scheduled job (every 15 minutes, with the visit
reminders) looks at entries over a day old: their key was never registered,
so whatever reached storage under it is deleted. Only those keys are ever
touched: files taken off a project were registered once, so they are never
in this list, and stay restorable from the audit log.
"""

from __future__ import annotations

from typing import Any

from _lib import storage
from _lib.db import fetch_all, transaction

STALE_AFTER = "1 day"
BATCH = 200


def record(key: str, uid: int | None) -> None:
    """A link for this key was handed out."""
    with transaction(uid) as cur:
        cur.execute("insert into upload_intents (key, uid) values (%s, %s) on conflict do nothing", (key, uid))


def done(key: str, uid: int | None = None) -> None:
    """The key's file is registered (or was refused and deleted): nothing to sweep."""
    with transaction(uid) as cur:
        cur.execute("delete from upload_intents where key = %s", (key,))


def _registered(key: str) -> bool:
    return bool(
        fetch_all(
            "select 1 from project_files where url = %(k)s union all select 1 from users where avatar_key = %(k)s "
            "union all select 1 from project_signatures where signature_url = %(k)s or certificate_url = %(k)s",
            {"k": key},
        )
    )


def sweep() -> dict[str, Any]:
    """Deletes what abandoned uploads left in storage. Safe to run as often as you like."""
    if not storage.mode():
        return {"checked": 0, "deleted": 0, "skipped": "storage isn't set up"}
    rows = fetch_all(
        f"select key from upload_intents where created_at < now() - interval '{STALE_AFTER}' "
        f"order by created_at limit {BATCH}"
    )
    deleted = failed = 0
    for r in rows:
        key = r["key"]
        if not _registered(key):
            try:
                storage.delete(key)
                deleted += 1
            except Exception as exc:  # leave it for the next run
                print(f"[sweep] couldn't delete {key}: {exc}")
                failed += 1
                continue
        done(key)
    return {"checked": len(rows), "deleted": deleted, "failed": failed}
