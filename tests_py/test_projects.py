"""Projects: the list each role sees, and Create Project, end to end on the test branch."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import psycopg
import pytest
from fastapi import HTTPException

from _lib import onemap, project_fields
from _lib.db import transaction
from _routes import projects as projects_mod
from conftest import bearer

SITE = onemap.Location(address="53 ANG MO KIO AVENUE 3 AMK HUB SINGAPORE 569933", postal_code="569933",
                       lat=1.3691, lng=103.8486)  # fmt: skip


@pytest.fixture(autouse=True)
def _onemap(monkeypatch: pytest.MonkeyPatch):
    """OneMap is not called from tests; every postal code resolves to one site."""
    monkeypatch.setattr(projects_mod.onemap, "resolve", lambda _a, _p: SITE)


@pytest.fixture
def pm(fx):
    return fx.user("project_manager", full_name="Projects PM")


@pytest.fixture
def made(fx):
    """Projects created during a test, removed afterwards (their history stays in the log)."""
    ids: list[int] = []
    yield ids
    if ids:
        fx.conn.execute("delete from projects where project_id = any(%s)", (ids,))


@pytest.fixture
def crew_group(fx):
    admin = fx.user("contractor", full_name="Group Admin")
    epc = fx.user("epc_team", full_name="Group EPC")
    g = fx.conn.execute(
        "insert into contractor_groups (name) values (%s) returning group_id", (f"pytest proj {uuid.uuid4().hex[:6]}",)
    ).fetchone()["group_id"]
    for u in (admin, epc):
        fx.conn.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (g, u["uid"]))
    yield {"id": g, "admin": admin, "epc": epc}
    fx.conn.execute("delete from projects where contractor_group_id = %s", (g,))
    fx.conn.execute("delete from contractor_group_members where group_id = %s", (g,))
    fx.conn.execute("delete from contractor_groups where group_id = %s", (g,))


def body(**over):
    b = {
        "name": "Jalan Kayu Residence",
        "postalCode": "569933",
        "address": "14 Jalan Kayu, Singapore 799463",
        "homeownerName": "Aisha Rahman",
        "contactNo": "+65 9123 4567",
        "contractor": {"type": "text", "text": "Northline Roofing"},
        "startDate": "2026-10-12",
    }
    b.update(over)
    return b


def create(client, who, made, **over):
    r = client.post("/api/py/projects", headers=bearer(who["clerk_user_id"]), json=body(**over))
    if r.status_code == 200:
        made.append(r.json()["id"])
    return r


def listed(client, who) -> list[dict]:
    r = client.get("/api/py/projects", headers=bearer(who["clerk_user_id"]))
    assert r.status_code == 200, r.text
    return r.json()["projects"]


# ------------------------------------------------------------------- dates


def test_either_date_is_enough_and_the_other_is_three_weeks_away() -> None:
    d = date(2026, 10, 12)
    assert projects_mod.plan_dates(d, None) == (d, d + timedelta(days=21))
    assert projects_mod.plan_dates(None, d) == (d - timedelta(days=21), d)
    assert projects_mod.plan_dates(d, d + timedelta(days=40)) == (d, d + timedelta(days=40))
    for bad in ((None, None), (d, d - timedelta(days=1))):
        with pytest.raises(HTTPException):
            projects_mod.plan_dates(*bad)


# ------------------------------------------------------------------ creating


def test_only_project_managers_create(client, fx, made) -> None:
    for r in ("homeowner", "contractor", "epc_team"):
        u = fx.user(r)
        assert create(client, u, made).status_code == 403
        assert client.get("/api/py/projects/options", headers=bearer(u["clerk_user_id"])).status_code == 403


def test_create_with_an_account_and_a_group(client, pm, fx, made, crew_group) -> None:
    ho = fx.user("homeowner", full_name="Jasmine Lee")
    r = create(
        client, pm, made, homeownerId=ho["uid"], homeownerName="", startDate=None, endDate="2026-11-30",
        contractor={"type": "group", "groupId": crew_group["id"]},
    )  # fmt: skip
    assert r.status_code == 200, r.text
    assert "asked to approve" in r.json()["message"]
    row = fx.conn.execute("select * from projects where project_id = %s", (r.json()["id"],)).fetchone()
    assert row["status"] == "awaiting_homeowner"
    assert (row["installation_start_date"], row["target_end_date"]) == (date(2026, 11, 9), date(2026, 11, 30))
    assert (row["site_lat"], row["postal_code"], row["project_manager_id"]) == (SITE.lat, "569933", pm["uid"])

    kinds = {
        n["recipient_uid"]: n["kind"]
        for n in fx.conn.execute(
            "select recipient_uid, kind::text from notifications where project_id = %s", (row["project_id"],)
        ).fetchall()  # fmt: skip
    }
    assert kinds == {ho["uid"]: "approval_request", crew_group["admin"]["uid"]: "assignment",
                     crew_group["epc"]["uid"]: "assignment"}  # fmt: skip
    # Written to the audit log, attributed to the PM.
    assert (
        fx.conn.execute(
            "select actor_uid from audit_log where entity_table = 'projects' and entity_id = %s and action = 'insert'",
            (str(row["project_id"]),),
        ).fetchone()["actor_uid"]
        == pm["uid"]
    )


def test_create_as_a_draft_with_named_individuals(client, pm, fx, made) -> None:
    a, b = fx.user("contractor"), fx.user("epc_team")
    r = create(client, pm, made, contractor={"type": "users", "userIds": [a["uid"], b["uid"]]})
    assert r.status_code == 200, r.text
    assert "draft" in r.json()["message"]
    pid = r.json()["id"]
    assert fx.conn.execute("select status from projects where project_id = %s", (pid,)).fetchone()["status"] == "draft"
    assigned = fx.conn.execute("select user_id from project_assignments where project_id = %s", (pid,)).fetchall()
    assert {x["user_id"] for x in assigned} == {a["uid"], b["uid"]}
    p = next(x for x in listed(client, pm) if x["id"] == pid)
    assert p["homeowner"] == {"uid": None, "name": "Aisha Rahman", "linked": False}
    assert p["endDate"] == "2026-11-02" and p["contractor"]["type"] == "users"


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"name": ""}, "name"),
        ({"postalCode": "12345"}, "postal code"),
        ({"address": ""}, "address"),
        ({"homeownerName": ""}, "homeowner"),
        ({"contactNo": ""}, "contact"),
        ({"contractor": {"type": "group"}}, "contractor group"),
        ({"contractor": {"type": "users", "userIds": []}}, "contractor admins"),
        ({"contractor": {"type": "text", "text": ""}}, "contractor"),
        ({"startDate": None, "endDate": None}, "start date or an end date"),
        ({"endDate": "2026-10-01"}, "before the start"),
    ],
)
def test_everything_in_create_project_is_mandatory(client, pm, made, over, message) -> None:
    r = create(client, pm, made, **over)
    assert r.status_code == 400 and message in r.json()["error"], r.text


def test_homeowner_must_be_a_homeowner_account(client, pm, fx, made) -> None:
    crew = fx.user("contractor")
    assert create(client, pm, made, homeownerId=crew["uid"]).status_code == 400


def test_onemap_down_does_not_block_but_a_wrong_postal_code_does(client, pm, fx, made, monkeypatch) -> None:
    def down(_a, _p):
        raise onemap.GeocodeError("OneMap is busy.", "rate_limited")

    monkeypatch.setattr(projects_mod.onemap, "resolve", down)
    r = create(client, pm, made)
    assert r.status_code == 200 and "GPS" in r.json()["message"]
    assert next(x for x in listed(client, pm) if x["id"] == r.json()["id"])["siteLocated"] is False

    def unknown(_a, _p):
        raise onemap.GeocodeError('OneMap found nothing for "999999".', "not_found")

    monkeypatch.setattr(projects_mod.onemap, "resolve", unknown)
    assert create(client, pm, made, postalCode="999999").status_code == 400


# ------------------------------------------------------------------ who sees what


def test_each_role_sees_only_its_projects(client, pm, fx, made, crew_group) -> None:
    ho = fx.user("homeowner")
    other_ho = fx.user("homeowner")
    loner = fx.user("epc_team")
    named = fx.user("contractor")
    mine = create(client, pm, made, homeownerId=ho["uid"], homeownerName="",
                  contractor={"type": "group", "groupId": crew_group["id"]}).json()["id"]  # fmt: skip
    theirs = create(client, pm, made, homeownerId=other_ho["uid"], homeownerName="",
                    contractor={"type": "users", "userIds": [named["uid"]]}).json()["id"]  # fmt: skip

    def ids(u):
        return {p["id"] for p in listed(client, u)}

    assert {mine, theirs} <= ids(pm)
    assert ids(ho) == {mine}
    assert mine in ids(crew_group["epc"]) and theirs not in ids(crew_group["epc"])
    assert theirs in ids(named) and mine not in ids(named)
    assert not ({mine, theirs} & ids(loner))
    assert client.get(f"/api/py/projects/{theirs}", headers=bearer(ho["clerk_user_id"])).status_code == 404
    assert client.get(f"/api/py/projects/{mine}", headers=bearer(ho["clerk_user_id"])).status_code == 200


# ---------------------------------------------------------------- red flags


def test_late_and_no_show_turn_a_project_red(client, pm, fx, made) -> None:
    on_time = create(client, pm, made, startDate=None, endDate=(date.today() + timedelta(days=30)).isoformat())
    late = create(client, pm, made, startDate="2026-01-05", endDate="2026-01-26")
    rows = {p["id"]: p for p in listed(client, pm)}
    assert rows[on_time.json()["id"]]["attention"] is False
    assert rows[late.json()["id"]]["flags"][0]["kind"] == "overdue"

    pid = on_time.json()["id"]
    fx.conn.execute(
        "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note) "
        "values (%s, current_date - 2, '09:00', 'Panel mounting')",
        (pid,),
    )
    p = next(x for x in listed(client, pm) if x["id"] == pid)
    assert p["attention"] and p["flags"][0]["kind"] == "no_show" and "Panel mounting" in p["flags"][0]["text"]


# ---------------------------------------------------------------- the guard


def test_only_a_pm_changes_details_crews_fill_milestones(client, pm, fx, made, crew_group) -> None:
    pid = create(client, pm, made, contractor={"type": "group", "groupId": crew_group["id"]}).json()["id"]
    admin = crew_group["admin"]["uid"]
    with pytest.raises(psycopg.Error, match="project manager"), transaction(admin) as cur:
        cur.execute("update projects set name = 'Hijacked' where project_id = %s", (pid,))
    with pytest.raises(psycopg.Error, match="project manager"), transaction(admin) as cur:
        cur.execute("update projects set target_end_date = target_end_date + 7 where project_id = %s", (pid,))
    with transaction(admin) as cur:
        cur.execute("update projects set sales = 'K. Chandra' where project_id = %s", (pid,))
    with transaction(pm["uid"]) as cur:
        cur.execute("update projects set target_end_date = target_end_date + 7 where project_id = %s", (pid,))


# ------------------------------------------------------------- progress


def test_progress_and_milestones_follow_the_brief() -> None:
    p: dict = {"status": "in_progress", "electricity_retailer_id": None, "homeowner_id": 1,
               "_homeowner": {"ic_last4": "567D", "email": "a@example.com"}}  # fmt: skip
    g = project_fields.group_status(p, {})
    assert project_fields.milestone_reached(g) == 0
    assert 0 < project_fields.progress(p, g) < 10  # the homeowner's IC and email count

    # Fill every Milestone 1 field: milestone 1 reached, conditional ones obeyed.
    m1 = [f for f in project_fields.FIELDS if f.group in project_fields.MILESTONES[1]]
    files = {f.key: 1 for f in m1 if f.kind in project_fields.FILE_KINDS}
    for f in m1:
        if f.kind in ("date",):
            p[f.key] = "2026-10-12"
        elif f.kind == "yesno":
            p[f.key] = True
        elif f.kind in ("number", "text"):
            p[f.key] = 1 if f.kind == "number" else "x"
    p["electricity_retailer_id"], p["_retailer_name"], p["sp_application_status"] = 2, "SP Group", 1
    p["retailer_contract_end_date"] = None  # SP: not required
    g = project_fields.group_status(p, files)
    assert project_fields.milestone_reached(g) == 1

    # An unanswered conditional (not collected, no date) reopens it.
    p["inverter_collected"], p["inverter_date"] = False, None
    assert project_fields.milestone_reached(project_fields.group_status(p, files)) == 0
    assert project_fields.progress({"status": "closed"}, g) == 100
