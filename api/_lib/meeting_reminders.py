"""Reminders before a meeting, at the times its organiser chose, so nobody misses one.

Run by the 15-minute job (POST /cron/visit-reminders). A meeting carries up
to five reminders, in minutes before its start (meetings.reminders; an hour
before unless the organiser chose otherwise). For each meeting that isn't
cancelled, everyone invited who hasn't declined gets each reminder once its
time comes (in the app and on the phone; by email too for one set 12 hours
or more ahead, and urgent within 30 minutes of the start), with its video
link when it has one.

A reminder whose time had passed before the meeting was arranged isn't sent
(more than a quarter of an hour before), and when several fall due at once
(the job was late) only the latest goes. Each goes once per person and start
time (meeting_reminders, stage = its minutes): a meeting moved to a new time
is reminded of again. A maintenance check booked through the calendar is a
meeting, so it's reminded of too.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from _lib import notify
from _lib.db import fetch_all, transaction

SG = ZoneInfo("Asia/Singapore")
EVERY = timedelta(minutes=15)  # how often the job runs; a reminder "at the start" waits this long for it
URGENT = timedelta(minutes=30)
EMAIL_FROM = 12 * 60  # minutes ahead: a reminder this early goes by email too
PLACE = {"online": "Online", "physical": "In person", "site": "In person", "office": "In person", "phone": "By phone"}


def due(starts: datetime, created: datetime, now: datetime, offsets: list[int]) -> list[int]:
    """The reminders (minutes before) whose time has come, smallest first."""
    out = []
    for o in offsets:
        at = starts - timedelta(minutes=o)
        if at <= now < max(starts, at + EVERY) and at >= created - EVERY:
            out.append(o)
    return sorted(out)


def _claim(mid: int, uid: int, stages: list[int], starts: datetime) -> bool:
    """Marks these reminders sent; False when the first was already."""
    with transaction(None) as cur:
        claimed = False
        for i, o in enumerate(stages):
            cur.execute(
                "insert into meeting_reminders (meeting_id, user_id, stage, starts_at) values (%s, %s, %s, %s) "
                "on conflict do nothing returning meeting_id",
                (mid, uid, str(o), starts),
            )
            got = cur.fetchone() is not None
            if i == 0:
                claimed = got
        return claimed


def when_text(start: datetime, end: datetime) -> str:
    s, e = start.astimezone(SG), end.astimezone(SG)
    return f"{s.strftime('%a %d %b %Y')}, {s.strftime('%H:%M')} to {e.strftime('%H:%M')}"


def message(m: dict[str, Any], now: datetime) -> tuple[str, str]:
    where = PLACE.get(m["place"], "")
    if m["place"] != "online" and m.get("location"):
        where = f"{where}: {m['location']}"
    if m.get("online_link"):
        where = (
            f"{where} · join by video from the meeting" if m["place"] != "online" else "Online · join from the meeting"
        )
    when = f"{when_text(m['starts_at'], m['ends_at'])} · {where}"
    mins = round((m["starts_at"] - now).total_seconds() / 60)
    if mins <= 0:
        return f"Starting now · {m['title']}", when
    if mins <= 90:
        return f"Starting in {mins} minutes · {m['title']}", when
    return f"Coming up · {m['title']}", when


def run(now: datetime | None = None, *, meeting_ids: list[int] | None = None) -> int:
    now = now or datetime.now(SG)
    rows = fetch_all(
        "select m.meeting_id, m.title, m.place, m.location, m.online_link, m.starts_at, m.ends_at, m.created_at, "
        "m.reminders, p.user_id, u.email, u.language from meetings m "
        "join meeting_people p on p.meeting_id = m.meeting_id join users u on u.uid = p.user_id "
        "where m.cancelled_at is null and p.response <> 'declined' and u.active and cardinality(m.reminders) > 0 "
        "and m.starts_at > %(now)s - interval '15 minutes' "
        "and m.starts_at - make_interval(mins => (select max(x) from unnest(m.reminders) x)) <= %(now)s "
        "and (%(ids)s::int[] is null or m.meeting_id = any(%(ids)s))",
        {"now": now, "ids": meeting_ids},
    )
    sent = 0
    for r in rows:
        stages = due(r["starts_at"], r["created_at"], now, list(r["reminders"]))
        if not stages or not _claim(r["meeting_id"], r["user_id"], stages, r["starts_at"]):
            continue
        title, body = message(r, now)
        link = f"/calendar?meeting={r['meeting_id']}"
        email = None
        if stages[0] >= EMAIL_FROM and r["email"]:
            lang = r["language"] or "en"
            html, text = notify.email_shell(title, [body], ("Open the meeting", f"{notify.app_url()}{link}"), lang)
            email = (r["email"], notify.tr(f"{notify.BRAND}: {title}", lang) or title, html, text)
        try:
            notify.notify(r["user_id"], "meeting_reminder", title, body, link=link,
                          urgent=r["starts_at"] - now <= URGENT, email=email)  # fmt: skip
            sent += 1
        except Exception as exc:  # one person's reminder mustn't stop everyone else's
            print(f"[meetings] reminder to {r['user_id']} failed: {exc}")
    return sent
