"""Site visits, GPS check-in and check-out through the API, the Sites list, and visit reminders."""

from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timedelta

import pytest

from _routes import sites as sites_mod
from _routes.projects import SG
from conftest import bearer

SITE = (1.3521, 103.8198)
GPS = "You're currently not receiving GPS signal, please move to a spot where you can."


def north(metres: float) -> tuple[float, float]:
    return SITE[0] + metres / 111_194.93, SITE[1]


@pytest.fixture
def t(fx):
    """A PM, a homeowner, an approved project with an Apex-like crew, and someone not on it."""
    w = {
        r: fx.user(r2, full_name=n)
        for r, r2, n in [
            ("pm", "project_manager", "Sites PM"),
            ("ho", "homeowner", "Sites Homeowner"),
            ("admin", "contractor", "Sites Admin"),
            ("epc", "epc_team", "Sites EPC"),
            ("epc2", "epc_team", "Sites EPC 2"),
            ("outsider", "epc_team", "Sites Outsider"),
        ]
    }
    g = fx.conn.execute(
        "insert into contractor_groups (name) values (%s) returning group_id", (f"pytest sites {uuid.uuid4().hex[:6]}",)
    ).fetchone()["group_id"]
    for r in ("admin", "epc", "epc2"):
        fx.conn.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (g, w[r]["uid"]))

    def project(status: str = "in_progress", located: bool = True) -> int:
        pid = fx.conn.execute(
            "insert into projects (name, address, postal_code, site_lat, site_lng, homeowner_id, homeowner_contact_no, "
            "contractor_group_id, project_manager_id, installation_start_date, target_end_date, status) values "
            "(%s, 'Sites Road', '569933', %s, %s, %s, '+65 9000 0000', %s, %s, current_date, current_date + 21, %s) "
            "returning project_id",
            (
                f"pytest site {uuid.uuid4().hex[:6]}",
                SITE[0] if located else None,
                SITE[1] if located else None,
                w["ho"]["uid"],
                g,
                w["pm"]["uid"],
                status,
            ),
        ).fetchone()["project_id"]
        w.setdefault("pids", []).append(pid)
        return pid

    w["group"], w["project"] = g, project
    w["pid"] = project()
    yield w
    fx.conn.execute("delete from projects where project_id = any(%s)", (w["pids"],))
    fx.conn.execute("delete from contractor_group_members where group_id = %s", (g,))
    fx.conn.execute("delete from contractor_groups where group_id = %s", (g,))


def H(t, r):  # noqa: N802
    return bearer(t[r]["clerk_user_id"])


def schedule(client, t, who, pid, day: date, time: str | None = "09:00", note="Panel mounting"):
    return client.post(
        f"/api/py/projects/{pid}/visits", headers=H(t, who), json={"date": day.isoformat(), "time": time, "note": note}
    )


def check_in(client, t, who, pid, at=SITE, acc=10.0, crew=4):
    return client.post(
        f"/api/py/projects/{pid}/check-ins",
        headers=H(t, who),
        json={"lat": at[0], "lng": at[1], "accuracy": acc, "crew": crew},
    )


def today() -> date:
    return datetime.now(SG).date()


# ------------------------------------------------------------------ schedule


def test_pm_and_crew_schedule_and_the_crew_is_told(client, fx, t) -> None:
    r = schedule(client, t, "pm", t["pid"], today() + timedelta(days=2))
    assert r.status_code == 200, r.text
    told = {
        n["recipient_uid"]
        for n in fx.conn.execute(
            "select recipient_uid from notifications where project_id = %s and kind = 'visit_assigned'", (t["pid"],)
        )
    }
    assert told == {t["admin"]["uid"], t["epc"]["uid"], t["epc2"]["uid"]}
    assert schedule(client, t, "admin", t["pid"], today() + timedelta(days=3)).status_code == 200
    assert schedule(client, t, "epc", t["pid"], today() + timedelta(days=4), None).status_code == 200


@pytest.mark.parametrize(("who", "code"), [("ho", 403), ("outsider", 404)])
def test_homeowners_and_outsiders_cant_schedule(client, t, who, code) -> None:
    assert schedule(client, t, who, t["pid"], today() + timedelta(days=1)).status_code == code


@pytest.mark.parametrize("status", ["draft", "awaiting_homeowner", "homeowner_approved", "awaiting_signature"])
def test_scheduling_waits_for_approval_and_stops_at_handover(client, t, status) -> None:
    r = schedule(client, t, "pm", t["project"](status), today() + timedelta(days=1))
    assert r.status_code == 400 and "approved" in r.json()["error"]


@pytest.mark.parametrize(
    ("day", "time", "message"),
    [(-1, "09:00", "today or a later"), (1, "9am", "HH:MM"), (1, "24:00", "HH:MM"), (1, "09:60", "HH:MM")],
)
def test_dates_and_times_are_checked(client, t, day, time, message) -> None:
    r = schedule(client, t, "pm", t["pid"], today() + timedelta(days=day), time)
    assert r.status_code == 400 and message in r.json()["error"]


