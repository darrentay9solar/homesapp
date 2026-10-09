"""What every UAT test shares: the world, an API client, and pooled database connections.

The API opens a fresh database connection for every query, as it should on
Vercel. Thousands of tests doing that spend most of their time shaking hands
with Neon, so here the API's connections are reused: same database, same
least-privilege role, same rules, with the acting person set per transaction
exactly as before. Emails, WhatsApps and texts are recorded, never sent.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from _lib import db as dbmod
from _lib import notify, onemap
from uat import world as world_mod

SENT: list[dict[str, Any]] = []
# The real senders, for the tests about sending itself.
REAL_SEND_WHATSAPP = notify.send_whatsapp


class _Pool:
    def __init__(self, url: str) -> None:
        self.url = url
        self.free: list[psycopg.Connection] = []
        self.lock = threading.Lock()

    def get(self) -> psycopg.Connection:
        with self.lock:
            conn = self.free.pop() if self.free else None
        if conn is None or conn.closed or conn.broken:
            conn = psycopg.connect(self.url, row_factory=dict_row)
        return conn

    def put(self, conn: psycopg.Connection) -> None:
        if conn.closed or conn.broken:
            return
        with self.lock:
            self.free.append(conn)

    def close(self) -> None:
        for c in self.free:
            c.close()


class _Lease:
    """What ``transaction()`` gets from ``psycopg.connect()``: a pooled connection, handed back afterwards."""

    def __init__(self, pool: _Pool) -> None:
        self.pool = pool
        self.conn = pool.get()

    def __enter__(self) -> psycopg.Connection:
        return self.conn

    def __exit__(self, et: Any, ev: Any, tb: Any) -> bool:
        try:
            if not self.conn.broken:
                self.conn.rollback() if et else self.conn.commit()
        except psycopg.Error:
            self.conn.close()
        self.pool.put(self.conn)
        return False


@pytest.fixture(scope="package", autouse=True)
def _pooled_database() -> Iterator[None]:
    pool = _Pool(dbmod._database_url())
    real_psycopg, real_connect = dbmod.psycopg, dbmod.connect

    class Shim:
        Error = psycopg.Error

        @staticmethod
        def connect(*_a: Any, **_k: Any) -> _Lease:
            return _Lease(pool)

    @contextmanager
    def connect(actor_uid: int | None = None) -> Iterator[psycopg.Connection]:
        with _Lease(pool) as conn:
            if actor_uid is not None:
                # Transaction-local here (the real one sets it for the session it then closes).
                conn.execute("select set_config('app.actor_uid', %s, true)", (str(actor_uid),))
            yield conn

    dbmod.psycopg, dbmod.connect = Shim, connect  # type: ignore[assignment]
    try:
        yield
    finally:
        dbmod.psycopg, dbmod.connect = real_psycopg, real_connect
        pool.close()


@pytest.fixture(scope="package", autouse=True)
def _messages_are_recorded() -> Iterator[None]:
    real = notify.send_email, notify.send_whatsapp, notify.send_sms

    def email(to: str, subject: str, html_body: str, text: str) -> notify.SendResult:
        SENT.append({"channel": "email", "to": to, "subject": subject, "html": html_body, "text": text})
        return notify.SendResult("sent", provider_id="uat")

    def whatsapp(to: str | None, template: str, params: list[str], **kw: Any) -> notify.SendResult:
        SENT.append({"channel": "whatsapp", "to": to, "template": template, "params": params, **kw})
        return notify.SendResult("sent", provider_id="uat")

    def sms(to: str | None, text: str) -> notify.SendResult:
        SENT.append({"channel": "sms", "to": to, "text": text})
        return notify.SendResult("sent", provider_id="uat")

    notify.send_email, notify.send_whatsapp, notify.send_sms = email, whatsapp, sms  # type: ignore[assignment]
    try:
        yield
    finally:
        notify.send_email, notify.send_whatsapp, notify.send_sms = real  # type: ignore[assignment]


@pytest.fixture(autouse=True)
def _onemap(monkeypatch: pytest.MonkeyPatch) -> None:
    site = onemap.Location(
        address="53 ANG MO KIO AVENUE 3 SINGAPORE 569933",
        postal_code="569933",
        lat=world_mod.SITE[0],
        lng=world_mod.SITE[1],
    )
    monkeypatch.setattr(onemap, "resolve", lambda _a, _p: site)


@pytest.fixture(scope="package")
def world(_pooled_database: None) -> Iterator[world_mod.World]:
    w = world_mod.build()
    try:
        yield w
    finally:
        w.close()


@pytest.fixture(scope="package")
def api(_pooled_database: None) -> Iterator[TestClient]:
    import index

    with TestClient(index.app) as c:
        yield c


class Cached:
    """GET responses that many tests read, fetched once per person and project."""

    def __init__(self, api: TestClient, w: world_mod.World) -> None:
        self.api, self.w = api, w
        self.store: dict[tuple[str, str, str], tuple[int, Any]] = {}

    def get(self, path: str, actor: str, state: str) -> tuple[int, Any]:
        key = (path, actor, state)
        if key not in self.store:
            r = self.api.get(path.format(pid=self.w.pid[state]), headers=self.w.h(actor), follow_redirects=False)
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else None
            self.store[key] = (r.status_code, body)
        return self.store[key]


@pytest.fixture(scope="package")
def cached(api: TestClient, world: world_mod.World) -> Cached:
    return Cached(api, world)
