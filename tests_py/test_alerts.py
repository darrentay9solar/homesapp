"""Alerts and phone notifications.

push     RFC 8291 encryption (the standard's own worked example), VAPID tokens, sending
links    every alert points at what it's about
api      the Alerts list, unread count, marking read, older pages, privacy
phones   subscribing, re-subscribing, turning off, test notification, dead phones
late     a crew an hour late: the project's PM (and crew) are told, urgently, once
"""

from __future__ import annotations

import io
import json
import time
import uuid
from datetime import datetime, timedelta

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from test_sites import SITE, check_in, t  # noqa: F401

from _lib import notify, push
from _lib.db import transaction
from _routes import sites as sites_mod
from _routes.projects import SG
from conftest import bearer

REAL_SEND = push.send  # conftest swaps push.send out for every test; these tests use the real one


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


# ---------------------------------------------------------------------- push


def decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth: bytes) -> bytes:
    """The phone's side of RFC 8291, written separately to check ours."""
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    as_public = body[21 : 21 + idlen]
    ct = body[21 + idlen :]
    assert rs == 4096 and idlen == 65
    shared = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    ua_public = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    ikm = push._hkdf(auth, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = push._hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = push._hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ct, None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


class Phone:
    """A pretend phone: its own keys, like a browser's PushSubscription."""

    def __init__(self) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.auth = uuid.uuid4().bytes
        self.endpoint = f"https://push.example.com/send/{uuid.uuid4().hex}"

    def json(self) -> dict:
        pub = self.key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return {"endpoint": self.endpoint, "keys": {"p256dh": push.b64u(pub), "auth": push.b64u(self.auth)}}

    def sub(self) -> dict:
        j = self.json()
        return {"endpoint": j["endpoint"], **j["keys"]}


def test_encryption_matches_the_standards_worked_example() -> None:
    server = ec.derive_private_key(
        int.from_bytes(push.b64u_decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1()
    )
    out = push.encrypt(
        push.b64u_decode("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        "BTBZMqHH6r4Tts7J_aSIgg",
        server_key=server,
        salt=push.b64u_decode("DGv6ra1nlYgDCS1FRnbzlw"),
    )
    assert push.b64u(out) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6"
        "PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    )


@pytest.mark.parametrize("text", ["", "a", "Crew running late · 九太阳家 🌞", "x" * 3000])
def test_a_phone_can_read_what_we_send(text) -> None:
    phone = Phone()
    s = phone.sub()
    body = push.encrypt(text.encode(), s["p256dh"], s["auth"])
    assert decrypt(body, phone.key, phone.auth) == text.encode()


def test_every_message_is_encrypted_afresh() -> None:
    s = Phone().sub()
    assert push.encrypt(b"same", s["p256dh"], s["auth"]) != push.encrypt(b"same", s["p256dh"], s["auth"])


def test_messages_too_long_for_one_record_are_refused() -> None:
    s = Phone().sub()
    with pytest.raises(ValueError):
        push.encrypt(b"x" * 4000, s["p256dh"], s["auth"])


@pytest.fixture
def keys(monkeypatch):
    public, private = push.new_keys()
    values = {"VAPID_PUBLIC_KEY": public, "VAPID_PRIVATE_KEY": private, "VAPID_SUBJECT": "https://app.example"}
    monkeypatch.setattr(push, "env", lambda k: values.get(k, ""))
    return values


def test_vapid_token_is_signed_for_the_push_service(keys) -> None:
    v = push.vapid()
    header = push.vapid_header("https://fcm.googleapis.com/fcm/send/abc", v)
    t_part, k_part = header.removeprefix("vapid t=").split(", k=")
    assert k_part == keys["VAPID_PUBLIC_KEY"]
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), push.b64u_decode(k_part))
    claims = jwt.decode(t_part, pub, algorithms=["ES256"], audience="https://fcm.googleapis.com")
    assert claims["sub"] == "https://app.example" and time.time() < claims["exp"] <= time.time() + 24 * 3600


def test_mismatched_vapid_keys_are_caught(monkeypatch) -> None:
    a, _ = push.new_keys()
    _, b = push.new_keys()
    monkeypatch.setattr(push, "env", lambda k: {"VAPID_PUBLIC_KEY": a, "VAPID_PRIVATE_KEY": b}.get(k, ""))
    with pytest.raises(RuntimeError):
        push.vapid()


def test_without_keys_push_is_skipped(monkeypatch) -> None:
    monkeypatch.setattr(push, "env", lambda k: "")
    assert REAL_SEND(Phone().sub(), {"title": "x"}).status == "skipped"


class FakeService:
    def __init__(self, status: int = 201) -> None:
        self.status, self.requests = status, []

    def __call__(self, req, timeout):
        self.requests.append(req)
        if self.status >= 400:
            raise push.urllib.error.HTTPError(req.full_url, self.status, "x", {}, io.BytesIO(b""))
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.mark.parametrize(
    ("status", "want"), [(201, "sent"), (404, "gone"), (410, "gone"), (429, "failed"), (500, "failed")]
)
def test_sending_reports_what_the_push_service_said(keys, monkeypatch, status, want) -> None:
    svc = FakeService(status)
    monkeypatch.setattr(push.urllib.request, "urlopen", svc)
    phone = Phone()
    r = REAL_SEND(phone.sub(), {"title": "Running late", "url": "/projects/1"}, urgent=True)
    assert r.status == want
    req = svc.requests[0]
    assert req.full_url == phone.endpoint and req.get_method() == "POST"
    assert req.headers["Content-encoding"] == "aes128gcm" and req.headers["Urgency"] == "high"
    assert req.headers["Authorization"].startswith("vapid t=") and int(req.headers["Ttl"]) == 86400
    assert json.loads(decrypt(req.data, phone.key, phone.auth)) == {"title": "Running late", "url": "/projects/1"}


# --------------------------------------------------------------------- links


@pytest.mark.parametrize(
    ("kind", "pid", "want"),
    [
        ("visit_missed", 7, "/projects/7#site-visits"),
        ("crew_arrived_late", 7, "/projects/7#site-visits"),
        ("visit_assigned", 7, "/projects/7#site-visits"),
        ("visit_reminder", 7, "/projects/7#site-visits"),
        ("milestone_complete", 7, "/projects/7"),
        ("approval_request", 7, "/projects/7"),
        ("audit_restore", 7, "/projects/7"),
        ("account_request", None, "/people"),
        ("role_request", None, "/people"),
        ("role_approved", None, "/account"),
        ("account_approved", None, "/account"),
        ("audit_restore", None, "/alerts"),
    ],
)
def test_every_alert_points_at_what_its_about(kind, pid, want) -> None:
    assert notify.default_link(kind, pid) == want


# ----------------------------------------------------------------------- api


@pytest.fixture
def two(fx):
    return fx.user("contractor", full_name="Alert One"), fx.user("homeowner", full_name="Alert Two")


def test_alerts_list_unread_and_read(client, fx, two) -> None:
    a, b = two
    for i in range(3):
        notify.notify(a["uid"], "account_created", f"Hello {i}", "Body")
    notify.notify(b["uid"], "account_created", "Not yours", "Body")
    r = client.get("/api/py/alerts", headers=h(a)).json()
    assert [x["title"] for x in r["alerts"]] == ["Hello 2", "Hello 1", "Hello 0"], "newest first, only mine"
    assert r["unread"] == 3 and client.get("/api/py/me", headers=h(a)).json()["unread"] == 3
    first = r["alerts"][0]
    assert first["link"] == "/account" and first["kindLabel"] == "Account" and first["read"] is False

    # Someone else's alert id can't be marked by me.
    theirs = client.get("/api/py/alerts", headers=h(b)).json()["alerts"][0]["id"]
    client.post("/api/py/alerts/read", headers=h(a), json={"ids": [theirs]})
    assert client.get("/api/py/alerts", headers=h(b)).json()["unread"] == 1

    assert client.post("/api/py/alerts/read", headers=h(a), json={"ids": [first["id"]]}).json()["unread"] == 2
    assert client.post("/api/py/alerts/read", headers=h(a), json={"all": True}).json()["unread"] == 0
    assert all(x["read"] for x in client.get("/api/py/alerts", headers=h(a)).json()["alerts"])
    assert client.post("/api/py/alerts/read", headers=h(a), json={}).status_code == 400


def test_older_alerts_come_in_pages(client, two) -> None:
    a, _ = two
    for i in range(7):
        notify.notify(a["uid"], "account_created", f"N{i}", None)
    page = client.get("/api/py/alerts", headers=h(a), params={"limit": 4}).json()
    assert len(page["alerts"]) == 4 and page["more"] is True
    rest = client.get("/api/py/alerts", headers=h(a), params={"limit": 4, "before": page["alerts"][-1]["id"]}).json()
    assert [x["title"] for x in rest["alerts"]] == ["N2", "N1", "N0"] and rest["more"] is False


def test_alerts_need_sign_in(client) -> None:
    assert client.get("/api/py/alerts").status_code == 401


# -------------------------------------------------------------------- phones


@pytest.fixture
def recorder(monkeypatch):
    calls: list[tuple[dict, dict, bool]] = []

    def send(sub, message, urgent=False):
        calls.append((sub, message, urgent))
        return push.PushResult(getattr(send, "next", "sent"))

    monkeypatch.setattr(push, "send", send)
    return send, calls


def test_a_phone_gets_each_alert_with_its_link_and_unread_count(client, fx, two, recorder) -> None:
    a, _ = two
    phone = Phone()
    assert client.post("/api/py/push/subscriptions", headers=h(a), json=phone.json()).status_code == 200
    report = notify.notify(a["uid"], "milestone_complete", "Milestone 1 complete", "Done", link="/projects/9")
    assert report["push"].status == "sent"
    _, calls = recorder
    sub, message, urgent = calls[-1]
    assert sub["endpoint"] == phone.endpoint and urgent is False
    assert message["title"] == "Milestone 1 complete" and message["url"] == "/projects/9" and message["unread"] == 1
    nid = message["id"]
    d = fx.conn.execute("select * from notification_deliveries where notification_id = %s", (nid,)).fetchone()
    assert d["channel"] == "push" and d["status"] == "sent"


def test_two_phones_both_get_it_and_a_dead_one_is_forgotten(client, fx, two, recorder) -> None:
    a, _ = two
    p1, p2 = Phone(), Phone()
    client.post("/api/py/push/subscriptions", headers=h(a), json=p1.json())
    client.post("/api/py/push/subscriptions", headers=h(a), json=p2.json())
    send, calls = recorder
    notify.notify(a["uid"], "account_created", "Two phones", None)
    assert {c[0]["endpoint"] for c in calls} == {p1.endpoint, p2.endpoint}
    send.next = "gone"
    notify.notify(a["uid"], "account_created", "Phones gone", None)
    assert not fx.conn.execute("select 1 from push_subscriptions where uid = %s", (a["uid"],)).fetchone()


def test_without_phones_nothing_is_attempted(client, two, recorder) -> None:
    a, _ = two
    report = notify.notify(a["uid"], "account_created", "No phones", None)
    assert "push" not in report and recorder[1] == []


@pytest.mark.parametrize(
    "bad",
    [
        {"endpoint": "http://insecure.example/x", "keys": {"p256dh": "x", "auth": "y"}},
        {"endpoint": "https://push.example.com/x", "keys": {"p256dh": "short", "auth": "AAAAAAAAAAAAAAAAAAAAAA"}},
        {"endpoint": "https://push.example.com/x", "keys": {}},
        {"endpoint": "", "keys": {}},
    ],
)
def test_bad_subscriptions_are_refused(client, two, bad) -> None:
    assert client.post("/api/py/push/subscriptions", headers=h(two[0]), json=bad).status_code == 400


def test_the_same_phone_moves_to_whoever_signed_in_last(client, fx, two) -> None:
    a, b = two
    phone = Phone()
    client.post("/api/py/push/subscriptions", headers=h(a), json=phone.json())
    client.post("/api/py/push/subscriptions", headers=h(b), json=phone.json())
    rows = fx.conn.execute("select uid from push_subscriptions where endpoint = %s", (phone.endpoint,)).fetchall()
    assert [r["uid"] for r in rows] == [b["uid"]]


def test_turning_off_only_affects_your_own_phone(client, fx, two) -> None:
    a, b = two
    pa, pb = Phone(), Phone()
    client.post("/api/py/push/subscriptions", headers=h(a), json=pa.json())
    client.post("/api/py/push/subscriptions", headers=h(b), json=pb.json())
    client.request("DELETE", "/api/py/push/subscriptions", headers=h(a), json={"endpoint": pb.endpoint})
    assert fx.conn.execute("select 1 from push_subscriptions where endpoint = %s", (pb.endpoint,)).fetchone()
    client.request("DELETE", "/api/py/push/subscriptions", headers=h(a), json={"endpoint": pa.endpoint})
    assert not fx.conn.execute("select 1 from push_subscriptions where endpoint = %s", (pa.endpoint,)).fetchone()


def test_the_database_refuses_subscribing_someone_else(fx, two) -> None:
    a, b = two
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(a["uid"]) as cur:
        cur.execute(
            "insert into push_subscriptions (uid, endpoint, p256dh, auth) values (%s, 'https://x.example/1', 'k', 'a')",
            (b["uid"],),
        )


def test_test_notification(client, two, recorder, keys) -> None:
    a, _ = two
    assert client.post("/api/py/push/test", headers=h(a)).status_code == 400, "no phone yet"
    client.post("/api/py/push/subscriptions", headers=h(a), json=Phone().json())
    assert client.post("/api/py/push/test", headers=h(a)).status_code == 200
    assert recorder[1][-1][1]["title"] == "Test notification"
    assert client.get("/api/py/push/key", headers=h(a)).json() == {"publicKey": keys["VAPID_PUBLIC_KEY"], "devices": 1}


def test_test_notification_without_server_keys(client, two, monkeypatch) -> None:
    monkeypatch.setattr(push, "env", lambda k: "")
    assert client.post("/api/py/push/test", headers=h(two[0])).status_code == 503
    assert client.get("/api/py/push/key", headers=h(two[0])).json()["publicKey"] is None


# ---------------------------------------------------------------------- late


def visit(fx, pid, when: datetime) -> int:
    return fx.conn.execute(
        "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note) "
        "values (%s, %s, %s, 'Panel mounting') returning visit_id",
        (pid, when.date(), when.strftime("%H:%M")),
    ).fetchone()["visit_id"]


def test_crew_an_hour_late_alerts_the_projects_pm_urgently(client, fx, t, recorder) -> None:  # noqa: F811
    now = datetime.now(SG).replace(second=0, microsecond=0)
    start = now - timedelta(minutes=75)
    if start.date() != now.date():
        pytest.skip("too close to midnight in Singapore for a same-day visit")
    for r in ("pm", "epc"):
        client.post("/api/py/push/subscriptions", headers=h(t[r]), json=Phone().json())
    visit(fx, t["pid"], start)
    sent = sites_mod.run_reminders(now)
    assert sent["missed"] >= 1
    rows = fx.conn.execute(
        "select recipient_uid, title, link from notifications where project_id = %s and kind = 'visit_missed'",
        (t["pid"],),
    ).fetchall()
    assert t["pm"]["uid"] in {r["recipient_uid"] for r in rows}, "the project's PM is told"
    assert all(r["title"].startswith("Running late") and r["link"].endswith("#site-visits") for r in rows)
    urgent = [c for c in recorder[1] if c[1]["title"].startswith("Running late")]
    assert urgent and all(c[2] for c in urgent), "phone notifications go out as urgent"
    assert sites_mod.run_reminders(now)["missed"] == 0, "only once"


def test_crew_not_yet_an_hour_late_is_not_flagged(fx, t) -> None:  # noqa: F811
    now = datetime.now(SG).replace(second=0, microsecond=0)
    start = now - timedelta(minutes=50)
    if start.date() != now.date():
        pytest.skip("too close to midnight in Singapore")
    visit(fx, t["pid"], start)
    sites_mod.run_reminders(now)
    assert not fx.conn.execute(
        "select 1 from notifications where project_id = %s and kind = 'visit_missed'", (t["pid"],)
    ).fetchone()


def test_late_arrival_tells_the_pm_once(client, fx, t) -> None:  # noqa: F811
    now = datetime.now(SG)
    start = now - timedelta(minutes=80)
    if start.date() != now.date():
        pytest.skip("too close to midnight in Singapore")
    visit(fx, t["pid"], start)
    assert check_in(client, t, "epc", t["pid"]).status_code == 200
    rows = fx.conn.execute(
        "select recipient_uid, title, body from notifications where project_id = %s and kind = 'crew_arrived_late'",
        (t["pid"],),
    ).fetchall()
    assert [r["recipient_uid"] for r in rows] == [t["pm"]["uid"]]
    assert rows[0]["title"].startswith("Crew arrived 1 h 2") and "Sites EPC" in rows[0]["body"]
    assert check_in(client, t, "epc2", t["pid"]).status_code == 200
    assert (
        fx.conn.execute(
            "select count(*)::int as n from notifications where project_id = %s and kind = 'crew_arrived_late'",
            (t["pid"],),
        ).fetchone()["n"]
        == 1
    ), "the second crew member's check-in doesn't repeat it"


def test_on_time_arrival_sends_nothing(client, fx, t) -> None:  # noqa: F811
    now = datetime.now(SG)
    start = now - timedelta(minutes=20)
    if start.date() != now.date():
        pytest.skip("too close to midnight in Singapore")
    visit(fx, t["pid"], start)
    assert check_in(client, t, "epc", t["pid"]).status_code == 200
    assert not fx.conn.execute(
        "select 1 from notifications where project_id = %s and kind = 'crew_arrived_late'", (t["pid"],)
    ).fetchone()
