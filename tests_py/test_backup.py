# ruff: noqa: E501  (SQL reads better whole)
"""Backups (scripts/backup.py, scripts/restore.py, docs/backups.md).

backup     every table, in one moment, with each table's rows and checksum; nothing written
order      a restore loads tables after the ones they point at; a loop is refused, not guessed
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tarfile
from pathlib import Path

import pytest

from conftest import TEST_OWNER_URL

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bk = _load("backup")
rs = _load("restore")


def test_a_backup_holds_every_table_with_its_rows_and_checksum(tmp_path, fx):
    path = bk.backup(TEST_OWNER_URL, "test", tmp_path, "pytest")
    with tarfile.open(path) as tar:
        m = json.loads(tar.extractfile("manifest.json").read())
        for t, info in m["tables"].items():
            data = tar.extractfile(f"tables/{t}.csv").read()
            assert hashlib.sha256(data).hexdigest() == info["sha256"], t
    live = {
        r["table_name"]
        for r in fx.conn.execute(
            "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
        )
    }
    assert set(m["tables"]) == live
    assert m["reason"] == "pytest" and m["migrations"] and "audit_log" in m["tables"]
    users = fx.conn.execute("select count(*) as n from users").fetchone()["n"]
    assert abs(m["tables"]["users"]["rows"] - users) <= 5  # other tests may add a few meanwhile


def test_tables_load_after_what_they_point_at():
    deps = {
        "users": set(),
        "projects": {"users"},
        "project_files": {"projects", "users"},
        "meetings": {"projects", "users"},
    }
    out = rs.order(deps)
    assert out.index("users") < out.index("projects") < out.index("project_files")
    assert out.index("projects") < out.index("meetings")


def test_a_loop_is_refused():
    with pytest.raises(SystemExit, match="point at each other"):
        rs.order({"a": {"b"}, "b": {"a"}})


def test_the_real_schema_has_a_load_order(fx):
    with fx.conn.cursor() as cur:
        names = bk.tables(cur)
        out = rs.load_order(cur, names)
    assert sorted(out) == sorted(names)
    assert out.index("users") < out.index("projects") < out.index("project_files")
