# ruff: noqa: E501  (one assertion per line reads best here)
"""Maintenance tracking (migration 0031, api/_routes/maintenance.py, scripts/import_maintenance.py).

convert     a handed-over project becomes a maintenance record by itself, once
see         a superadmin sees every system; a project manager theirs and unassigned ones; nobody else any
change      details, the contract, the checks; a superadmin assigns the manager
guard       the database refuses what the API refuses, whoever asks
projects    the Projects list leaves handed-over projects to Maintenance; labels read Completed, Handed Over
import      the project listing's rows, read strictly; a re-run adds nothing
"""

from __future__ import annotations

import importlib.util
import json
import uuid
from datetime import date, timedelta
from pathlib import Path

import psycopg
import pytest
from test_project_work import _onemap, new_project, team  # noqa: F401

from _lib.db import transaction
from _routes import maintenance as mt
from _routes import projects as proj
from conftest import bearer

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("import_maintenance", ROOT / "scripts" / "import_maintenance.py")
assert _spec and _spec.loader
imp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(imp)


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


@pytest.fixture
def boss(fx):
    return fx.user("superadmin", full_name="Sam Superadmin")


@pytest.fixture
def pm2(fx):
    return fx.user("project_manager", full_name="Other PM")


@pytest.fixture
def systems(fx):
    """Makes maintenance records through the owner connection, and removes them after."""
    tag = f"pytest-{uuid.uuid4().hex[:8]}"
    made: list[int] = []

    def make(**cols) -> int:
        row = {
            "import_ref": f"{tag}#{len(made) + 1}",
            "address": f"{len(made) + 1} Pytest Road",
            "postal_code": "123456",
            "panels": json.dumps([{"count": 20, "wp": 620}]),
            "kwp": 12.4,
            "turned_on_on": date(2026, 5, 11),
            "six_month_due": date(2026, 11, 11),
            "one_year_due": date(2027, 5, 11),
            **cols,
        }
        sid = fx.conn.execute(
            f"insert into maintenance_systems ({', '.join(row)}) values ({', '.join(['%s'] * len(row))}) returning system_id",
            tuple(row.values()),
        ).fetchone()["system_id"]
        made.append(sid)
        return sid

    yield make
    fx.conn.execute("delete from maintenance_systems where system_id = any(%s)", (made,))


def close_project(fx, pid: int, **fields) -> dict:
    """Sets a project's fields and hands it over, as the owner (the steps before are other tests' business)."""
    if fields:
        fx.conn.execute(
            f"update projects set {', '.join(f'{k} = %s' for k in fields)} where project_id = %s", (*fields.values(), pid)
        )
    fx.conn.execute("update projects set status = 'closed' where project_id = %s", (pid,))
    row = fx.conn.execute("select * from maintenance_systems where project_id = %s", (pid,)).fetchone()
    assert row is not None, "closing the project made a maintenance record"
    return row


@pytest.fixture
def cleanup_converted(fx):
    pids: list[int] = []
    yield pids
    fx.conn.execute("delete from maintenance_systems where project_id = any(%s)", (pids,))


# ------------------------------------------------------------------ convert


