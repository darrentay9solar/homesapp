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
    if counts.get("skipped"):
        return counts
    # FusionSolar's alarms, a year after they cleared (non-essential; the plant's output is kept), and the
    # 5-minute power curves: an inverter's after 31 days, a plant's after 400 (a year of any day's curve,
    # as FusionSolar shows; its hourly kWh stays with the plant).
    with transaction(None) as cur:
        cur.execute("delete from solar_alarms where cleared_at < now() - interval '1 year'")
        counts["solar_alarms"] = cur.rowcount
        cur.execute("delete from solar_device_power where at < now() - interval '31 days'")
        counts["solar_device_power"] = cur.rowcount
        cur.execute("delete from solar_plant_power where at < now() - interval '400 days'")
        counts["solar_plant_power"] = cur.rowcount
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
