# ruff: noqa: E501  (SQL reads better whole)
"""Puts a database back exactly as a backup (scripts/backup.py) had it.

    python scripts/restore.py backups/gethomeapps-prod-20261012-020000.tar.gz --target dev            # what it would do
    python scripts/restore.py backups/gethomeapps-prod-20261012-020000.tar.gz --target dev --apply    # do it

Without --apply nothing is written: it says what would change, table by
table. With --apply it first backs up the database it's about to replace
(so a restore can itself be undone), then, in one transaction, empties every
table and loads the backup's rows, ids and sequences included. The
database's own rules (who may write, the audit log) are paused for those few
seconds and switched back on; anything that fails rolls the whole thing
back. Production also needs --confirm-restore-production.

The database must have the same migrations as the backup; restore into a
fresh Neon branch made from production, or migrate first.
"""

from __future__ import annotations

import argparse
import json
import sys
import tarfile
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from backup import URLS, _from_env_file, backup, migrations, tables  # noqa: E402


def load_order(cur: psycopg.Cursor, names: list[str]) -> list[str]:
    """Tables ordered so each comes after the tables it points at (a table pointing at itself is fine)."""
    deps: dict[str, set[str]] = {t: set() for t in names}
    for r in cur.execute(
        "select c.conrelid::regclass::text as t, c.confrelid::regclass::text as ref from pg_constraint c "
        "join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname = 'public'"
    ):
        t, ref = r["t"].strip('"'), r["ref"].strip('"')
        if t in deps and ref in deps and t != ref:
            deps[t].add(ref)
    return order(deps)


def order(deps: dict[str, set[str]]) -> list[str]:
    out: list[str] = []
    left = {t: set(d) for t, d in deps.items()}
    while left:
        ready = sorted(t for t, d in left.items() if not d)
        if not ready:
            raise SystemExit(f"These tables point at each other, so there's no order to load them in: {sorted(left)}")
        for t in ready:
            out.append(t)
            del left[t]
        for d in left.values():
            d.difference_update(ready)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", help="a backup made by scripts/backup.py")
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--apply", action="store_true", help="actually restore (otherwise: only say what would change)")
    ap.add_argument("--confirm-restore-production", action="store_true")
    a = ap.parse_args()

    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't in .env.local")
    if a.target == "prod" and a.apply and not a.confirm_restore_production:
        sys.exit("Restoring production replaces everything in it. Add --confirm-restore-production.")

    with tarfile.open(a.file) as tar:
        manifest = json.loads(tar.extractfile("manifest.json").read())  # type: ignore[union-attr]
        data = {t: tar.extractfile(f"tables/{t}.csv").read() for t in manifest["tables"]}  # type: ignore[union-attr]

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        have = migrations(cur)
        if have != manifest["migrations"]:
            sys.exit(
                f"The {a.target} database has {len(have)} migrations, the backup {len(manifest['migrations'])}. Bring them to the same migration first."
            )
        live = tables(cur)
        if sorted(live) != sorted(manifest["tables"]):
            sys.exit(
                f"Tables differ: only in the database {sorted(set(live) - set(manifest['tables']))}, only in the backup {sorted(set(manifest['tables']) - set(live))}"
            )
        for t in live:
            cols = [
                r["c"]
                for r in cur.execute(
                    "select column_name as c from information_schema.columns where table_schema = 'public' and table_name = %s order by ordinal_position",
                    (t,),
                )
            ]
            if cols != manifest["tables"][t]["columns"]:
                sys.exit(f"{t}'s columns differ from the backup's.")
        print(
            f"Backup of {manifest['label']} taken {manifest['takenAt']}{' (' + manifest['reason'] + ')' if manifest.get('reason') else ''}"
        )
        print(f"{'table':32} {'now':>8} {'backup':>8}")
        for t in sorted(live):
            now = cur.execute(sql.SQL("select count(*) as n from {}").format(sql.Identifier(t))).fetchone()["n"]
            then = manifest["tables"][t]["rows"]
            print(f"{t:32} {now:>8} {then:>8}{'' if now == then else '  <- changes'}")
        conn.rollback()
        if not a.apply:
            print("\nNothing written. Add --apply to restore.")
            return

        safety = backup(url, a.target, ROOT / "backups", f"before restoring {Path(a.file).name}")
        print(f"\nFirst, the {a.target} database as it is now: {safety}")

        names = load_order(cur, live)
        conn.rollback()
        with conn.transaction():
            # The rules (who may write, the audit log's no-change guards) pause; foreign keys still hold.
            for t in names:
                cur.execute(sql.SQL("alter table {} disable trigger user").format(sql.Identifier(t)))
            cur.execute(
                sql.SQL("truncate {} restart identity cascade").format(
                    sql.SQL(", ").join(sql.Identifier(t) for t in names)
                )
            )
            for t in names:
                cols = sql.SQL(", ").join(sql.Identifier(c) for c in manifest["tables"][t]["columns"])
                with cur.copy(
                    sql.SQL("copy {} ({}) from stdin with (format csv, header true)").format(sql.Identifier(t), cols)
                ) as copy:
                    copy.write(data[t])
            for seq, v in manifest["sequences"].items():
                if v["last_value"] is None:
                    cur.execute("select setval(%s::regclass, %s, false)", (seq, v["start_value"]))
                else:
                    cur.execute("select setval(%s::regclass, %s, true)", (seq, v["last_value"]))
            for t in names:
                cur.execute(sql.SQL("alter table {} enable trigger user").format(sql.Identifier(t)))
            for t in names:
                n = cur.execute(sql.SQL("select count(*) as n from {}").format(sql.Identifier(t))).fetchone()["n"]
                if n != manifest["tables"][t]["rows"]:
                    raise SystemExit(
                        f"{t}: {n} rows loaded, the backup has {manifest['tables'][t]['rows']}. Nothing was changed."
                    )
        print(
            f"Restored {a.target} to the backup of {manifest['takenAt']}: {sum(t['rows'] for t in manifest['tables'].values())} rows in {len(names)} tables."
        )


if __name__ == "__main__":
    main()
