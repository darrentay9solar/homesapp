"""Self sign-up: POST /api/py/account-requests, end to end against the dev database.

Clerk's Backend API is replaced with a fake user (verified email), so no real
Clerk account is needed; everything after that is the real code path.
"""

from __future__ import annotations

import uuid

import pytest

from _lib import account as account_mod
from _lib import clerk
from conftest import bearer


@pytest.fixture
def newcomer(monkeypatch: pytest.MonkeyPatch, fx):
    clerk_id = f"user_test_new_{uuid.uuid4().hex[:10]}"
    email = f"pytest-new-{uuid.uuid4().hex[:8]}@example.com"
    fake = clerk.ClerkUser(clerk_id, [email], email, "Aisha Rahman", "+65 9123 4567")
    monkeypatch.setattr(account_mod.clerk, "get_user", lambda _id: fake)
    yield fake
    fx.conn.execute("delete from account_requests where clerk_user_id = %s", (clerk_id,))


def test_no_account_then_request_then_pending(client, newcomer) -> None:
    h = bearer(newcomer.id)
    me = client.get("/api/py/me", headers=h).json()
    assert me["state"] == "no_account"
    assert me["clerk"]["fullName"] == "Aisha Rahman"

    r = client.post(
        "/api/py/account-requests",
        headers=h,
        json={"fullName": "Aisha Rahman", "role": "contractor", "contactNo": "+65 9123 4567", "note": "Apex"},
    )
    assert r.status_code == 200, r.text

    me = client.get("/api/py/me", headers=h).json()
    assert me["state"] == "pending"
    assert me["request"]["requestedRole"] == "contractor"

    again = client.post(
        "/api/py/account-requests", headers=h, json={"fullName": "Aisha Rahman", "role": "contractor"}
    )
    assert again.status_code == 409


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"fullName": "A", "role": "homeowner"}, "full name"),
        ({"fullName": "Aisha", "role": "boss"}, "Choose a role"),
        ({"fullName": "Aisha", "role": "homeowner", "icLast4": "S1234567D"}, "last 4"),
        ({"fullName": "Aisha", "role": "homeowner", "icLast4": "12AB"}, "three digits"),
        ({"fullName": "Aisha", "role": "homeowner", "postalCode": "12345"}, "6 digits"),
        ({"fullName": "Aisha", "role": "homeowner", "contactNo": "call me"}, "mobile number"),
    ],
)
def test_validation(client, newcomer, payload, message) -> None:
    r = client.post("/api/py/account-requests", headers=bearer(newcomer.id), json=payload)
    assert r.status_code == 400
    assert message.lower() in r.json()["error"].lower()


def test_postal_code_fills_in_address(client, newcomer, fx) -> None:
    r = client.post(
        "/api/py/account-requests",
        headers=bearer(newcomer.id),
        json={"fullName": "Aisha Rahman", "role": "homeowner", "postalCode": "569933", "icLast4": "567d"},
    )
    assert r.status_code == 200, r.text
    row = fx.conn.execute(
        "select address, postal_code, ic_last4, status from account_requests where clerk_user_id = %s",
        (newcomer.id,),
    ).fetchone()
    assert row["postal_code"] == "569933"
    assert "ANG MO KIO" in row["address"]
    assert row["ic_last4"] == "567D"
    assert row["status"] == "pending"


def test_existing_account_cannot_request(client, fx) -> None:
    u = fx.user("homeowner")
    body = {"fullName": "X Y", "role": "homeowner"}
    r = client.post("/api/py/account-requests", headers=bearer(u["clerk_user_id"]), json=body)
    assert r.status_code == 409


@pytest.mark.parametrize(
    ("raw", "stored"),
    [
        ("+65 9123 4567", "+65 9123 4567"),
        ("+65 91234567", "+65 91234567"),
        ("91234567", "+65 9123 4567"),  # bare Singapore mobile gets +65
        ("+60 12-345 6789", "+60 12-345 6789"),
        ("+852 9123 4567", "+852 9123 4567"),
        ("", None),
    ],
)
def test_phone_normalised(raw, stored) -> None:
    from _lib.profile import clean_phone

    assert clean_phone(raw) == stored


@pytest.mark.parametrize("raw", ["+65 9123 456", "12345", "+65", "0123 4567"])
def test_phone_rejected(raw) -> None:
    from fastapi import HTTPException

    from _lib.profile import clean_phone

    with pytest.raises(HTTPException):
        clean_phone(raw)
