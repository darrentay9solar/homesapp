"""Warnings for managers (_lib/watch.py), end to end against the test database.

A project gone late tells its manager once; two weeks late, the superadmins
once; a check a month overdue on a managed system, the superadmins once.
The morning summary goes from 08:00, Monday to Saturday, once a day, only
when there's something to act on, with the dashboard's own numbers.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from test_project_work import _onemap, new_project, team  # noqa: F401

from _lib import checks as yearly
from _lib import watch
from _routes import projects as proj

SG = ZoneInfo("Asia/Singapore")


def today() -> date:
    return proj.today()


def alerts(fx, uid: int, kind: str) -> list[dict]:
    return fx.conn.execute(
        "select title, body, link from notifications where recipient_uid = %s and kind = %s order by notification_id",
        (uid, kind),
    ).fetchall()


@pytest.fixture
def boss(fx):
    return fx.user("superadmin", full_name="Watch Boss")


def late_by(fx, pid: int, days: int) -> None:
    end = today() - timedelta(days=days)
    fx.conn.execute(
        "update projects set installation_start_date = %s, target_end_date = %s, installation_end_date = null "
        "where project_id = %s",
        (end - timedelta(days=30), end, pid),
    )


# ------------------------------------------------------------ a project gone late


def test_the_manager_is_told_once_when_a_project_goes_late(client, fx, team, boss) -> None:  # noqa: F811
    pid = new_project(client, team)
    late_by(fx, pid, 2)
    people = [team["pm"]["uid"], boss["uid"]]
    assert watch.late_projects(today(), uids=people, project_ids=[pid]) == 1
    got = alerts(fx, team["pm"]["uid"], "project_late")
    assert len(got) == 1 and got[0]["title"] == "Project late · Flow Residence" and got[0]["link"] == f"/projects/{pid}"
    assert watch.late_projects(today(), uids=people, project_ids=[pid]) == 0, "once"
    assert alerts(fx, boss["uid"], "project_late") == [], "the manager has it; not the superadmins too"


def test_a_new_target_date_that_passes_tells_them_again(client, fx, team, boss) -> None:  # noqa: F811
    pid = new_project(client, team)
    people = [team["pm"]["uid"], boss["uid"]]
    late_by(fx, pid, 2)
    watch.late_projects(today(), uids=people, project_ids=[pid])
    late_by(fx, pid, 1)
    assert watch.late_projects(today(), uids=people, project_ids=[pid]) == 1


def test_two_weeks_late_goes_to_the_superadmins(client, fx, team, boss) -> None:  # noqa: F811
    pid = new_project(client, team)
    late_by(fx, pid, 15)
    assert watch.late_projects(today(), uids=[team["pm"]["uid"], boss["uid"]], project_ids=[pid]) == 1
    got = alerts(fx, boss["uid"], "escalation")
    assert got and got[0]["title"] == "Two weeks late · Flow Residence"
    assert "15 days past" in got[0]["body"] and "Flow PM" in got[0]["body"]


@pytest.mark.parametrize("days", [0, 8, 13, 22, 120])
def test_outside_the_windows_nothing_is_sent(client, fx, team, boss, days) -> None:  # noqa: F811
    """Old news is in the summary; turning this on never sends a burst."""
    pid = new_project(client, team)
    late_by(fx, pid, days)
    assert watch.late_projects(today(), uids=[team["pm"]["uid"], boss["uid"]], project_ids=[pid]) == 0


# ------------------------------------------------------------ a check a month overdue


def system(fx, *, run_by: int | None, year2_due: date) -> int:
    """A system whose year 2 check falls due on year2_due (24 months after its turn-on)."""
    return fx.conn.execute(
        "insert into maintenance_systems (import_ref, address, postal_code, run_by, turned_on_on, plan_years) "
        "values (%s, 'Watch Test House', '560123', %s, %s, 5) returning system_id",
        (f"pytest-watch-{uuid.uuid4().hex[:8]}", run_by, yearly.add_months(year2_due, -24)),
    ).fetchone()["system_id"]  # fmt: skip


@pytest.fixture
def systems(fx):
    made: list[int] = []
    yield made
    fx.conn.execute("delete from maintenance_systems where system_id = any(%s)", (made,))


def test_a_check_a_month_overdue_on_a_managed_system_goes_to_the_superadmins(fx, team, boss, systems) -> None:  # noqa: F811
    sid = system(fx, run_by=team["pm"]["uid"], year2_due=today() - timedelta(days=31))
    systems.append(sid)
    assert watch.overdue_checks(today(), uids=[boss["uid"]], system_ids=[sid]) == 1
    got = alerts(fx, boss["uid"], "escalation")
    assert got[-1]["title"] == "Year 2 check a month overdue · Watch Test House"
    assert got[-1]["link"] == f"/maintenance/{sid}"
    assert watch.overdue_checks(today(), uids=[boss["uid"]], system_ids=[sid]) == 0, "once"


def test_an_unmanaged_system_isnt_escalated(fx, boss, systems) -> None:
    """The superadmins already get its reminders."""
    sid = system(fx, run_by=None, year2_due=today() - timedelta(days=31))
    systems.append(sid)
    assert watch.overdue_checks(today(), uids=[boss["uid"]], system_ids=[sid]) == 0


# ------------------------------------------------------------ the morning summary


def at(hour: int, weekday: int = 1) -> datetime:
    """A time today's week: weekday 0 is Monday."""
    d = today() + timedelta(days=weekday - today().weekday())
    return datetime(d.year, d.month, d.day, hour, tzinfo=SG)


