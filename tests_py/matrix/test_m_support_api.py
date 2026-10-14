# ruff: noqa: E501  (case tables read better whole)
"""Matrix: who may do what in a support conversation, through the real API and database.

Six people (the asker, someone brought in, the handling manager, another
manager, a superadmin, a stranger) x four states (with the assistant,
waiting, open, settled) x ten actions, each against the rule in docs/support.md.

Run with: npm run test:matrix
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from _lib import assistant
from conftest import TEST_OWNER_URL, bearer

PEOPLE = ["asker", "guest", "handler", "other_pm", "superadmin", "stranger"]
STATES = ["assistant", "waiting", "open", "settled"]
ACTIONS = ["view", "read", "write", "ask_person", "add", "remove", "settle", "reopen", "assign", "call"]
SEES = {"asker", "guest", "handler", "superadmin"}
HANDLES = {"handler", "superadmin"}


def expected(who: str, state: str, action: str) -> int:
    """The rule, as docs/support.md says it."""
    settled = state == "settled"
    if who not in SEES:
        return 404  # not theirs to know about
    if action in ("view", "read"):
        return 200
    if action == "write":
        if who == "asker":
            return 200  # writing again reopens a settled one
        return 409 if settled else 200
    if action == "ask_person":
        if who != "asker":
            return 403
        return 200 if state == "assistant" else 409
    if action in ("add", "remove", "assign", "call"):
        if who not in HANDLES:
            return 403
        return 409 if settled else 200
    if action == "settle":
        if who not in HANDLES and who != "asker":
            return 403
        return 409 if settled else 200
    if action == "reopen":
        if who not in HANDLES and who != "asker":
            return 403
        return 200 if settled else 409
    raise AssertionError(action)


CASES = [(w, s, a) for w in PEOPLE for s in STATES for a in ACTIONS]


@pytest.fixture(scope="module")
def world() -> Iterator[dict[str, Any]]:
    tag = uuid.uuid4().hex[:8]
    conn = psycopg.connect(TEST_OWNER_URL, row_factory=dict_row, autocommit=True)
    roles = {"asker": "homeowner", "guest": "contractor", "handler": "project_manager", "other_pm": "project_manager",
             "superadmin": "superadmin", "stranger": "homeowner", "extra": "epc_team", "pm2": "project_manager"}  # fmt: skip
    u = {}
    for key, role in roles.items():
        u[key] = conn.execute(
            "insert into users (email, user_type, full_name, clerk_user_id) values (%s, %s, %s, %s) returning *",
            (f"matrix-{key}-{tag}@example.com", role, f"Matrix {key}", f"user_matrix_{key}_{tag}"),
        ).fetchone()
    pid = conn.execute(
        "insert into projects (name, address, postal_code, homeowner_id, homeowner_contact_no, project_manager_id, "
        "installation_start_date, target_end_date, status) values ('Matrix House', '1 Matrix Road', '569933', %s, '+65 9000 0000', %s, "
        "current_date, current_date + 21, 'in_progress') returning project_id",
        (u["asker"]["uid"], u["handler"]["uid"]),
    ).fetchone()["project_id"]
    import index

    with TestClient(index.app) as client:
        yield {"conn": conn, "u": u, "pid": pid, "client": client}
    uids = [x["uid"] for x in u.values()]
    conn.execute("delete from support_threads where project_id = %s", (pid,))
    conn.execute("delete from projects where project_id = %s", (pid,))
    conn.execute("delete from users u where uid = any(%s) and not exists (select 1 from audit_log a where a.actor_uid = u.uid)", (uids,))
    conn.execute("update users set active = false, clerk_user_id = null where uid = any(%s)", (uids,))
    conn.close()


@pytest.fixture(autouse=True)
def no_claude(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(assistant, "configured", lambda: False)
    monkeypatch.setattr(assistant, "faq", lambda: [])


def conversation(w: dict[str, Any], state: str) -> int:
    c, u = w["conn"], w["u"]
    tid = c.execute(
        "insert into support_threads (subject, opened_by, project_id, handled_by, status, asked_at, settled_at) "
        "values ('Matrix question', %s, %s, %s, %s, case when %s <> 'assistant' then now() end, case when %s = 'settled' then now() end) "
        "returning thread_id",
        (u["asker"]["uid"], w["pid"], None if state == "assistant" else u["handler"]["uid"], state, state, state),
    ).fetchone()["thread_id"]
    for k in ("asker", "guest") + (("handler",) if state != "assistant" else ()):
        c.execute("insert into support_members (thread_id, user_id) values (%s, %s)", (tid, u[k]["uid"]))
    c.execute("insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'text', 'Matrix?')", (tid, u["asker"]["uid"]))
    return tid


@pytest.mark.parametrize(("who", "state", "action"), CASES, ids=[f"{w}-{s}-{a}" for w, s, a in CASES])
def test_who_may_do_what(world, who, state, action) -> None:
    u, client = world["u"], world["client"]
    tid = conversation(world, state)
    h = bearer(u[who]["clerk_user_id"])
    base = f"/api/py/support/{tid}"
    calls = {
        "view": lambda: client.get(base, headers=h),
        "read": lambda: client.post(f"{base}/read", headers=h),
        "write": lambda: client.post(f"{base}/messages", headers=h, json={"body": "Hello"}),
        "ask_person": lambda: client.post(f"{base}/ask-person", headers=h),
        "add": lambda: client.post(f"{base}/members", headers=h, json={"uid": u["extra"]["uid"]}),
        "remove": lambda: client.delete(f"{base}/members/{u['guest']['uid']}", headers=h),
        "settle": lambda: client.post(f"{base}/settle", headers=h),
        "reopen": lambda: client.post(f"{base}/reopen", headers=h),
        "assign": lambda: client.post(f"{base}/assign", headers=h, json={"uid": u["pm2"]["uid"]}),
        "call": lambda: client.post(f"{base}/call", headers=h, json={"link": "https://meet.google.com/abc-defg-hij"}),
    }
    r = calls[action]()
    assert r.status_code == expected(who, state, action), r.text
