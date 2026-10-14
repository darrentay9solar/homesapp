"""Reminders before a meeting, so nobody misses one.

Run by the 15-minute job (POST /cron/visit-reminders). For each meeting that
isn't cancelled, everyone invited who hasn't declined gets:

  day    about a day before (in the app, on the phone, by email), for a
         meeting arranged more than a few hours ahead
  soon   within 30 minutes of the start (in the app and on the phone),
         with its video link when it has one

Each goes once per person and start time (meeting_reminders): a meeting
moved to a new time is reminded of again. A maintenance check booked
through the calendar is a meeting, so it's reminded of too.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from _lib import notify
from _lib.db import fetch_all, transaction

SG = ZoneInfo("Asia/Singapore")
DAY = timedelta(hours=24)
SOON = timedelta(minutes=30)
AHEAD = timedelta(hours=6)  # arranged at least this long before, or "a day before" is just noise
PLACE = {"online": "Online", "site": "On site", "office": "At the office", "phone": "By phone"}


def stage_for(starts: datetime, created: datetime, now: datetime) -> str | None:
    left = starts - now
    if timedelta(0) < left <= SOON:
        return "soon"
    if SOON < left <= DAY and starts - created >= DAY + AHEAD:
        return "day"
    return None


def _claim(mid: int, uid: int, stage: str, starts: datetime) -> bool:
    with transaction(None) as cur:
        cur.execute(
            "insert into meeting_reminders (meeting_id, user_id, stage, starts_at) values (%s, %s, %s, %s) "
            "on conflict do nothing returning meeting_id",
            (mid, uid, stage, starts),
        )
        return cur.fetchone() is not None


def when_text(start: datetime, end: datetime) -> str:
    s, e = start.astimezone(SG), end.astimezone(SG)
    return f"{s.strftime('%a %d %b %Y')}, {s.strftime('%H:%M')} to {e.strftime('%H:%M')}"


def message(m: dict[str, Any], stage: str, now: datetime) -> tuple[str, str]:
    where = PLACE.get(m["place"], "")
    if m["place"] != "online" and m.get("location"):
        where = f"{where}: {m['location']}"
    if m.get("online_link"):
        where = (
            f"{where} · join by video from the meeting" if m["place"] != "online" else "Online · join from the meeting"
        )
    if stage == "soon":
        mins = max(1, round((m["starts_at"] - now).total_seconds() / 60))
        return f"Starting in {mins} minutes · {m['title']}", f"{when_text(m['starts_at'], m['ends_at'])} · {where}"
    return f"Coming up · {m['title']}", f"{when_text(m['starts_at'], m['ends_at'])} · {where}"


def run(now: datetime | None = None, *, meeting_ids: list[int] | None = None) -> int:
    now = now or datetime.now(SG)
    rows = fetch_all(
        "select m.meeting_id, m.title, m.place, m.location, m.online_link, m.starts_at, m.ends_at, m.created_at, "
        "p.user_id, u.email, u.language from meetings m join meeting_people p on p.meeting_id = m.meeting_id "
        "join users u on u.uid = p.user_id "
        "where m.cancelled_at is null and p.response <> 'declined' and u.active "
        "and m.starts_at > %(now)s and m.starts_at <= %(now)s + interval '24 hours' "
        "and (%(ids)s::int[] is null or m.meeting_id = any(%(ids)s))",
        {"now": now, "ids": meeting_ids},
    )
    sent = 0
    for r in rows:
        stage = stage_for(r["starts_at"], r["created_at"], now)
        if not stage or not _claim(r["meeting_id"], r["user_id"], stage, r["starts_at"]):
            continue
        title, body = message(r, stage, now)
        link = f"/calendar?meeting={r['meeting_id']}"
        email = None
        if stage == "day" and r["email"]:
            lang = r["language"] or "en"
            html, text = notify.email_shell(title, [body], ("Open the meeting", f"{notify.app_url()}{link}"), lang)
            email = (r["email"], notify.tr(f"{notify.BRAND}: {title}", lang) or title, html, text)
        try:
            notify.notify(r["user_id"], "meeting_reminder", title, body, link=link, urgent=stage == "soon", email=email)
            sent += 1
        except Exception as exc:  # one person's reminder mustn't stop everyone else's
            print(f"[meetings] reminder to {r['user_id']} failed: {exc}")
    return sent
