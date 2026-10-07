"""The project workflow end to end: approvals, milestone fields, uploads, locks, details, act-as."""

from __future__ import annotations

import shutil
import uuid

import psycopg
import pytest

from _lib import onemap, storage
from _lib.db import transaction
from _routes import projects as projects_mod
from conftest import bearer

SITE = onemap.Location(
    address="53 ANG MO KIO AVENUE 3 SINGAPORE 569933", postal_code="569933", lat=1.3691, lng=103.8486
)
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
PDF = b"%PDF-1.4\n" + b"0" * 64


@pytest.fixture(autouse=True)
def _onemap(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(projects_mod.onemap, "resolve", lambda _a, _p: SITE)


@pytest.fixture
def team(fx):
    """A PM, a homeowner, and a contractor group with an admin and an EPC lead."""
    pm = fx.user("project_manager", full_name="Flow PM")
    ho = fx.user("homeowner", full_name="Flow Homeowner")
    admin = fx.user("contractor", full_name="Flow Admin")
    epc = fx.user("epc_team", full_name="Flow EPC")
    outsider = fx.user("contractor", full_name="Not On It")
    g = fx.conn.execute(
        "insert into contractor_groups (name) values (%s) returning group_id", (f"pytest flow {uuid.uuid4().hex[:6]}",)
    ).fetchone()["group_id"]
    for u in (admin, epc):
        fx.conn.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (g, u["uid"]))
    t = {"pm": pm, "ho": ho, "admin": admin, "epc": epc, "outsider": outsider, "group": g, "projects": []}
    yield t
    for pid in t["projects"]:
        shutil.rmtree(storage.LOCAL_DIR / "projects" / str(pid), ignore_errors=True)
    fx.conn.execute("delete from projects where contractor_group_id = %s or project_id = any(%s)", (g, t["projects"]))
    fx.conn.execute("delete from contractor_group_members where group_id = %s", (g,))
    fx.conn.execute("delete from contractor_groups where group_id = %s", (g,))


def h(u):
    return bearer(u["clerk_user_id"])


def new_project(client, t, *, account=True) -> int:
    body = {
        "name": "Flow Residence",
        "postalCode": "569933",
        "address": "53 Ang Mo Kio Ave 3",
        "homeownerId": t["ho"]["uid"] if account else None,
        "homeownerName": "" if account else "Typed Name",
        "contactNo": "+65 9123 4567",
        "contractor": {"type": "group", "groupId": t["group"]},
        "startDate": "2026-10-12",
    }
    r = client.post("/api/py/projects", headers=h(t["pm"]), json=body)
    assert r.status_code == 200, r.text
    t["projects"].append(r.json()["id"])
    return r.json()["id"]


def fields(client, who, pid) -> dict:
    r = client.get(f"/api/py/projects/{pid}/fields", headers=h(who))
    assert r.status_code == 200, r.text
    return r.json()


def field(data: dict, key: str) -> dict:
    return next(f for s in data["sections"] for f in s["fields"] if f["key"] == key)


def save(client, who, pid, key, value):
    return client.patch(f"/api/py/projects/{pid}/fields", headers=h(who), json={"key": key, "value": value})


def upload(client, who, pid, category, data=PNG, ctype="image/png", name="photo.png"):
    link = client.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=h(who),
        json={"category": category, "fileName": name, "contentType": ctype, "size": len(data)},
    )
    if link.status_code != 200:
        return link
    put = client.put(link.json()["uploadUrl"], content=data, headers={"Content-Type": ctype})
    assert put.status_code == 200, put.text
    return client.post(
        f"/api/py/projects/{pid}/files",
        headers=h(who),
        json={"category": category, "key": link.json()["key"], "fileName": name},
    )


def status(fx, pid) -> str:
    return fx.conn.execute("select status from projects where project_id = %s", (pid,)).fetchone()["status"]


def approve_both(client, t, pid):
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(t["ho"])).status_code == 200
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(t["pm"])).status_code == 200


