"""Settings, profile pictures, scheduled disable/enable, the PM file repository, files by type.

settings   language and notification preferences: saved, validated, returned on /me
silence    when an alert reaches the phone/email/WhatsApp, for every combination of settings
photos     your own picture; a PM can change or remove anyone's; nobody else can
schedule   expiry asked at creation; auto-disable on the date; extending re-enables; auto-enable
files      stored under images/ or documents/; PMs search everyone's
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import psycopg
import pytest
from test_project_work import _onemap, approve_both, new_project, team, upload  # noqa: F401

from _lib import notify, prefs, push
from _lib.account import SG
from _lib.db import transaction
from conftest import bearer

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 80


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


def today() -> date:
    return datetime.now(SG).date()


@pytest.fixture
def folks(fx):
    pm = fx.user("project_manager", full_name="Settings PM")
    pm2 = fx.user("project_manager", full_name="Second PM")
    c = fx.user("contractor", full_name="Chen Contractor")
    e = fx.user("epc_team", full_name="Eddie EPC")
    return {"pm": pm, "pm2": pm2, "c": c, "e": e}


def row(fx, uid):
    return fx.conn.execute("select * from users where uid = %s", (uid,)).fetchone()


# ------------------------------------------------------------------ settings


def test_language_is_saved_and_returned(client, fx, folks) -> None:
    c = folks["c"]
    assert client.get("/api/py/me", headers=h(c)).json()["settings"]["language"] == "en"
    assert client.patch("/api/py/me/settings", headers=h(c), json={"language": "zh"}).status_code == 200
    assert client.get("/api/py/me", headers=h(c)).json()["settings"]["language"] == "zh"
    assert client.patch("/api/py/me/settings", headers=h(c), json={"language": "fr"}).status_code == 400
    assert client.patch("/api/py/me/settings", headers=h(c), json={}).status_code == 400


def test_notification_preferences_round_trip(client, folks) -> None:
    c = folks["c"]
    want = {
        "pausedUntil": None,
        "quiet": {"on": True, "from": "22:30", "to": "06:45"},
        "urgent": False,
        "mute": ["milestones", "visits"],
        "channels": {"push": True, "email": False, "mobile": True},
    }
    r = client.patch("/api/py/me/settings", headers=h(c), json={"notificationPrefs": want})
    assert r.status_code == 200, r.text
    assert client.get("/api/py/me", headers=h(c)).json()["settings"]["notificationPrefs"] == want


@pytest.mark.parametrize(
    "bad",
    [
        {"quiet": {"on": True, "from": "25:00", "to": "07:00"}},
        {"quiet": {"on": True, "from": "22:00", "to": "22:00"}},
        {"mute": ["everything"]},
        {"mute": "visits"},
        {"pausedUntil": "tomorrow"},
    ],
)
def test_nonsense_preferences_are_refused(client, folks, bad) -> None:
    assert (
        client.patch("/api/py/me/settings", headers=h(folks["c"]), json={"notificationPrefs": bad}).status_code == 400
    )


def test_preferences_are_only_your_own(fx, folks) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(folks["c"]["uid"]) as cur:
        cur.execute("update users set language = 'zh' where uid = %s", (folks["e"]["uid"],))


# ------------------------------------------------------------------- silence

NIGHT = datetime(2026, 10, 7, 23, 30, tzinfo=SG)
DAY = datetime(2026, 10, 7, 14, 0, tzinfo=SG)
QUIET = {"quiet": {"on": True, "from": "22:00", "to": "07:00"}}


@pytest.mark.parametrize(
    ("settings", "kind", "now", "silenced"),
    [
        ({}, "milestone_complete", NIGHT, False),
        (QUIET, "milestone_complete", NIGHT, True),
        (QUIET, "milestone_complete", DAY, False),
        (QUIET, "visit_missed", NIGHT, False),  # running late still gets through by default
        ({**QUIET, "urgent": False}, "visit_missed", NIGHT, True),
        ({"quiet": {"on": True, "from": "09:00", "to": "17:00"}}, "approval_request", DAY, True),
        ({"quiet": {"on": True, "from": "09:00", "to": "17:00"}}, "approval_request", NIGHT, False),
        ({"mute": ["visits"]}, "visit_assigned", DAY, True),
        ({"mute": ["visits"]}, "visit_reminder", DAY, True),
        ({"mute": ["visits"]}, "visit_missed", DAY, False),
        ({"mute": ["late"]}, "crew_arrived_late", DAY, True),
        ({"pausedUntil": (DAY + timedelta(hours=2)).isoformat()}, "approval_request", DAY, True),
        ({"pausedUntil": (DAY - timedelta(hours=2)).isoformat()}, "approval_request", DAY, False),
        ({"pausedUntil": (DAY + timedelta(hours=2)).isoformat()}, "visit_missed", DAY, False),
        ({"pausedUntil": (DAY + timedelta(hours=2)).isoformat(), "urgent": False}, "visit_missed", DAY, True),
        ({"mute": ["people"]}, "role_request", DAY, True),
        ({"mute": ["account"]}, "role_approved", DAY, True),
    ],
)
def test_when_an_alert_is_silenced(settings, kind, now, silenced) -> None:
    assert bool(prefs.silenced(prefs.normalise(settings), kind, now)) is silenced


@pytest.fixture
def recorder(monkeypatch):
    calls = []
    monkeypatch.setattr(push, "send", lambda sub, msg, urgent=False: calls.append(msg) or push.PushResult("sent"))
    monkeypatch.setattr(notify, "send_email", lambda *a: calls.append({"email": a[1]}) or notify.SendResult("sent"))
    return calls


def subscribe(fx, uid) -> None:
    fx.conn.execute(
        "insert into push_subscriptions (uid, endpoint, p256dh, auth) values (%s, %s, 'k', 'a')",
        (uid, f"https://push.example.com/{uuid.uuid4().hex}"),
    )


def test_silenced_alerts_still_reach_the_alerts_screen(client, fx, folks, recorder) -> None:
    c = folks["c"]
    subscribe(fx, c["uid"])
    client.patch("/api/py/me/settings", headers=h(c), json={"notificationPrefs": {"mute": ["milestones"]}})
    report = notify.notify(
        c["uid"], "milestone_complete", "Milestone 1 complete", "x", email=(c["email"], "Subj", "<p>", "t")
    )
    assert recorder == [], "nothing sent"
    assert report["push"].status == "skipped" and "muted" in report["push"].detail
    assert report["email"].status == "skipped"
    assert client.get("/api/py/alerts", headers=h(c)).json()["alerts"][0]["title"] == "Milestone 1 complete"


def test_a_channel_turned_off_is_skipped_alone(client, fx, folks, recorder) -> None:
    c = folks["c"]
    subscribe(fx, c["uid"])
    client.patch("/api/py/me/settings", headers=h(c), json={"notificationPrefs": {"channels": {"email": False}}})
    report = notify.notify(c["uid"], "approval_request", "Approve X", "y", email=(c["email"], "Subj", "<p>", "t"))
    assert report["push"].status == "sent" and report["email"].status == "skipped"


# -------------------------------------------------------------------- photos


def give_photo(client, who, target_uid=None):
    base = "/api/py/me" if target_uid is None else f"/api/py/people/{target_uid}"
    lk = client.post(f"{base}/avatar/upload-link", headers=h(who), json={"contentType": "image/png", "size": len(PNG)})
    if lk.status_code != 200:
        return lk
    assert client.put(lk.json()["uploadUrl"], content=PNG, headers={"Content-Type": "image/png"}).status_code == 200
    return client.post(f"{base}/avatar", headers=h(who), json={"key": lk.json()["key"]})


def test_your_own_picture(client, fx, folks) -> None:
    c = folks["c"]
    r = give_photo(client, c)
    assert r.status_code == 200, r.text
    u = row(fx, c["uid"])
    assert u["avatar_key"].startswith(f"profiles/{c['uid']}/images/") and u["avatar_updated_by"] == c["uid"]
    me = client.get("/api/py/me", headers=h(c)).json()["user"]
    assert me["avatar"].startswith(f"/api/py/avatars/{c['uid']}?v=")
    view = client.get(f"/api/py/avatars/{c['uid']}", headers=h(folks["e"]), follow_redirects=False)
    assert (
        view.status_code == 302 and client.get(view.headers["location"]).content == PNG
    ), "anyone signed in can see it"
    assert client.delete("/api/py/me/avatar", headers=h(c)).status_code == 200
    assert row(fx, c["uid"])["avatar_key"] is None
    assert client.get(f"/api/py/avatars/{c['uid']}", headers=h(c)).status_code == 404


def test_only_a_pm_changes_someone_elses_picture(client, fx, folks) -> None:
    c, e, pm = folks["c"], folks["e"], folks["pm"]
    give_photo(client, c)
    assert give_photo(client, e, c["uid"]).status_code == 403
    assert client.delete(f"/api/py/people/{c['uid']}/avatar", headers=h(e)).status_code == 403
    r = give_photo(client, pm, c["uid"])
    assert r.status_code == 200 and "Chen Contractor's picture is updated" in r.json()["message"]
    assert row(fx, c["uid"])["avatar_updated_by"] == pm["uid"]
    assert client.delete(f"/api/py/people/{c['uid']}/avatar", headers=h(pm)).status_code == 200
    log = client.get("/api/py/audit", headers=h(pm), params={"location": f"person:{c['uid']}"}).json()["entries"]
    assert sum(1 for x in log if any(ch["field"] == "avatar_key" for ch in x["changes"])) >= 3


@pytest.mark.parametrize(
    ("ctype", "size", "why"),
    [
        ("image/gif", 100, "JPEG, PNG or WebP"),
        ("application/pdf", 100, "JPEG, PNG or WebP"),
        ("image/png", 6 * 1024 * 1024, "5 MB"),
        ("image/png", 0, "5 MB"),
    ],
)
def test_unsuitable_pictures_are_refused(client, folks, ctype, size, why) -> None:
    r = client.post("/api/py/me/avatar/upload-link", headers=h(folks["c"]), json={"contentType": ctype, "size": size})
    assert r.status_code == 400 and why in r.json()["error"]


def test_a_picture_key_for_someone_else_is_refused(client, folks) -> None:
    c, e = folks["c"], folks["e"]
    key = f"profiles/{e['uid']}/images/{uuid.uuid4()}.png"
    assert client.post("/api/py/me/avatar", headers=h(c), json={"key": key}).status_code == 400
    mine = f"profiles/{c['uid']}/images/{uuid.uuid4()}.png"
    r = client.post("/api/py/me/avatar", headers=h(c), json={"key": mine})
    assert r.status_code == 400 and "never arrived" in r.json()["error"]


def test_the_database_keeps_pictures_to_their_owner_or_a_pm(fx, folks) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(folks["c"]["uid"]) as cur:
        cur.execute("update users set avatar_key = 'x' where uid = %s", (folks["e"]["uid"],))


# ------------------------------------------------------------------ schedule


def make(client, pm, **extra):
    return client.post(
        "/api/py/people",
        headers=h(pm),
        json={
            "fullName": "Scheduled Person",
            "email": f"pytest-s-{uuid.uuid4().hex[:8]}@example.com",
            "role": "contractor",
            "contactNo": "+65 9123 4567",
            **extra,
        },
    )


def test_expiry_is_asked_when_an_account_is_made(client, fx, folks) -> None:
    pm = folks["pm"]
    assert make(client, pm).status_code == 400, "neither an expiry nor No expiry"
    assert make(client, pm, expiresOn=today().isoformat()).status_code == 400, "must be after today"
    assert make(client, pm, expiresOn="not a date").status_code == 400
    r = make(client, pm, expiresOn=(today() + timedelta(days=90)).isoformat())
    assert r.status_code == 200, r.text
    fx.uids.append(r.json()["uid"])
    assert row(fx, r.json()["uid"])["disable_on"] == today() + timedelta(days=90)
    r2 = make(client, pm, noExpiry=True)
    fx.uids.append(r2.json()["uid"])
    assert row(fx, r2.json()["uid"])["disable_on"] is None
    listed = {p["uid"]: p for p in client.get("/api/py/people", headers=h(pm)).json()["users"]}
    assert listed[r.json()["uid"]]["disableOn"] == (today() + timedelta(days=90)).isoformat()


def test_an_account_disables_itself_on_its_expiry_and_extending_re_enables_it(client, fx, folks) -> None:
    c, pm = folks["c"], folks["pm"]
    assert (
        client.patch(
            f"/api/py/people/{c['uid']}", headers=h(pm), json={"disableOn": (today() + timedelta(days=5)).isoformat()}
        ).status_code
        == 200
    )
    assert client.get("/api/py/me", headers=h(c)).json()["state"] == "active"
    fx.conn.execute("update users set disable_on = %s where uid = %s", (today(), c["uid"]))  # the day arrives
    me = client.get("/api/py/me", headers=h(c)).json()
    assert me["state"] == "deactivated" and me["disabled"] == {
        "reason": "scheduled",
        "expiredOn": today().isoformat(),
        "enableOn": None,
    }
    assert client.get("/api/py/projects", headers=h(c)).status_code == 403
    log = fx.conn.execute(
        "select actor_uid from audit_log where entity_table = 'users' and entity_id = %s "
        "and changes ? 'disabled_reason' order by audit_id desc limit 1",
        (str(c["uid"]),),
    ).fetchone()
    assert log["actor_uid"] is None, "recorded as the system's doing"
    r = client.patch(
        f"/api/py/people/{c['uid']}", headers=h(pm), json={"disableOn": (today() + timedelta(days=30)).isoformat()}
    )
    assert r.status_code == 200 and "re-enabled" in r.json()["message"]
    assert client.get("/api/py/me", headers=h(c)).json()["state"] == "active"


def test_a_manually_disabled_account_isnt_re_enabled_by_moving_the_expiry(client, fx, folks) -> None:
    c, pm = folks["c"], folks["pm"]
    client.patch(f"/api/py/people/{c['uid']}", headers=h(pm), json={"active": False})
    client.patch(
        f"/api/py/people/{c['uid']}", headers=h(pm), json={"disableOn": (today() + timedelta(days=30)).isoformat()}
    )
    u = row(fx, c["uid"])
    assert u["active"] is False and u["disabled_reason"] == "manual"


def test_a_disabled_account_enables_itself_on_its_date(client, fx, folks) -> None:
    c, pm = folks["c"], folks["pm"]
    r = client.patch(
        f"/api/py/people/{c['uid']}",
        headers=h(pm),
        json={"active": False, "enableOn": (today() + timedelta(days=3)).isoformat()},
    )
    assert r.status_code == 200 and "enables itself" in r.json()["message"]
    assert client.get("/api/py/me", headers=h(c)).json()["state"] == "deactivated"
    fx.conn.execute("update users set enable_on = %s where uid = %s", (today(), c["uid"]))
    assert client.get("/api/py/me", headers=h(c)).json()["state"] == "active"
    u = row(fx, c["uid"])
    assert u["enable_on"] is None and u["disabled_reason"] is None


@pytest.mark.parametrize(
    ("body", "why"),
    [
        ({"disableOn": "2020-01-01"}, "after today"),
        ({"enableOn": "2020-01-01"}, "after today"),
        ({"enableOn": "2099-02-01", "disableOn": "2099-01-01"}, "before the expiry"),
    ],
)
def test_bad_dates_are_refused(client, folks, body, why) -> None:
    r = client.patch(f"/api/py/people/{folks['c']['uid']}", headers=h(folks["pm"]), json=body)
    assert r.status_code == 400 and why in r.json()["error"]


def test_re_enabling_past_the_expiry_needs_a_new_date(client, fx, folks) -> None:
    c, pm = folks["c"], folks["pm"]
    fx.conn.execute("update users set disable_on = %s where uid = %s", (today(), c["uid"]))
    client.get("/api/py/people", headers=h(pm))  # opening People applies the schedule
    assert row(fx, c["uid"])["active"] is False
    r = client.patch(f"/api/py/people/{c['uid']}", headers=h(pm), json={"active": True})
    assert r.status_code == 400 and "expiry date has passed" in r.json()["error"]


def test_you_cant_expire_yourself_and_the_last_pm_never_lapses(client, fx, folks) -> None:
    pm = folks["pm"]
    r = client.patch(
        f"/api/py/people/{pm['uid']}", headers=h(pm), json={"disableOn": (today() + timedelta(days=9)).isoformat()}
    )
    assert r.status_code == 400
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(folks["c"]["uid"]) as cur:
        cur.execute("update users set disable_on = '2099-01-01' where uid = %s", (folks["c"]["uid"],))


def test_the_scheduled_job_applies_dates(client, fx, folks, monkeypatch) -> None:
    c = folks["c"]
    fx.conn.execute("update users set disable_on = %s where uid = %s", (today(), c["uid"]))
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    r = client.post("/api/py/cron/visit-reminders", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json()["accounts"] >= 1
    assert row(fx, c["uid"])["active"] is False


# --------------------------------------------------------------------- files


def test_files_are_stored_by_type(client, fx, team) -> None:  # noqa: F811
    pid = new_project(client, team)
    approve_both(client, team, pid)
    upload(client, team["epc"], pid, "panel_pictures")
    upload(client, team["admin"], pid, "utility_bill", b"%PDF-1.4\n" + b"0" * 20, "application/pdf", "bill.pdf")
    rows = fx.conn.execute(
        "select url, kind from project_files where project_id = %s order by file_id", (pid,)
    ).fetchall()
    assert rows[0]["url"].startswith(f"projects/{pid}/images/panel_pictures/") and rows[0]["kind"] == "image"
    assert rows[1]["url"].startswith(f"projects/{pid}/documents/utility_bill/") and rows[1]["kind"] == "document"
    # A key in the wrong folder for its type is refused.
    bad = f"projects/{pid}/documents/panel_pictures/{uuid.uuid4()}.png"
    r = client.post(
        f"/api/py/projects/{pid}/files", headers=h(team["epc"]), json={"category": "panel_pictures", "key": bad}
    )
    assert r.status_code == 400


def test_pms_search_everyones_files(client, fx, team) -> None:  # noqa: F811
    pid = new_project(client, team)
    approve_both(client, team, pid)
    a = upload(client, team["epc"], pid, "panel_pictures", name="roof east.png").json()["id"]
    b = upload(
        client, team["admin"], pid, "utility_bill", b"%PDF-1.4\n" + b"0" * 20, "application/pdf", "June bill.pdf"
    ).json()["id"]

    def ids(**q):
        return {f["id"] for f in client.get("/api/py/all-files", headers=h(team["pm"]), params=q).json()["files"]}

    assert {a, b} <= ids()
    assert ids(q="roof east") >= {a} and b not in ids(q="roof east")
    assert a in ids(q="Flow EPC") and b not in ids(q="Flow EPC"), "by uploader"
    assert b in ids(q="utility bill") and a not in ids(q="utility bill"), "by slot name"
    assert a in ids(q="photo flow") and b not in ids(q="photo flow"), "by type word"
    assert b in ids(kind="document") and a not in ids(kind="document")
    assert ids(q="nothing-like-this") == set()
    page = client.get("/api/py/all-files", headers=h(team["pm"]), params={"limit": 1}).json()
    assert len(page["files"]) == 1 and page["more"] is True
    f = next(
        x
        for x in client.get("/api/py/all-files", headers=h(team["pm"]), params={"q": "roof east"}).json()["files"]
        if x["id"] == a
    )
    assert f["uploader"]["name"] == "Flow EPC" and f["kind"] == "photo"
    for who in ("admin", "epc", "ho"):
        assert client.get("/api/py/all-files", headers=h(team[who])).status_code == 403