def test_a_handed_over_project_becomes_a_maintenance_record(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    m = close_project(
        fx, pid, panel_quantity_estimate=18, panel_quantity_actual=20, panel_capacity=620,
        inverter_to_order=" SUN2000-10K-LC0 ", sp_turn_on_inspection_date=date(2026, 5, 11),
    )  # fmt: skip
    assert m["run_by"] == team["pm"]["uid"] and m["homeowner_id"] == team["ho"]["uid"]
    assert m["homeowner_name"] == "Flow Homeowner" and m["homeowner_contact_no"] == "+65 9123 4567"
    assert m["address"] == "53 Ang Mo Kio Ave 3" and m["postal_code"] == "569933"
    assert m["panels"] == [{"count": 20, "wp": 620}], "the actual panel count wins over the estimate"
    assert float(m["kwp"]) == 12.4
    assert m["inverters"] == ["SUN2000-10K-LC0"]
    assert (m["turned_on_on"], m["six_month_due"], m["one_year_due"]) == (date(2026, 5, 11), date(2026, 11, 11), date(2027, 5, 11))
    assert m["import_ref"] is None and m["ppa_kind"] is None and m["plan_years"] is None, "the contract is left for the manager"


def test_without_a_turn_on_inspection_the_checks_count_from_the_close(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    m = close_project(fx, pid)
    today = proj.today()
    assert m["turned_on_on"] == today
    assert m["six_month_due"] == mt._months(today, 6) and m["one_year_due"] == mt._months(today, 12)
    assert m["panels"] == [] and m["kwp"] is None and m["inverters"] == []


def test_a_project_converts_once(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    close_project(fx, pid)
    fx.conn.execute("update projects set status = 'closed', updated_at = now() where project_id = %s", (pid,))
    assert fx.conn.execute("select count(*) as n from maintenance_systems where project_id = %s", (pid,)).fetchone()["n"] == 1


def test_a_project_that_is_not_closed_stays_out_of_maintenance(client, fx, team) -> None:  # noqa: F811
    pid = new_project(client, team)
    fx.conn.execute("update projects set status = 'signed' where project_id = %s", (pid,))
    assert fx.conn.execute("select 1 from maintenance_systems where project_id = %s", (pid,)).fetchone() is None


def test_the_conversion_is_audited_under_the_project(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    m = close_project(fx, pid)
    a = fx.conn.execute(
        "select project_id, action::text as action from audit_log where entity_table = 'maintenance_systems' and entity_id = %s",
        (str(m["system_id"]),),
    ).fetchall()
    assert a == [{"project_id": pid, "action": "insert"}]


# ---------------------------------------------------------------------- see


def test_a_project_manager_sees_theirs_and_unassigned_ones(client, team, pm2, systems) -> None:  # noqa: F811
    mine, free, theirs = systems(run_by=team["pm"]["uid"]), systems(), systems(run_by=pm2["uid"])
    ids = {s["id"] for s in client.get("/api/py/maintenance", headers=h(team["pm"])).json()["systems"]}
    assert {mine, free} <= ids and theirs not in ids
    assert client.get(f"/api/py/maintenance/{theirs}", headers=h(team["pm"])).status_code == 404
    assert client.get(f"/api/py/maintenance/{free}", headers=h(team["pm"])).status_code == 200


def test_a_superadmin_sees_every_system_and_the_managers(client, boss, team, pm2, systems) -> None:  # noqa: F811
    ids = [systems(run_by=team["pm"]["uid"]), systems(), systems(run_by=pm2["uid"])]
    d = client.get("/api/py/maintenance", headers=h(boss)).json()
    assert set(ids) <= {s["id"] for s in d["systems"]}
    assert d["canAssign"] is True and {team["pm"]["uid"], pm2["uid"]} <= {m["uid"] for m in d["managers"]}
    assert client.get("/api/py/maintenance", headers=h(team["pm"])).json()["canAssign"] is False


@pytest.mark.parametrize("who", ["ho", "admin", "epc"])
def test_nobody_else_sees_maintenance(client, team, systems, who) -> None:  # noqa: F811
    sid = systems()
    assert client.get("/api/py/maintenance", headers=h(team[who])).status_code == 403
    assert client.get(f"/api/py/maintenance/{sid}", headers=h(team[who])).status_code == 403
    assert client.patch(f"/api/py/maintenance/{sid}", headers=h(team[who]), json={"notes": "x"}).status_code == 403


def test_a_system_reads_as_people_need_it(client, team, systems) -> None:  # noqa: F811
    sid = systems(
        run_by=team["pm"]["uid"], ppa_kind="ppa", ppa_years=7, plan_years=7, plan_excludes_first_year=True,
        panels=json.dumps([{"count": 23, "wp": 635}, {"count": 3, "wp": 620}]), kwp=16.465, phase=1,
        inverters=["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"], roof_access=False, urgent=True, urgent_note="Poor generation: need to check",
    )  # fmt: skip
    s = client.get(f"/api/py/maintenance/{sid}", headers=h(team["pm"])).json()["system"]
    assert s["ppa"] == {"kind": "ppa", "years": 7} and s["plan"] == {"years": 7, "excludesFirstYear": True}
    assert s["panelCount"] == 26 and s["kwp"] == 16.465 and s["phase"] == 1
    assert s["inverters"] == ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"] and s["roofAccess"] is False
    assert s["urgent"] and s["attention"] and s["imported"] and s["project"] is None
    assert s["pm"]["name"] == "Flow PM"


@pytest.mark.parametrize(
    ("due", "done", "state"),
    [
        (-1, None, "overdue"),
        (0, None, "due_soon"),
        (30, None, "due_soon"),
        (31, None, "scheduled"),
        (-5, -1, "done"),
        (None, None, "unscheduled"),
    ],
)
def test_a_check_is_overdue_due_soon_scheduled_or_done(due, done, state) -> None:
    t = date(2026, 10, 9)
    d = (lambda n: None if n is None else t + timedelta(days=n))  # noqa: E731
    assert mt.check_state(d(due), d(done), t) == state


def test_the_next_check_is_the_first_not_done(client, team, systems) -> None:  # noqa: F811
    t = proj.today()
    sid = systems(turned_on_on=t - timedelta(days=200), six_month_due=t - timedelta(days=17), one_year_due=t + timedelta(days=165),
                  six_month_done_on=t - timedelta(days=20))  # fmt: skip
    s = client.get(f"/api/py/maintenance/{sid}", headers=h(team["pm"])).json()["system"]
    assert [c["state"] for c in s["checks"]] == ["done", "scheduled"]
    assert s["next"]["key"] == "one_year" and not s["attention"]


def test_an_overdue_check_needs_attention(client, team, systems) -> None:  # noqa: F811
    t = proj.today()
    sid = systems(turned_on_on=t - timedelta(days=200), six_month_due=t - timedelta(days=17), one_year_due=t + timedelta(days=165))
    s = client.get(f"/api/py/maintenance/{sid}", headers=h(team["pm"])).json()["system"]
    assert s["next"]["state"] == "overdue" and s["attention"]


# ------------------------------------------------------------------- change


def test_a_project_manager_changes_their_system(client, fx, team, systems) -> None:  # noqa: F811
    sid = systems(run_by=team["pm"]["uid"])
    r = client.patch(
        f"/api/py/maintenance/{sid}",
        headers=h(team["pm"]),
        json={
            "ppa": {"kind": "value_buy"},
            "plan": {"years": 5, "excludesFirstYear": False},
            "panels": [{"count": 5, "wp": 635}, {"count": 13, "wp": 620}],
            "kwp": 11.235,
            "phase": 3,
            "inverters": [" SUN2000-10K-LC0 ", ""],
            "roofAccess": True,
            "urgent": True,
            "urgentNote": "  Poor generation  ",
            "notes": "Gate code with the homeowner.",
            "contactNo": "+65 8123 4567",
            "homeownerName": "Mdm Tan",
        },
    )
    assert r.status_code == 200, r.text
    s = r.json()["system"]
    assert s["ppa"] == {"kind": "value_buy", "years": None} and s["plan"] == {"years": 5, "excludesFirstYear": False}
    assert s["panels"] == [{"count": 5, "wp": 635}, {"count": 13, "wp": 620}] and s["panelCount"] == 18
    assert s["kwp"] == 11.235 and s["phase"] == 3 and s["inverters"] == ["SUN2000-10K-LC0"]
    assert s["roofAccess"] is True and s["urgent"] and s["urgentNote"] == "Poor generation"
    assert s["homeowner"]["name"] == "Mdm Tan" and s["contactNo"] == "+65 8123 4567"
    who = fx.conn.execute(
        "select actor_uid from audit_log where entity_table = 'maintenance_systems' and entity_id = %s and action = 'update'",
        (str(sid),),
    ).fetchall()
    assert who and all(a["actor_uid"] == team["pm"]["uid"] for a in who), "the change is audited as the manager"


def test_clearing_urgent_clears_its_note(client, team, systems) -> None:  # noqa: F811
    sid = systems(run_by=team["pm"]["uid"], urgent=True, urgent_note="Poor generation")
    s = client.patch(f"/api/py/maintenance/{sid}", headers=h(team["pm"]), json={"urgent": False, "urgentNote": "still here"}).json()["system"]
    assert not s["urgent"] and s["urgentNote"] is None


def test_a_new_turn_on_date_moves_the_checks(client, team, systems) -> None:  # noqa: F811
    sid = systems(run_by=team["pm"]["uid"])
    s = client.patch(f"/api/py/maintenance/{sid}", headers=h(team["pm"]), json={"turnedOn": "2025-12-31"}).json()["system"]
    assert s["turnedOn"] == "2025-12-31"
    assert [c["due"] for c in s["checks"]] == ["2026-06-30", "2026-12-31"], "the month's last day when it's shorter, as the listing has it"


def test_given_check_dates_are_kept(client, team, systems) -> None:  # noqa: F811
    sid = systems(run_by=team["pm"]["uid"])
    s = client.patch(f"/api/py/maintenance/{sid}", headers=h(team["pm"]), json={"turnedOn": "2026-01-10", "sixMonthDue": "2026-07-01", "oneYearDue": "2027-01-02"}).json()["system"]
    assert [c["due"] for c in s["checks"]] == ["2026-07-01", "2027-01-02"]


def test_a_project_manager_looks_after_unassigned_systems(client, team, systems) -> None:  # noqa: F811
    sid = systems()
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(team["pm"]), json={"notes": "Visited"})
    assert r.status_code == 200 and r.json()["canEdit"] is True


@pytest.mark.parametrize(
    ("body", "status", "says"),
    [
        ({"address": "  "}, 400, "can't be empty"),
        ({"postalCode": "12345"}, 400, "six digits"),
        ({"postalCode": "12345a"}, 400, "six digits"),
        ({"ppa": {"kind": "ppa"}}, 400, "how many years"),
        ({"ppa": {"kind": "lease", "years": 5}}, 422, None),
        ({"plan": {"years": 0}}, 422, None),
        ({"panels": [{"count": 0, "wp": 620}]}, 422, None),
        ({"kwp": -1}, 422, None),
        ({"phase": 2}, 422, None),
        ({"inverters": ["X"] * 21}, 400, "more inverters"),
        ({"sixMonthDue": "2026-05-01"}, 400, "after the turn-on"),
        ({"oneYearDue": "2026-11-10"}, 400, "after the turn-on"),
        ({"urgent": None}, 400, "whether it's urgent"),
        ({"notes": "x" * 2001}, 400, "too long"),
        ({}, 400, "Nothing to change"),
    ],
)
def test_changes_that_dont_make_sense_are_refused(client, team, systems, body, status, says) -> None:  # noqa: F811
    sid = systems(run_by=team["pm"]["uid"])
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(team["pm"]), json=body)
    assert r.status_code == status, r.text
    if says:
        assert says in r.json()["error"]


def test_a_linked_homeowners_name_comes_from_their_account(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    m = close_project(fx, pid)
    r = client.patch(f"/api/py/maintenance/{m['system_id']}", headers=h(team["pm"]), json={"homeownerName": "Someone Else"})
    assert r.status_code == 409


def test_only_a_superadmin_assigns_the_manager(client, boss, team, pm2, systems) -> None:  # noqa: F811
    sid = systems()
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(team["pm"]), json={"runBy": team["pm"]["uid"]})
    assert r.status_code == 403 and "superadmin" in r.json()["error"]
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(boss), json={"runBy": pm2["uid"]})
    assert r.status_code == 200 and r.json()["system"]["pm"]["uid"] == pm2["uid"]
    assert client.get(f"/api/py/maintenance/{sid}", headers=h(team["pm"])).status_code == 404, "now another manager's"
    assert client.get(f"/api/py/maintenance/{sid}", headers=h(pm2)).json()["canEdit"] is True
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(boss), json={"runBy": None})
    assert r.json()["system"]["pm"]["uid"] is None


