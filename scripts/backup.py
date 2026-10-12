# ruff: noqa: E501  (SQL reads better whole)
"""A copy of every row in the database, as of one moment: `npm run db:backup -- --target prod`.

    python scripts/backup.py --target prod                    # production, into backups/
    python scripts/backup.py --target dev --out somewhere/
    python scripts/backup.py --url-env BACKUP_DATABASE_URL    # the nightly job (GitHub Actions)

The file, `gethomeapps-<target>-<YYYYMMDD-HHMMSS>.tar.gz`, holds each table as
CSV, the sequences' positions, and a manifest: when, which migrations the
database had, and every table's row count and checksum. It's read in one
read-only snapshot, so the tables agree with each other, and nothing is
written. The schema itself is the migrations in git: restore into a database
at the same migration (scripts/restore.py checks).

Real customers' data is in a production backup: it stays on this laptop
(backups/ is ignored by git) or, from the nightly job, encrypted.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import tarfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
from _lib.db import _from_env_file  # noqa: E402

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}
SG = timezone(timedelta(hours=8))
FORMAT = 1


def tables(cur: psycopg.Cursor) -> list[str]:
    return [r["t"] for r in cur.execute(
        "select table_name as t from information_schema.tables "
        "where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
    )]  # fmt: skip


def sequences(cur: psycopg.Cursor) -> dict[str, dict[str, object]]:
    out = {}
    for r in cur.execute(
        "select sequencename as s, last_value, start_value from pg_sequences where schemaname = 'public'"
    ):
        out[r["s"]] = {"last_value": r["last_value"], "start_value": r["start_value"]}
    return out


def migrations(cur: psycopg.Cursor) -> list[str]:
    """The migrations the database has had (drizzle's own record), oldest first."""
    try:
        return [r["hash"] for r in cur.execute("select hash from drizzle.__drizzle_migrations order by created_at, id")]
    except psycopg.errors.UndefinedTable:
        return []


def backup(url: str, label: str, out_dir: Path, reason: str | None = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(SG).strftime("%Y%m%d-%H%M%S")
    path = out_dir / f"gethomeapps-{label}-{stamp}.tar.gz"
    manifest: dict[str, object] = {
        "format": FORMAT,
        "label": label,
        "reason": reason,
        "takenAt": datetime.now(SG).isoformat(),
        "tables": {},
    }
    with psycopg.connect(url, row_factory=dict_row) as conn:
        # One consistent, read-only moment for every table.
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only = True
        with conn.transaction(), conn.cursor() as cur, tarfile.open(path, "w:gz") as tar:
            manifest["serverVersion"] = cur.execute("show server_version").fetchone()["server_version"]
            manifest["database"] = cur.execute("select current_database() as d").fetchone()["d"]
            manifest["migrations"] = migrations(cur)
            manifest["sequences"] = sequences(cur)
            for t in tables(cur):
                cols = [r["c"] for r in cur.execute(
                    "select column_name as c from information_schema.columns "
                    "where table_schema = 'public' and table_name = %s order by ordinal_position", (t,))]  # fmt: skip
                buf = io.BytesIO()
                q = sql.SQL("copy (select * from {}) to stdout with (format csv, header true)").format(
                    sql.Identifier(t)
                )
                with cur.copy(q) as copy:
                    for chunk in copy:
                        buf.write(chunk)
                data = buf.getvalue()
                n = cur.execute(sql.SQL("select count(*) as n from {}").format(sql.Identifier(t))).fetchone()["n"]
                info = tarfile.TarInfo(f"tables/{t}.csv")
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
                manifest["tables"][t] = {
                    "rows": n,
                    "columns": cols,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": len(data),
                }  # type: ignore[index]
            body = json.dumps(manifest, indent=1, default=str).encode()
            info = tarfile.TarInfo("manifest.json")
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, help="which database (.env.local key)")
    ap.add_argument("--url-env", help="read the database URL from this environment variable instead (the nightly job)")
    ap.add_argument("--out", default=str(ROOT / "backups"), help="folder for the file (default: backups/)")
    ap.add_argument("--reason", help="kept in the manifest, e.g. 'before migration 0033'")
    ap.add_argument("--label", help="names the file (default: the target, or prod for --url-env)")
    a = ap.parse_args()
    if bool(a.target) == bool(a.url_env):
        sys.exit("Give one of --target or --url-env.")
    url = (
        (os.environ.get(a.url_env, "").strip() or _from_env_file(a.url_env))
        if a.url_env
        else _from_env_file(URLS[a.target])
    )
    if not url:
        sys.exit(f"{a.url_env or URLS[a.target]} isn't set.")
    label = a.label or a.target or "prod"
    path = backup(url, label, Path(a.out), a.reason)
    with tarfile.open(path) as tar:
        m = json.loads(tar.extractfile("manifest.json").read())  # type: ignore[union-attr]
    total = sum(t["rows"] for t in m["tables"].values())
    print(f"Backed up {label}: {len(m['tables'])} tables, {total} rows, {len(m['migrations'])} migrations -> {path}")


if __name__ == "__main__":
    main()
