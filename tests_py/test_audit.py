"""Audit log (PM only): reading it, filtering it, and reverting changes, on the dev database."""

from __future__ import annotations

import uuid

import pytest

from _lib.db import transaction
from conftest import bearer


@pytest.fixture
def pm(fx):
    return fx.user("project_manager", full_name="Audit PM")


@pytest.fixture
def group(fx):
    g = fx.conn.execute(
        "insert into contractor_groups (name) values (%s) returning group_id",
        (f"pytest audit group {uuid.uuid4().hex[:6]}",),
    ).fetchone()["group_id"]
    yield g
    fx.conn.execute("delete from contractor_group_members where group_id = %s", (g,))
    fx.conn.execute("delete from contractor_groups where group_id = %s", (g,))


def entries(client, pm, **params):
    r = client.get("/api/py/audit", headers=bearer(pm["clerk_user_id"]), params=params)
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def latest_for(client, pm, location: str):
    return entries(client, pm, uid=pm["uid"], location=location)


def revert(client, pm, audit_id: int, fields: list[str] | None = None):
    return client.post(
        f"/api/py/audit/{audit_id}/revert", headers=bearer(pm["clerk_user_id"]), json={"fields": fields or []}
    )


def test_only_pms_can_read_or_revert(client, fx) -> None:
    for role in ("homeowner", "contractor", "epc_team"):
        u = fx.user(role)
        h = bearer(u["clerk_user_id"])
        assert client.get("/api/py/audit", headers=h).status_code == 403
        assert client.get("/api/py/audit/people", headers=h).status_code == 403
        assert client.post("/api/py/audit/1/revert", headers=h, json={}).status_code == 403


