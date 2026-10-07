"""Clerk session verification, and the /me endpoint end to end."""

from __future__ import annotations

import pytest

from _lib.auth import AuthError, frontend_api, verify_token
from conftest import PRIVATE_KEY, bearer, make_token


def test_decodes_frontend_api_from_publishable_key() -> None:
    host = frontend_api()
    assert host.endswith((".clerk.accounts.dev", ".clerk.com")) or "." in host


def test_valid_token_identifies_the_user() -> None:
    ident = verify_token(make_token("user_abc"))
    assert ident.clerk_user_id == "user_abc"


def test_expired_token_is_refused() -> None:
    with pytest.raises(AuthError, match="sign-in has expired. Go back to the app"):
        verify_token(make_token("user_abc", exp_in=-60))


def test_expired_session_cookie_gets_a_plain_message(client) -> None:
    # What happens when an API address is opened in its own tab with a stale cookie.
    client.cookies.set("__session", make_token("user_abc", exp_in=-60))
    r = client.get("/api/py/storage/check")
    assert r.status_code == 401 and r.json()["error"].startswith("Your sign-in has expired")


def test_token_for_another_site_is_refused() -> None:
    with pytest.raises(AuthError, match="another origin"):
        verify_token(make_token("user_abc", azp="https://evil.example"))


def test_pending_session_is_refused() -> None:
    with pytest.raises(AuthError, match="not complete"):
        verify_token(make_token("user_abc", sts="pending"))


def test_token_signed_with_another_key_is_refused() -> None:
    from cryptography.hazmat.primitives.asymmetric import rsa

    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    import jwt

    forged = jwt.encode({"sub": "user_abc", "iat": 1, "exp": 9999999999}, other, algorithm="RS256")
    with pytest.raises(AuthError):
        verify_token(forged)
    assert PRIVATE_KEY is not other  # the fixture key is the only trusted one


def test_hs256_downgrade_is_refused() -> None:
    import jwt

    forged = jwt.encode({"sub": "user_abc", "iat": 1, "exp": 9999999999}, "secret", algorithm="HS256")
    with pytest.raises(AuthError):
        verify_token(forged)


# ---------------------------------------------------------------- API


def test_ping_needs_no_login(client) -> None:
    r = client.get("/api/py/ping")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_me_without_token_is_401_json(client) -> None:
    r = client.get("/api/py/me")
    assert r.status_code == 401
    assert "error" in r.json()


def test_me_for_linked_project_manager(client, fx) -> None:
    pm = fx.user("project_manager", full_name="Wei Ming Tan")
    r = client.get("/api/py/me", headers=bearer(pm["clerk_user_id"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "active"
    assert body["user"]["role"] == "project_manager"
    assert body["user"]["fullName"] == "Wei Ming Tan"
    assert "icLast4" not in body["user"]


def test_me_for_deactivated_user(client, fx) -> None:
    u = fx.user("contractor")
    fx.conn.execute("update users set active = false where uid = %s", (u["uid"],))
    r = client.get("/api/py/me", headers=bearer(u["clerk_user_id"]))
    assert r.json()["state"] == "deactivated"


def test_session_cookie_also_works(client, fx) -> None:
    u = fx.user("homeowner")
    client.cookies.set("__session", make_token(u["clerk_user_id"]))
    r = client.get("/api/py/me")
    client.cookies.clear()
    assert r.status_code == 200 and r.json()["state"] == "active"
