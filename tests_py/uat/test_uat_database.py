"""UAT · the database's own rules, without the app in front of them.

The API is one way in; the database refuses the same things on its own, so a
bug in the app (or someone with the app's database login) still can't skip
a step. Each test acts as one person, through the app's least-privilege
role, tries one change, and rolls it back whatever happens.
"""

from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row

from conftest import TEST_APP_URL
from uat import spec

pytestmark = pytest.mark.uat


@pytest.fixture(scope="module")
def app_db() -> Iterator[psycopg.Connection]:
    with psycopg.connect(TEST_APP_URL, row_factory=dict_row) as c:
        yield c


def attempt(conn: psycopg.Connection, actor_uid: int | None, sql: str, params: tuple) -> str | None:
    """Runs one statement as ``actor_uid`` and rolls back. None if it went through, else the SQLSTATE."""
    try:
        with conn.transaction():
            conn.execute("select set_config('app.actor_uid', %s, true)", ("" if actor_uid is None else str(actor_uid),))
            conn.execute(sql, params)
            raise _UndoError
    except _UndoError:
        return None
    except psycopg.Error as exc:
        return exc.sqlstate or "error"


class _UndoError(Exception):
    pass


STATUS_GRID = [(a, s, to) for a in spec.ACTORS for s in spec.STATE_KEYS for to in spec.STATUSES]


@pytest.mark.parametrize(("actor", "state", "to"), STATUS_GRID, ids=[f"{a}-{s}-to-{t}" for a, s, t in STATUS_GRID])
def test_status_change(app_db, world, actor, state, to) -> None:
    pid = world.pid[state]
    got = attempt(app_db, world.uid(actor), "update projects set status = %s where project_id = %s", (to, pid))
    signed = spec.STATUS[state] in ("signed", "closed")
    allowed = spec.db_status_change(actor, state, to, homeowner_signed=signed)
    assert (got is None) == allowed, got
    if not allowed:
        assert got == "42501", "refused as not allowed, not as a crash"


@pytest.mark.parametrize(("actor", "state"), [(a, s) for a in spec.ACTORS for s in spec.STATE_KEYS])
def test_signing_in_the_database(app_db, world, actor, state) -> None:
    pid = world.pid[state]
    got = attempt(
        app_db,
        world.uid(actor),
        "insert into project_signatures (project_id, signed_by, signature_url, certificate_hash) values (%s, %s, 'k', 'h')",
        (pid, world.uid(actor)),
    )
    if spec.db_signature_insert(actor, state):
        assert got is None
    else:
        assert got in ("42501", "P0001", "23505"), got


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("state", ["signed", "closed"])
@pytest.mark.parametrize("op", ["update", "delete"])
def test_a_signature_is_never_changed_or_removed(app_db, world, actor, state, op) -> None:
    pid = world.pid[state]
    sql = (
        "update project_signatures set signer_name = 'Someone else' where project_id = %s"
        if op == "update"
        else "delete from project_signatures where project_id = %s"
    )
    assert attempt(app_db, world.uid(actor), sql, (pid,)) == "42501"


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_nobody_signs_as_someone_else(app_db, world, actor) -> None:
    pid = world.pid["awaiting_signature"]
    got = attempt(
        app_db,
        world.uid(actor),
        "insert into project_signatures (project_id, signed_by, signature_url, certificate_hash) values (%s, %s, 'k', 'h')",
        (pid, world.uid("ho") if actor != "ho" else world.uid("ho2")),
    )
    assert got == "42501"


FILE_GRID = [(a, s) for a in spec.ACTORS for s in spec.STATE_KEYS]


@pytest.mark.parametrize(("actor", "state"), FILE_GRID, ids=[f"{a}-{s}" for a, s in FILE_GRID])
def test_adding_a_file_in_the_database(app_db, world, actor, state) -> None:
    pid = world.pid[state]
    got = attempt(
        app_db,
        world.uid(actor),
        "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by, kind) "
        "values (%s, 'handover_docs', 'projects/x/documents/handover_docs/x.pdf', 'x.pdf', 'application/pdf', 10, %s, "
        "'document')",
        (pid, world.uid(actor)),
    )
    rel = spec.relation(actor, state)
    allowed = rel == "pm" or (rel == "crew" and spec.STATUS[state] not in spec.AT_HANDOVER)
    assert (got is None) == allowed, got


@pytest.mark.parametrize(("actor", "state"), FILE_GRID, ids=[f"{a}-{s}" for a, s in FILE_GRID])
def test_changing_a_field_in_the_database(app_db, world, actor, state) -> None:
    pid = world.pid[state]
    got = attempt(app_db, world.uid(actor), "update projects set sales = 'UAT' where project_id = %s", (pid,))
    rel = spec.relation(actor, state)
    allowed = rel == "pm" or (rel == "crew" and spec.STATUS[state] not in spec.AT_HANDOVER)
    assert (got is None) == allowed, got


@pytest.mark.parametrize(("actor", "state"), FILE_GRID, ids=[f"{a}-{s}" for a, s in FILE_GRID])
def test_closing_stamps_who_and_when(app_db, world, actor, state) -> None:
    """Only from signed, only by whoever runs the project; the database records who closed it and when."""
    pid = world.pid[state]
    uid = world.uid(actor)
    try:
        with app_db.transaction():
            app_db.execute("select set_config('app.actor_uid', %s, true)", (str(uid),))
            app_db.execute("update projects set status = 'closed' where project_id = %s", (pid,))
            row = app_db.execute("select closed_at, closed_by from projects where project_id = %s", (pid,)).fetchone()
            raise _UndoError(row)
    except _UndoError as done:
        row = done.args[0]
        allowed = spec.db_status_change(actor, state, "closed", homeowner_signed=True)
        assert allowed
        if spec.STATUS[state] != "closed":
            assert row["closed_by"] == uid and row["closed_at"] is not None
    except psycopg.Error as exc:
        assert not spec.db_status_change(actor, state, "closed", homeowner_signed=True), exc
        assert exc.sqlstate == "42501"


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("state", spec.STATE_KEYS)
def test_asking_for_the_signature_in_the_database(app_db, world, actor, state) -> None:
    """request_handover_signature(): only someone on the project, only with Milestone 3 recorded."""
    pid = world.pid[state]
    got = attempt(app_db, world.uid(actor), "select request_handover_signature(%s)", (pid,))
    rel = spec.relation(actor, state)
    if rel not in ("pm", "crew"):
        assert got == "42501"
    elif spec.RECORDED[state] < 3:
        assert got == "P0001", "Milestone 3 isn't complete yet"
    else:
        assert got is None, "allowed; it changes nothing once the project is past working"