def test_a_system_goes_only_to_an_active_manager(client, boss, team, systems) -> None:  # noqa: F811
    sid = systems()
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(boss), json={"runBy": team["ho"]["uid"]})
    assert r.status_code == 400 and "active project manager" in r.json()["error"]


# ------------------------------------------------------------------- checks


def test_a_check_is_marked_done_and_undone(client, fx, team, systems) -> None:  # noqa: F811
    t = proj.today()
    sid = systems(run_by=team["pm"]["uid"], turned_on_on=t - timedelta(days=190), six_month_due=t - timedelta(days=7), one_year_due=t + timedelta(days=175))
    r = client.post(f"/api/py/maintenance/{sid}/checks/six_month", headers=h(team["pm"]), json={"doneOn": t.isoformat()})
    assert r.status_code == 200, r.text
    c = r.json()["system"]["checks"][0]
    assert c["state"] == "done" and c["doneOn"] == t.isoformat() and not r.json()["system"]["attention"]
    r = client.post(f"/api/py/maintenance/{sid}/checks/six_month", headers=h(team["pm"]), json={"doneOn": None})
    assert r.json()["system"]["checks"][0]["state"] == "overdue"
    changes = fx.conn.execute(
        "select changes from audit_log where entity_table = 'maintenance_systems' and entity_id = %s and action = 'update' and changes ? 'six_month_done_on' order by audit_id",
        (str(sid),),
    ).fetchall()
    assert len(changes) == 2


