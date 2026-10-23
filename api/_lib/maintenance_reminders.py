"""Reminders for the yearly maintenance checks (_lib/checks.py).

Run by the 15-minute job (POST /cron/visit-reminders). For each check not
yet done, three reminders, each sent once (maintenance_reminders):

  soon      within 14 days of the date
  due       on the day
  overdue   after it, once (and not for checks more than 90 days overdue,
            which are a list to work through, not news)

They go to the system's project manager (the superadmins while it has
none), linked to the system, to start its maintenance and book a time with the
homeowner. A check already booked says so. The homeowner gets none of these:
they don't see the check schedule, and hear only when maintenance is started
(_lib/maintenance_jobs.py, migration 0057). The 6-month check is a record and
has no reminders.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from _lib import checks as yearly
from _lib import notify
from _lib.db import fetch_all, transaction

SG = ZoneInfo("Asia/Singapore")
SOON = 14
STALE = 90


def stage_for(due: date, today: date) -> str | None:
    days = (due - today).days
    if 0 < days <= SOON:
        return "soon"
    if days == 0:
        return "due"
    if -STALE <= days < 0:
        return "overdue"
    return None


def _claim(system_id: int, check: str, due: date, stage: str) -> bool:
    """Records the reminder; False if it already went (so two runs at once can't both send it)."""
    with transaction(None) as cur:
        cur.execute(
            "insert into maintenance_reminders (system_id, check_key, due, stage) values (%s, %s, %s, %s) "
            "on conflict do nothing returning system_id",
            (system_id, check, due, stage),
        )
        return cur.fetchone() is not None


def run(now: datetime | None = None) -> int:
    today = (now or datetime.now(SG)).astimezone(SG).date()
    booked: dict[tuple[int, str], datetime] = {
        (r["system_id"], r["check_key"]): r["starts_at"]
        for r in fetch_all(
            "select distinct on (system_id, check_key) system_id, check_key, starts_at from meetings "
            "where kind = 'maintenance_check' and cancelled_at is null and ends_at > now() "
            "order by system_id, check_key, starts_at"
        )
    }
    admins = [r["uid"] for r in fetch_all("select uid from users where user_type = 'superadmin' and active")]
    sent = 0
    for s, checks in yearly.all_systems():
        for c in checks:
            if not c.due or c.done_on:
                continue
            stage = stage_for(c.due, today)
            if not stage or not _claim(s["system_id"], c.key, c.due, stage):
                continue
            sent += _send(s, yearly.label(c.key), c.due, stage, booked.get((s["system_id"], c.key)), admins)
    return sent


def _send(s: dict[str, Any], label: str, due: date, stage: str, when: datetime | None, admins: list[int]) -> int:
    day = due.strftime("%d %b %Y")
    title = {
        "soon": f"Maintenance check coming up · {s['address']}",
        "due": f"Maintenance check due today · {s['address']}",
        "overdue": f"Maintenance check overdue · {s['address']}",
    }[stage]
    what = f"The {label} was due on {day}." if stage == "overdue" else f"The {label} is due on {day}."
    booking = f" It's booked for {when.astimezone(SG).strftime('%d %b %Y, %H:%M')}." if when else None
    n = 0
    for uid in [s["run_by"]] if s["run_by"] else admins:
        body = what + (booking or " Start its maintenance and book a time with the homeowner.")
        notify.notify(uid, "maintenance_due", title, body, project_id=s["project_id"],
                      link=f"/maintenance/{s['system_id']}", urgent=stage == "overdue")  # fmt: skip
        n += 1
    return n
