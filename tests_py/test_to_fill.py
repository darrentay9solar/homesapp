# ruff: noqa: E501  (one assertion per line reads best here)
"""Records imported from 9 Solar Home's lists: the whole flow to fill, what's empty flagged, and the
manager told when they're given one (api/_lib/to_fill.py, client_list.record_projects).

record     an imported system gets a handed-over project holding the project's part of the flow, filled
           from what the lists say; the handover finds the system already there, so there's no second one
open       an imported record's fields open in any order for its manager; the crew can't touch a record
flagged    every required field still empty is flagged, counted on the system, the project and the lists
quiet      completing a record's section asks nobody to sign and tells nobody
told       the manager given an imported record (a superadmin's choice, or taking one on) is alerted
"""

from __future__ import annotations

import json
from zoneinfo import ZoneInfo

import pytest
from test_maintenance import boss, h, pm2, systems  # noqa: F401
from test_project_work import _onemap, field, fields, new_project, team  # noqa: F401

from _lib import client_list


@pytest.fixture
def imported(fx, systems):  # noqa: F811
    """An imported system with its record project; removes the project after."""
    made: list[int] = []

    def make(**cols) -> tuple[int, int]:
        sid = systems(**{
            "inverters": ["SUN2000-10K-MAP0"], "inverter_serials": ["HV123"], "project_code": f"9SH{len(made) + 9000}",
            "salesperson": "Alex", "epc": "Ah Seng Electrical", "homeowner_name": "Mr Tan", "homeowner_contact_no": "+65 9111 2222",
            **cols,
        })  # fmt: skip
        with fx.conn.cursor() as cur:
            got = client_list.record_projects(cur, [sid])
        assert len(got) == 1
        made.append(got[0][0])
        return got[0][0], sid

    yield make
    fx.conn.execute("update maintenance_systems set project_id = null where project_id = any(%s)", (made,))
    fx.conn.execute("delete from projects where project_id = any(%s)", (made,))


def _notes(fx, uid: int) -> list[dict]:
    return fx.conn.execute(
        "select title, body, link from notifications where recipient_uid = %s and kind = 'assignment' and title like 'Fields to fill%%'",
        (uid,),
    ).fetchall()


# ------------------------------------------------------------------ record


def test_an_imported_system_gets_its_project_record(fx, imported) -> None:
    pid, sid = imported()
    p = fx.conn.execute("select * from projects where project_id = %s", (pid,)).fetchone()
    s = fx.conn.execute("select * from maintenance_systems where system_id = %s", (sid,)).fetchone()
    assert p["status"] == "maintenance" and s["project_id"] == pid and p["import_ref"].startswith("record:")
    assert (
        fx.conn.execute("select count(*) as n from maintenance_systems where project_id = %s", (pid,)).fetchone()["n"]
        == 1
    ), "no second system"
    # From the lists, and what turned on means.
    assert (p["address"], p["postal_code"], p["project_code"], p["sales"]) == (
        s["address"],
        s["postal_code"],
        s["project_code"],
        "Alex",
    )
    assert (p["panel_quantity_estimate"], p["panel_capacity"], p["inverter_to_order"], p["inverter_serial_number"]) == (
        20,
        620,
        "SUN2000-10K-MAP0",
        "HV123",
    )
    assert p["sp_turn_on_inspection_date"] == s["turned_on_on"] and p["inverter_commission_grid_connection"] is True
    assert p["inverter_collected"] is True and p["sp_application_status"] == 2
    assert (
        p["closed_at"].astimezone(ZoneInfo("Asia/Singapore")).date() == s["turned_on_on"]
    ), "handed over when turned on"


def test_it_runs_once(fx, imported) -> None:
    _, sid = imported()
    with fx.conn.cursor() as cur:
        assert client_list.record_projects(cur, [sid]) == []


def test_a_system_with_little_in_the_lists_still_gets_one(fx, imported) -> None:
    pid, _ = imported(homeowner_contact_no=None, turned_on_on=None)
    p = fx.conn.execute(
        "select homeowner_contact_no, installation_start_date, target_end_date from projects where project_id = %s",
        (pid,),
    ).fetchone()
    assert (
        p["homeowner_contact_no"] == "Not in the list"
        and p["installation_start_date"] == p["target_end_date"] is not None
    )