@pytest.mark.parametrize(
    ("check", "when", "status"),
    [
        ("six_month", 1, 400),  # tomorrow
        ("six_month", -400, 400),  # before the turn-on
        ("two_year", 0, 404),
    ],
)
def test_a_check_cant_be_done_in_the_future_or_before_the_turn_on(client, team, systems, check, when, status) -> None:  # noqa: F811
    t = proj.today()
    sid = systems(run_by=team["pm"]["uid"], turned_on_on=t - timedelta(days=190), six_month_due=t - timedelta(days=7), one_year_due=t + timedelta(days=175))
    r = client.post(f"/api/py/maintenance/{sid}/checks/{check}", headers=h(team["pm"]), json={"doneOn": (t + timedelta(days=when)).isoformat()})
    assert r.status_code == status


def test_another_managers_checks_are_theirs(client, team, pm2, systems) -> None:  # noqa: F811
    sid = systems(run_by=pm2["uid"])
    r = client.post(f"/api/py/maintenance/{sid}/checks/six_month", headers=h(team["pm"]), json={"doneOn": proj.today().isoformat()})
    assert r.status_code == 404


# -------------------------------------------------------------------- guard


def _as(uid, sql, params=()) -> None:
    with transaction(uid) as cur:
        cur.execute(sql, params)


