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


# ------------------------------------------------------------------ essential records (0050)


def _system(fx, years_ago: int, *, plan: int | None = 8, ppa: int | None = None, pid=None, ho=None) -> int:
    return fx.conn.execute(
        "insert into maintenance_systems (address, project_id, homeowner_id, turned_on_on, plan_years, ppa_years) "
        "values ('1 Retention Road', %s, %s, current_date - make_interval(years => %s), %s, %s) returning system_id",
        (pid, ho, years_ago, plan, ppa),
    ).fetchone()["system_id"]


def _project(fx, ho=None, years_ago: int = 0) -> int:
    return fx.conn.execute(
        "insert into projects (address, name, homeowner_id, homeowner_name, homeowner_contact_no, "
        "installation_start_date, target_end_date, created_at, updated_at) values "
        "('1 Retention Road', 'Retention test', %s, 'Retention Test', '+65 9555 0199', current_date, current_date + 30, "
        "now() - make_interval(years => %s), now() - make_interval(years => %s)) returning project_id",
        (ho, years_ago, years_ago),
    ).fetchone()["project_id"]


def test_essential_records_go_5_years_after_the_8_year_plan(fx, clean) -> None:
    ho = fx.user("homeowner", contact_no="+65 9555 0101")
    pid = _project(fx, ho["uid"], 14)
    old = _system(fx, 14, pid=pid, ho=ho["uid"])  # turned on 14 years ago: 8 + 5 have passed
    fx.conn.execute(
        "insert into project_files (project_id, category, url, file_name) values (%s, 'utility_bill', %s, 'bill.pdf')",
        (pid, f"projects/{pid}/documents/utility_bill/retention-test.pdf"),
    )
    young = _system(fx, 12)  # 12 years: the 5 after the plan aren't over
    long_ppa = _system(fx, 20, ppa=25)  # a 25-year PPA still running
    counts = retention.run()

    assert not exists(fx, "maintenance_systems", "system_id", old)
    assert not exists(fx, "projects", "project_id", pid)
    assert not exists(fx, "project_files", "project_id", pid)
    assert exists(fx, "maintenance_systems", "system_id", young)
    assert exists(fx, "maintenance_systems", "system_id", long_ppa)
    assert counts["systems"] >= 1 and counts["projects"] >= 1 and counts["files"] >= 1
    # The homeowner, with nothing left, keeps no personal details.
    u = fx.conn.execute(
        "select full_name, contact_no, email, active from users where uid = %s", (ho["uid"],)
    ).fetchone()
    assert u["full_name"] == "Former customer" and u["contact_no"] is None and not u["active"]
    assert u["email"].endswith("@invalid.example")
    fx.conn.execute("delete from maintenance_systems where system_id = any(%s)", ([young, long_ppa],))


def test_a_project_that_never_became_a_system_goes_after_13_years(fx, clean) -> None:
    old, recent = _project(fx, years_ago=14), _project(fx, years_ago=12)
    retention.run()
    assert not exists(fx, "projects", "project_id", old)
    assert exists(fx, "projects", "project_id", recent)
    fx.conn.execute("delete from projects where project_id = %s", (recent,))


def test_staff_uploads_with_no_project_are_kept(fx, clean) -> None:
    staff = fx.user("project_manager")
    fid = fx.conn.execute(
        "insert into unassigned_files (url, file_name, content_type, size_bytes, kind, uploaded_by, uploaded_at) "
        "values ('unassigned/retention-test.pdf', 'old.pdf', 'application/pdf', 10, 'document', %s, now() - interval '20 years') "
        "returning file_id",
        (staff["uid"],),
    ).fetchone()["file_id"]
    retention.run()
    assert exists(fx, "unassigned_files", "file_id", fid)
    fx.conn.execute("delete from unassigned_files where file_id = %s", (fid,))


def test_audit_entries_about_deleted_records_go_after_13_years(fx, clean) -> None:
    here = _project(fx)

    def entry(pid: int, years_ago: int) -> int:
        return fx.conn.execute(
            "insert into audit_log (action, entity_table, entity_id, entity_key, occurred_at, changes) "
            "values ('update', 'projects', %s, jsonb_build_object('project_id', %s), now() - make_interval(years => %s), '{}') "
            "returning audit_id",
            (str(pid), pid, years_ago),
        ).fetchone()["audit_id"]

    gone_old = entry(2_000_000_000, 14)  # the record is gone and the entry is 13+ years old
    gone_new = entry(2_000_000_001, 12)  # the record is gone, but not 13 years yet
    still_there = entry(here, 14)  # 13+ years old, but the record still exists
    retention.run()
    assert not exists(fx, "audit_log", "audit_id", gone_old)
    assert exists(fx, "audit_log", "audit_id", gone_new)
    assert exists(fx, "audit_log", "audit_id", still_there)
    fx.conn.execute("delete from projects where project_id = %s", (here,))


def test_only_the_purge_may_remove_audit_entries(fx) -> None:
    with pytest.raises(psycopg.Error):
        fx.conn.execute("delete from audit_log where audit_id = (select min(audit_id) from audit_log)")
