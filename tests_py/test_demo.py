"""The demonstration site: trying the app as a sample person, without a password.

locks       the deployment AND the database must both say "demo"; only sample people
as          a visitor gets that person's view, and /me says it's the demo
off         sign-in changes, phone notifications and location sharing are refused
nothing     no email, WhatsApp, SMS or Clerk invitation ever leaves the demo
list        /demo/people lists the sample people, only on the demo site
database    only the database owner can mark a sample person
"""

from __future__ import annotations

import uuid

import psycopg
import pytest

from _lib import clerk, demo, notify, storage
from _lib.db import transaction
from conftest import bearer


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setattr(demo, "database_is_demo", lambda: True)


@pytest.fixture
def sample(fx):
    pm = fx.user("project_manager", linked=False, full_name="Demo PM")
    epc = fx.user("epc_team", linked=False, full_name="Demo EPC")
    ho = fx.user("homeowner", linked=False, full_name="Demo Homeowner")
    fx.conn.execute("update users set is_demo = true where uid = any(%s)", ([pm["uid"], epc["uid"], ho["uid"]],))
    return {"pm": pm, "epc": epc, "ho": ho}


def as_(u) -> dict[str, str]:
    return {"X-Demo-As": str(u["uid"])}


# ------------------------------------------------------------------ locks


def test_off_unless_the_deployment_says_demo(client, sample, monkeypatch) -> None:
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.setattr(demo, "database_is_demo", lambda: True)
    r = client.get("/api/py/me", headers=as_(sample["pm"]))
    assert r.status_code == 401 and "isn't available" in r.json()["error"]


def test_off_unless_the_database_says_demo(client, sample, monkeypatch) -> None:
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setattr(demo, "database_is_demo", lambda: False)
    assert client.get("/api/py/me", headers=as_(sample["pm"])).status_code == 401


def test_the_test_database_is_not_a_demo_database(monkeypatch) -> None:
    monkeypatch.setattr(demo, "_cache", None)
    assert demo.database_is_demo() is False


def test_only_sample_people(client, fx, on) -> None:
    real = fx.user("project_manager", full_name="Real PM")
    r = client.get("/api/py/me", headers={"X-Demo-As": str(real["uid"])})
    assert r.status_code == 401 and "sample person" in r.json()["error"]


@pytest.mark.parametrize("bad", ["", "abc", "-1", "999999999", "1 or 1=1"])
def test_nonsense_ids(client, on, bad) -> None:
    assert client.get("/api/py/me", headers={"X-Demo-As": bad}).status_code == 401


def test_a_disabled_sample_person_cant_be_picked(client, fx, on, sample) -> None:
    fx.conn.execute("update users set active = false where uid = %s", (sample["epc"]["uid"],))
    assert client.get("/api/py/me", headers=as_(sample["epc"])).status_code == 401


def test_on_the_demo_site_the_picked_person_wins_over_a_sign_in(client, fx, on, sample) -> None:
    real = fx.user("homeowner", full_name="Real Homeowner")
    me = client.get("/api/py/me", headers={**bearer(real["clerk_user_id"]), **as_(sample["pm"])}).json()
    assert me["user"]["uid"] == sample["pm"]["uid"] and me["demo"] is True


def test_elsewhere_a_sign_in_ignores_the_demo_header(client, fx, sample, monkeypatch) -> None:
    monkeypatch.delenv("DEMO_MODE", raising=False)
    real = fx.user("homeowner", full_name="Real Homeowner")
    me = client.get("/api/py/me", headers={**bearer(real["clerk_user_id"]), **as_(sample["pm"])}).json()
    assert me["user"]["uid"] == real["uid"] and "demo" not in me


# ------------------------------------------------------------------ as


@pytest.mark.parametrize("who", ["pm", "epc", "ho"])
def test_a_visitor_sees_the_app_as_that_person(client, on, sample, who) -> None:
    r = client.get("/api/py/me", headers=as_(sample[who]))
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["state"] == "active" and me["demo"] is True
    assert me["user"]["uid"] == sample[who]["uid"]


