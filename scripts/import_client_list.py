# ruff: noqa: E501, RUF001  (column lists read better whole; the list writes date ranges with en dashes)
"""Imports 9 Solar Home's project list (the client workbook) into the app.

    node scripts/py.mjs scripts/import_client_list.py "<Project List.xlsx>" --target test --dry-run
    node scripts/py.mjs scripts/import_client_list.py "<Project List.xlsx>" --target prod --confirm

What goes where (migration 0038):

  Clients List        one row per client. Turned on: the client record is added
                      to its maintenance system (matched by postal code and house
                      number; a new one is added if there's none). Not turned on
                      yet: a project in progress, with no project manager yet.
  Actual Solar Output kWh per system per month, and the monthly estimate.
  Billing Period      each system's billing period, and the period per month.
  Feedback            what each homeowner said, on their project or system.
  Inverter Warranties each inverter model's phase, price and warranty.

  Leads and Upfront Buy Price are left out for now.

Before anything is written it checks for duplicates: the same postal code,
address or project code twice in the file, or a postal code already in the
app on a different record. Any of these stops it (--allow-shared-postal for a
block of flats). Running it again changes nothing that's already there except the list's own
columns: a project code already in the app is updated, not duplicated, and
anything set in the app (managers, checks done, notes, milestones) is left
alone. A value it can't read stops it before anything is written, naming the
project code; small fixes (inverter spellings, dates written as text) are
listed. --dry-run writes inside a transaction and rolls it back. Production
needs --confirm. Customer details are only ever read from the file you name
and written to the database; nothing is printed but codes and counts.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import psycopg
from psycopg.rows import dict_row

from _lib.client_list import *  # noqa: F403  (the reading and writing; tests use them through this module)
from _lib.client_list import RowError, read, write
from _lib.db import _from_env_file

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("workbook", type=Path)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--date", help="the list's date, default from the file name (…-2026-10-14.xlsx)")
    ap.add_argument("--dry-run", action="store_true", help="write inside a transaction, then roll it back")
    ap.add_argument("--confirm", action="store_true", help="required for production")
    ap.add_argument("--no-geocode", action="store_true", help="don't look the new projects' sites up on OneMap")
    ap.add_argument("--allow-shared-postal", action="store_true", help="allow two clients at one postal code (a block of flats); otherwise it stops")
    a = ap.parse_args()
    if a.target == "prod" and not (a.confirm or a.dry_run):
        sys.exit("Refusing to import into production without --confirm. Try --dry-run first.")
    m = re.search(r"(\d{4}-\d{2}-\d{2})", a.date or a.workbook.stem)
    if not m:
        sys.exit("Couldn't read the list's date from the file name; pass --date 2026-10-14")
    ref_date = date.fromisoformat(m.group(1))
    try:
        wb = read(a.workbook, ref_date)
    except RowError as exc:
        sys.exit(f"Nothing imported. {exc}")
    on = sum(1 for c in wb.clients if c.turned_on)
    print(f"{a.workbook.name}: {len(wb.clients)} clients ({on} turned on, {len(wb.clients) - on} not yet), "
          f"output for {len(wb.output)}, billing for {len(wb.billing)}, feedback {len(wb.feedback)}, {len(wb.warranties)} inverter models")  # fmt: skip
    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    with psycopg.connect(url, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            cur.execute("select set_config('app.actor_uid', '', false)")
            try:
                k = write(cur, wb, ref_date if a.target != "prod" else date.today(), geocode=not a.no_geocode, allow_shared_postal=a.allow_shared_postal)
            except RowError as exc:
                conn.rollback()
                sys.exit(f"Nothing imported. {exc}")
        if a.dry_run:
            conn.rollback()
        else:
            conn.commit()
    verb = "would be" if a.dry_run else "were"
    print(f"{a.target}: systems {k.systems_updated} updated and {k.systems_added} added; projects {k.projects_added} added and "
          f"{k.projects_updated} updated; {k.output_months} months of output; {k.billing_months} billing months; "
          f"{k.feedback} feedback; {k.warranties} inverter models — {verb} written.")  # fmt: skip
    for n in wb.notes + k.notes:
        print("  note:", n)
    if a.dry_run:
        print("Dry run: rolled back, nothing changed.")


if __name__ == "__main__":
    main()
