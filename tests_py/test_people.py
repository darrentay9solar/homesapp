"""People (PM only): accounts, requests and contractor groups, end to end on the dev database."""

from __future__ import annotations

import uuid

import pytest

from _lib import clerk
from _routes import people as people_mod
from conftest import bearer


@pytest.fixture
def pm(fx):
    return fx.user("project_manager", full_name="Wei Ming Tan")


@pytest.fixture(autouse=True)
def _no_real_invitations(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        people_mod.clerk,
        "create_invitation",
        lambda email, _url: {"id": f"inv_{uuid.uuid4().hex[:8]}", "url": "https://example.test/accept"},
    )


@pytest.fixture
def cleanup(fx):
    groups: list[int] = []
    requests: list[int] = []
    yield groups, requests
    if requests:
        fx.conn.execute("delete from account_requests where request_id = any(%s)", (requests,))
    if groups:
        fx.conn.execute("delete from contractor_group_members where group_id = any(%s)", (groups,))
        fx.conn.execute("delete from contractor_groups where group_id = any(%s)", (groups,))


def test_only_pms_can_see_people(client, fx) -> None:
    for role in ("homeowner", "contractor", "epc_team"):
        u = fx.user(role)
        assert client.get("/api/py/people", headers=bearer(u["clerk_user_id"])).status_code == 403


