# ruff: noqa: E501  (one assertion per line reads best here)
"""The superadmin, and project managers limited to the projects they run (migration 0028).

exists      a superadmin only exists by being put in the database; the app can't make one
projects    a superadmin sees and edits every project and chooses who runs it;
            a project manager sees and edits only their own
accounts    project managers manage everyone except project managers (and superadmins);
            a superadmin manages project managers too
audit       homeowners and crews can't read it; a project manager reads their own projects'
            entries and people changes except other managers' accounts; a superadmin reads all
"""

from __future__ import annotations

import uuid

import psycopg
import pytest
from test_project_work import _onemap, new_project, team  # noqa: F401

from _lib.db import transaction
from conftest import bearer


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


@pytest.fixture
def boss(fx):
    return fx.user("superadmin", full_name="Sam Superadmin")


@pytest.fixture
def pm2(fx):
    return fx.user("project_manager", full_name="Other PM")


def body(**over) -> dict:
    b = {
        "name": "Superadmin Residence",
        "postalCode": "569933",
        "address": "53 Ang Mo Kio Ave 3",
        "homeownerName": "Typed Owner",
        "contactNo": "+65 9123 4567",
        "contractor": {"type": "text", "text": "Some Contractor"},
        "startDate": "2026-10-12",
    }
    return {**b, **over}


def person(role: str) -> dict:
    return {
        "fullName": f"New {role}",
        "email": f"sa-{uuid.uuid4().hex[:8]}@example.com",
        "contactNo": "+65 9123 4500",
        "role": role,
        "noExpiry": True,
    }


# ------------------------------------------------------------------ exists


def test_me_says_superadmin(client, boss) -> None:
    me = client.get("/api/py/me", headers=h(boss)).json()
    assert me["state"] == "active" and me["user"]["role"] == "superadmin" and me["user"]["roleLabel"] == "Superadmin"


@pytest.mark.parametrize("who", ["boss", "pm"])
def test_nobody_creates_a_superadmin_in_the_app(client, boss, team, who) -> None:  # noqa: F811
    actor = boss if who == "boss" else team["pm"]
    r = client.post("/api/py/people", headers=h(actor), json=person("superadmin"))
    assert r.status_code in (400, 403)


@pytest.mark.parametrize("actor_role", ["superadmin", "project_manager"])
def test_the_database_refuses_making_or_changing_a_superadmin(fx, boss, actor_role) -> None:
    actor = boss if actor_role == "superadmin" else fx.user("project_manager")
    target = fx.user("homeowner")
    with (
        pytest.raises(psycopg.Error, match="Superadmin accounts are managed directly in the database"),
        transaction(actor["uid"]) as cur,
    ):
        cur.execute("update users set user_type = 'superadmin' where uid = %s", (target["uid"],))
    other = fx.user("superadmin")
    with (
        pytest.raises(psycopg.Error, match="Superadmin accounts are managed directly in the database"),
        transaction(actor["uid"]) as cur,
    ):
        cur.execute("update users set active = false where uid = %s", (other["uid"],))


def test_a_superadmin_can_change_their_own_name(client, boss) -> None:
    assert client.patch("/api/py/me/name", headers=h(boss), json={"fullName": "Sam S. Superadmin"}).status_code == 200


def test_nobody_asks_to_become_a_superadmin(fx) -> None:
    with pytest.raises(psycopg.Error, match="added directly in the database"), transaction(None) as cur:
        cur.execute(
            "insert into account_requests (clerk_user_id, email, full_name, requested_type) values (%s, %s, 'X', 'superadmin')",
            (f"user_{uuid.uuid4().hex[:8]}", f"x-{uuid.uuid4().hex[:6]}@example.com"),
        )


def test_expiry_never_switches_off_a_superadmin(fx, boss) -> None:
    fx.conn.execute("update users set disable_on = current_date - 1 where uid = %s", (boss["uid"],))
    fx.conn.execute("select apply_account_schedule()")
    assert fx.conn.execute("select active from users where uid = %s", (boss["uid"],)).fetchone()["active"] is True


# ------------------------------------------------------------------ projects


def test_a_project_manager_sees_only_their_own_projects(client, team, pm2) -> None:  # noqa: F811
    pid = new_project(client, team)
    mine = {p["id"] for p in client.get("/api/py/projects", headers=h(team["pm"])).json()["projects"]}
    theirs = {p["id"] for p in client.get("/api/py/projects", headers=h(pm2)).json()["projects"]}
    assert pid in mine and pid not in theirs
    assert client.get(f"/api/py/projects/{pid}", headers=h(pm2)).status_code == 404
    assert client.get(f"/api/py/projects/{pid}/fields", headers=h(pm2)).status_code in (403, 404)


