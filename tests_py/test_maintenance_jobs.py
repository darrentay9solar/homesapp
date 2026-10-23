# ruff: noqa: E501  (one assertion per line reads best here)
"""Maintenance the project manager starts (migration 0057, api/_lib/maintenance_jobs.py).

hidden      a homeowner sees no check schedule, nothing due, no reminders; only maintenance once started
start       the system's manager starts it (for a yearly check, or other work); the homeowner hears; one at a time
visit       booking a check's visit starts its maintenance when nobody has
finish      done (its check recorded) or called off; the homeowner hears either way
six-month   the office's record: recorded, never due, late or next; never the homeowner's
"""

from __future__ import annotations

from datetime import datetime, timedelta

import psycopg
import pytest
from test_maintenance import cleanup_converted, close_project, h, pm2, systems  # noqa: F401
from test_project_work import _onemap, new_project, team  # noqa: F401

from _lib import checks as yearly
from _lib import maintenance_reminders as reminders
from _lib.db import transaction
from _routes import projects as proj


@pytest.fixture
def handed_over(client, fx, team, cleanup_converted):  # noqa: F811
    """A handed-over project with its homeowner, its system's year-2 check overdue."""
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    m = close_project(fx, pid, sp_turn_on_inspection_date=yearly.add_months(proj.today(), -25))
    fx.conn.execute("update maintenance_systems set plan_years = 5 where system_id = %s", (m["system_id"],))
    return {"pid": pid, "sid": m["system_id"]}


def _notes(fx, uid: int, kind: str) -> list[dict]:
    return fx.conn.execute(
        "select title, body, link from notifications where recipient_uid = %s and kind = %s order by notification_id",
        (uid, kind),
    ).fetchall()


def test_the_homeowner_sees_no_schedule(client, team, handed_over) -> None:  # noqa: F811
    d = client.get(f"/api/py/projects/{handed_over['pid']}/maintenance", headers=h(team["ho"])).json()
    assert d["system"]["checks"] == [] and d["system"]["next"] is None and not d["system"]["attention"]
    assert d["maintenance"] is None and d["canBook"] is False and d["canStart"] is False
    # The office sees the schedule: the 6-month record, and the year-2 check overdue.
    o = client.get(f"/api/py/projects/{handed_over['pid']}/maintenance", headers=h(team["pm"])).json()
    assert [c["key"] for c in o["system"]["checks"]][:2] == ["six_month", "year_2"] and o["system"]["next"][
        "state"
    ] == "overdue"


def test_reminders_go_to_the_office_only(fx, team, handed_over) -> None:  # noqa: F811
    reminders.run()
    assert _notes(fx, team["ho"]["uid"], "maintenance_due") == []
    assert any("Start its maintenance" in n["body"] for n in _notes(fx, team["pm"]["uid"], "maintenance_due"))