def test_pm_lists_people(client, pm) -> None:
    r = client.get("/api/py/people", headers=bearer(pm["clerk_user_id"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(u["uid"] == pm["uid"] for u in body["users"])
    assert {"users", "groups", "requests"} <= set(body)


def test_create_user_invites_and_records(client, pm, fx) -> None:
    email = f"pytest-new-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(
        "/api/py/people",
        headers=bearer(pm["clerk_user_id"]),
        json={
            "fullName": "Priya Nair",
            "email": email,
            "role": "contractor",
            "contactNo": "+65 9123 4567",
            "noExpiry": True,
        },
    )
    assert r.status_code == 200, r.text
    uid = r.json()["uid"]
    fx.uids.append(uid)
    row = fx.conn.execute(
        "select user_type, invited_by, clerk_invitation_id from users where uid=%s", (uid,)
    ).fetchone()
    assert row["user_type"] == "contractor"
    assert row["invited_by"] == pm["uid"]
    assert row["clerk_invitation_id"].startswith("inv_")
    # Email/WhatsApp/SMS aren't configured in tests: recorded as skipped, not lost.
    channels = fx.conn.execute(
        "select d.channel, d.status from notification_deliveries d join notifications n using (notification_id) "
        "where n.recipient_uid = %s",
        (uid,),
    ).fetchall()
    assert {c["channel"] for c in channels} >= {"email", "whatsapp", "sms"}
    assert "Created Priya Nair as Contractor Admin" in r.json()["message"]

    dup = client.post(
        "/api/py/people",
        headers=bearer(pm["clerk_user_id"]),
        json={"fullName": "X Y", "email": email, "role": "homeowner", "contactNo": "+65 9123 4567", "noExpiry": True},
    )
    assert dup.status_code == 409


def test_change_role_and_disable(client, pm, fx) -> None:
    u = fx.user("contractor")
    h = bearer(pm["clerk_user_id"])
    assert (
        client.patch(f"/api/py/people/{u['uid']}", headers=h, json={"role": "epc_team", "noExpiry": True}).status_code
        == 200
    )
    assert client.patch(f"/api/py/people/{u['uid']}", headers=h, json={"active": False}).status_code == 200
    row = fx.conn.execute("select user_type, active from users where uid=%s", (u["uid"],)).fetchone()
    assert row == {"user_type": "epc_team", "active": False}
    # A disabled account can no longer use the app.
    assert client.get("/api/py/me", headers=bearer(u["clerk_user_id"])).json()["state"] == "deactivated"


def test_pm_cannot_disable_themselves(client, pm) -> None:
    r = client.patch(f"/api/py/people/{pm['uid']}", headers=bearer(pm["clerk_user_id"]), json={"active": False})
    assert r.status_code == 400


def test_approve_and_reject_requests(client, pm, fx, cleanup) -> None:
    _, requests = cleanup
    rows = []
    for name in ("Aisha Rahman", "Kelvin Lim"):
        rows.append(
            fx.conn.execute(
                "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) "
                "values (%s, %s, %s, 'homeowner', '+65 9123 4567') returning request_id",
                (f"user_test_req_{uuid.uuid4().hex[:8]}", f"pytest-req-{uuid.uuid4().hex[:8]}@example.com", name),
            ).fetchone()["request_id"]
        )
    requests.extend(rows)
    h = bearer(pm["clerk_user_id"])

    ok = client.post(
        f"/api/py/account-requests/{rows[0]}/approve", headers=h, json={"role": "epc_team", "noExpiry": True}
    )
    assert ok.status_code == 200, ok.text
    fx.uids.append(ok.json()["uid"])
    granted = fx.conn.execute("select user_type from users where uid=%s", (ok.json()["uid"],)).fetchone()
    assert granted["user_type"] == "epc_team"  # PM granted a different role than requested

    no = client.post(f"/api/py/account-requests/{rows[1]}/reject", headers=h, json={"note": "Not a customer yet"})
    assert no.status_code == 200, no.text
    st = fx.conn.execute(
        "select status, decided_by, decision_note from account_requests where request_id=%s", (rows[1],)
    ).fetchone()
    assert st == {"status": "rejected", "decided_by": pm["uid"], "decision_note": "Not a customer yet"}

    again = client.post(
        f"/api/py/account-requests/{rows[1]}/approve", headers=h, json={"role": "homeowner", "noExpiry": True}
    )
    assert again.status_code == 409


def test_groups_and_membership(client, pm, fx, cleanup) -> None:
    groups, _ = cleanup
    h = bearer(pm["clerk_user_id"])
    name = f"Pytest Solar {uuid.uuid4().hex[:6]}"
    g = client.post("/api/py/groups", headers=h, json={"name": name})
    assert g.status_code == 200, g.text
    gid = g.json()["id"]
    groups.append(gid)

    crew = fx.user("epc_team")
    owner = fx.user("homeowner")
    assert client.post(f"/api/py/groups/{gid}/members", headers=h, json={"uid": crew["uid"]}).status_code == 200
    # A homeowner in a contractor group could open other people's projects.
    bad = client.post(f"/api/py/groups/{gid}/members", headers=h, json={"uid": owner["uid"]})
    assert bad.status_code == 400

    listing = client.get("/api/py/people", headers=h).json()
    group = next(x for x in listing["groups"] if x["id"] == gid)
    assert group["members"] == [crew["uid"]]

    # Changing the crew member to homeowner takes them out of the group.
    client.patch(f"/api/py/people/{crew['uid']}", headers=h, json={"role": "homeowner", "noExpiry": True})
    left = fx.conn.execute("select count(*) as n from contractor_group_members where group_id=%s", (gid,)).fetchone()
    assert left["n"] == 0

    assert client.delete(f"/api/py/groups/{gid}", headers=h).status_code == 200


def test_non_pm_cannot_change_groups_even_directly(fx) -> None:
    """The database refuses it too, not just the API."""
    import psycopg

    from _lib.db import transaction

    crew = fx.user("contractor")
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(crew["uid"]) as cur:
        cur.execute("insert into contractor_groups (name) values ('Sneaky Group')")


def test_clerk_module_untouched() -> None:
    assert callable(clerk.create_invitation)


def test_create_user_requires_a_mobile(client, pm) -> None:
    r = client.post(
        "/api/py/people",
        headers=bearer(pm["clerk_user_id"]),
        json={
            "fullName": "No Phone",
            "email": f"pytest-nophone-{uuid.uuid4().hex[:8]}@example.com",
            "role": "homeowner",
            "noExpiry": True,
        },
    )
    assert r.status_code == 400
    assert "mobile" in r.json()["error"].lower()


def test_approve_can_place_crew_in_a_group(client, pm, fx, cleanup) -> None:
    groups, requests = cleanup
    h = bearer(pm["clerk_user_id"])
    gid = client.post("/api/py/groups", headers=h, json={"name": f"Pytest Crew {uuid.uuid4().hex[:6]}"}).json()["id"]
    groups.append(gid)
    rid = fx.conn.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) "
        "values (%s, %s, 'Kelvin Lim', 'epc_team', '+65 8222 1100') returning request_id",
        (f"user_test_req_{uuid.uuid4().hex[:8]}", f"pytest-req-{uuid.uuid4().hex[:8]}@example.com"),
    ).fetchone()["request_id"]
    requests.append(rid)

    r = client.post(
        f"/api/py/account-requests/{rid}/approve",
        headers=h,
        json={"role": "epc_team", "groupId": gid, "noExpiry": True},
    )
    assert r.status_code == 200, r.text
    uid = r.json()["uid"]
    fx.uids.append(uid)
    member = fx.conn.execute(
        "select added_by from contractor_group_members where group_id = %s and user_id = %s", (gid, uid)
    ).fetchone()
    assert member == {"added_by": pm["uid"]}