def test_the_database_lets_a_manager_change_only_their_own_and_unassigned(team, pm2, systems) -> None:  # noqa: F811
    mine, free, theirs = systems(run_by=team["pm"]["uid"]), systems(), systems(run_by=pm2["uid"])
    _as(team["pm"]["uid"], "update maintenance_systems set notes = 'ok' where system_id = any(%s)", ([mine, free],))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="another project manager"):
        _as(team["pm"]["uid"], "update maintenance_systems set notes = 'no' where system_id = %s", (theirs,))


@pytest.mark.parametrize(
    ("sql", "says"),
    [
        ("update maintenance_systems set run_by = {me} where system_id = {sid}", "Only a superadmin can hand"),
        ("update maintenance_systems set import_ref = 'x' where system_id = {sid}", "can't be changed"),
        ("delete from maintenance_systems where system_id = {sid}", "add or remove"),
        ("insert into maintenance_systems (address) values ('1 Sneaky Road')", "add or remove"),
    ],
)
def test_the_database_keeps_assignment_and_records_to_a_superadmin(team, systems, sql, says) -> None:  # noqa: F811
    sid = systems()
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match=says):
        _as(team["pm"]["uid"], sql.format(me=team["pm"]["uid"], sid=sid))


@pytest.mark.parametrize("who", ["ho", "admin", "epc"])
def test_the_database_refuses_everyone_else(team, systems, who) -> None:  # noqa: F811
    sid = systems()
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="project managers look after"):
        _as(team[who]["uid"], "update maintenance_systems set notes = 'x' where system_id = %s", (sid,))