M1_VALUES = {
    "electricity_retailer_id": "SP Group",
    "gst_proof": None,
    "homeowner.ic_last4": "567d",
    "sp_application_status": 1,
    "sales": "K. Chandra",
    "waterproofing": False,
    "create_group_chat": True,
    "panel_quantity_estimate": 20,
    "panel_capacity": 610,
    "inverter_to_order": "Huawei SUN2000-10KTL",
    "inverter_collected": True,
    "inverter_serial_number": "HW-10KTL-1",
    "current_stage": 2,
    "installation_end_date": "2026-10-16",
    "scaffolding_removal": True,
    "scaffolding_removal_date": "2026-10-17",
    "sp_submission_date": "2026-10-18",
}
M1_FILES = [
    "utility_bill",
    "gst_proof",
    "sp_forms_signed",
    "panel_pictures",
    "inverter_pictures",
    "sp_submission_screenshot",
]


def fill_m1(client, who, pid, *, leave_out: str | None = None):
    for k, v in M1_VALUES.items():
        if k in M1_FILES or k == leave_out:
            continue
        r = save(client, who, pid, k, v)
        assert r.status_code == 200, (k, r.text)
    for c in M1_FILES:
        if c != leave_out:
            r = upload(client, who, pid, c, PDF, "application/pdf", f"{c}.pdf")
            assert r.status_code == 200, (c, r.text)


# ------------------------------------------------------------------ the flow


def test_the_whole_flow_to_milestone_one(client, fx, team) -> None:
    pid = new_project(client, team)
    assert status(fx, pid) == "awaiting_homeowner"

    # Before approval: everyone can look, nobody can fill in.
    for who in ("pm", "admin", "epc", "ho"):
        assert field(fields(client, team[who], pid), "sales")["lockedReason"]
    assert save(client, team["admin"], pid, "sales", "x").status_code == 403
    assert fields(client, team["ho"], pid)["actions"]["approve"] is True
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(team["pm"])).status_code == 409  # homeowner first

    # The homeowner approves, then a PM.
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(team["ho"])).status_code == 200
    assert status(fx, pid) == "homeowner_approved"
    assert save(client, team["admin"], pid, "sales", "x").status_code == 403  # still waiting for the PM
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(team["pm"])).status_code == 200
    assert status(fx, pid) == "pm_approved"

    # Milestone 1's sections are open; Milestone 2's aren't yet.
    d = fields(client, team["epc"], pid)
    assert field(d, "sales")["lockedReason"] is None
    assert "Milestone 1" in field(d, "pvl_received_date")["lockedReason"]

    # The first field starts the project.
    assert save(client, team["epc"], pid, "sales", "K. Chandra").status_code == 200
    assert status(fx, pid) == "in_progress"

    # Fill everything else in Milestone 1 (the admin and the EPC lead share the work).
    fill_m1(client, team["admin"], pid)
    d = fields(client, team["admin"], pid)
    assert d["milestoneReached"] == 1 and d["recordedMilestones"] == [1]
    assert field(d, "pvl_received_date")["lockedReason"] is None  # Milestone 2 open
    news = fx.conn.execute(
        "select recipient_uid from notifications where project_id = %s and kind = 'milestone_complete'", (pid,)
    ).fetchall()
    assert {team["ho"]["uid"], team["pm"]["uid"], team["epc"]["uid"]} <= {n["recipient_uid"] for n in news}

    # Milestone 1 is fixed for the crew now; a PM can correct it, not empty it; reopening frees it.
    assert save(client, team["epc"], pid, "sales", "Someone else").status_code == 403
    assert save(client, team["pm"], pid, "sales", "K. Chandra (corrected)").status_code == 200
    assert save(client, team["pm"], pid, "sales", "").status_code == 400
    assert client.post(f"/api/py/projects/{pid}/milestones/1/reopen", headers=h(team["epc"])).status_code == 403
    assert client.post(f"/api/py/projects/{pid}/milestones/1/reopen", headers=h(team["pm"])).status_code == 200
    assert save(client, team["epc"], pid, "sales", "Back to crew").status_code == 200


