"""Audit log (PM only): reading it, and reverting and restoring through it, on the test branch."""

from __future__ import annotations

import uuid

import psycopg
import pytest

from _lib.db import transaction
from conftest import bearer

REASON = "Entered on the wrong account by mistake."


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


@pytest.fixture
def project(fx, pm):
    # Run by the audit PM: a project manager reads and changes only the projects they run.
    p = fx.conn.execute(
        "insert into projects (name, address, homeowner_name, homeowner_contact_no, installation_start_date, "
        "target_end_date, project_manager_id) values (%s, '1 Test Road', 'Test Homeowner', '+65 9000 0000', "
        "current_date, current_date + 21, %s) returning project_id",
        (f"pytest project {uuid.uuid4().hex[:6]}", pm["uid"]),
    ).fetchone()["project_id"]
    yield p
    fx.conn.execute("delete from projects where project_id = %s", (p,))


def entries(client, pm, **params):
    r = client.get("/api/py/audit", headers=bearer(pm["clerk_user_id"]), params=params)
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def latest_for(client, pm, location: str):
    return entries(client, pm, uid=pm["uid"], location=location)


def preview(client, pm, **body):
    r = client.post("/api/py/audit/actions/preview", headers=bearer(pm["clerk_user_id"]), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def act(client, pm, *, reason: str = REASON, **body):
    """Preview, then apply with what the preview saw — the way the screen does it."""
    p = preview(client, pm, **body)
    return client.post(
        "/api/py/audit/actions/apply",
        headers=bearer(pm["clerk_user_id"]),
        json={**body, "reason": reason, "expect": p["expect"]},
    )


def log_size(fx) -> int:
    return fx.conn.execute("select count(*)::int as n from audit_log").fetchone()["n"]


def user_col(fx, uid: int, col: str):
    return fx.conn.execute(f"select {col} from users where uid = %s", (uid,)).fetchone()[col]


# ------------------------------------------------------------------ reading


def test_only_pms_can_read_or_act(client, fx) -> None:
    for role in ("homeowner", "contractor", "epc_team"):
        h = bearer(fx.user(role)["clerk_user_id"])
        assert client.get("/api/py/audit", headers=h).status_code == 403
        assert client.get("/api/py/audit/people", headers=h).status_code == 403
        body = {"kind": "revert", "auditId": 1}
        assert client.post("/api/py/audit/actions/preview", headers=h, json=body).status_code == 403
        assert client.post("/api/py/audit/actions/apply", headers=h, json=body).status_code == 403


def test_change_is_attributed_and_located(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Priya Audit")
    r = client.patch(f"/api/py/people/{target['uid']}", headers=bearer(pm["clerk_user_id"]), json={"role": "epc_team"})
    assert r.status_code == 200, r.text

    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    assert e["actor"]["uid"] == pm["uid"] and e["actor"]["name"] == "Audit PM"
    assert e["page"] == "people" and e["summary"] == "Updated account"
    assert e["location"]["key"] == f"person:{target['uid']}" and e["location"]["label"] == "Priya Audit"
    [c] = [c for c in e["changes"] if c["field"] == "user_type"]
    assert (c["from"], c["to"], c["state"]) == ("contractor", "epc_team", "current")
    assert all(c["field"] != "updated_at" for c in e["changes"])

    people = client.get("/api/py/audit/people", headers=bearer(pm["clerk_user_id"])).json()
    me = next(p for p in people if p["uid"] == pm["uid"])
    assert me["changes"] >= 1 and "people" in me["pages"]


def test_filter_by_page(client, pm, fx, group) -> None:
    crew = fx.user("contractor")
    client.post(f"/api/py/groups/{group}/members", headers=bearer(pm["clerk_user_id"]), json={"uid": crew["uid"]})
    client.patch(f"/api/py/people/{crew['uid']}", headers=bearer(pm["clerk_user_id"]), json={"active": False})
    assert {e["page"] for e in entries(client, pm, page="groups")} == {"groups"}
    assert {e["page"] for e in entries(client, pm, page="people")} == {"people"}
    assert client.get("/api/py/audit?page=nope", headers=bearer(pm["clerk_user_id"])).status_code == 400


# ------------------------------------------------------------- the log itself


def test_the_log_cannot_be_edited_emptied_or_bypassed(fx, pm) -> None:
    for stmt in ("update audit_log set reason = 'x'", "delete from audit_log", "truncate audit_log"):
        # Inside a transaction that is rolled back regardless, so even a
        # failure of the guard could not lose anything.
        with pytest.raises(psycopg.Error), fx.conn.transaction():
            fx.conn.execute(stmt)
    # A revert written straight to the database without a reason is refused by the database itself.
    target = fx.user("homeowner")
    with pytest.raises(psycopg.Error, match="reason"), transaction(pm["uid"]) as cur:
        cur.execute("select set_config('app.reverts_audit_id', '1', true)")
        cur.execute("update users set full_name = 'x' where uid = %s", (target["uid"],))


# ---------------------------------------------------------------- reverting


def test_preview_shows_exactly_what_would_happen_and_saves_nothing(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Preview Me")
    client.patch(f"/api/py/people/{target['uid']}", headers=bearer(pm["clerk_user_id"]), json={"role": "epc_team"})
    e = latest_for(client, pm, f"person:{target['uid']}")[0]

    before = log_size(fx)
    p = preview(client, pm, kind="revert", auditId=e["id"])
    assert p["blockers"] == []
    [effect] = p["effects"]
    assert effect["changes"] == [{"field": "user_type", "from": "epc_team", "to": "contractor"}]
    assert any("already sent" in w for w in p["warnings"])
    # Nothing was written: not the data, not the log.
    assert user_col(fx, target["uid"], "user_type") == "epc_team"
    assert log_size(fx) == before


def test_revert_needs_a_reason_and_is_its_own_entry(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Revert Me")
    client.patch(f"/api/py/people/{target['uid']}", headers=bearer(pm["clerk_user_id"]), json={"role": "epc_team"})
    original = latest_for(client, pm, f"person:{target['uid']}")[0]
    snapshot = fx.conn.execute("select * from audit_log where audit_id = %s", (original["id"],)).fetchone()

    r = act(client, pm, kind="revert", auditId=original["id"], reason="too short")
    assert r.status_code == 400 and "reason" in r.json()["error"]

    r = act(client, pm, kind="revert", auditId=original["id"])
    assert r.status_code == 200, r.text
    assert user_col(fx, target["uid"], "user_type") == "contractor"

    log = latest_for(client, pm, f"person:{target['uid']}")
    undo, before = log[0], next(x for x in log if x["id"] == original["id"])
    assert undo["revertsId"] == original["id"] and undo["reason"] == REASON and undo["operationId"]
    assert before["revertedBy"] == [undo["id"]]
    assert next(c for c in before["changes"] if c["field"] == "user_type")["state"] == "reverted"
    # The original entry is exactly as it was written.
    assert fx.conn.execute("select * from audit_log where audit_id = %s", (original["id"],)).fetchone() == snapshot

    # Doing it twice would undo nothing — refused, not silently repeated.
    assert act(client, pm, kind="revert", auditId=original["id"]).status_code == 409


def test_revert_refuses_when_changed_again_since(client, pm, fx) -> None:
    target = fx.user("contractor", full_name="Changed Twice")
    h = bearer(pm["clerk_user_id"])
    client.patch(f"/api/py/people/{target['uid']}", headers=h, json={"role": "epc_team"})
    first = latest_for(client, pm, f"person:{target['uid']}")[0]
    client.patch(f"/api/py/people/{target['uid']}", headers=h, json={"role": "homeowner"})

    older = next(x for x in latest_for(client, pm, f"person:{target['uid']}") if x["id"] == first["id"])
    assert next(c for c in older["changes"] if c["field"] == "user_type")["state"] == "superseded"
    p = preview(client, pm, kind="revert", auditId=first["id"])
    assert any("changed again" in b for b in p["blockers"])
    assert act(client, pm, kind="revert", auditId=first["id"]).status_code == 409
    assert user_col(fx, target["uid"], "user_type") == "homeowner"


def test_apply_stops_if_anything_changed_after_the_preview(client, pm, fx) -> None:
    target = fx.user("homeowner", full_name="Racing", contact_no="+65 9000 1111")
    with transaction(pm["uid"]) as cur:
        cur.execute("update users set full_name = 'Racing 2' where uid = %s", (target["uid"],))
    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    p = preview(client, pm, kind="revert", auditId=e["id"])
    # Someone else edits the same record between the preview and the click.
    with transaction(pm["uid"]) as cur:
        cur.execute("update users set contact_no = '+65 9000 2222' where uid = %s", (target["uid"],))
    r = client.post(
        "/api/py/audit/actions/apply",
        headers=bearer(pm["clerk_user_id"]),
        json={"kind": "revert", "auditId": e["id"], "reason": REASON, "expect": p["expect"]},
    )
    assert r.status_code == 409 and "after your preview" in r.json()["error"]


def test_revert_line_by_line(client, pm, fx) -> None:
    target = fx.user("homeowner", full_name="Old Name", contact_no="+65 9000 0001")
    with transaction(pm["uid"]) as cur:
        cur.execute(
            "update users set full_name = 'New Name', contact_no = '+65 9000 0002' where uid = %s", (target["uid"],)
        )
    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    assert {c["field"] for c in e["changes"]} == {"full_name", "contact_no"}

    assert act(client, pm, kind="revert", auditId=e["id"], fields=["full_name"]).status_code == 200
    assert (user_col(fx, target["uid"], "full_name"), user_col(fx, target["uid"], "contact_no")) == (
        "Old Name",
        "+65 9000 0002",
    )
    again = next(x for x in latest_for(client, pm, f"person:{target['uid']}") if x["id"] == e["id"])
    assert {c["field"]: c["state"] for c in again["changes"]} == {"full_name": "reverted", "contact_no": "current"}

    assert act(client, pm, kind="revert", auditId=e["id"], fields=["contact_no"]).status_code == 200
    assert user_col(fx, target["uid"], "contact_no") == "+65 9000 0001"


def test_membership_can_be_removed_and_put_back(client, pm, fx, group) -> None:
    crew = fx.user("epc_team", full_name="Crew Audit")
    h = bearer(pm["clerk_user_id"])
    assert client.post(f"/api/py/groups/{group}/members", headers=h, json={"uid": crew["uid"]}).status_code == 200

    added = entries(client, pm, uid=pm["uid"], location=f"group:{group}")[0]
    assert added["summary"] == "Added Crew Audit" and added["rowUndo"]["verb"] == "Remove again"

    assert act(client, pm, kind="revert", auditId=added["id"]).status_code == 200
    removed = entries(client, pm, uid=pm["uid"], location=f"group:{group}")[0]
    assert removed["action"] == "delete" and removed["revertsId"] == added["id"]

    assert act(client, pm, kind="revert", auditId=removed["id"]).status_code == 200
    assert fx.conn.execute(
        "select 1 from contractor_group_members where group_id=%s and user_id=%s", (group, crew["uid"])
    ).fetchone()


# ------------------------------------------------------ restoring a value


def test_restore_a_field_to_an_earlier_version(client, pm, fx) -> None:
    other = fx.user("project_manager", full_name="Other PM")
    target = fx.user("homeowner", full_name="Version A")
    for name, who in (("Version B", pm), ("Version C", pm), ("Version D", other)):
        with transaction(who["uid"]) as cur:
            cur.execute("update users set full_name = %s where uid = %s", (name, target["uid"]))
    e = entries(client, pm, location=f"person:{target['uid']}")[0]

    h = client.get(
        f"/api/py/audit/{e['id']}/history", params={"field": "full_name"}, headers=bearer(pm["clerk_user_id"])
    )
    assert h.status_code == 200, h.text
    hist = h.json()
    assert hist["current"] == "Version D" and hist["lockedReason"] is None
    assert [v["value"] for v in hist["versions"]][:3] == ["Version D", "Version C", "Version B"]

    b = next(v for v in hist["versions"] if v["value"] == "Version B")
    assert act(client, pm, kind="restore_value", auditId=b["id"], field="full_name").status_code == 200
    assert user_col(fx, target["uid"], "full_name") == "Version B"

    newest = entries(client, pm, location=f"person:{target['uid']}")[0]
    assert newest["restoresId"] == b["id"] and newest["reason"] == REASON
    # Only that one field moved, and the people whose later edits were undone are told why.
    assert [c["field"] for c in newest["changes"]] == ["full_name"]
    note = fx.conn.execute(
        "select body from notifications where recipient_uid = %s and kind = 'audit_restore'", (other["uid"],)
    ).fetchone()
    assert note and REASON in note["body"]

    assert any(
        "already has" in x
        for x in preview(client, pm, kind="restore_value", auditId=b["id"], field="full_name")["blockers"]
    )


# ------------------------------------------------ what a rewind must not break


def test_role_rewind_refused_while_in_contractor_groups(client, pm, fx, group) -> None:
    person = fx.user("homeowner", full_name="Was Homeowner")
    h = bearer(pm["clerk_user_id"])
    client.patch(f"/api/py/people/{person['uid']}", headers=h, json={"role": "contractor"})
    became = latest_for(client, pm, f"person:{person['uid']}")[0]
    client.post(f"/api/py/groups/{group}/members", headers=h, json={"uid": person["uid"]})

    p = preview(client, pm, kind="revert", auditId=became["id"])
    assert any("contractor group" in b for b in p["blockers"])
    assert act(client, pm, kind="revert", auditId=became["id"]).status_code == 409
    assert user_col(fx, person["uid"], "user_type") == "contractor"


def test_milestone_fields_and_status_are_never_rewound_alone(client, pm, fx, project) -> None:
    with transaction(pm["uid"]) as cur:
        cur.execute("update projects set panel_quantity_actual = 20 where project_id = %s", (project,))
    e = entries(client, pm, location=f"project:{project}")[0]
    # Fine while Milestone 1 is open...
    assert preview(client, pm, kind="revert", auditId=e["id"])["blockers"] == []

    # ...refused once Milestone 1 is complete: the milestone and status would no longer match the data.
    fx.conn.execute("insert into project_milestones (project_id, milestone_no) values (%s, 1)", (project,))
    p = preview(client, pm, kind="revert", auditId=e["id"])
    assert any("Milestone 1" in b for b in p["blockers"])

    # Status itself only moves through the project's own steps.
    with transaction(pm["uid"]) as cur:
        cur.execute("update projects set status = 'in_progress' where project_id = %s", (project,))
    s = entries(client, pm, location=f"project:{project}")[0]
    assert any("status" in b.lower() for b in preview(client, pm, kind="revert", auditId=s["id"])["blockers"])

    # And once signed, the project's details are the signed record.
    with transaction(pm["uid"]) as cur:
        cur.execute("update projects set sales = 'Ann', status = 'signed' where project_id = %s", (project,))
    x = entries(client, pm, location=f"project:{project}")[0]
    assert any(
        "signed record" in b for b in preview(client, pm, kind="revert", auditId=x["id"], fields=["sales"])["blockers"]
    )


def test_what_can_never_be_reverted(client, pm, fx) -> None:
    target = fx.user("homeowner")
    with transaction(pm["uid"]) as cur:
        cur.execute("update users set clerk_invitation_id = 'inv_x' where uid = %s", (target["uid"],))
    e = latest_for(client, pm, f"person:{target['uid']}")[0]
    assert e["changes"][0]["state"] == "locked"
    assert preview(client, pm, kind="revert", auditId=e["id"], fields=["clerk_invitation_id"])["blockers"]

    created = client.post(
        "/api/py/people",
        headers=bearer(pm["clerk_user_id"]),
        json={
            "fullName": "Brand New",
            "email": f"pytest-a-{uuid.uuid4().hex[:6]}@example.com",
            "role": "homeowner",
            "contactNo": "+65 9123 4567",
            "noExpiry": True,
        },  # fmt: skip
    )
    fx.uids.append(created.json()["uid"])
    ins = next(x for x in latest_for(client, pm, f"person:{created.json()['uid']}") if x["action"] == "insert")
    assert ins["lockedReason"] and "disable" in ins["lockedReason"]
    assert preview(client, pm, kind="revert", auditId=ins["id"])["blockers"]


# ------------------------------------------------------ restoring a record


def test_deleted_group_comes_back_with_its_members_and_ids(client, pm, fx) -> None:
    h = bearer(pm["clerk_user_id"])
    gid = client.post("/api/py/groups", headers=h, json={"name": f"Restore Co {uuid.uuid4().hex[:5]}"}).json()["id"]
    crew = [fx.user("epc_team", full_name=f"Crew {i}") for i in range(2)]
    for c in crew:
        client.post(f"/api/py/groups/{gid}/members", headers=h, json={"uid": c["uid"]})
    assert client.delete(f"/api/py/groups/{gid}", headers=h).status_code == 200

    deleted = next(e for e in entries(client, pm, location=f"group:{gid}") if e["table"] == "contractor_groups")
    assert deleted["action"] == "delete" and deleted["rowUndo"]["verb"] == "Restore"

    p = preview(client, pm, kind="restore_record", auditId=deleted["id"])
    assert p["blockers"] == [] and len(p["effects"]) == 3
    assert act(client, pm, kind="restore_record", auditId=deleted["id"]).status_code == 200

    assert fx.conn.execute("select 1 from contractor_groups where group_id = %s", (gid,)).fetchone()
    members = fx.conn.execute("select user_id from contractor_group_members where group_id = %s", (gid,)).fetchall()
    assert {m["user_id"] for m in members} == {c["uid"] for c in crew}
    restored = [e for e in entries(client, pm, location=f"group:{gid}") if e["restoresId"] == deleted["id"]]
    assert len(restored) == 3 and all(e["reason"] == REASON for e in restored)

    # Cleanup.
    fx.conn.execute("delete from contractor_group_members where group_id = %s", (gid,))
    fx.conn.execute("delete from contractor_groups where group_id = %s", (gid,))


def test_restore_refused_when_the_name_is_taken_again(client, pm, fx) -> None:
    h = bearer(pm["clerk_user_id"])
    name = f"Taken Co {uuid.uuid4().hex[:5]}"
    gid = client.post("/api/py/groups", headers=h, json={"name": name}).json()["id"]
    client.delete(f"/api/py/groups/{gid}", headers=h)
    deleted = next(e for e in entries(client, pm, location=f"group:{gid}") if e["action"] == "delete")
    again = client.post("/api/py/groups", headers=h, json={"name": name}).json()["id"]

    p = preview(client, pm, kind="restore_record", auditId=deleted["id"])
    assert any("same name" in b for b in p["blockers"])
    fx.conn.execute("delete from contractor_groups where group_id = %s", (again,))