@pytest.fixture
def no_requests(monkeypatch: pytest.MonkeyPatch):
    """The test database keeps other tests' requests; these tests count only their own things."""
    monkeypatch.setattr(watch, "requests_waiting", lambda: 0)


def test_the_summary_waits_for_eight_and_skips_sunday(client, fx, team, no_requests) -> None:  # noqa: F811
    late_by(fx, new_project(client, team), 3)
    assert watch.summaries(at(7), uids=[team["pm"]["uid"]]) == 0
    assert watch.summaries(at(9, weekday=6), uids=[team["pm"]["uid"]]) == 0


def test_the_summary_says_whats_late_once_a_day(client, fx, team, no_requests) -> None:  # noqa: F811
    late_by(fx, new_project(client, team), 3)
    assert watch.summaries(at(9), uids=[team["pm"]["uid"]]) == 1
    got = alerts(fx, team["pm"]["uid"], "daily_summary")
    assert got[-1]["title"] == "Your morning summary" and got[-1]["link"] == "/dashboard"
    assert "Late projects: 1, the latest 3 days over" in got[-1]["body"]
    assert watch.summaries(at(10), uids=[team["pm"]["uid"]]) == 0, "once a day"


def test_nothing_to_act_on_sends_nothing(fx, no_requests) -> None:
    quiet = fx.user("project_manager", full_name="Nothing On")
    assert watch.summaries(at(9), uids=[quiet["uid"]]) == 0
    assert alerts(fx, quiet["uid"], "daily_summary") == []


def test_waiting_requests_are_in_it(fx, monkeypatch: pytest.MonkeyPatch) -> None:
    quiet = fx.user("project_manager", full_name="Requests Only")
    monkeypatch.setattr(watch, "requests_waiting", lambda: 2)
    assert watch.summaries(at(9), uids=[quiet["uid"]]) == 1
    assert alerts(fx, quiet["uid"], "daily_summary")[-1]["body"] == "Account requests waiting: 2"


# ------------------------------------------------------------ the lines themselves


def dash(**tiles) -> dict:
    t = {k: {"count": 0, "ids": []} for k in ("late", "awaitingPm", "handover")}
    t.update(tiles)
    return {"tiles": t, "projects": {1: {"daysLate": 12}, 2: {"daysLate": 3}}, "delivery": {"dueSoon": []}}


def upkeep(**tiles) -> dict:
    t = {k: {"count": 0, "ids": []} for k in ("urgent", "overdue", "unassigned")}
    t.update(tiles)
    return {"tiles": t, "systems": {}}


def test_lines_most_pressing_first() -> None:
    lines = watch.summary_lines(
        dash(late={"count": 2, "ids": [1, 2]}, awaitingPm={"count": 0, "ids": [5]}),
        upkeep(overdue={"count": 5, "ids": []}, unassigned={"count": 49, "ids": []}),
        1,
        superadmin=True,
        today=date(2026, 10, 13),
    )
    assert lines == [
        "Late projects: 2, the latest 12 days over",
        "Systems with a check overdue: 5",
        "Waiting for your approval: 1",
        "Account requests waiting: 1",
        "Systems without a project manager: 49",
    ]


def test_unassigned_systems_are_for_superadmins_only() -> None:
    u = upkeep(unassigned={"count": 49, "ids": []})
    assert watch.summary_lines(dash(), u, 0, superadmin=False, today=date(2026, 10, 13)) == []


def test_checks_due_this_week_count_from_today() -> None:
    systems = {
        "1": {"next": {"key": "year_2", "due": "2026-10-15", "overdue": False}},
        "2": {"next": {"key": "year_3", "due": "2026-10-19", "overdue": False}},
        "3": {"next": {"key": "year_2", "due": "2026-10-20", "overdue": False}},
        "4": {"next": None},
    }
    u = {**upkeep(), "systems": systems}
    assert watch.summary_lines(dash(), u, 0, superadmin=False, today=date(2026, 10, 13)) == ["Checks due this week: 2"]
