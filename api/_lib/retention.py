"""Personal data (PDPA): how long data is kept, then deleted.

  non-essential   a year after it stops being needed (migration 0045)
  essential       5 years after the contract ends: the 8-year plan from turn-on (longer if the
                  PPA or maintenance plan is), so 8 + 5 years; a project that never became a
                  system, 13 years after it was last changed (0050)
  audit log       an entry about a record that no longer exists, once it is 13 years old (0050)

The rules are in the database (purge_old_data()): what goes, when, and that the
deletes aren't copied into the audit log. The 15-minute job (POST
/cron/visit-reminders) calls it; it runs at most once in 20 hours, so in practice
once a day. The deleted records' files are removed from storage here, once the
database has let them go. docs/pdpa.md lists what goes.
"""

from __future__ import annotations

from typing import Any

from _lib import storage
from _lib.db import transaction


def run() -> dict[str, Any]:
    with transaction(None) as cur:
        cur.execute("select purge_old_data() as counts")
        row = cur.fetchone()
    counts: dict[str, Any] = dict(row["counts"]) if row else {}
    keys = counts.pop("files", None) or []
    gone = 0
    for key in keys:
        try:
            storage.delete(key)
            gone += 1
        except Exception as exc:  # one file that won't go mustn't stop the rest
            print(f"[retention] couldn't remove a file from storage: {exc}")
    if keys:
        counts["files"] = gone
    return counts