def test_a_superadmin_may_do_anything(boss, team, systems) -> None:  # noqa: F811
    sid = systems()
    _as(boss["uid"], "update maintenance_systems set run_by = %s where system_id = %s", (team["pm"]["uid"], sid))
    _as(boss["uid"], "delete from maintenance_systems where system_id = %s", (sid,))


@pytest.mark.parametrize(
    ("cols", "constraint"),
    [
        ({"postal_code": "1234"}, "maintenance_systems_values"),
        ({"ppa_kind": "lease"}, "maintenance_systems_values"),
        ({"ppa_kind": "ppa", "ppa_years": None}, "maintenance_systems_values"),
        ({"phase": 2}, "maintenance_systems_values"),
        ({"six_month_due": date(2026, 1, 1)}, "maintenance_systems_values"),
        ({"address": " "}, "maintenance_systems_values"),
    ],
)
def test_the_database_keeps_values_sensible(systems, cols, constraint) -> None:
    with pytest.raises(psycopg.errors.CheckViolation, match=constraint):
        systems(**cols)


def test_an_import_ref_is_imported_once(fx, systems) -> None:
    systems(import_ref="pytest-once#1")
    with pytest.raises(psycopg.errors.UniqueViolation):
        systems(import_ref="pytest-once#1")


# ----------------------------------------------------------------- projects