def test_a_system_from_the_app_gets_none(fx, systems) -> None:  # noqa: F811
    sid = systems(import_ref=None)
    with fx.conn.cursor() as cur:
        assert client_list.record_projects(cur, [sid]) == []


# --------------------------------------------------------------- open, flagged


def test_its_manager_fills_any_section_and_the_empty_ones_are_flagged(client, fx, team, imported) -> None:  # noqa: F811
    pid, _ = imported(run_by=team["pm"]["uid"])
    fx.conn.execute("update projects set project_manager_id = %s where project_id = %s", (team["pm"]["uid"], pid))
    d = fields(client, team["pm"], pid)
    assert d["imported"] is True and d["toFill"] > 0
    assert all(s["lockedReason"] is None for s in d["sections"]), "every section open, handed over or not"
    assert field(d, "utility_bill")["toFill"] is True and field(d, "sales")["toFill"] is False, "filled from the list"
    assert field(d, "moc_change")["toFill"] is False, "optional"
    assert sum(s["toFill"] for s in d["sections"]) == d["toFill"]
    r = client.patch(
        f"/api/py/projects/{pid}/fields",
        headers=h(team["pm"]),
        json={"key": "pvl_received_date", "value": "2026-04-01"},
    )
    assert r.status_code == 200, r.text
    assert field(fields(client, team["pm"], pid), "pvl_received_date")["toFill"] is False


def test_the_crew_cant_change_a_record(client, fx, team, imported) -> None:  # noqa: F811
    pid, _ = imported(run_by=team["pm"]["uid"])
    fx.conn.execute(
        "update projects set project_manager_id = %s, contractor_group_id = %s where project_id = %s",
        (team["pm"]["uid"], team["group"], pid),
    )
    d = fields(client, team["epc"], pid)
    assert field(d, "pvl_received_date")["lockedReason"] == "Handed over: its project manager completes the record."
    r = client.patch(
        f"/api/py/projects/{pid}/fields",
        headers=h(team["epc"]),
        json={"key": "pvl_received_date", "value": "2026-04-01"},
    )
    assert r.status_code == 403


def test_a_project_from_the_app_has_nothing_flagged(client, team) -> None:  # noqa: F811
    pid = new_project(client, team)
    d = fields(client, team["pm"], pid)
    assert (
        d["imported"] is False and d["toFill"] == 0 and not any(f["toFill"] for s in d["sections"] for f in s["fields"])
    )


def test_the_system_and_the_lists_count_what_is_empty(client, fx, team, imported) -> None:  # noqa: F811
    pid, sid = imported(run_by=team["pm"]["uid"], phase=None, roof_access=None, ppa_kind=None)
    s = client.get(f"/api/py/maintenance/{sid}", headers=h(team["pm"])).json()["system"]
    assert s["toFill"]["system"] == ["Phase", "PPA", "Roof access"]
    assert s["toFill"]["project"] > 0
    listed = next(
        x for x in client.get("/api/py/maintenance", headers=h(team["pm"])).json()["systems"] if x["id"] == sid
    )
    assert listed["toFill"] == s["toFill"]
    fx.conn.execute("update projects set project_manager_id = %s where project_id = %s", (team["pm"]["uid"], pid))
    row = next(
        p
        for p in client.get("/api/py/projects?handed=true", headers=h(team["pm"])).json()["projects"]
        if p["id"] == pid
    )
    assert row["imported"] is True and row["toFill"] == s["toFill"]["project"]
    assert any(f["kind"] == "to_fill" for f in row["flags"])


# ------------------------------------------------------------------- quiet


