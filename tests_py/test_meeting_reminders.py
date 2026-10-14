"""Reminders before a meeting (_lib/meeting_reminders.py), run by the 15-minute job.

A day before (for a meeting arranged well ahead) and within 30 minutes of the
start, to everyone invited who hasn't declined; each once per start time.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from _lib import meeting_reminders as mr

SG = ZoneInfo("Asia/Singapore")
NOW = datetime(2026, 10, 14, 9, 0, tzinfo=SG)


@pytest.mark.parametrize(
    ("starts_in", "made_before", "stage"),
    [
        (timedelta(minutes=20), timedelta(days=3), "soon"),
        (timedelta(minutes=30), timedelta(minutes=40), "soon"),
        (timedelta(hours=20), timedelta(days=3), "day"),
        (timedelta(hours=23, minutes=59), timedelta(hours=31), "day"),
        (timedelta(hours=20), timedelta(hours=2), None),
        (timedelta(hours=25), timedelta(days=3), None),
        (timedelta(minutes=-5), timedelta(days=3), None),
        (timedelta(0), timedelta(days=3), None),
    ],
)
def test_stage(starts_in, made_before, stage) -> None:
    assert mr.stage_for(NOW + starts_in, NOW + starts_in - made_before, NOW) == stage


def test_the_message_says_when_where_and_how_to_join() -> None:
    m = {"title": "Design review", "place": "site", "location": "53 Ang Mo Kio Ave 3", "online_link": "https://meet.google.com/x",
         "starts_at": NOW + timedelta(minutes=25), "ends_at": NOW + timedelta(minutes=85)}  # fmt: skip
    title, body = mr.message(m, "soon", NOW)
    assert title == "Starting in 25 minutes · Design review"
    assert body == "Wed 14 Oct 2026, 09:25 to 10:25 · On site: 53 Ang Mo Kio Ave 3 · join by video from the meeting"
    title, body = mr.message({**m, "place": "online", "location": None}, "day", NOW)
    assert title == "Coming up · Design review" and body.endswith("· Online · join from the meeting")


@pytest.fixture
def meeting(fx):
    """A meeting by fx's owner connection, with an organiser, an invitee waiting, and one who declined."""
    org, waiting, declined = fx.user("project_manager"), fx.user("contractor"), fx.user("homeowner")
    made: list[int] = []

    def make(starts_in: timedelta, made_before: timedelta) -> tuple[int, dict, datetime]:
        """The meeting starts on a half-hour mark two days out; returns the "now" that is starts_in before it."""
        start = (datetime.now(SG) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
        mid = fx.conn.execute(
            "insert into meetings (title, organiser_id, starts_at, ends_at, place, created_at) values "
            "('Reminder test', %s, %s, %s, 'online', %s) returning meeting_id",
            (org["uid"], start, start + timedelta(hours=1), start - made_before),
        ).fetchone()["meeting_id"]
        for u, answer in ((org, "accepted"), (waiting, "pending"), (declined, "declined")):
            fx.conn.execute(
                "insert into meeting_people (meeting_id, user_id, response) values (%s, %s, %s)",
                (mid, u["uid"], answer),
            )
        made.append(mid)
        return mid, {"org": org, "waiting": waiting, "declined": declined}, start - starts_in

    yield make
    fx.conn.execute("delete from meetings where meeting_id = any(%s)", (made,))


def reminders(fx, uid: int) -> list[dict]:
    return fx.conn.execute(
        "select title, link from notifications where recipient_uid = %s and kind = 'meeting_reminder'", (uid,)
    ).fetchall()


def test_everyone_who_hasnt_declined_is_reminded_once(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(minutes=20), timedelta(days=2))
    assert mr.run(now, meeting_ids=[mid]) == 2
    assert reminders(fx, who["org"]["uid"])[0]["link"] == f"/calendar?meeting={mid}"
    assert reminders(fx, who["waiting"]["uid"]) and not reminders(fx, who["declined"]["uid"])
    assert mr.run(now, meeting_ids=[mid]) == 0, "once"


def test_a_day_before_then_soon(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(hours=20), timedelta(days=3))
    assert mr.run(now, meeting_ids=[mid]) == 2
    assert reminders(fx, who["org"]["uid"])[0]["title"] == "Coming up · Reminder test"
    later = now + timedelta(hours=19, minutes=45)
    assert mr.run(later, meeting_ids=[mid]) == 2, "and again when it's about to start"


def test_a_moved_meeting_is_reminded_of_again(fx, meeting) -> None:
    mid, _, now = meeting(timedelta(minutes=20), timedelta(days=2))
    mr.run(now, meeting_ids=[mid])
    fx.conn.execute(
        "update meetings set starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes' "
        "where meeting_id = %s",
        (mid,),
    )
    assert mr.run(now + timedelta(minutes=30), meeting_ids=[mid]) == 2


def test_a_cancelled_meeting_isnt(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(minutes=20), timedelta(days=2))
    fx.conn.execute(
        "update meetings set cancelled_at = now(), cancelled_by = %s where meeting_id = %s", (who["org"]["uid"], mid)
    )
    assert mr.run(now, meeting_ids=[mid]) == 0
