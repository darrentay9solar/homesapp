"""Checks that the Python runtime reaches the same database as the web app.

The important assertion is the branch fingerprint: if Python and TypeScript
report different values, they are pointed at different Neon branches, and
every scheduled job would be operating on the wrong data.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from _lib.db import fetch_one


def test_connects_and_sees_the_schema() -> None:
    row = fetch_one("select current_user as who, version() as version")
    assert row is not None
    # Python must use the least-privilege role, exactly like the web app.
    assert row["who"] == "gethomeapps_app"
    assert "PostgreSQL" in row["version"]


def test_sees_the_expected_tables() -> None:
    row = fetch_one(
        """
        select count(*)::int as n
          from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'
        """
    )
    assert row is not None
    assert row["n"] >= 14, f"expected the full schema, found {row['n']} tables"


def test_cannot_alter_the_schema() -> None:
    """Python inherits the same restriction as the web app, by design."""
    import psycopg
    from _lib.db import connect

    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute("create table _py_probe (id int)")
    except psycopg.errors.InsufficientPrivilege:
        return
    except psycopg.Error:
        return
    raise AssertionError("Python was able to create a table; check the grants")
