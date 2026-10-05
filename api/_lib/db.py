"""Database access for the Python side.

Python and TypeScript share one Neon database and one set of rules. Two
conventions matter and are not optional:

1. Connect with ``DATABASE_URL`` — the least-privilege role. Python gets no
   more access than the web app; nothing here needs to alter the schema, and
   migrations are deliberately a separate, deliberate act.

2. Set ``app.actor_uid`` on every connection that writes. The audit triggers
   and the row level security policies both read it. A write without it is
   still recorded, but as an unattributed change — which is a signal worth
   seeing, not a thing to shrug at.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

__all__ = [
    "DatabaseNotConfiguredError",
    "connect",
    "fetch_all",
    "fetch_one",
    "transaction",
]


class DatabaseNotConfiguredError(RuntimeError):
    """Raised when DATABASE_URL is absent, with the same wording the web app uses."""

    def __init__(self) -> None:
        super().__init__(
            "DATABASE_URL is not set. Locally, put it in web/.env.local; on "
            "Vercel, set it under Project -> Settings -> Environment Variables."
        )


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        # Vercel injects env vars; locally a developer runs with .env.local, so
        # fall back to reading it rather than requiring a second mechanism.
        url = _from_env_file("DATABASE_URL")
    if not url:
        raise DatabaseNotConfiguredError
    return url


def _from_env_file(key: str) -> str:
    """Reads one key from .env.local, searching upward from this file."""
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        candidate = os.path.join(here, ".env.local")
        if os.path.isfile(candidate):
            with open(candidate, encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    name, _, value = line.partition("=")
                    if name.strip() == key:
                        return value.strip().strip('"').strip("'")
        here = os.path.dirname(here)
    return ""


@contextmanager
def connect(actor_uid: int | None = None) -> Iterator[psycopg.Connection]:
    """Opens a connection, optionally identifying who is acting.

    ``actor_uid`` is applied with ``set_config(..., false)`` so it lasts for the
    session rather than a transaction, which matches how the triggers and
    policies expect to find it.
    """
    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        if actor_uid is not None:
            with conn.cursor() as cur:
                cur.execute("select set_config('app.actor_uid', %s, false)", (str(actor_uid),))
        yield conn


@contextmanager
def transaction(actor_uid: int | None) -> Iterator[psycopg.Cursor]:
    """One transaction, acting as ``actor_uid``. Commits on success, rolls back on error.

    The actor is set with ``set_config(..., true)`` — local to this
    transaction — so it can never leak into another request, even if a
    connection were ever reused. Every write the API makes goes through here,
    which is what lets the audit log attribute it and lets the database's own
    guards (only a PM may create accounts, the geofence, ...) judge it.
    """
    with (
        psycopg.connect(_database_url(), row_factory=dict_row) as conn,
        conn.transaction(),
        conn.cursor() as cur,
    ):
        cur.execute(
            "select set_config('app.actor_uid', %s, true)",
            ("" if actor_uid is None else str(actor_uid),),
        )
        yield cur


def fetch_all(
    sql: str, params: tuple[Any, ...] = (), actor_uid: int | None = None
) -> list[dict[str, Any]]:
    with connect(actor_uid) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def fetch_one(
    sql: str, params: tuple[Any, ...] = (), actor_uid: int | None = None
) -> dict[str, Any] | None:
    rows = fetch_all(sql, params, actor_uid)
    return rows[0] if rows else None
