"""Personal data (PDPA): agreeing to the privacy notice, and downloading your own data."""

from __future__ import annotations

import uuid

import psycopg
import pytest

from _lib import account as account_mod
from _lib import clerk, privacy
from _lib.db import transaction
from conftest import bearer


@pytest.fixture
def newcomer(monkeypatch: pytest.MonkeyPatch, fx):
    clerk_id = f"user_test_new_{uuid.uuid4().hex[:10]}"
    email = f"pytest-new-{uuid.uuid4().hex[:8]}@example.com"
    fake = clerk.ClerkUser(clerk_id, [email], email, "Aisha Rahman", "+65 9123 4567")
    monkeypatch.setattr(account_mod.clerk, "get_user", lambda _id: fake)
    yield fake
    fx.conn.execute("delete from account_requests where clerk_user_id = %s", (clerk_id,))


ASK = {"fullName": "Aisha Rahman", "role": "homeowner", "contactNo": "+65 9123 4567"}


def test_asking_for_access_needs_the_privacy_notice_agreed(client, newcomer) -> None:
    r = client.post("/api/py/account-requests", headers=bearer(newcomer.id), json=ASK)
    assert r.status_code == 400
    assert r.json()["error"] == "Agree to the privacy notice to continue."
    assert r.json().get("field") == "privacy"


def test_agreeing_when_asking_is_recorded_and_carried_to_the_account(client, newcomer, fx) -> None:
    r = client.post("/api/py/account-requests", headers=bearer(newcomer.id), json={**ASK, "privacyAccepted": True})
    assert r.status_code == 200, r.text
    req = fx.conn.execute(
        "select request_id, privacy_accepted_at, privacy_version from account_requests where clerk_user_id = %s",
        (newcomer.id,),
    ).fetchone()
    assert req["privacy_accepted_at"] is not None
    assert req["privacy_version"] == privacy.VERSION

    pm = fx.user("project_manager")
    ok = client.post(
        f"/api/py/account-requests/{req['request_id']}/approve",
        headers=bearer(pm["clerk_user_id"]),
        json={"role": "homeowner", "noExpiry": True},
    )
    assert ok.status_code == 200, ok.text
    fx.uids.append(ok.json()["uid"])
    u = fx.conn.execute(
        "select privacy_accepted_at, privacy_version from users where uid = %s", (ok.json()["uid"],)
    ).fetchone()
    assert u["privacy_accepted_at"] == req["privacy_accepted_at"]
    assert u["privacy_version"] == privacy.VERSION


def test_someone_without_an_agreement_is_asked_then_agrees(client, fx) -> None:
    ho = fx.user("homeowner")
    h = bearer(ho["clerk_user_id"])
    before = client.get("/api/py/me", headers=h).json()["settings"]["privacy"]
    assert before == {"acceptedAt": None, "version": None, "current": privacy.VERSION}

    r = client.post("/api/py/me/privacy", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == privacy.VERSION

    after = client.get("/api/py/me", headers=h).json()["settings"]["privacy"]
    assert after["acceptedAt"] and after["version"] == after["current"] == privacy.VERSION


def test_only_the_person_agrees_for_themself(fx) -> None:
    ho = fx.user("homeowner")
    pm = fx.user("superadmin")
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(pm["uid"]) as cur:
        cur.execute("update users set privacy_accepted_at = now(), privacy_version = 'x' where uid = %s", (ho["uid"],))


def test_without_an_account_there_is_nothing_to_agree_or_download(client, newcomer) -> None:
    h = bearer(newcomer.id)
    assert client.post("/api/py/me/privacy", headers=h).status_code == 403
    assert client.get("/api/py/me/data", headers=h).status_code == 403


def test_download_my_data(client, fx) -> None:
    ho = fx.user("homeowner", contact_no="+65 9876 0001")
    fx.conn.execute("update users set ic_last4 = '123A', address = '1 Test Road' where uid = %s", (ho["uid"],))
    other = fx.user("homeowner")
    fx.conn.execute(
        "insert into notifications (recipient_uid, kind, title, body) values "
        "(%s, 'account_approved', 'Mine', 'For me'), (%s, 'account_approved', 'Theirs', 'Not for me')",
        (ho["uid"], other["uid"]),
    )

    r = client.get("/api/py/me/data", headers=bearer(ho["clerk_user_id"]))
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"].startswith('attachment; filename="gethomeapps-my-data-')
    assert ho["email"] not in r.headers["content-disposition"]
    assert r.headers["cache-control"] == "no-store"
    d = r.json()
    assert d["profile"]["email"] == ho["email"]
    assert d["profile"]["address"] == "1 Test Road"
    # Never: ways into the account, nor the NRIC fragment.
    for hidden in ("ic_last4", "clerk_user_id", "avatar_key"):
        assert hidden not in d["profile"]
    assert [n["title"] for n in d["notifications"]] == ["Mine"]
    for part in ("homes", "systems", "invoices", "meetings", "signatures", "siteCheckIns", "supportMessages"):
        assert d[part] == []
    assert "123A" not in r.text


def test_a_staff_members_files_with_no_project_are_in_their_data(client, fx) -> None:
    pm = fx.user("project_manager")
    other = fx.user("project_manager")
    fx.conn.execute(
        "insert into unassigned_files (url, file_name, content_type, size_bytes, kind, note, uploaded_by) values "
        "(%s, 'mine.pdf', 'application/pdf', 10, 'document', 'For a lead', %s), "
        "(%s, 'theirs.pdf', 'application/pdf', 10, 'document', null, %s)",
        (f"unassigned/documents/{pm['uid']}-a.pdf", pm["uid"], f"unassigned/documents/{other['uid']}-b.pdf", other["uid"]),
    )
    try:
        d = client.get("/api/py/me/data", headers=bearer(pm["clerk_user_id"])).json()
        assert [(f["file_name"], f["note"]) for f in d["filesNotOnAProject"]] == [("mine.pdf", "For a lead")]
    finally:
        fx.conn.execute("delete from unassigned_files where uploaded_by = any(%s)", ([pm["uid"], other["uid"]],))
