"""Account settings and My Files, end to end: name, email, mobile codes, password, role requests.

Clerk's Backend API is faked where the server asks Clerk what changed; the
database rules (migration 0022/0023) and the audit log are the real thing.
WhatsApp and SMS are faked per test; with neither set up, a laptop shows the
code on screen (the "dev" channel).
"""

from __future__ import annotations

import time
import uuid

import psycopg
import pytest
from test_project_work import _onemap, approve_both, new_project, team, upload  # noqa: F401

from _lib import clerk, notify
from _lib.db import transaction
from _routes import settings as settings_mod
from conftest import bearer

REASON = "Correcting this during a settings test run"


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


def user_row(fx, uid) -> dict:
    return fx.conn.execute("select * from users where uid = %s", (uid,)).fetchone()


def last_audit(fx, uid, field):
    return fx.conn.execute(
        "select * from audit_log where entity_table = 'users' and entity_id = %s and changes ? %s "
        "order by audit_id desc limit 1",
        (str(uid), field),
    ).fetchone()


@pytest.fixture
def people(fx):
    pm = fx.user("project_manager", full_name="Settings PM")
    c = fx.user("contractor", full_name="Settings Contractor", contact_no="+65 9000 1111")
    e = fx.user("epc_team", full_name="Settings EPC")
    ho = fx.user("homeowner", full_name="Settings Homeowner")
    g = fx.conn.execute(
        "insert into contractor_groups (name) values (%s) returning group_id",
        (f"pytest settings {uuid.uuid4().hex[:6]}",),
    ).fetchone()["group_id"]
    fx.conn.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (g, c["uid"]))
    yield {"pm": pm, "c": c, "e": e, "ho": ho, "group": g}
    uids = [pm["uid"], c["uid"], e["uid"], ho["uid"]]
    fx.conn.execute("delete from contractor_group_members where group_id = %s or user_id = any(%s)", (g, uids))
    fx.conn.execute("delete from contractor_groups where group_id = %s", (g,))
    fx.conn.execute("delete from verification_codes where uid = any(%s)", (uids,))


@pytest.fixture
def no_wait(monkeypatch):
    monkeypatch.setattr(settings_mod, "RESEND_SECONDS", 0)


# ------------------------------------------------------------------ name


def test_name_change_is_saved_and_audited(client, fx, people) -> None:
    c = people["c"]
    r = client.patch("/api/py/me/name", headers=h(c), json={"fullName": "  Priya   Nair  "})
    assert r.status_code == 200 and r.json()["fullName"] == "Priya Nair"
    assert user_row(fx, c["uid"])["full_name"] == "Priya Nair"
    a = last_audit(fx, c["uid"], "full_name")
    assert a["actor_uid"] == c["uid"] and a["changes"]["full_name"]["to"] == "Priya Nair"


@pytest.mark.parametrize("bad", ["", " ", "A", "x" * 81])
def test_name_must_be_sensible(client, people, bad) -> None:
    assert client.patch("/api/py/me/name", headers=h(people["c"]), json={"fullName": bad}).status_code == 400


def test_a_pm_can_revert_a_name_change(client, fx, people) -> None:
    c, pm = people["c"], people["pm"]
    client.patch("/api/py/me/name", headers=h(c), json={"fullName": "Wrong Name"})
    a = last_audit(fx, c["uid"], "full_name")
    p = client.post("/api/py/audit/actions/preview", headers=h(pm), json={"kind": "revert", "auditId": a["audit_id"]})
    assert p.status_code == 200 and p.json()["blockers"] == [], p.text
    r = client.post(
        "/api/py/audit/actions/apply",
        headers=h(pm),
        json={"kind": "revert", "auditId": a["audit_id"], "reason": REASON, "expect": p.json()["expect"]},
    )
    assert r.status_code == 200, r.text
    assert user_row(fx, c["uid"])["full_name"] == "Settings Contractor"


# ------------------------------------------------------------------ mobile


