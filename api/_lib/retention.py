"""Personal data (PDPA): non-essential data goes a year after it stops being needed.

The rule itself is in the database (purge_old_data(), migration 0045): what
counts as non-essential, the year, and that the deletes aren't copied into the
audit log. The 15-minute job (POST /cron/visit-reminders) calls it; it runs at
most once in 20 hours, so in practice once a day. docs/pdpa.md lists what goes.
"""

from __future__ import annotations

from typing import Any

from _lib.db import transaction


def run() -> dict[str, Any]:
    with transaction(None) as cur:
        cur.execute("select purge_old_data() as counts")
        row = cur.fetchone()
    return row["counts"] if row else {}