def test_the_projects_list_leaves_handed_over_projects_to_maintenance(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    done, going = new_project(client, team), new_project(client, team)
    cleanup_converted.append(done)
    close_project(fx, done)
    d = client.get("/api/py/projects", headers=h(team["pm"])).json()
    ids = {p["id"] for p in d["projects"]}
    assert going in ids and done not in ids and d["handedOver"] >= 1
    for crew in ("admin", "epc"):
        assert done not in {p["id"] for p in client.get("/api/py/projects", headers=h(team[crew])).json()["projects"]}
    mine = client.get("/api/py/projects", headers=h(team["ho"])).json()
    assert done in {p["id"] for p in mine["projects"]}, "a homeowner still sees their project"
    assert client.get(f"/api/py/projects/{done}", headers=h(team["pm"])).json()["statusLabel"] == "Handed Over"


def test_a_signed_project_reads_completed(client, fx, team) -> None:  # noqa: F811
    pid = new_project(client, team)
    fx.conn.execute("update projects set status = 'signed' where project_id = %s", (pid,))
    p = next(p for p in client.get("/api/py/projects", headers=h(team["pm"])).json()["projects"] if p["id"] == pid)
    assert p["statusLabel"] == "Completed"


def test_the_handover_points_a_manager_at_the_maintenance_record(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    m = close_project(fx, pid)
    assert client.get(f"/api/py/projects/{pid}/handover", headers=h(team["pm"])).json()["maintenance"] == m["system_id"]
    assert client.get(f"/api/py/projects/{pid}/handover", headers=h(team["ho"])).json()["maintenance"] is None


def test_the_dashboard_still_counts_handed_over_projects(client, fx, team, cleanup_converted) -> None:  # noqa: F811
    pid = new_project(client, team)
    cleanup_converted.append(pid)
    close_project(fx, pid)
    d = client.get("/api/py/analytics?period=all", headers=h(team["pm"])).json()
    closed = next(s for s in d["pipeline"] if s["key"] == "closed")
    assert pid in closed["ids"] and closed["label"] == "Handed over"


# ------------------------------------------------------------------- import

HEADER = imp.HEADER


def row(sn=1, **over):
    r = {
        "S/N": sn, "Address": "1 Example Road", "Postal Code": 18956, "PPA": "5 Years", "No. of Panels": 22,
        "Panel Wp": 620, "kWp DC": 13.64, "1P or 3P": "Single-phase", "Inverter": "SUN2000-5KTL-L1\nSUN2000-5KTL-L1",
        "Turn On Date": date(2026, 5, 26), "6 Months": date(2026, 11, 26), "1 Year": date(2027, 5, 26),
        "Maintenance Plan": "Free for 5 years", "Roof Access": "No", "Urgent Maintenance due to Poor Generation": None,
    }  # fmt: skip
    r.update(over)
    return tuple(r[h] for h in HEADER)


def parse(*rows):
    return imp.parse([tuple(HEADER), *rows], "listing-test")


def test_a_listing_row_becomes_a_record() -> None:
    (r,), notes = parse(row())
    assert r["import_ref"] == "listing-test#1" and r["postal_code"] == "018956", "a postal code keeps its leading zero"
    assert (r["ppa_kind"], r["ppa_years"], r["plan_years"], r["plan_excludes_first_year"]) == ("ppa", 5, 5, False)
    assert r["panels"] == [{"count": 22, "wp": 620}] and str(r["kwp"]) == "13.640" and r["phase"] == 1
    assert r["inverters"] == ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"], "two of the same inverter stay two"
    assert r["roof_access"] is False and r["urgent"] is False and r["urgent_note"] is None and notes == []


@pytest.mark.parametrize(
    ("over", "key", "want"),
    [
        ({"PPA": "Value buy"}, ("ppa_kind", "ppa_years"), ("value_buy", None)),
        ({"PPA": "8 Years"}, ("ppa_kind", "ppa_years"), ("ppa", 8)),
        ({"Maintenance Plan": "7 years excluding 1st year"}, ("plan_years", "plan_excludes_first_year"), (7, True)),
        ({"Maintenance Plan": "Free for 3 years"}, ("plan_years", "plan_excludes_first_year"), (3, False)),
        ({"1P or 3P": "3-phase"}, ("phase",), (3,)),
        ({"Roof Access": "Yes"}, ("roof_access",), (True,)),
        ({"Roof Access": None}, ("roof_access",), (None,)),
        ({"Urgent Maintenance due to Poor Generation": "need to check"}, ("urgent", "urgent_note"), (True, "Poor generation: need to check")),
        ({"No. of Panels": 26, "Panel Wp": "23 Nos. x 635 Wp\n3 Nos. X 620 Wp", "kWp DC": 16.465}, ("panels",), ([{"count": 23, "wp": 635}, {"count": 3, "wp": 620}],)),
        ({"Postal Code": "358791"}, ("postal_code",), ("358791",)),
    ],
)
def test_the_listings_wordings_are_read(over, key, want) -> None:
    (r,), _ = parse(row(**over))
    assert tuple(r[k] for k in key) == want


@pytest.mark.parametrize(
    ("raw", "fixed"),
    [("UN2000-10K-MAP0", "SUN2000-10K-MAP0"), ("SUN2000 - 30K-MC0", "SUN2000-30K-MC0"), ("sun2000-10k-lc0", "SUN2000-10K-LC0")],
)
def test_inverter_typos_are_corrected_and_listed(raw, fixed) -> None:
    (r,), notes = parse(row(Inverter=raw))
    assert r["inverters"] == [fixed] and any(fixed in n for n in notes)


def test_a_kwp_that_disagrees_with_the_panels_is_kept_and_noted() -> None:
    (r,), notes = parse(row(**{"kWp DC": 14.0}))
    assert str(r["kwp"]) == "14.000" and any("differs" in n for n in notes)


@pytest.mark.parametrize(
    ("over", "says"),
    [
        ({"PPA": "Lease"}, "PPA"),
        ({"Maintenance Plan": "Sometimes"}, "Maintenance Plan"),
        ({"1P or 3P": "2-phase"}, "1P or 3P"),
        ({"Roof Access": "Maybe"}, "Roof Access"),
        ({"Postal Code": "1234567"}, "Postal Code"),
        ({"Address": " "}, "Address"),
        ({"Panel Wp": "lots"}, "Panel Wp"),
        ({"No. of Panels": 25, "Panel Wp": "23 Nos. x 635 Wp\n3 Nos. X 620 Wp"}, "don't add up"),
        ({"6 Months": date(2026, 1, 1)}, "aren't in order"),
        ({"Turn On Date": "soon"}, "isn't a date"),
        ({"S/N": None}, "missing or repeated"),
    ],
)
def test_anything_unexpected_stops_the_import(over, says) -> None:
    with pytest.raises(imp.RowError, match=says):
        parse(row(**over))


def test_a_repeated_sn_stops_the_import() -> None:
    with pytest.raises(imp.RowError, match="repeated"):
        parse(row(1), row(1))


def test_a_sheet_without_the_listings_header_is_refused() -> None:
    with pytest.raises(imp.RowError, match="header"):
        imp.parse([("Name", "Address"), (1, "x")], "listing-test")


def test_blank_rows_are_skipped() -> None:
    records, _ = parse(row(1), tuple([None] * len(HEADER)), row(2))
    assert [r["import_ref"] for r in records] == ["listing-test#1", "listing-test#2"]


def test_an_import_adds_new_rows_once_and_updates_only_when_asked(fx) -> None:
    ref = f"pytest-listing-{uuid.uuid4().hex[:6]}"
    records, _ = imp.parse([tuple(HEADER), row(1), row(2, Address="2 Example Road")], ref)
    try:
        with fx.conn.cursor() as cur:
            assert imp.write(cur, records, update=False) == (2, 0, 0)
            assert imp.write(cur, records, update=False) == (0, 0, 2)
            fx.conn.execute("update maintenance_systems set notes = 'kept', urgent = true where import_ref = %s", (f"{ref}#1",))
            assert imp.write(cur, records, update=True) == (0, 2, 0)
        r = fx.conn.execute("select notes, urgent from maintenance_systems where import_ref = %s", (f"{ref}#1",)).fetchone()
        assert r == {"notes": "kept", "urgent": False}, "the sheet's columns refresh; what was set in the app stays"
    finally:
        fx.conn.execute("delete from maintenance_systems where import_ref like %s", (f"{ref}#%",))


@pytest.mark.parametrize(
    ("d", "n", "want"),
    [
        (date(2025, 12, 31), 6, date(2026, 6, 30)),
        (date(2026, 5, 26), 6, date(2026, 11, 26)),
        (date(2026, 8, 31), 6, date(2027, 2, 28)),
        (date(2028, 2, 29), 12, date(2029, 2, 28)),
        (date(2026, 1, 12), 12, date(2027, 1, 12)),
    ],
)
def test_months_are_added_as_the_listing_does(d, n, want) -> None:
    assert mt._months(d, n) == want