def test_mobile_changes_only_after_the_right_code(client, fx, people, no_wait) -> None:
    c = people["c"]
    r = client.post("/api/py/me/mobile/send", headers=h(c), json={"number": "+65 8123 4567"})
    assert r.status_code == 200, r.text
    assert r.json()["sentBy"] == "dev" and r.json()["to"] == "•••• 4567"
    code = r.json()["devCode"]
    assert user_row(fx, c["uid"])["contact_no"] == "+65 9000 1111", "nothing changes before the code"

    wrong = "000000" if code != "000000" else "111111"
    bad = client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": wrong})
    assert bad.status_code == 400 and "4 tries left" in bad.json()["error"]
    ok = client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": code})
    assert ok.status_code == 200, ok.text
    row = user_row(fx, c["uid"])
    assert row["contact_no"] == "+65 8123 4567" and row["mobile_verified_at"] is not None
    a = last_audit(fx, c["uid"], "contact_no")
    assert a["actor_uid"] == c["uid"] and a["changes"]["contact_no"]["to"] == "+65 8123 4567"
    again = client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": code})
    assert again.status_code == 400, "a code works once"


def test_five_wrong_tries_use_up_the_code(client, people, no_wait) -> None:
    c = people["c"]
    code = client.post("/api/py/me/mobile/send", headers=h(c), json={"number": "+65 8222 3333"}).json()["devCode"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": wrong})
    r = client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": code})
    assert r.status_code == 429


def test_an_expired_code_is_refused(client, fx, people, no_wait) -> None:
    c = people["c"]
    code = client.post("/api/py/me/mobile/send", headers=h(c), json={"number": "+65 8333 4444"}).json()["devCode"]
    fx.conn.execute(
        "update verification_codes set expires_at = now() - interval '1 second' where uid = %s", (c["uid"],)
    )
    r = client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": code})
    assert r.status_code == 400 and "expired" in r.json()["error"]


@pytest.mark.parametrize(("number", "why"), [("", "Enter"), ("12", ""), ("+65 9000 1111", "already")])
def test_unusable_numbers_get_no_code(client, people, number, why) -> None:
    r = client.post("/api/py/me/mobile/send", headers=h(people["c"]), json={"number": number})
    assert r.status_code == 400 and why in r.json()["error"]


def test_codes_are_rate_limited(client, people) -> None:
    c = people["c"]
    assert client.post("/api/py/me/mobile/send", headers=h(c), json={"number": "+65 8444 5555"}).status_code == 200
    r = client.post("/api/py/me/mobile/send", headers=h(c), json={"number": "+65 8444 5555"})
    assert r.status_code == 429 and "wait" in r.json()["error"]


def test_whatsapp_first_then_sms(client, people, monkeypatch, no_wait) -> None:
    sent: list[str] = []

    def wa(to, template, params, copy_code=None):
        sent.append(f"wa:{template}:{copy_code == params[0]}")
        return notify.SendResult("failed", "template not approved")

    def sms(to, text):
        sent.append("sms")
        return notify.SendResult("sent", provider_id="SM1")

    monkeypatch.setattr(settings_mod.notify, "send_whatsapp", wa)
    monkeypatch.setattr(settings_mod.notify, "send_sms", sms)
    r = client.post("/api/py/me/mobile/send", headers=h(people["c"]), json={"number": "+65 8555 6666"})
    assert r.json()["sentBy"] == "sms" and "devCode" not in r.json()
    assert sent == ["wa:verification_code:True", "sms"]
    sent.clear()
    r = client.post(
        "/api/py/me/mobile/send", headers=h(people["c"]), json={"number": "+65 8555 6666", "channel": "sms"}
    )
    assert r.json()["sentBy"] == "sms" and sent == ["sms"], "Send by SMS skips WhatsApp"


def test_whatsapp_delivered_means_no_sms(client, people, monkeypatch) -> None:
    monkeypatch.setattr(settings_mod.notify, "send_whatsapp", lambda *a, **k: notify.SendResult("sent"))
    monkeypatch.setattr(settings_mod.notify, "send_sms", lambda *a: pytest.fail("SMS sent as well"))
    r = client.post("/api/py/me/mobile/send", headers=h(people["c"]), json={"number": "+65 8666 7777"})
    assert r.json()["sentBy"] == "whatsapp" and "devCode" not in r.json()


def test_without_messaging_in_production_no_code_is_made(client, fx, people, monkeypatch) -> None:
    monkeypatch.setattr(settings_mod, "act_as_allowed", lambda: False)
    r = client.post("/api/py/me/mobile/send", headers=h(people["c"]), json={"number": "+65 8777 8888"})
    assert r.status_code == 503 and "aren't set up" in r.json()["error"]
    assert not fx.conn.execute("select 1 from verification_codes where uid = %s", (people["c"]["uid"],)).fetchone()


def test_the_database_refuses_a_mobile_change_without_a_code(fx, people) -> None:
    c = people["c"]
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(c["uid"]) as cur:
        cur.execute("update users set contact_no = '+65 8999 0000' where uid = %s", (c["uid"],))
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(c["uid"]) as cur:
        cur.execute(
            "insert into verification_codes (uid, purpose, target, code_hash, expires_at) "
            "values (%s, 'mobile', '+65 8', 'x$y', now())",
            (people["e"]["uid"],),
        )


def test_verified_dates_cannot_be_reverted(client, fx, people, no_wait) -> None:
    c = people["c"]
    code = client.post("/api/py/me/mobile/send", headers=h(c), json={"number": "+65 8888 9999"}).json()["devCode"]
    client.post("/api/py/me/mobile/verify", headers=h(c), json={"code": code})
    a = last_audit(fx, c["uid"], "mobile_verified_at")
    p = client.post(
        "/api/py/audit/actions/preview",
        headers=h(people["pm"]),
        json={"kind": "revert", "auditId": a["audit_id"], "fields": ["mobile_verified_at"]},
    )
    body = p.json()
    assert (
        p.status_code != 200
        or body["blockers"]
        or not any(e.get("field") == "mobile_verified_at" for e in body.get("effects", []))
    )


# ------------------------------------------------------------------ email


def fake_clerk(monkeypatch, user, *, email, verified=True, password=True, updated_ms=None):
    fake = clerk.ClerkUser(
        user["clerk_user_id"],
        [email] if verified else [],
        email,
        user["full_name"],
        None,
        password,
        int(time.time() * 1000) if updated_ms is None else updated_ms,
    )
    monkeypatch.setattr(clerk, "get_user", lambda _id: fake)


def test_email_follows_clerk_once_verified(client, fx, people, monkeypatch) -> None:
    c = people["c"]
    new = f"pytest-new-{uuid.uuid4().hex[:8]}@example.com"
    fake_clerk(monkeypatch, c, email=new, verified=False)
    assert client.post("/api/py/me/email/sync", headers=h(c)).status_code == 400
    fake_clerk(monkeypatch, c, email=new)
    r = client.post("/api/py/me/email/sync", headers=h(c))
    assert r.status_code == 200, r.text
    assert user_row(fx, c["uid"])["email"] == new
    assert last_audit(fx, c["uid"], "email")["actor_uid"] == c["uid"]


def test_email_already_used_by_someone_else(client, people, monkeypatch) -> None:
    fake_clerk(monkeypatch, people["c"], email=people["e"]["email"])
    assert client.post("/api/py/me/email/sync", headers=h(people["c"])).status_code == 409


def test_email_cannot_be_set_with_a_plain_update(fx, people) -> None:
    c = people["c"]
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(c["uid"]) as cur:
        cur.execute("update users set email = 'x@example.com' where uid = %s", (c["uid"],))


def test_email_change_is_not_reverted_from_the_log(client, fx, people, monkeypatch) -> None:
    c = people["c"]
    fake_clerk(monkeypatch, c, email=f"pytest-rv-{uuid.uuid4().hex[:8]}@example.com")
    client.post("/api/py/me/email/sync", headers=h(c))
    a = last_audit(fx, c["uid"], "email")
    p = client.post(
        "/api/py/audit/actions/preview", headers=h(people["pm"]), json={"kind": "revert", "auditId": a["audit_id"]}
    )
    assert p.status_code != 200 or p.json()["blockers"], "the sign-in email isn't rewound"


# ---------------------------------------------------------------- password


def test_password_change_is_recorded_not_stored(client, fx, people, monkeypatch) -> None:
    c = people["c"]
    fake_clerk(monkeypatch, c, email=c["email"], updated_ms=int(time.time() * 1000) - 10 * 60 * 1000)
    assert client.post("/api/py/me/password-changed", headers=h(c)).status_code == 409, "nothing changed recently"
    fake_clerk(monkeypatch, c, email=c["email"])
    r = client.post("/api/py/me/password-changed", headers=h(c))
    assert r.status_code == 200, r.text
    assert user_row(fx, c["uid"])["password_changed_at"] is not None
    a = last_audit(fx, c["uid"], "password_changed_at")
    assert a["actor_uid"] == c["uid"] and "password" not in {k for k in a["changes"] if k != "password_changed_at"}


# -------------------------------------------------------------------- role


def test_role_request_approved_by_a_pm(client, fx, people) -> None:
    c, pm = people["c"], people["pm"]
    assert (
        client.post("/api/py/me/role-request", headers=h(c), json={"role": "epc_team", "reason": "x"}).status_code
        == 400
    )
    r = client.post(
        "/api/py/me/role-request", headers=h(c), json={"role": "epc_team", "reason": "I've joined the EPC crew"}
    )
    assert r.status_code == 200, r.text
    dup = client.post("/api/py/me/role-request", headers=h(c), json={"role": "homeowner", "reason": "Changed my mind"})
    assert dup.status_code == 409
    me = client.get("/api/py/me", headers=h(c)).json()
    assert me["settings"]["roleRequest"]["role"] == "epc_team"
    assert fx.conn.execute(
        "select 1 from notifications where recipient_uid = %s and kind = 'role_request'", (pm["uid"],)
    ).fetchone()

    listed = client.get("/api/py/people", headers=h(pm)).json()["roleRequests"]
    rr = next(x for x in listed if x["uid"] == c["uid"])
    assert rr["from"] == "contractor" and rr["role"] == "epc_team"
    assert client.post(f"/api/py/role-requests/{rr['id']}/approve", headers=h(people["e"]), json={}).status_code == 403
    ok = client.post(f"/api/py/role-requests/{rr['id']}/approve", headers=h(pm), json={"groupId": people["group"]})
    assert ok.status_code == 200, ok.text
    assert user_row(fx, c["uid"])["user_type"] == "epc_team"
    assert fx.conn.execute(
        "select 1 from contractor_group_members where user_id = %s and group_id = %s", (c["uid"], people["group"])
    ).fetchone(), "still a crew role: keeps the group"
    assert fx.conn.execute(
        "select 1 from notifications where recipient_uid = %s and kind = 'role_approved'", (c["uid"],)
    ).fetchone()
    assert client.post(f"/api/py/role-requests/{rr['id']}/approve", headers=h(pm), json={}).status_code == 409

    # The role itself can be reverted from the log; the decision can't.
    role_entry = last_audit(fx, c["uid"], "user_type")
    p = client.post(
        "/api/py/audit/actions/preview", headers=h(pm), json={"kind": "revert", "auditId": role_entry["audit_id"]}
    )
    assert p.status_code == 200 and p.json()["blockers"] == [], p.text
    decision = fx.conn.execute(
        "select audit_id from audit_log where entity_table = 'role_change_requests' and entity_id = %s "
        "and action = 'update' order by audit_id desc limit 1",
        (str(rr["id"]),),
    ).fetchone()
    p2 = client.post(
        "/api/py/audit/actions/preview", headers=h(pm), json={"kind": "revert", "auditId": decision["audit_id"]}
    )
    assert p2.status_code != 200 or p2.json()["blockers"]
    log = client.get("/api/py/audit", headers=h(pm), params={"location": f"person:{c['uid']}"}).json()["entries"]
    assert {"Asked to become EPC Team", "Approved role change"} <= {e["summary"] for e in log}


def test_moving_out_of_a_crew_role_leaves_the_group(client, fx, people) -> None:
    c, pm = people["c"], people["pm"]
    client.post("/api/py/me/role-request", headers=h(c), json={"role": "homeowner", "reason": "I'm a customer now"})
    rr = next(x for x in client.get("/api/py/people", headers=h(pm)).json()["roleRequests"] if x["uid"] == c["uid"])
    assert client.post(f"/api/py/role-requests/{rr['id']}/approve", headers=h(pm), json={}).status_code == 200
    assert not fx.conn.execute("select 1 from contractor_group_members where user_id = %s", (c["uid"],)).fetchone()


def test_role_request_declined_and_withdrawn(client, fx, people) -> None:
    c, pm = people["c"], people["pm"]
    client.post("/api/py/me/role-request", headers=h(c), json={"role": "epc_team", "reason": "Need site access"})
    rr = next(x for x in client.get("/api/py/people", headers=h(pm)).json()["roleRequests"] if x["uid"] == c["uid"])
    r = client.post(f"/api/py/role-requests/{rr['id']}/reject", headers=h(pm), json={"note": "Talk to Wei Ming first"})
    assert r.status_code == 200 and user_row(fx, c["uid"])["user_type"] == "contractor"
    note = fx.conn.execute(
        "select body from notifications where recipient_uid = %s and kind = 'role_rejected'", (c["uid"],)
    ).fetchone()
    assert note
    client.post("/api/py/me/role-request", headers=h(c), json={"role": "epc_team", "reason": "Asking again later"})
    assert client.delete("/api/py/me/role-request", headers=h(c)).status_code == 200
    assert client.get("/api/py/me", headers=h(c)).json()["settings"]["roleRequest"] is None
    assert client.delete("/api/py/me/role-request", headers=h(c)).status_code == 404


def test_pms_change_roles_in_people_not_by_request(client, people) -> None:
    r = client.post(
        "/api/py/me/role-request", headers=h(people["pm"]), json={"role": "contractor", "reason": "Testing it"}
    )
    assert r.status_code == 400


def test_the_database_keeps_role_decisions_to_pms(fx, people) -> None:
    c = people["c"]
    with transaction(c["uid"]) as cur:
        cur.execute(
            "insert into role_change_requests (uid, from_type, requested_type, reason) "
            "values (%s, 'contractor', 'epc_team', 'x') returning request_id",
            (c["uid"],),
        )
        rid = cur.fetchone()["request_id"]
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(c["uid"]) as cur:
        cur.execute(
            "update role_change_requests set status = 'approved', decided_by = %s, decided_at = now() "
            "where request_id = %s",
            (c["uid"], rid),
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(c["uid"]) as cur:
        cur.execute(
            "insert into role_change_requests (uid, from_type, requested_type) values (%s, 'epc_team', 'homeowner')",
            (people["e"]["uid"],),
        )


# ---------------------------------------------------------------- my files


def test_my_files_lists_my_uploads_including_removed_ones(client, fx, team) -> None:  # noqa: F811
    pid = new_project(client, team)
    approve_both(client, team, pid)
    a = upload(client, team["epc"], pid, "panel_pictures", name="roof east.png").json()["id"]
    b = upload(client, team["epc"], pid, "inverter_pictures", name="inverter.png").json()["id"]
    upload(client, team["admin"], pid, "utility_bill", b"%PDF-1.4\n" + b"0" * 20, "application/pdf", "bill.pdf")
    assert client.delete(f"/api/py/projects/{pid}/files/{b}", headers=h(team["pm"])).status_code == 200

    mine = client.get("/api/py/my-files", headers=h(team["epc"])).json()["files"]
    by_id = {f["id"]: f for f in mine}
    assert set(by_id) == {a, b}, "only my uploads, not the admin's"
    assert by_id[a]["removed"] is None and by_id[a]["kind"] == "photo" and by_id[a]["projectId"] == pid
    assert by_id[a]["categoryLabel"] and by_id[a]["name"] == "roof east.png"
    assert by_id[b]["removed"]["by"] == "Flow PM" and by_id[b]["name"] == "inverter.png"

    admin = {f["id"] for f in client.get("/api/py/my-files", headers=h(team["admin"])).json()["files"]}
    assert a not in admin and b not in admin, "nobody sees someone else's removed uploads"
    assert client.get("/api/py/audit", headers=h(team["epc"])).status_code == 403, "the rest of the log stays PM-only"