def test_roles_still_apply(client, on, sample) -> None:
    assert client.get("/api/py/people", headers=as_(sample["pm"])).status_code == 200
    assert client.get("/api/py/people", headers=as_(sample["ho"])).status_code == 403


# ------------------------------------------------------------------ off


def test_sign_in_changes_are_off(client, on, sample) -> None:
    r = client.post("/api/py/me/email/sync", headers=as_(sample["pm"]))
    assert r.status_code == 403 and "Not in the demo" in r.json()["error"]


def test_phone_notifications_are_off(client, on, sample) -> None:
    sub = {"endpoint": "https://push.example.com/x", "keys": {"p256dh": "a", "auth": "b"}}
    r = client.post("/api/py/push/subscriptions", headers=as_(sample["epc"]), json=sub)
    assert r.status_code == 403 and "off in the demo" in r.json()["error"]


def test_location_sharing_is_off(client, on, sample) -> None:
    assert (
        client.patch("/api/py/me/settings", headers=as_(sample["epc"]), json={"shareLocation": True}).status_code == 403
    )
    assert (
        client.put("/api/py/me/location", headers=as_(sample["epc"]), json={"lat": 1.35, "lng": 103.8}).status_code
        == 403
    )


def test_other_settings_still_work(client, on, sample) -> None:
    assert client.patch("/api/py/me/settings", headers=as_(sample["ho"]), json={"language": "zh"}).status_code == 200


# ------------------------------------------------------------------ nothing leaves


def test_nothing_is_emailed_or_texted_from_the_demo(fx, on, sample, monkeypatch) -> None:
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda *a: sent.append("email") or notify.SendResult("sent"))
    monkeypatch.setattr(
        notify, "send_mobile", lambda *a: sent.append("mobile") or {"whatsapp": notify.SendResult("sent")}
    )
    out = notify.notify(
        sample["ho"]["uid"],
        "account_approved",
        "Hello",
        "Body",
        email=("someone@example.com", "s", "<p>h</p>", "t"),
        mobile=("+6591234567", "tpl", [], "sms"),
    )
    assert sent == [] and "email" not in out and "whatsapp" not in out


def test_new_accounts_in_the_demo_get_no_clerk_invitation(client, on, sample, monkeypatch) -> None:
    def boom(*a, **k):
        raise AssertionError("the demo must never create a Clerk invitation")

    monkeypatch.setattr(clerk, "create_invitation", boom)
    r = client.post(
        "/api/py/people",
        headers=as_(sample["pm"]),
        json={
            "fullName": "Visitor Made",
            "email": f"visitor-{uuid.uuid4().hex[:8]}@example.com",
            "contactNo": "+65 9123 4500",
            "role": "homeowner",
            "noExpiry": True,
        },
    )
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ list


def test_the_list_is_only_on_the_demo_site(client, sample, monkeypatch) -> None:
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert client.get("/api/py/demo/people").status_code == 404


def test_the_list_shows_sample_people_project_managers_first(client, on, sample) -> None:
    r = client.get("/api/py/demo/people")
    assert r.status_code == 200
    people = [p for p in r.json()["people"] if p["uid"] in {u["uid"] for u in sample.values()}]
    assert [p["role"] for p in people] == ["project_manager", "epc_team", "homeowner"]
    assert people[0]["roleLabel"] == "Project Manager"


def test_storage_calls_itself_demo(monkeypatch) -> None:
    monkeypatch.setenv("DEMO_MODE", "1")
    assert storage.check()["environment"] == "demo"


# ------------------------------------------------------------------ database


def test_only_the_database_owner_marks_sample_people(fx, sample) -> None:
    real = fx.user("homeowner", full_name="Not A Sample")
    with (
        pytest.raises(psycopg.Error, match="Only the database owner marks sample people"),
        transaction(sample["pm"]["uid"]) as cur,
    ):
        cur.execute("update users set is_demo = true where uid = %s", (real["uid"],))