def test_visit_states(client, fx, t) -> None:
    pid = t["pid"]
    schedule(client, t, "pm", pid, today() + timedelta(days=5))
    schedule(client, t, "pm", pid, today(), "07:00")
    fx.conn.execute(
        "insert into site_visits (project_id, scheduled_date, scheduled_time) values (%s, %s, '09:00')",
        (pid, today() - timedelta(days=3)),
    )
    check_in(client, t, "epc", pid)
    states = {
        v["date"]: v["state"] for v in client.get(f"/api/py/projects/{pid}/visits", headers=H(t, "pm")).json()["visits"]
    }
    assert states == {
        (today() + timedelta(days=5)).isoformat(): "upcoming",
        today().isoformat(): "attended",
        (today() - timedelta(days=3)).isoformat(): "missed",
    }


def test_who_sees_which_buttons(client, t) -> None:
    flags = lambda who: client.get(f"/api/py/projects/{t['pid']}/visits", headers=H(t, who)).json()  # noqa: E731
    assert (flags("pm")["canSchedule"], flags("pm")["canCheckIn"]) == (True, False)
    assert (flags("admin")["canSchedule"], flags("admin")["canCheckIn"]) == (True, False)
    assert (flags("epc")["canSchedule"], flags("epc")["canCheckIn"]) == (True, True)
    assert (flags("ho")["canSchedule"], flags("ho")["canCheckIn"]) == (False, False)
    unlocated = t["project"](located=False)
    assert client.get(f"/api/py/projects/{unlocated}/visits", headers=H(t, "epc")).json()["canCheckIn"] is False


def test_a_visit_can_be_cancelled_until_someone_checks_in(client, t) -> None:
    pid = t["pid"]
    vid = schedule(client, t, "pm", pid, today() + timedelta(days=1)).json()["id"]
    assert client.delete(f"/api/py/projects/{pid}/visits/{vid}", headers=H(t, "admin")).status_code == 200
    vid = schedule(client, t, "pm", pid, today(), "08:00").json()["id"]
    check_in(client, t, "epc", pid)
    r = client.delete(f"/api/py/projects/{pid}/visits/{vid}", headers=H(t, "pm"))
    assert r.status_code == 400 and "stays as a record" in r.json()["error"]


# ---------------------------------------------------------------- check in


def test_check_in_and_out_at_the_site(client, fx, t) -> None:
    pid = t["pid"]
    vid = schedule(client, t, "pm", pid, today(), "08:00").json()["id"]
    r = check_in(client, t, "epc", pid, north(40), 12, 5)
    assert r.status_code == 200 and "with 5 crew" in r.json()["message"], r.text
    row = fx.conn.execute("select * from site_check_ins where project_id = %s", (pid,)).fetchone()
    assert row["visit_id"] == vid and abs(row["distance_m"] - 40) < 0.5 and row["crew_in"] == 5

    mine = client.get(f"/api/py/projects/{pid}/visits", headers=H(t, "epc")).json()["myOpenCheckIn"]
    assert mine["id"] == row["check_in_id"]
    out = client.post(
        f"/api/py/check-ins/{mine['id']}/check-out",
        headers=H(t, "epc"),
        json={"lat": SITE[0], "lng": SITE[1], "accuracy": 8, "crew": 3},
    )
    assert out.status_code == 200 and "3 crew still on site" in out.json()["message"], out.text
    again = client.post(
        f"/api/py/check-ins/{mine['id']}/check-out",
        headers=H(t, "epc"),
        json={"lat": SITE[0], "lng": SITE[1], "accuracy": 8, "crew": 3},
    )
    assert again.status_code == 409


NOT_HERE = "You're not at the check-in location (about 150 m away). Please head to the site to check in."
NO_FIX = "We couldn't get your phone's location. Allow location for GetHomeApps, then try again."


@pytest.mark.parametrize(
    ("at", "acc", "message"),
    [(north(150), 10, NOT_HERE), (north(20), 80, GPS), (north(20), None, GPS), ((None, None), 10, NO_FIX)],
)
def test_each_refusal_says_what_is_wrong(client, t, at, acc, message) -> None:
    r = check_in(client, t, "epc", t["pid"], at, acc)
    assert r.status_code == 400 and r.json()["error"] == message