def test_completing_a_records_milestone_asks_nobody_to_sign(client, fx, team, imported) -> None:  # noqa: F811
    pid, _ = imported(run_by=team["pm"]["uid"])
    fx.conn.execute("update projects set project_manager_id = %s where project_id = %s", (team["pm"]["uid"], pid))
    # Everything but one field, as the owner; the manager fills the last.
    d = fields(client, team["pm"], pid)
    cols = {"waterproofing": False, "create_group_chat": True, "current_stage": 3, "scaffolding_removal": True,
            "scaffolding_removal_date": "2026-01-02", "sp_submission_date": "2026-01-03", "installation_end_date": "2026-01-01",
            "rcb_breaker_replacement": False, "pvl_received_date": "2026-02-01", "pre_inspection_date": "2026-03-01",
            "sp_appointment_letter_received_date": "2026-03-02", "fusion_solar_app_access": False}  # fmt: skip
    fx.conn.execute(
        f"update projects set {', '.join(f'{k} = %s' for k in cols)} where project_id = %s", (*cols.values(), pid)
    )
    for cat in [
        f["key"]
        for s in d["sections"]
        for f in s["fields"]
        if f["kind"] in ("file", "photos") and f["required"] and f["key"] != "moc_change"
    ]:
        fx.conn.execute(
            "insert into project_files (project_id, category, url, file_name, content_type, size_bytes) values (%s, %s, 'local:x', 'x.pdf', 'application/pdf', 1)",
            (pid, cat),
        )
    fx.conn.execute(
        "update projects set electricity_retailer_id = (select retailer_id from electricity_retailers where name = 'SP Group') where project_id = %s",
        (pid,),
    )
    left = [f["key"] for s in fields(client, team["pm"], pid)["sections"] for f in s["fields"] if f["toFill"]]
    assert set(left) <= {"homeowner.ic_last4", "homeowner.email", "inverter_date"}, left
    r = client.patch(f"/api/py/projects/{pid}/fields", headers=h(team["pm"]), json={"key": "current_stage", "value": 4})
    assert r.status_code == 200, r.text
    p = fx.conn.execute("select status from projects where project_id = %s", (pid,)).fetchone()
    assert p["status"] == "maintenance", "still handed over: nothing to sign"
    assert not fx.conn.execute(
        "select 1 from notifications where project_id = %s and kind in ('milestone_complete', 'signature_request')",
        (pid,),
    ).fetchone()


# -------------------------------------------------------------------- told


def test_the_manager_given_an_imported_system_is_told(client, fx, boss, team, imported) -> None:  # noqa: F811
    pid, sid = imported(phase=None, roof_access=True, ppa_kind="value_buy")
    r = client.patch(f"/api/py/maintenance/{sid}", headers=h(boss), json={"runBy": team["pm"]["uid"]})
    assert r.status_code == 200, r.text
    assert (
        fx.conn.execute("select project_manager_id from projects where project_id = %s", (pid,)).fetchone()[
            "project_manager_id"
        ]
        == team["pm"]["uid"]
    ), "its record follows the system"
    told = _notes(fx, team["pm"]["uid"])
    assert len(told) == 1 and told[0]["link"] == f"/maintenance/{sid}"
    assert "1 on the maintenance record" in told[0]["body"] and "on the project record" in told[0]["body"]
    # Given it again: nothing new. Handed to someone else: they're told.
    client.patch(f"/api/py/maintenance/{sid}", headers=h(boss), json={"runBy": team["pm"]["uid"]})
    assert len(_notes(fx, team["pm"]["uid"])) == 1


def test_a_system_from_the_app_tells_nobody(client, fx, boss, team, systems) -> None:  # noqa: F811
    sid = systems(import_ref=None)
    client.patch(f"/api/py/maintenance/{sid}", headers=h(boss), json={"runBy": team["pm"]["uid"]})
    assert _notes(fx, team["pm"]["uid"]) == []


def test_taking_on_an_imported_project_tells_the_manager(client, fx, team) -> None:  # noqa: F811
    pid = fx.conn.execute(
        "insert into projects (name, address, postal_code, homeowner_name, homeowner_contact_no, installation_start_date, "
        "target_end_date, import_ref, status) values ('9 Import Road', '9 Import Road', '654321', 'Ms Lim', '+65 9000 0000', "
        "current_date, current_date + 21, %s, 'in_progress') returning project_id",
        (f"client-list#{json.dumps(team['pm']['uid'])}",),
    ).fetchone()["project_id"]
    team["projects"].append(pid)
    d = fields(client, team["pm"], pid)
    assert d["actions"]["takeOn"] is True
    assert client.post(f"/api/py/projects/{pid}/take-on", headers=h(team["pm"])).status_code == 200
    told = _notes(fx, team["pm"]["uid"])
    assert len(told) == 1 and told[0]["link"] == f"/projects/{pid}?tab=milestones"
    assert "This project came in from 9 Solar Home's lists" in told[0]["body"]
    # Imported, its later milestones are open before Milestone 1 is complete.
    assert all(s["lockedReason"] is None for s in fields(client, team["pm"], pid)["sections"])