def test_starting_maintenance_tells_the_homeowner(client, fx, team, handed_over) -> None:  # noqa: F811
    sid = handed_over["sid"]
    r = client.post(
        f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={"checkKey": "year_2", "note": "Fan noise"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["maintenance"]["checkKey"] == "year_2" and r.json()["maintenance"]["note"] == "Fan noise"
    told = _notes(fx, team["ho"]["uid"], "maintenance_started")
    assert len(told) == 1 and "Year 2" not in told[0]["body"], "not which check: the homeowner doesn't see the schedule"
    assert told[0]["link"] == f"/projects/{handed_over['pid']}?tab=maintenance"
    d = client.get(f"/api/py/projects/{handed_over['pid']}/maintenance", headers=h(team["ho"])).json()
    assert d["maintenance"]["status"] == "started" and d["system"]["checks"] == []
    # One at a time.
    again = client.post(f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={})
    assert again.status_code == 409 and "already under way" in again.json()["error"]


@pytest.mark.parametrize("who", ["ho", "admin", "epc"])
def test_only_the_systems_manager_starts_it(client, team, handed_over, who) -> None:  # noqa: F811
    assert (
        client.post(f"/api/py/maintenance/{handed_over['sid']}/jobs", headers=h(team[who]), json={}).status_code == 403
    )


def test_another_managers_system_isnt_theirs_to_start(client, team, pm2, systems) -> None:  # noqa: F811
    sid = systems(run_by=pm2["uid"])
    assert client.post(f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={}).status_code == 404


def test_booking_a_checks_visit_starts_its_maintenance(client, fx, team, handed_over) -> None:  # noqa: F811
    start = (datetime.now(proj.SG) + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    r = client.post(
        "/api/py/meetings",
        headers=h(team["pm"]),
        json={
            "title": "Year 2 check", "startsAt": start.isoformat(), "endsAt": (start + timedelta(hours=2)).isoformat(),
            "people": [team["ho"]["uid"]], "systemId": handed_over["sid"], "checkKey": "year_2", "place": "physical",
            "location": "1 Pytest Road", "postalCode": "123456",
        },
    )  # fmt: skip
    assert r.status_code == 200, r.text
    mid = r.json()["meeting"]["id"]
    try:
        assert len(_notes(fx, team["ho"]["uid"], "maintenance_started")) == 1
        d = client.get(f"/api/py/projects/{handed_over['pid']}/maintenance", headers=h(team["ho"])).json()
        assert d["maintenance"]["visit"]["meetingId"] == mid
    finally:
        fx.conn.execute("delete from meetings where meeting_id = %s", (mid,))


def test_done_records_the_check_and_tells_the_homeowner(client, fx, team, handed_over) -> None:  # noqa: F811
    sid = handed_over["sid"]
    job = client.post(f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={"checkKey": "year_2"}).json()[
        "maintenance"
    ]
    r = client.post(
        f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish", headers=h(team["pm"]), json={"outcome": "done"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["maintenance"] is None
    year2 = next(c for c in r.json()["system"]["checks"] if c["key"] == "year_2")
    assert year2["state"] == "done" and year2["doneOn"] == proj.today().isoformat()
    assert [n["title"].split(" · ")[0] for n in _notes(fx, team["ho"]["uid"], "maintenance_done")] == [
        "Maintenance done"
    ]
    d = client.get(f"/api/py/projects/{handed_over['pid']}/maintenance", headers=h(team["ho"])).json()
    assert d["maintenance"] is None and d["lastMaintained"] is not None


def test_called_off_tells_the_homeowner_and_leaves_the_check(client, fx, team, handed_over) -> None:  # noqa: F811
    sid = handed_over["sid"]
    job = client.post(f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={"checkKey": "year_2"}).json()[
        "maintenance"
    ]
    r = client.post(
        f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish", headers=h(team["pm"]), json={"outcome": "cancelled"}
    )
    assert next(c for c in r.json()["system"]["checks"] if c["key"] == "year_2")["state"] == "overdue"
    assert [n["title"].split(" · ")[0] for n in _notes(fx, team["ho"]["uid"], "maintenance_done")] == [
        "Maintenance called off"
    ]


def test_recording_the_check_done_finishes_its_maintenance(client, team, handed_over) -> None:  # noqa: F811
    sid = handed_over["sid"]
    client.post(f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={"checkKey": "year_2"})
    r = client.post(
        f"/api/py/maintenance/{sid}/checks/year_2", headers=h(team["pm"]), json={"doneOn": proj.today().isoformat()}
    )
    assert r.json()["maintenance"] is None


def test_the_six_month_check_is_a_record(client, team, systems) -> None:  # noqa: F811
    sid = systems(run_by=team["pm"]["uid"], turned_on_on=yearly.add_months(proj.today(), -8))
    s = client.get(f"/api/py/maintenance/{sid}", headers=h(team["pm"])).json()["system"]
    six = s["checks"][0]
    assert six["key"] == "six_month" and six["label"] == "6-month check" and six["state"] == "record"
    assert not s["attention"] and (s["next"] is None or s["next"]["key"] != "six_month"), "never late or next"
    r = client.post(
        f"/api/py/maintenance/{sid}/checks/six_month", headers=h(team["pm"]), json={"doneOn": proj.today().isoformat()}
    )
    assert r.json()["system"]["checks"][0]["state"] == "done"
    # No workflow for it: maintenance is for the yearly checks, or other work.
    assert (
        client.post(
            f"/api/py/maintenance/{sid}/jobs", headers=h(team["pm"]), json={"checkKey": "six_month"}
        ).status_code
        == 400
    )


def test_the_database_keeps_maintenance_to_the_systems_manager(team, pm2, systems) -> None:  # noqa: F811
    theirs = systems(run_by=pm2["uid"])
    with (
        pytest.raises(psycopg.errors.InsufficientPrivilege, match="another project manager"),
        transaction(team["pm"]["uid"]) as cur,
    ):
        cur.execute("insert into maintenance_jobs (system_id) values (%s)", (theirs,))
    with (
        pytest.raises(psycopg.errors.InsufficientPrivilege, match="project managers look after"),
        transaction(team["ho"]["uid"]) as cur,
    ):
        cur.execute("insert into maintenance_jobs (system_id) values (%s)", (theirs,))
