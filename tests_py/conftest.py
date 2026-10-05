"""Shared test helpers.

Tests run against the DEVELOPMENT Neon branch, through the same
least-privilege role the API uses. Fixtures that must bypass the app's own
rules (creating the first PM, cleaning up) use the owner connection from
MIGRATION_DATABASE_URL, exactly as the TypeScript verify scripts do.

Clerk is the one thing replaced: tokens are signed with a throwaway RSA key
generated per test session, and the API is pointed at that key instead of
Clerk's. Everything after signature verification is the real code path.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from collections.abc import Iterator
from typing import Any

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from psycopg.rows import dict_row

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from _lib import auth
from _lib.db import _from_env_file

PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_KEY = PRIVATE_KEY.public_key()


def make_token(sub: str, *, azp: str = "http://localhost:3000", exp_in: int = 60, **extra: Any) -> str:
    now = int(time.time())
    claims = {"sub": sub, "sid": "sess_test", "iat": now, "nbf": now, "exp": now + exp_in, "azp": azp}
    claims.update(extra)
    return jwt.encode(claims, PRIVATE_KEY, algorithm="RS256", headers={"kid": "test"})


class _FakeJwks:
    def get_signing_key_from_jwt(self, _token: str) -> Any:
        return type("K", (), {"key": PUBLIC_KEY})()


@pytest.fixture(autouse=True)
def _fake_clerk_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "_jwks_client", lambda: _FakeJwks())


def owner_conn() -> psycopg.Connection:
    url = os.environ.get("MIGRATION_DATABASE_URL") or _from_env_file("MIGRATION_DATABASE_URL")
    return psycopg.connect(url, row_factory=dict_row, autocommit=True)


class Fixtures:
    """Creates users through the owner connection and tidies up after."""

    def __init__(self) -> None:
        self.conn = owner_conn()
        self.uids: list[int] = []
        self.stamp = uuid.uuid4().hex[:8]

    def user(self, role: str, *, linked: bool = True, **cols: Any) -> dict[str, Any]:
        clerk_id = f"user_test_{role}_{uuid.uuid4().hex[:10]}" if linked else None
        row = self.conn.execute(
            "insert into users (email, user_type, full_name, clerk_user_id, contact_no) "
            "values (%s, %s, %s, %s, %s) returning *",
            (
                cols.get("email", f"pytest-{role}-{uuid.uuid4().hex[:8]}@example.com"),
                role,
                cols.get("full_name", f"Test {role}"),
                clerk_id,
                cols.get("contact_no"),
            ),
        ).fetchone()
        assert row is not None
        self.uids.append(row["uid"])
        return row

    def close(self) -> None:
        # Users who appear in the audit log as actors cannot be deleted (the
        # log is append-only); deactivate those, delete the rest.
        if self.uids:
            self.conn.execute(
                "delete from users u where u.uid = any(%s) "
                "and not exists (select 1 from audit_log a where a.actor_uid = u.uid)",
                (self.uids,),
            )
            self.conn.execute(
                "update users set active = false, clerk_user_id = null, full_name = 'pytest fixture' "
                "where uid = any(%s)",
                (self.uids,),
            )
        self.conn.close()


@pytest.fixture
def fx() -> Iterator[Fixtures]:
    f = Fixtures()
    try:
        yield f
    finally:
        f.close()


@pytest.fixture
def client() -> Iterator[Any]:
    from fastapi.testclient import TestClient

    import index

    with TestClient(index.app) as c:
        yield c


def bearer(sub: str, **kw: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub, **kw)}"}
