"""Set up another company's copy of the app on a fresh database (docs/editions.md).

    node scripts/py.mjs scripts/new_edition.py --target PROD_GETAPPS_MIGRATION_DATABASE_URL \\
        --person darrentay@9solarfintech.com --company "9 Solar Fintech" --confirm

Run AFTER the migrations (npm run db:migrate -- --key=PROD_GETAPPS_MIGRATION_DATABASE_URL --confirm) and
the app's database roles (scripts/create-app-role.ts, scripts/create_backup_role.py) on that database.

It refuses unless the database is fresh (no accounts at all). Then it:
  - adds the one superadmin, with their details taken from their account in 9 Solar Home's app (name,
    mobile, address, postal code, IC last 4, language, notification settings). Not taken: the sign-in
    link (the new app has its own sign-in; their account links itself by email on first sign-in), the
    profile picture (it's in the other company's file store), or the privacy notice they agreed to (the
    new company's is its own: they're asked once);
  - sets the invoice settings' company name.

Prints names of nothing but the one account it adds.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent.parent
COPIED = ("full_name", "contact_no", "ic_last4", "address", "postal_code", "language", "notification_prefs")


def env(key: str) -> str:
    for line in (ROOT / ".env.local").read_text(encoding="utf8").splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit(f"{key} isn't in .env.local")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, help="the new database's OWNER url key in .env.local")
    ap.add_argument("--person", required=True, help="the superadmin's email (as in 9 Solar Home's app)")
    ap.add_argument("--company", required=True, help="the company name for invoices")
    ap.add_argument("--source", default="PROD_DATABASE_URL", help="9 Solar Home's database (read only)")
    ap.add_argument("--confirm", action="store_true")
    a = ap.parse_args()
    if a.target in ("PROD_MIGRATION_DATABASE_URL", "PROD_DATABASE_URL", a.source):
        sys.exit("That's 9 Solar Home's own database. The target must be the new company's.")

    with psycopg.connect(env(a.source), row_factory=dict_row) as src:
        person = src.execute(
            f"select {', '.join(COPIED)} from users where lower(email) = lower(%s)", (a.person,)
        ).fetchone()
    if not person:
        sys.exit(f"No account with {a.person} in the source database.")

    with psycopg.connect(env(a.target), row_factory=dict_row) as dst:
        n = dst.execute("select count(*) as n from users").fetchone()["n"]
        if n:
            sys.exit(f"The target database already has {n} accounts; this is only for a fresh one. Nothing changed.")
        print(f"Will add {a.person} ({person['full_name']}) as the only superadmin, and name the company {a.company}.")
        if not a.confirm:
            print("Add --confirm to do it.")
            return
        with dst.transaction():
            vals = {k: (Jsonb(v) if k == "notification_prefs" and v is not None else v) for k, v in person.items()}
            cols = ["email", "user_type", *vals]
            dst.execute(
                f"insert into users ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})",
                (a.person.lower(), "superadmin", *vals.values()),
            )
            dst.execute("update finance_settings set company_name = %s where id = 1", (a.company,))
        print("Done: 1 superadmin; invoice company name set.")


if __name__ == "__main__":
    main()