def test_a_superadmin_sees_every_project(client, team, boss) -> None:  # noqa: F811
    pid = new_project(client, team)
    assert pid in {p["id"] for p in client.get("/api/py/projects", headers=h(boss)).json()["projects"]}
    assert client.get(f"/api/py/projects/{pid}", headers=h(boss)).status_code == 200


def test_another_project_manager_cant_edit_it_even_in_the_database(client, team, pm2) -> None:  # noqa: F811
    pid = new_project(client, team)
    assert client.patch(f"/api/py/projects/{pid}", headers=h(pm2), json=body()).status_code == 404
    with pytest.raises(psycopg.Error, match="run by another project manager"), transaction(pm2["uid"]) as cur:
        cur.execute("update projects set name = 'Hijacked' where project_id = %s", (pid,))


def test_a_superadmin_edits_any_project_and_hands_it_over(client, team, boss, pm2) -> None:  # noqa: F811
    pid = new_project(client, team)
    r = client.patch(
        f"/api/py/projects/{pid}", headers=h(boss), json=body(name="Renamed By Superadmin", projectManagerId=pm2["uid"])
    )
    assert r.status_code == 200, r.text
    assert pid in {p["id"] for p in client.get("/api/py/projects", headers=h(pm2)).json()["projects"]}
    assert pid not in {p["id"] for p in client.get("/api/py/projects", headers=h(team["pm"])).json()["projects"]}


def test_a_project_manager_cant_hand_a_project_over(client, team, pm2) -> None:  # noqa: F811
    pid = new_project(client, team)
    r = client.patch(f"/api/py/projects/{pid}", headers=h(team["pm"]), json=body(projectManagerId=pm2["uid"]))
    assert r.status_code == 403


def test_a_superadmin_creates_a_project_for_a_project_manager(client, boss, pm2) -> None:
    r = client.post("/api/py/projects", headers=h(boss), json=body(projectManagerId=pm2["uid"]))
    assert r.status_code == 200, r.text
    assert r.json()["id"] in {p["id"] for p in client.get("/api/py/projects", headers=h(pm2)).json()["projects"]}


def test_only_a_superadmin_is_offered_the_managers(client, team, boss) -> None:  # noqa: F811
    assert client.get("/api/py/projects/options", headers=h(team["pm"])).json()["managers"] == []
    names = {m["uid"] for m in client.get("/api/py/projects/options", headers=h(boss)).json()["managers"]}
    assert team["pm"]["uid"] in names


# ------------------------------------------------------------------ accounts


@pytest.mark.parametrize("role", ["homeowner", "contractor", "epc_team"])
def test_a_project_manager_creates_everyone_but_project_managers(client, team, role) -> None:  # noqa: F811
    assert client.post("/api/py/people", headers=h(team["pm"]), json=person(role)).status_code == 200


def test_a_project_manager_cant_create_a_project_manager(client, team) -> None:  # noqa: F811
    r = client.post("/api/py/people", headers=h(team["pm"]), json=person("project_manager"))
    assert r.status_code == 403 and "superadmin" in r.json()["error"]


def test_a_superadmin_creates_a_project_manager(client, boss) -> None:
    assert client.post("/api/py/people", headers=h(boss), json=person("project_manager")).status_code == 200


def test_a_project_manager_cant_change_another_project_managers_account(client, team, pm2) -> None:  # noqa: F811
    for change in ({"role": "homeowner"}, {"active": False}):
        assert client.patch(f"/api/py/people/{pm2['uid']}", headers=h(team["pm"]), json=change).status_code == 403


def test_a_project_manager_cant_promote_anyone_to_project_manager(client, team) -> None:  # noqa: F811
    r = client.patch(f"/api/py/people/{team['admin']['uid']}", headers=h(team["pm"]), json={"role": "project_manager"})
    assert r.status_code == 403


def test_a_superadmin_changes_project_managers(client, boss, pm2) -> None:
    r = client.patch(f"/api/py/people/{pm2['uid']}", headers=h(boss), json={"active": False})
    assert r.status_code == 200, r.text


def test_nobody_changes_a_superadmin_from_people(client, fx, team, boss) -> None:  # noqa: F811
    other = fx.user("superadmin")
    assert client.patch(f"/api/py/people/{other['uid']}", headers=h(boss), json={"active": False}).status_code == 403
    assert (
        client.patch(f"/api/py/people/{other['uid']}", headers=h(team["pm"]), json={"active": False}).status_code == 403
    )