def test_far_check_out_is_refused(client, t) -> None:
    check_in(client, t, "epc", t["pid"])
    cid = client.get(f"/api/py/projects/{t['pid']}/visits", headers=H(t, "epc")).json()["myOpenCheckIn"]["id"]
    r = client.post(
        f"/api/py/check-ins/{cid}/check-out",
        headers=H(t, "epc"),
        json={"lat": north(500)[0], "lng": SITE[1], "accuracy": 10, "crew": 2},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "You're not at the site (about 500 m away). Please check out at the site."


@pytest.mark.parametrize(("who", "code"), [("admin", 403), ("pm", 403), ("ho", 403), ("outsider", 404)])
def test_only_the_epc_team_checks_in(client, t, who, code) -> None:
    assert check_in(client, t, who, t["pid"]).status_code == code


def test_a_second_open_check_in_is_refused_plainly(client, t) -> None:
    assert check_in(client, t, "epc", t["pid"]).status_code == 200
    r = check_in(client, t, "epc", t["pid"])
    assert r.status_code == 409 and "already checked in" in r.json()["error"]


def test_crew_count_is_needed(client, t) -> None:
    assert check_in(client, t, "epc", t["pid"], crew=0).status_code == 400


def test_nobody_can_check_out_someone_else(client, t) -> None:
    check_in(client, t, "epc", t["pid"])
    cid = client.get(f"/api/py/projects/{t['pid']}/visits", headers=H(t, "epc")).json()["myOpenCheckIn"]["id"]
    r = client.post(
        f"/api/py/check-ins/{cid}/check-out",
        headers=H(t, "epc2"),
        json={"lat": SITE[0], "lng": SITE[1], "accuracy": 10, "crew": 2},
    )
    assert r.status_code == 404


# ------------------------------------------------------------------- sites


def test_sites_lists_where_the_crew_can_work(client, t) -> None:
    waiting = t["project"]("awaiting_homeowner")
    schedule(client, t, "pm", t["pid"], today(), "09:00")
    check_in(client, t, "epc", t["pid"])
    s = client.get("/api/py/sites", headers=H(t, "epc")).json()
    ids = [x["id"] for x in s["sites"]]
    assert t["pid"] in ids and waiting not in ids and s["canCheckIn"]
    first = s["sites"][0]
    assert first["id"] == t["pid"] and first["open"] and first["today"][0]["time"] == "09:00"
    assert client.get("/api/py/sites", headers=H(t, "admin")).json()["canCheckIn"] is False
    assert client.get("/api/py/sites", headers=H(t, "ho")).status_code == 403


# --------------------------------------------------------------- reminders


def _visit(fx, pid, day: date, time: str | None) -> int:
    return fx.conn.execute(
        "insert into site_visits (project_id, scheduled_date, scheduled_time) values (%s, %s, %s) "
        "returning visit_id",
        (pid, day, time),
    ).fetchone()["visit_id"]


def _told(fx, pid, kind) -> list[int]:
    return sorted(
        n["recipient_uid"]
        for n in fx.conn.execute(
            "select recipient_uid from notifications where project_id = %s and kind = %s", (pid, kind)
        )
    )


def at(day: date, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime(day.year, day.month, day.day, h, m, tzinfo=SG)


def test_an_hour_before_the_epc_team_is_reminded_once(fx, t) -> None:
    d = today()
    _visit(fx, t["pid"], d, "10:00")
    sites_mod.run_reminders(at(d, "09:30"))
    sites_mod.run_reminders(at(d, "09:45"))
    assert _told(fx, t["pid"], "visit_reminder") == sorted([t["epc"]["uid"], t["epc2"]["uid"]])


@pytest.mark.parametrize("hhmm", ["08:00", "08:59", "10:00", "10:30"])
def test_no_reminder_outside_the_hour_before(fx, t, hhmm) -> None:
    d = today()
    _visit(fx, t["pid"], d, "10:00")
    sites_mod.run_reminders(at(d, hhmm))
    assert _told(fx, t["pid"], "visit_reminder") == []


def test_an_hour_after_with_no_check_in_the_crew_and_pm_are_told_once(fx, t) -> None:
    d = today()
    _visit(fx, t["pid"], d, "09:00")
    sites_mod.run_reminders(at(d, "09:59"))
    assert _told(fx, t["pid"], "visit_missed") == []
    sites_mod.run_reminders(at(d, "10:00"))
    sites_mod.run_reminders(at(d, "11:00"))
    assert _told(fx, t["pid"], "visit_missed") == sorted([t["epc"]["uid"], t["epc2"]["uid"], t["pm"]["uid"]])


def test_no_missed_alert_when_they_checked_in(client, fx, t) -> None:
    d = today()
    _visit(fx, t["pid"], d, "09:00")
    check_in(client, t, "epc", t["pid"])
    sites_mod.run_reminders(at(d, "11:00"))
    assert _told(fx, t["pid"], "visit_missed") == []


def test_an_untimed_visit_is_missed_the_next_day(fx, t) -> None:
    y = today() - timedelta(days=1)
    _visit(fx, t["pid"], y, None)
    sites_mod.run_reminders(at(y, "23:00"))
    assert _told(fx, t["pid"], "visit_missed") == []
    sites_mod.run_reminders(at(today(), "08:00"))
    assert len(_told(fx, t["pid"], "visit_missed")) == 3


@pytest.mark.parametrize(
    ("secret", "sent", "code"), [("", "x", 503), ("s3cret", "Bearer nope", 401), ("s3cret", "Bearer s3cret", 200)]
)
def test_the_reminder_job_needs_its_secret(client, monkeypatch, secret, sent, code) -> None:
    monkeypatch.setattr(sites_mod, "env", lambda k: secret if k == "CRON_SECRET" else "")
    assert client.post("/api/py/cron/visit-reminders", headers={"Authorization": sent}).status_code == code


def test_distance_helper_is_right() -> None:
    lat, _ = north(100)
    assert math.isclose((lat - SITE[0]) * 111_194.93, 100, rel_tol=1e-9)