def test_change_is_attributed_and_located(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Priya Audit")
    r = client.patch(f"/api/py/people/{target['uid']}", headers=bearer(pm["clerk_user_id"]), json={"role": "epc_team"})
    assert r.status_code == 200, r.text

    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    assert e["actor"]["uid"] == pm["uid"] and e["actor"]["name"] == "Audit PM"
    assert e["page"] == "people" and e["summary"] == "Updated account"
    assert e["location"] == {
        "key": f"person:{target['uid']}",
        "kind": "person",
        "id": target["uid"],
        "label": "Priya Audit",
    }
    [c] = [c for c in e["changes"] if c["field"] == "user_type"]
    assert (c["from"], c["to"], c["state"]) == ("contractor", "epc_team", "current")
    # updated_at is bookkeeping, never shown.
    assert all(c["field"] != "updated_at" for c in e["changes"])

    people = client.get("/api/py/audit/people", headers=bearer(pm["clerk_user_id"])).json()
    me = next(p for p in people if p["uid"] == pm["uid"])
    assert me["changes"] >= 1 and "people" in me["pages"]


def test_revert_puts_the_value_back_as_a_new_entry(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Revert Me")
    client.patch(f"/api/py/people/{target['uid']}", headers=bearer(pm["clerk_user_id"]), json={"role": "epc_team"})
    original = latest_for(client, pm, f"person:{target['uid']}")[0]

    r = revert(client, pm, original["id"])
    assert r.status_code == 200, r.text
    assert (
        fx.conn.execute("select user_type from users where uid=%s", (target["uid"],)).fetchone()["user_type"]
        == "contractor"
    )

    log = latest_for(client, pm, f"person:{target['uid']}")
    undo, before = log[0], next(x for x in log if x["id"] == original["id"])
    # The original entry is untouched; the revert is its own entry pointing back.
    assert undo["revertsId"] == original["id"]
    assert before["revertedBy"] == [undo["id"]]
    assert next(c for c in before["changes"] if c["field"] == "user_type")["state"] == "reverted"
    assert (
        fx.conn.execute("select count(*) as n from audit_log where audit_id = %s", (original["id"],)).fetchone()["n"]
        == 1
    )

    # Putting it back twice would undo nothing — it's refused, not silently repeated.
    assert revert(client, pm, original["id"]).status_code == 409


def test_revert_refuses_when_changed_again_since(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Changed Twice")
    h = bearer(pm["clerk_user_id"])
    client.patch(f"/api/py/people/{target['uid']}", headers=h, json={"role": "epc_team"})
    first = latest_for(client, pm, f"person:{target['uid']}")[0]
    client.patch(f"/api/py/people/{target['uid']}", headers=h, json={"role": "homeowner"})

    stale = latest_for(client, pm, f"person:{target['uid']}")
    older = next(x for x in stale if x["id"] == first["id"])
    assert next(c for c in older["changes"] if c["field"] == "user_type")["state"] == "superseded"

    r = revert(client, pm, first["id"])
    assert r.status_code == 409 and "changed again" in r.json()["error"]
    assert (
        fx.conn.execute("select user_type from users where uid=%s", (target["uid"],)).fetchone()["user_type"]
        == "homeowner"
    )


def test_revert_line_by_line(client, pm, fx) -> None:
    target = fx.user("homeowner", full_name="Old Name", contact_no="+65 9000 0001")
    with transaction(pm["uid"]) as cur:
        cur.execute(
            "update users set full_name = 'New Name', contact_no = '+65 9000 0002' where uid = %s", (target["uid"],)
        )
    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    assert {c["field"] for c in e["changes"]} == {"full_name", "contact_no"}

    r = revert(client, pm, e["id"], ["full_name"])
    assert r.status_code == 200, r.text
    row = fx.conn.execute("select full_name, contact_no from users where uid=%s", (target["uid"],)).fetchone()
    assert (row["full_name"], row["contact_no"]) == ("Old Name", "+65 9000 0002")

    again = next(x for x in latest_for(client, pm, f"person:{target['uid']}") if x["id"] == e["id"])
    states = {c["field"]: c["state"] for c in again["changes"]}
    assert states == {"full_name": "reverted", "contact_no": "current"}

    # The other line can still be put back on its own.
    assert revert(client, pm, e["id"], ["contact_no"]).status_code == 200
    assert (
        fx.conn.execute("select contact_no from users where uid=%s", (target["uid"],)).fetchone()["contact_no"]
        == "+65 9000 0001"
    )


def test_membership_can_be_removed_and_put_back(client, pm, fx, group) -> None:
    crew = fx.user("epc_team", full_name="Crew Audit")
    h = bearer(pm["clerk_user_id"])
    assert client.post(f"/api/py/groups/{group}/members", headers=h, json={"uid": crew["uid"]}).status_code == 200

    added = entries(client, pm, uid=pm["uid"], location=f"group:{group}")[0]
    assert added["summary"] == "Added Crew Audit" and added["linkState"] == "current"
    assert added["page"] == "groups"

    assert revert(client, pm, added["id"]).status_code == 200
    removed = entries(client, pm, uid=pm["uid"], location=f"group:{group}")[0]
    assert removed["action"] == "delete" and removed["revertsId"] == added["id"]

    # Reverting the revert restores it — every step is in the log.
    assert revert(client, pm, removed["id"]).status_code == 200
    assert fx.conn.execute(
        "select 1 from contractor_group_members where group_id=%s and user_id=%s", (group, crew["uid"])
    ).fetchone()


def test_what_can_never_be_reverted(client, pm, fx) -> None:
    target = fx.user("homeowner")
    with transaction(pm["uid"]) as cur:
        cur.execute("update users set clerk_invitation_id = 'inv_x' where uid = %s", (target["uid"],))
    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    assert e["changes"][0]["state"] == "locked"
    assert revert(client, pm, e["id"], ["clerk_invitation_id"]).status_code == 400

    # A new account is undone by disabling it, not by deleting history.
    created = client.post(
        "/api/py/people",
        headers=bearer(pm["clerk_user_id"]),
        json={
            "fullName": "Brand New",
            "email": f"pytest-a-{uuid.uuid4().hex[:6]}@example.com",
            "role": "homeowner",
            "contactNo": "+65 9123 4567",
        },  # fmt: skip
    )
    fx.uids.append(created.json()["uid"])
    ins = next(x for x in latest_for(client, pm, f"person:{created.json()['uid']}") if x["action"] == "insert")
    assert ins["lockedReason"] and "disable" in ins["lockedReason"]
    assert revert(client, pm, ins["id"]).status_code == 400


def test_filter_by_page(client, pm, fx, group) -> None:
    crew = fx.user("contractor")
    client.post(f"/api/py/groups/{group}/members", headers=bearer(pm["clerk_user_id"]), json={"uid": crew["uid"]})
    client.patch(f"/api/py/people/{crew['uid']}", headers=bearer(pm["clerk_user_id"]), json={"active": False})
    assert {e["page"] for e in entries(client, pm, page="groups")} == {"groups"}
    assert {e["page"] for e in entries(client, pm, page="people")} == {"people"}
    assert client.get("/api/py/audit?page=nope", headers=bearer(pm["clerk_user_id"])).status_code == 400