def test_conditional_fields_follow_their_answer(client, fx, team) -> None:
    pid = new_project(client, team)
    approve_both(client, team, pid)
    fill_m1(client, team["admin"], pid)
    assert fields(client, team["pm"], pid)["milestoneReached"] == 1
    # "Inverter collected? No" makes "Expected collection date" required: Milestone 1 is no longer complete by data.
    client.post(f"/api/py/projects/{pid}/milestones/1/reopen", headers=h(team["pm"]))
    save(client, team["admin"], pid, "inverter_collected", False)
    d = fields(client, team["admin"], pid)
    assert field(d, "inverter_date")["shown"] and d["milestoneReached"] == 0
    save(client, team["admin"], pid, "inverter_date", "2026-10-20")
    assert fields(client, team["admin"], pid)["milestoneReached"] == 1
    # A retailer that isn't SP needs its contract end date.
    client.post(f"/api/py/projects/{pid}/milestones/1/reopen", headers=h(team["pm"]))
    save(client, team["admin"], pid, "electricity_retailer_id", "Geneco")
    assert fields(client, team["admin"], pid)["milestoneReached"] == 0


def test_decline_and_ask_again(client, fx, team) -> None:
    pid = new_project(client, team)
    r = client.post(f"/api/py/projects/{pid}/decline", headers=h(team["ho"]), json={"reason": "Not this month"})
    assert r.status_code == 200 and status(fx, pid) == "homeowner_declined"
    note = fx.conn.execute(
        "select body from notifications where project_id = %s and kind = 'approval_declined'", (pid,)
    ).fetchone()
    assert "Not this month" in note["body"]
    assert client.post(f"/api/py/projects/{pid}/remind", headers=h(team["pm"])).status_code == 200
    assert status(fx, pid) == "awaiting_homeowner"


# ------------------------------------------------------------------ uploads


def test_upload_view_and_remove_a_file(client, fx, team) -> None:
    pid = new_project(client, team)
    approve_both(client, team, pid)
    r = upload(client, team["epc"], pid, "panel_pictures")
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    f = field(fields(client, team["ho"], pid), "panel_pictures")
    assert f["files"][0]["id"] == fid and f["filled"]

    view = client.get(f"/api/py/files/{fid}", headers=h(team["ho"]), follow_redirects=False)
    assert view.status_code == 302
    got = client.get(view.headers["location"])
    assert got.status_code == 200 and got.content == PNG and got.headers["content-type"] == "image/png"
    assert client.get(f"/api/py/files/{fid}", headers=h(team["outsider"])).status_code == 404

    assert client.delete(f"/api/py/projects/{pid}/files/{fid}", headers=h(team["ho"])).status_code == 403
    assert client.delete(f"/api/py/projects/{pid}/files/{fid}", headers=h(team["epc"])).status_code == 200
    # The stored copy stays, so the removal can be restored from the audit log.
    assert any((storage.LOCAL_DIR / "projects" / str(pid) / "images" / "panel_pictures").glob("*.png"))


def test_uploads_are_checked_three_ways(client, fx, team) -> None:
    pid = new_project(client, team)
    approve_both(client, team, pid)
    assert upload(client, team["epc"], pid, "panel_pictures", b"<html>", "text/html").status_code == 400
    assert upload(client, team["outsider"], pid, "panel_pictures").status_code == 404
    assert upload(client, team["epc"], pid, "pvl_letter").status_code == 403  # Milestone 2: not open yet
    # A key for another project, or bytes that differ from what was approved, are refused.
    forged = client.post(
        f"/api/py/projects/{pid}/files",
        headers=h(team["epc"]),
        json={"category": "panel_pictures", "key": f"projects/{pid + 1}/panel_pictures/x.png"},
    )
    assert forged.status_code == 400
    link = client.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=h(team["epc"]),
        json={"category": "panel_pictures", "contentType": "image/png", "size": len(PNG)},
    ).json()
    assert (
        client.put(link["uploadUrl"], content=PNG + b"extra", headers={"Content-Type": "image/png"}).status_code == 400
    )


# --------------------------------------------------- the homeowner's details


