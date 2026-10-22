"""Two-step verification for staff (ISO 27001 A.8.5), once REQUIRE_STAFF_MFA=1: api/_lib/web.py."""

from __future__ import annotations

import pytest

from _lib.auth import verify_token
from conftest import PUBLIC_KEY, bearer, make_token

WITHOUT = {"fva": [3, -1]}  # signed in with a password only
WITH = {"fva": [3, 3]}  # and a code from an authenticator app


@pytest.fixture
def required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REQUIRE_STAFF_MFA", "1")


def test_the_token_says_whether_a_second_factor_was_used() -> None:
    assert verify_token(make_token("user_x", **WITHOUT), key=PUBLIC_KEY).second_factor is False
    assert verify_token(make_token("user_x", **WITH), key=PUBLIC_KEY).second_factor is True
    assert verify_token(make_token("user_x"), key=PUBLIC_KEY).second_factor is None


def test_staff_without_it_can_open_only_their_own_account(client, fx, required) -> None:
    pm = fx.user("project_manager")
    h = bearer(pm["clerk_user_id"], **WITHOUT)
    r = client.get("/api/py/projects", headers=h)
    assert r.status_code == 403 and "two-step" in r.json()["error"]
    me = client.get("/api/py/me", headers=h)
    assert me.status_code == 200 and me.json()["settings"]["twoStepNeeded"] is True


def test_staff_with_it_carry_on(client, fx, required) -> None:
    pm = fx.user("project_manager")
    h = bearer(pm["clerk_user_id"], **WITH)
    assert client.get("/api/py/projects", headers=h).status_code == 200
    assert client.get("/api/py/me", headers=h).json()["settings"]["twoStepNeeded"] is False


def test_homeowners_arent_asked(client, fx, required) -> None:
    ho = fx.user("homeowner")
    h = bearer(ho["clerk_user_id"], **WITHOUT)
    assert client.get("/api/py/me", headers=h).json()["settings"]["twoStepNeeded"] is False
    assert client.get("/api/py/projects", headers=h).status_code == 200


def test_off_until_9_solar_home_turns_it_on(client, fx) -> None:
    pm = fx.user("project_manager")
    assert client.get("/api/py/projects", headers=bearer(pm["clerk_user_id"], **WITHOUT)).status_code == 200
