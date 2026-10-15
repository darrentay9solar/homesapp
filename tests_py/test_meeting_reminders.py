# ruff: noqa: E501  (one case per line reads best here)
"""Reminders before a meeting (_lib/meeting_reminders.py), run by the 15-minute job.

At the times the organiser chose (an hour before unless they chose), to
everyone invited who hasn't declined; each once per start time.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from _lib import meeting_reminders as mr

SG = ZoneInfo("Asia/Singapore")
NOW = datetime(2026, 10, 14, 9, 0, tzinfo=SG)
M = timedelta(minutes=1)


@pytest.mark.parametrize(
    ("starts_in", "made_before", "offsets", "want"),
    [
        (60 * M, 3 * 24 * 60 * M, [60], [60]),
        (50 * M, 3 * 24 * 60 * M, [60], [60]),
        (61 * M, 3 * 24 * 60 * M, [60], []),
        (0 * M, 3 * 24 * 60 * M, [60], []),
        (20 * M, 3 * 24 * 60 * M, [60, 30, 10], [30, 60]),
        (5 * M, 3 * 24 * 60 * M, [10], [10]),
        (0 * M, 3 * 24 * 60 * M, [0], [0]),
        (-10 * M, 3 * 24 * 60 * M, [0], [0]),
        (-15 * M, 3 * 24 * 60 * M, [0], []),
        (60 * M, 30 * M, [60], []),
        (60 * M, 70 * M, [60], [60]),
        (24 * 60 * M, 3 * 24 * 60 * M, [1440], [1440]),
        (23 * 60 * M, 23 * 60 * M + 10 * M, [1440], []),
        (2 * M, 3 * 24 * 60 * M, [], []),
    ],
)
def test_due(starts_in, made_before, offsets, want) -> None:
    start = NOW + starts_in
    assert mr.due(start, start - made_before, NOW, offsets) == want


def test_the_message_says_when_where_and_how_to_join() -> None:
    m = {"title": "Design review", "place": "physical", "location": "53 Ang Mo Kio Ave 3", "online_link": "https://meet.google.com/x",
         "starts_at": NOW + timedelta(minutes=25), "ends_at": NOW + timedelta(minutes=85)}  # fmt: skip
    title, body = mr.message(m, NOW)
    assert title == "Starting in 25 minutes · Design review"
    assert body == "Wed 14 Oct 2026, 09:25 to 10:25 · In person: 53 Ang Mo Kio Ave 3 · join by video from the meeting"
    title, body = mr.message({**m, "place": "online", "location": None, "starts_at": NOW + timedelta(hours=20)}, NOW)
    assert title == "Coming up · Design review" and body.endswith("· Online · join from the meeting")
    assert mr.message({**m, "starts_at": NOW}, NOW)[0] == "Starting now · Design review"


@pytest.fixture
def meeting(fx):
    """A meeting by fx's owner connection, with an organiser, an invitee waiting, and one who declined."""
    org, waiting, declined = fx.user("project_manager"), fx.user("contractor"), fx.user("homeowner")
    made: list[int] = []

    def make(starts_in: timedelta, made_before: timedelta, reminders: list[int] | None = None) -> tuple[int, dict, datetime]:
        """The meeting starts on a half-hour mark two days out; returns the "now" that is starts_in before it."""
        start = (datetime.now(SG) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
        mid = fx.conn.execute(
            "insert into meetings (title, organiser_id, starts_at, ends_at, place, created_at, reminders) values "
            "('Reminder test', %s, %s, %s, 'online', %s, %s) returning meeting_id",
            (org["uid"], start, start + timedelta(hours=1), start - made_before, reminders if reminders is not None else [60]),
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
        "select title, link from notifications where recipient_uid = %s and kind = 'meeting_reminder' order by notification_id",
        (uid,),
    ).fetchall()


def test_everyone_who_hasnt_declined_is_reminded_once(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(minutes=55), timedelta(days=2))
    assert mr.run(now, meeting_ids=[mid]) == 2
    assert reminders(fx, who["org"]["uid"])[0]["link"] == f"/calendar?meeting={mid}"
    assert reminders(fx, who["waiting"]["uid"]) and not reminders(fx, who["declined"]["uid"])
    assert mr.run(now, meeting_ids=[mid]) == 0, "once"


def test_each_chosen_time(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(days=1), timedelta(days=3), [1440, 30])
    assert mr.run(now, meeting_ids=[mid]) == 2
    assert reminders(fx, who["org"]["uid"])[0]["title"] == "Coming up · Reminder test"
    assert mr.run(now + timedelta(hours=12), meeting_ids=[mid]) == 0, "nothing between"
    later = now + timedelta(hours=23, minutes=35)
    assert mr.run(later, meeting_ids=[mid]) == 2, "and again when it's about to start"
    assert reminders(fx, who["org"]["uid"])[-1]["title"] == "Starting in 25 minutes · Reminder test"


def test_no_reminders_chosen_means_none(fx, meeting) -> None:
    mid, _, now = meeting(timedelta(minutes=55), timedelta(days=2), [])
    assert mr.run(now, meeting_ids=[mid]) == 0


def test_a_late_job_sends_only_the_latest(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(minutes=5), timedelta(days=2), [60, 30, 10])
    assert mr.run(now, meeting_ids=[mid]) == 2
    assert [r["title"] for r in reminders(fx, who["org"]["uid"])] == ["Starting in 5 minutes · Reminder test"]
    assert mr.run(now + timedelta(minutes=1), meeting_ids=[mid]) == 0, "the earlier ones were set aside"


def test_a_moved_meeting_is_reminded_of_again(fx, meeting) -> None:
    mid, _, now = meeting(timedelta(minutes=55), timedelta(days=2))
    mr.run(now, meeting_ids=[mid])
    fx.conn.execute(
        "update meetings set starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes' "
        "where meeting_id = %s",
        (mid,),
    )
    assert mr.run(now + timedelta(minutes=30), meeting_ids=[mid]) == 2


def test_a_cancelled_meeting_isnt(fx, meeting) -> None:
    mid, who, now = meeting(timedelta(minutes=55), timedelta(days=2))
    fx.conn.execute(
        "update meetings set cancelled_at = now(), cancelled_by = %s where meeting_id = %s", (who["org"]["uid"], mid)
    )
    assert mr.run(now, meeting_ids=[mid]) == 0