def test_homeowner_ic_is_recorded_but_never_shown(client, fx, team) -> None:
    pid = new_project(client, team)
    approve_both(client, team, pid)
    assert save(client, team["admin"], pid, "homeowner.ic_last4", "S1234567D").status_code == 400
    assert save(client, team["admin"], pid, "homeowner.ic_last4", "567d").status_code == 200
    ic = fx.conn.execute("select ic_last4 from users where uid = %s", (team["ho"]["uid"],)).fetchone()["ic_last4"]
    assert ic == "567D"
    f = field(fields(client, team["pm"], pid), "homeowner.ic_last4")
    assert f["value"] == "Recorded" and "567" not in str(f)
    assert field(fields(client, team["pm"], pid), "homeowner.email")["lockedReason"]


# ---------------------------------------------------------------- details


def test_linking_the_homeowner_takes_a_draft_to_approval(client, fx, team) -> None:
    pid = new_project(client, team, account=False)
    assert status(fx, pid) == "draft"
    body = {
        "name": "Flow Residence",
        "postalCode": "569933",
        "address": "53 Ang Mo Kio Ave 3",
        "homeownerId": team["ho"]["uid"],
        "contactNo": "+65 9123 4567",
        "contractor": {"type": "group", "groupId": team["group"]},
        "startDate": "2026-10-12",
        "endDate": "2026-11-30",
    }
    assert client.patch(f"/api/py/projects/{pid}", headers=h(team["admin"]), json=body).status_code == 403
    r = client.patch(f"/api/py/projects/{pid}", headers=h(team["pm"]), json=body)
    assert r.status_code == 200 and "asked to approve" in r.json()["message"]
    row = fx.conn.execute("select status, target_end_date from projects where project_id = %s", (pid,)).fetchone()
    assert row["status"] == "awaiting_homeowner" and str(row["target_end_date"]) == "2026-11-30"
    assert fx.conn.execute(
        "select 1 from notifications where project_id = %s and recipient_uid = %s and kind = 'approval_request'",
        (pid, team["ho"]["uid"]),
    ).fetchone()


# ------------------------------------------------------- the database's rules


def test_the_database_enforces_who_does_what(client, fx, team) -> None:
    pid = new_project(client, team)
    ho, outsider, epc = team["ho"]["uid"], team["outsider"]["uid"], team["epc"]["uid"]
    with pytest.raises(psycopg.Error, match="approve or decline"), transaction(ho) as cur:
        cur.execute("update projects set sales = 'x' where project_id = %s", (pid,))
    with pytest.raises(psycopg.Error, match="aren't on this project"), transaction(outsider) as cur:
        cur.execute("update projects set sales = 'x' where project_id = %s", (pid,))
    with pytest.raises(psycopg.Error, match="status"), transaction(epc) as cur:
        cur.execute("update projects set status = 'closed' where project_id = %s", (pid,))
    with pytest.raises(psycopg.Error, match="reopen"), transaction(epc) as cur:
        cur.execute("insert into project_milestones (project_id, milestone_no) values (%s, 1)", (pid,))
        cur.execute("delete from project_milestones where project_id = %s", (pid,))
    with pytest.raises(psycopg.Error, match="crew"), transaction(ho) as cur:
        cur.execute(
            "insert into project_files (project_id, category, url, file_name) values (%s, 'gst_proof', 'k', 'n')",
            (pid,),
        )


# ---------------------------------------------------------------- act as


def test_act_as_lets_a_pm_test_other_roles_on_a_laptop_only(client, fx, team, monkeypatch) -> None:
    hdr = {**h(team["pm"]), "X-Act-As": str(team["ho"]["uid"])}
    me = client.get("/api/py/me", headers=hdr).json()
    assert me["user"]["role"] == "homeowner" and me["actingAs"]["byUid"] == team["pm"]["uid"]
    # Only a PM can act as someone else, and never on Vercel.
    crew = client.get("/api/py/me", headers={**h(team["admin"]), "X-Act-As": str(team["ho"]["uid"])}).json()
    assert crew["user"]["role"] == "contractor" and "actingAs" not in crew
    monkeypatch.setenv("VERCEL", "1")
    assert client.get("/api/py/me", headers=hdr).json()["user"]["role"] == "project_manager"
