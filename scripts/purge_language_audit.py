"""Deletes audit log entries that only record someone switching the app's language.

    node scripts/py.mjs scripts/purge_language_audit.py --target prod            (counts only)
    node scripts/py.mjs scripts/purge_language_audit.py --target prod --confirm  (deletes them)

Since migration 0040 these aren't recorded, and the Audit page hides the
earlier ones, so this is only for clearing them out of the database for good.
It takes a restore point first (scripts/backup.py), deletes only entries
about an account whose every change is the language (or its updated_at),
and prints how many. The audit log is append-only, so its delete guard is
lifted for this one statement, inside one transaction.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from backup import URLS, _from_env_file  # noqa: E402

WHERE = (
    "entity_table = 'users' and action = 'update' "
    "and (coalesce(changes, '{}'::jsonb) - 'language' - 'updated_at') = '{}'::jsonb"
)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--confirm", action="store_true", help="delete them (otherwise only counts)")
    a = ap.parse_args()
    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    with psycopg.connect(url) as conn:
        n = conn.execute(f"select count(*) from audit_log where {WHERE}").fetchone()[0]
        print(f"{a.target}: {n} audit entries only record a language switch.")
        if not a.confirm or not n:
            print("Nothing deleted." if n else "Nothing to do.")
            return
    print("Taking a restore point first…")
    backup = [sys.executable, str(ROOT / "scripts" / "backup.py"), "--target", a.target]
    done = subprocess.run([*backup, "--reason", "before removing language-only audit entries"])
    if done.returncode:
        sys.exit("The restore point failed, so nothing was deleted.")
    with psycopg.connect(url) as conn, conn.transaction():
        conn.execute("alter table audit_log disable trigger audit_log_no_delete")
        gone = conn.execute(f"delete from audit_log where {WHERE}").rowcount
        conn.execute("alter table audit_log enable trigger audit_log_no_delete")
    print(f"Deleted {gone} language-only audit entries.")


if __name__ == "__main__":
    main()