def test_both_see_everyone_in_people(client, team, boss, pm2) -> None:  # noqa: F811
    for viewer in (team["pm"], boss):
        uids = {u["uid"] for u in client.get("/api/py/people", headers=h(viewer)).json()["users"]}
        assert {boss["uid"], pm2["uid"], team["ho"]["uid"]} <= uids


def request(fx, role: str) -> int:
    return fx.conn.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) "
        "values (%s, %s, 'Asking Person', %s, '+6591234500') returning request_id",
        (f"user_ask_{uuid.uuid4().hex[:8]}", f"ask-{uuid.uuid4().hex[:8]}@example.com", role),
    ).fetchone()["request_id"]


def test_only_a_superadmin_approves_a_new_project_manager(client, fx, team, boss) -> None:  # noqa: F811
    rid = request(fx, "project_manager")
    approve = {"role": "project_manager", "noExpiry": True}
    assert (
        client.post(f"/api/py/account-requests/{rid}/approve", headers=h(team["pm"]), json=approve).status_code == 403
    )
    assert client.post(f"/api/py/account-requests/{rid}/approve", headers=h(boss), json=approve).status_code == 200


def test_a_project_manager_still_approves_everyone_else(client, fx, team) -> None:  # noqa: F811
    rid = request(fx, "homeowner")
    r = client.post(
        f"/api/py/account-requests/{rid}/approve", headers=h(team["pm"]), json={"role": "homeowner", "noExpiry": True}
    )
    assert r.status_code == 200, r.text


def test_only_a_superadmin_decides_a_request_to_become_a_project_manager(client, team, boss) -> None:  # noqa: F811
    r = client.post(
        "/api/py/me/role-request",
        headers=h(team["admin"]),
        json={"role": "project_manager", "reason": "I run the office now."},
    )
    assert r.status_code == 200, r.text
    rid = next(
        x["id"]
        for x in client.get("/api/py/people", headers=h(boss)).json()["roleRequests"]
        if x["uid"] == team["admin"]["uid"]
    )
    assert client.post(f"/api/py/role-requests/{rid}/approve", headers=h(team["pm"]), json={}).status_code == 403
    assert client.post(f"/api/py/role-requests/{rid}/reject", headers=h(team["pm"]), json={}).status_code == 403
    assert client.post(f"/api/py/role-requests/{rid}/approve", headers=h(boss), json={}).status_code == 200


def test_pictures_follow_the_same_rule(client, team, boss, pm2) -> None:  # noqa: F811
    link = {"contentType": "image/jpeg", "size": 1000}
    assert (
        client.post(f"/api/py/people/{pm2['uid']}/avatar/upload-link", headers=h(team["pm"]), json=link).status_code
        == 403
    )
    assert client.post(f"/api/py/people/{pm2['uid']}/avatar/upload-link", headers=h(boss), json=link).status_code == 200
    assert (
        client.post(
            f"/api/py/people/{team['ho']['uid']}/avatar/upload-link", headers=h(team["pm"]), json=link
        ).status_code
        == 200
    )


# ------------------------------------------------------------------ audit


def entries(client, viewer, location: str) -> list[dict]:
    r = client.get(f"/api/py/audit?location={location}", headers=h(viewer))
    assert r.status_code == 200, r.text
    return r.json()["entries"]


@pytest.mark.parametrize("who", ["ho", "admin", "epc"])
def test_only_project_managers_and_superadmins_open_the_audit_log(client, team, who) -> None:  # noqa: F811
    assert client.get("/api/py/audit", headers=h(team[who])).status_code == 403


def test_a_project_managers_log_has_their_projects_only(client, team, pm2, boss) -> None:  # noqa: F811
    pid = new_project(client, team)
    assert entries(client, team["pm"], f"project:{pid}")
    assert entries(client, pm2, f"project:{pid}") == []
    assert entries(client, boss, f"project:{pid}")


def test_other_managers_accounts_are_hidden_from_a_project_manager(client, fx, team, pm2, boss) -> None:  # noqa: F811
    fx.conn.execute("select set_config('app.actor_uid', %s, false)", (str(boss["uid"]),))
    fx.conn.execute("update users set full_name = 'Other PM Renamed' where uid = %s", (pm2["uid"],))
    fx.conn.execute("select set_config('app.actor_uid', '', false)")
    assert entries(client, team["pm"], f"person:{pm2['uid']}") == []
    assert entries(client, boss, f"person:{pm2['uid']}")


def test_people_changes_are_in_a_project_managers_log(client, team) -> None:  # noqa: F811
    r = client.post("/api/py/people", headers=h(team["pm"]), json=person("homeowner"))
    uid = r.json()["uid"]
    assert entries(client, team["pm"], f"person:{uid}")
