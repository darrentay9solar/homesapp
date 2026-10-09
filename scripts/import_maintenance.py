"""Imports turned-on systems from a project listing spreadsheet into maintenance tracking.

    node scripts/py.mjs scripts/import_maintenance.py "<listing.xlsx>" --target test --dry-run
    node scripts/py.mjs scripts/import_maintenance.py "<listing.xlsx>" --target prod --confirm

The sheet is 9 Solar Home's project listing (first sheet, one system per row):

    S/N, Address, Postal Code, PPA, No. of Panels, Panel Wp, kWp DC, 1P or 3P,
    Inverter, Turn On Date, 6 Months, 1 Year, Maintenance Plan, Roof Access,
    Urgent Maintenance due to Poor Generation

Each row becomes a maintenance record (migration 0031) with no project, no
manager and no homeowner: those are assigned later, in the app or by a later
import. Rows are keyed by the sheet's date and S/N (import_ref, e.g.
"listing-2026-08-28#12"), so running it again adds only new rows; --update
also refreshes the sheet's own columns on rows already there, leaving anything
set in the app (manager, homeowner, checks done, notes) alone.

Nothing is guessed: a value the script doesn't recognise stops it before
anything is written, naming the row. Obvious typos in inverter models are
corrected (a missing leading S, spaces around a hyphen) and listed.

--dry-run does everything inside a transaction and rolls it back. Production
needs --confirm and PROD_MIGRATION_DATABASE_URL in .env.local; the connection
string is never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import psycopg

from _lib.db import _from_env_file

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}
HEADER = [
    "S/N", "Address", "Postal Code", "PPA", "No. of Panels", "Panel Wp", "kWp DC", "1P or 3P",
    "Inverter", "Turn On Date", "6 Months", "1 Year", "Maintenance Plan", "Roof Access",
    "Urgent Maintenance due to Poor Generation",
]  # fmt: skip
SHEET_COLUMNS = [
    "address", "postal_code", "ppa_kind", "ppa_years", "plan_years", "plan_excludes_first_year", "panels",
    "kwp", "phase", "inverters", "turned_on_on", "six_month_due", "one_year_due", "roof_access", "urgent",
    "urgent_note",
]  # fmt: skip


class RowError(ValueError):
    pass


def _text(v: object) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _date(v: object, what: str) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(_text(v))
    except ValueError:
        raise RowError(f"{what} isn't a date: {v!r}") from None


def ppa(v: object) -> tuple[str, int | None]:
    t = _text(v).lower()
    if t == "value buy":
        return "value_buy", None
    m = re.fullmatch(r"(\d+)\s*years?", t)
    if m:
        return "ppa", int(m.group(1))
    raise RowError(f"PPA isn't 'N Years' or 'Value buy': {v!r}")


def plan(v: object) -> tuple[int, bool]:
    t = _text(v).lower()
    m = re.fullmatch(r"free for (\d+) years?", t)
    if m:
        return int(m.group(1)), False
    m = re.fullmatch(r"(\d+) years? excluding (the )?1st year", t)
    if m:
        return int(m.group(1)), True
    raise RowError(f"Maintenance Plan isn't 'Free for N years' or 'N years excluding 1st year': {v!r}")


def phase(v: object) -> int:
    t = _text(v).lower().replace(" ", "-")
    if t in ("single-phase", "1-phase", "1p"):
        return 1
    if t in ("3-phase", "three-phase", "3p"):
        return 3
    raise RowError(f"1P or 3P isn't single- or 3-phase: {v!r}")


def panels(count: object, wp: object) -> list[dict[str, int]]:
    """[{count, wp}]: one entry for "620", one per line for "23 Nos. x 635 Wp\\n3 Nos. X 620 Wp"."""
    try:
        n = int(count)
    except (TypeError, ValueError):
        raise RowError(f"No. of Panels isn't a number: {count!r}") from None
    if isinstance(wp, int | float) or re.fullmatch(r"\d+", _text(wp)):
        return [{"count": n, "wp": int(wp)}]
    parts = re.findall(r"(\d+)\s*nos\.?\s*x\s*(\d+)\s*wp", str(wp), flags=re.I)
    if not parts:
        raise RowError(f"Panel Wp isn't a wattage or 'N Nos. x W Wp' lines: {wp!r}")
    mix = [{"count": int(c), "wp": int(w)} for c, w in parts]
    if sum(p["count"] for p in mix) != n:
        raise RowError(f"Panel Wp's counts ({wp!r}) don't add up to No. of Panels ({n})")
    return mix


def inverters(v: object) -> tuple[list[str], list[str]]:
    """The models, one per line, and what was corrected."""
    out, fixed = [], []
    for line in str(v or "").splitlines():
        raw = line.strip()
        if not raw:
            continue
        model = re.sub(r"\s*-\s*", "-", raw).upper()
        if model.startswith("UN2000"):
            model = "S" + model
        if model != raw:
            fixed.append(f"{raw!r} -> {model!r}")
        out.append(model)
    return out, fixed


def yes_no(v: object, what: str) -> bool | None:
    t = _text(v).lower()
    if not t:
        return None
    if t in ("yes", "y"):
        return True
    if t in ("no", "n"):
        return False
    raise RowError(f"{what} isn't Yes or No: {v!r}")


def parse(rows: list[tuple], ref: str) -> tuple[list[dict], list[str]]:
    """The sheet's rows as maintenance records, and notes on what was corrected or doesn't add up."""
    header = [_text(h) for h in rows[0]]
    if header[: len(HEADER)] != HEADER:
        raise RowError(f"The first row isn't the project listing's header. Expected {HEADER}, found {header}")
    out, notes, seen = [], [], set()
    for r in rows[1:]:
        if all(c is None or _text(c) == "" for c in r):
            continue
        sn = r[0]
        try:
            if not isinstance(sn, int) or sn in seen:
                raise RowError(f"S/N {sn!r} is missing or repeated")
            seen.add(sn)
            address = _text(r[1])
            if not address:
                raise RowError("Address is empty")
            postal = _text(r[2]).split(".")[0].zfill(6)
            if not re.fullmatch(r"\d{6}", postal):
                raise RowError(f"Postal Code isn't six digits: {r[2]!r}")
            kind, years = ppa(r[3])
            mix = panels(r[4], r[5])
            kwp = Decimal(str(r[6])).quantize(Decimal("0.001"))
            made = Decimal(sum(p["count"] * p["wp"] for p in mix)) / 1000
            if abs(made - kwp) > Decimal("0.01"):
                notes.append(f"S/N {sn}: kWp DC {kwp} differs from the panels ({made}); kept as given")
            models, fixed = inverters(r[8])
            notes += [f"S/N {sn}: inverter {f}" for f in fixed]
            on, six, year = _date(r[9], "Turn On Date"), _date(r[10], "6 Months"), _date(r[11], "1 Year")
            if not on <= six <= year:
                raise RowError(f"the dates aren't in order: {on}, {six}, {year}")
            plan_years, excludes = plan(r[12])
            urgent = _text(r[14])
            out.append({
                "import_ref": f"{ref}#{sn}",
                "address": address,
                "postal_code": postal,
                "ppa_kind": kind,
                "ppa_years": years,
                "plan_years": plan_years,
                "plan_excludes_first_year": excludes,
                "panels": mix,
                "kwp": kwp,
                "phase": phase(r[7]),
                "inverters": models,
                "turned_on_on": on,
                "six_month_due": six,
                "one_year_due": year,
                "roof_access": yes_no(r[13], "Roof Access"),
                "urgent": bool(urgent),
                "urgent_note": f"Poor generation: {urgent}" if urgent else None,
            })  # fmt: skip
        except RowError as exc:
            raise RowError(f"S/N {sn!r} ({_text(r[1]) or 'no address'}): {exc}") from None
    return out, notes


def read_sheet(path: Path) -> list[tuple]:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    return list(wb.worksheets[0].iter_rows(values_only=True))


def write(cur: psycopg.Cursor, records: list[dict], update: bool) -> tuple[int, int, int]:
    added = updated = kept = 0
    for rec in records:
        values = {**rec, "panels": json.dumps(rec["panels"])}
        cur.execute("select system_id from maintenance_systems where import_ref = %(import_ref)s", values)
        if cur.fetchone() is None:
            cols = ["import_ref", *SHEET_COLUMNS]
            cur.execute(
                f"insert into maintenance_systems ({', '.join(cols)}) "
                f"values ({', '.join(f'%({c})s' for c in cols)})",
                values,
            )
            added += 1
        elif update:
            cur.execute(
                f"update maintenance_systems set {', '.join(f'{c} = %({c})s' for c in SHEET_COLUMNS)} "
                "where import_ref = %(import_ref)s",
                values,
            )
            updated += cur.rowcount
        else:
            kept += 1
    return added, updated, kept


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", type=Path)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--ref", help="the sheet's key, default listing-<date in the file name>, e.g. listing-2026-08-28")
    ap.add_argument("--update", action="store_true", help="also refresh the sheet's columns on rows already imported")
    ap.add_argument("--dry-run", action="store_true", help="check and write inside a transaction, then roll it back")
    ap.add_argument("--confirm", action="store_true", help="required for production")
    a = ap.parse_args()

    if a.target == "prod" and not a.confirm and not a.dry_run:
        sys.exit("Refusing to import into production without --confirm. Try --dry-run first.")
    ref = a.ref
    if not ref:
        m = re.search(r"(\d{1,2}) (\w{3})\w* (\d{4})", a.sheet.stem)
        if not m:
            sys.exit("Couldn't read a date from the file name; pass --ref, e.g. --ref listing-2026-08-28")
        ref = "listing-" + datetime.strptime(" ".join(m.groups()), "%d %b %Y").date().isoformat()

    try:
        records, notes = parse(read_sheet(a.sheet), ref)
    except RowError as exc:
        sys.exit(f"Nothing imported. {exc}")
    print(f"{len(records)} systems in {a.sheet.name} ({ref})")
    for n in notes:
        print(f"  note: {n}")

    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # A pooled session may carry an earlier run's actor; this is a script, recorded as one.
            cur.execute("select set_config('app.actor_uid', '', false)")
            added, updated, kept = write(cur, records, a.update)
            cur.execute("select count(*) from maintenance_systems where import_ref like %s", (f"{ref}#%",))
            total = cur.fetchone()[0]
        if a.dry_run:
            conn.rollback()
        else:
            conn.commit()
    verb = "would be" if a.dry_run else "were"
    print(f"{a.target}: {added} {verb} added, {updated} updated, {kept} already there; {total} from {ref} in all.")
    if a.dry_run:
        print("Dry run: rolled back, nothing changed.")


if __name__ == "__main__":
    main()
