# ruff: noqa: E501  (SQL reads better whole)
"""Personal data (PDPA): non-essential data goes a year after it stops being needed (migration 0045)."""

from __future__ import annotations

import psycopg
import pytest

from _lib import retention
from _lib.db import transaction

OLD = "date_trunc('day', now()) - interval '13 months'"
NEW = "date_trunc('day', now()) - interval '11 months'"


@pytest.fixture
def clean(fx):
    """The purge runs at most once in 20 hours: forget earlier runs, so each test runs it afresh."""
    fx.conn.execute("delete from retention_runs")
    yield
    fx.conn.execute("delete from retention_runs")


def notification(fx, uid: int, when: str) -> int:
    return fx.conn.execute(
        f"insert into notifications (recipient_uid, kind, title, body, created_at) "
        f"values (%s, 'account_approved', 't', 'b', {when}) returning notification_id",
        (uid,),
    ).fetchone()["notification_id"]


def exists(fx, table: str, col: str, val: int) -> bool:
    return fx.conn.execute(f"select 1 from {table} where {col} = %s", (val,)).fetchone() is not None


def test_a_year_old_notification_goes_and_a_newer_one_stays(fx, clean) -> None:
    u = fx.user("homeowner")
    old, new = notification(fx, u["uid"], OLD), notification(fx, u["uid"], NEW)
    counts = retention.run()
    assert counts["notifications"] >= 1
    assert not exists(fx, "notifications", "notification_id", old)
    assert exists(fx, "notifications", "notification_id", new)


def test_meetings_and_busy_times_go_a_year_after_they_end_without_copies_in_the_audit_log(fx, clean) -> None:
    u = fx.user("project_manager")
    ids = {}
    for name, when in (("old", OLD), ("new", NEW)):
        ids[name] = fx.conn.execute(
            f"insert into meetings (title, kind, starts_at, ends_at, place, organiser_id) "
            f"values ('Retention test', 'meeting', {when}, {when} + interval '1 hour', 'online', %s) returning meeting_id",
            (u["uid"],),
        ).fetchone()["meeting_id"]
        fx.conn.execute("insert into meeting_people (meeting_id, user_id) values (%s, %s)", (ids[name], u["uid"]))
    block = fx.conn.execute(
        f"insert into calendar_blocks (user_id, starts_at, ends_at) values (%s, {OLD}, {OLD} + interval '2 hours') returning block_id",
        (u["uid"],),
    ).fetchone()["block_id"]
    before = fx.conn.execute("select count(*)::int n from audit_log where action = 'delete'").fetchone()["n"]

    retention.run()

    assert not exists(fx, "meetings", "meeting_id", ids["old"])
    assert not exists(fx, "meeting_people", "meeting_id", ids["old"])
    assert exists(fx, "meetings", "meeting_id", ids["new"])
    assert not exists(fx, "calendar_blocks", "block_id", block)
    # The purge is recorded as a run, not row by row: nothing it deleted is copied into the audit log.
    after = fx.conn.execute("select count(*)::int n from audit_log where action = 'delete'").fetchone()["n"]
    assert after == before
    run = fx.conn.execute("select counts from retention_runs").fetchone()
    assert run["counts"]["meetings"] >= 1
    fx.conn.execute("delete from meetings where meeting_id = %s", (ids["new"],))


def test_decided_requests_go_and_waiting_ones_stay(fx, clean) -> None:
    ids = {}
    for status in ("rejected", "pending"):
        ids[status] = fx.conn.execute(
            f"insert into account_requests (clerk_user_id, email, full_name, requested_type, status, created_at, decided_at) "
            f"values ('user_ret_{status}', 'ret-{status}@example.com', 'Ret Test', 'homeowner', %s, {OLD}, "
            f"case when %s = 'pending' then null else {OLD} end) returning request_id",
            (status, status),
        ).fetchone()["request_id"]
    retention.run()
    assert not exists(fx, "account_requests", "request_id", ids["rejected"])
    assert exists(fx, "account_requests", "request_id", ids["pending"])
    fx.conn.execute("delete from account_requests where request_id = %s", (ids["pending"],))


def test_essential_records_are_never_touched(fx, clean) -> None:
    """Contracts, invoices, signatures, check-ins, files and the audit log are kept, however old."""
    tables = (
        "projects",
        "maintenance_systems",
        "invoices",
        "project_signatures",
        "site_check_ins",
        "project_files",
        "audit_log",
        "users",
    )
    before = {t: fx.conn.execute(f"select count(*)::int n from {t}").fetchone()["n"] for t in tables}
    retention.run()
    after = {t: fx.conn.execute(f"select count(*)::int n from {t}").fetchone()["n"] for t in tables}
    assert after == before


def test_once_a_day(fx, clean) -> None:
    retention.run()
    assert retention.run() == {"skipped": True}


def test_the_app_cannot_mark_its_own_changes_as_a_purge(fx) -> None:
    """Otherwise any change could slip past the audit log."""
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(None) as cur:
        cur.execute("insert into retention_runs (txid) values (txid_current())")
