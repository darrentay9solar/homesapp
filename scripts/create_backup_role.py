# ruff: noqa: E501  (SQL and messages read better whole)
"""Creates the read-only login the nightly backup uses: `python scripts/create_backup_role.py --target prod`.

    gethomeapps_backup   reads every row (the audit log too), writes nothing

It can read past row-level security, because a backup that skipped the audit
log wouldn't be a backup; it can't insert, change or delete anything, or
alter the schema. Its connection string goes into .env.local as
BACKUP_DATABASE_URL (prod) or BACKUP_DATABASE_URL_<TARGET>, and, with
--github, into the repository's Actions secrets for the nightly job, along
with BACKUP_PASSPHRASE (the key the nightly backups are encrypted with: keep
a copy in your password manager, or the backups can't be opened).

Safe to run again: it gives the role a new password. Passwords are never printed.
"""

from __future__ import annotations

import argparse
import re
import secrets
import string
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
from _lib.db import _from_env_file  # noqa: E402

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}
ROLE = "gethomeapps_backup"
ENV = ROOT / ".env.local"


def password(n: int = 40) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def set_env(key: str, value: str) -> None:
    """Adds or replaces one line in .env.local without showing the file."""
    text = ENV.read_text(encoding="utf-8") if ENV.exists() else ""
    line = f'{key}="{value}"'
    if re.search(rf"^{re.escape(key)}=.*$", text, flags=re.M):
        text = re.sub(rf"^{re.escape(key)}=.*$", lambda _: line, text, flags=re.M)
    else:
        text = text.rstrip("\n") + f"\n{line}\n"
    ENV.write_text(text, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument(
        "--github", action="store_true", help="also store it (and a new BACKUP_PASSPHRASE) as GitHub Actions secrets"
    )
    a = ap.parse_args()
    owner = _from_env_file(URLS[a.target])
    if not owner:
        sys.exit(f"{URLS[a.target]} isn't in .env.local")
    if a.github and a.target != "prod":
        sys.exit("The nightly job backs up production only.")

    pw = password()
    with psycopg.connect(owner, autocommit=True) as c:
        exists = c.execute("select 1 from pg_roles where rolname = %s", (ROLE,)).fetchone()
        verb = "alter" if exists else "create"
        c.execute(
            sql.SQL(f"{verb} role {{}} with login bypassrls nocreatedb nocreaterole password {{}}").format(
                sql.Identifier(ROLE), sql.Literal(pw)
            )
        )
        db = c.execute("select current_database()").fetchone()[0]
        c.execute(sql.SQL("grant connect on database {} to {}").format(sql.Identifier(db), sql.Identifier(ROLE)))
        c.execute(sql.SQL("grant pg_read_all_data to {}").format(sql.Identifier(ROLE)))
        # Belt and braces: nothing it could write to, even by mistake.
        c.execute(sql.SQL("revoke pg_write_all_data from {}").format(sql.Identifier(ROLE)))
        c.execute(sql.SQL("alter role {} set default_transaction_read_only = on").format(sql.Identifier(ROLE)))

    parts = urlsplit(owner)
    host = parts.netloc.split("@", 1)[1]
    url = urlunsplit((parts.scheme, f"{ROLE}:{quote(pw, safe='')}@{host}", parts.path, parts.query, parts.fragment))
    # It works, and it can't write.
    with psycopg.connect(url) as c:
        c.execute("select count(*) from audit_log").fetchone()
        try:
            c.execute("create temp table _x (i int)")
            c.execute("insert into users (email) values ('nope@example.com')")
            sys.exit("The backup role could write. Stopped.")
        except psycopg.Error:
            c.rollback()

    key = "BACKUP_DATABASE_URL" if a.target == "prod" else f"BACKUP_DATABASE_URL_{a.target.upper()}"
    set_env(key, url)
    print(f"{ROLE} is ready on {a.target}: reads everything, writes nothing. Saved as {key} in .env.local.")

    if a.github:
        phrase = _from_env_file("BACKUP_PASSPHRASE") or password(48)
        set_env("BACKUP_PASSPHRASE", phrase)
        for name, value in (("BACKUP_DATABASE_URL", url), ("BACKUP_PASSPHRASE", phrase)):
            r = subprocess.run(
                ["gh", "secret", "set", name, "--repo", "darrentay9solar/homesapp"],
                input=value,
                text=True,
                capture_output=True,
            )
            print(f"GitHub secret {name}: {'set' if r.returncode == 0 else 'FAILED ' + r.stderr.strip()[:200]}")
        print(
            "Keep BACKUP_PASSPHRASE (in .env.local) in your password manager too: without it the nightly backups can't be opened."
        )


if __name__ == "__main__":
    main()
