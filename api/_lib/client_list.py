# ruff: noqa: E501, RUF001  (column lists read better whole; the list writes date ranges with en dashes)
"""9 Solar Home's project list (the client workbook): reading it, checking it and writing it (migration 0038).

Used by the command line (scripts/import_client_list.py) and by Projects → Import from Excel
(POST /import/client-list, api/_routes/imports.py). What goes where:
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

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

from _lib import onemap
from _lib.profile import clean_phone

CLIENT_HEADER = [
    "Project Code", "Salutation", "Homeowner", "Address", "Postal Code", "Mobile", "Email", "Signed Date",
    "Salesperson", "Referrer", "Solar Plan", "Rate (Per kWh)", "PPA", "EPC", "No. of Panels", "Panel Wp",
    "kWp DC", "1P or 3P", "Inverter", "Serial Number", "Dongle Serial No.", "Installation Start",
    "Installation End", "Turn On", "Turn On Date",
]  # fmt: skip
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


class RowError(ValueError):
    pass


# ------------------------------------------------------------------ reading values


def text(v: object) -> str | None:
    t = re.sub(r"\s+", " ", str(v if v is not None else "")).strip()
    return None if t in ("", "-", "–", "N/A", "NA") else t


def lines(v: object) -> list[str]:
    return [t for t in (text(x) for x in str(v or "").splitlines()) if t]


def day(v: object, year: int, what: str, notes: list[str], code: str) -> date | None:
    """A date, or a date written as text ("21-Sept-26"). Something else ("first week Dec"): none, noted."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    t = text(v)
    if not t:
        return None
    m = re.fullmatch(r"(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})", t)
    if m and m.group(2)[:3].lower() in MONTHS:
        y = int(m.group(3))
        return date(y + 2000 if y < 100 else y, MONTHS[m.group(2)[:3].lower()], int(m.group(1)))
    notes.append(f"{code}: {what} {t!r} isn't a date; left empty")
    return None


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    for last in (31, 30, 29, 28):
        try:
            return date(y, m, min(d.day, last))
        except ValueError:
            continue
    raise AssertionError


def postal(v: object) -> str | None:
    t = text(v)
    if not t:
        return None
    t = t.split(".")[0].zfill(6)
    return t if re.fullmatch(r"\d{6}", t) else None


def mobile(v: object, notes: list[str], code: str) -> str | None:
    if v is None:
        return None
    raw = str(int(v)) if isinstance(v, int | float) else (text(v) or "")
    if not raw:
        return None
    first = re.split(r"[/,;]| or ", raw)[0].strip()
    try:
        return clean_phone(first if first.startswith("+") or not re.fullmatch(r"65\d{8}", re.sub(r"\D", "", first)) else "+" + re.sub(r"\D", "", first))
    except Exception:
        notes.append(f"{code}: mobile isn't a phone number the app reads; kept as written")
        return raw[:32]


def ppa(v: object) -> tuple[str | None, int | None]:
    t = (text(v) or "").lower()
    if not t:
        return None, None
    if "upfront" in t or "value buy" in t:
        return "value_buy", None
    m = re.fullmatch(r"(\d+)\s*years?", t)
    if m:
        return "ppa", int(m.group(1))
    raise RowError(f"PPA isn't 'N Years' or 'Upfront Purchase': {v!r}")


def phase(v: object) -> int | None:
    t = (text(v) or "").lower().replace(" ", "-")
    if not t:
        return None
    if t in ("single-phase", "1-phase", "1p", "single"):
        return 1
    if t in ("3-phase", "three-phase", "3p"):
        return 3
    raise RowError(f"1P or 3P isn't single- or 3-phase: {v!r}")


def inverters(v: object, notes: list[str], code: str) -> list[str]:
    out = []
    for raw in lines(v):
        model = re.sub(r"\s*-\s*", "-", raw).upper()
        if model.startswith("UN2000"):
            model = "S" + model
        if model != raw:
            notes.append(f"{code}: inverter {raw!r} read as {model!r}")
        out.append(model)
    return out


def model_key(model: str) -> str:
    """One key for the list's spellings of a model: SUN2000-10KTL-LC0 and SUN2000-10K-LC0 are the same inverter."""
    k = re.sub(r"\s+", "", model.upper())
    return re.sub(r"(\d+)KTL", r"\1K", k)


def rate(v: object) -> Decimal | None:
    if isinstance(v, int | float):
        return Decimal(str(round(float(v), 4)))
    t = text(v)
    if not t:
        return None
    try:
        return Decimal(str(round(float(t.replace("$", "")), 4)))
    except ValueError:
        raise RowError(f"Rate (Per kWh) isn't a number: {v!r}") from None


def number(v: object) -> float | None:
    if isinstance(v, int | float):
        return float(v)
    t = text(v)
    try:
        return float(t) if t else None
    except ValueError:
        return None


# ------------------------------------------------------------------ the workbook


@dataclass
class Client:
    row: int
    code: str | None
    ref: str
    salutation: str | None
    name: str | None
    address: str
    postal: str | None
    contact: str | None
    email: str | None
    signed_on: date | None
    salesperson: str | None
    referrer: str | None
    plan: str | None
    rate: Decimal | None
    ppa_kind: str | None
    ppa_years: int | None
    epc: str | None
    panels: int | None
    wp: int | None
    kwp: Decimal | None
    phase: int | None
    inverters: list[str]
    serials: list[str]
    dongles: list[str]
    start: date | None
    end: date | None
    turned_on: date | None


@dataclass
class Workbook:
    clients: list[Client] = field(default_factory=list)
    output: dict[str, dict[date, Decimal]] = field(default_factory=dict)
    estimate: dict[str, Decimal] = field(default_factory=dict)
    billing: dict[str, tuple[str | None, dict[date, str]]] = field(default_factory=dict)
    feedback: dict[str, str] = field(default_factory=dict)
    warranties: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def month_of(h: object, year: int) -> date | None:
    """A month column's heading: a date (its month) or a month name ("Aug") in the list's year."""
    if isinstance(h, datetime | date):
        return date(h.year, h.month, 1)
    t = (text(h) or "").lower()[:3]
    return date(year, MONTHS[t], 1) if t in MONTHS else None


def read(path: Path, ref_date: date) -> Workbook:
    """The list, read and checked. The file is closed again whatever happens (so a copy can be deleted)."""
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return _read(book, path, ref_date)
    finally:
        book.close()


def _read(wb: Any, path: Path, ref_date: date) -> Workbook:
    sheets = {ws.title.split("-")[0].strip().lower(): ws for ws in wb.worksheets}

    def sheet(name: str) -> list[tuple]:
        ws = next((v for k, v in sheets.items() if k.startswith(name)), None)
        if ws is None:
            raise RowError(f"No '{name}' sheet in {path.name}")
        return list(ws.iter_rows(values_only=True))

    out = Workbook()
    year = ref_date.year
    ref = f"clients-{ref_date.isoformat()}"

    rows = sheet("clients list")
    head = next((i for i, r in enumerate(rows[:5]) if text(r[0]) == "Project Code"), None)
    if head is None or [text(h) for h in rows[head][: len(CLIENT_HEADER)]] != CLIENT_HEADER:
        raise RowError(f"The Clients List's header isn't the one this script knows: {CLIENT_HEADER}")
    seen: set[str] = set()
    for n, r in enumerate(rows[head + 1 :], start=head + 2):
        if all(text(c) is None for c in r[:25]):
            continue
        code = text(r[0])
        tag = code or f"row {n}"
        try:
            if code and code in seen:
                raise RowError("the project code is repeated")
            if code:
                seen.add(code)
            address = text(r[3])
            if not address:
                raise RowError("Address is empty")
            kind, years = ppa(r[12])
            panels = int(r[14]) if isinstance(r[14], int | float) else None
            wp = int(r[15]) if isinstance(r[15], int | float) else None
            kwp = Decimal(str(r[16])).quantize(Decimal("0.001")) if isinstance(r[16], int | float) else None
            on = r[23] in (1, True, "1", "Yes", "yes")
            on_date = day(r[24], year, "Turn On Date", out.notes, tag)
            if on and not on_date:
                raise RowError("Turn On is ticked but there's no Turn On Date")
            out.clients.append(
                Client(
                    row=n, code=code, ref=f"{ref}#{code or f'row{n}'}", salutation=text(r[1]), name=text(r[2]),
                    address=address, postal=postal(r[4]), contact=mobile(r[5], out.notes, tag), email=text(r[6]),
                    signed_on=day(r[7], year, "Signed Date", out.notes, tag), salesperson=text(r[8]), referrer=text(r[9]),
                    plan=text(r[10]), rate=rate(r[11]), ppa_kind=kind, ppa_years=years, epc=text(r[13]),
                    panels=panels, wp=wp, kwp=kwp, phase=phase(r[17]), inverters=inverters(r[18], out.notes, tag),
                    serials=lines(r[19]), dongles=lines(r[20]),
                    start=day(r[21], year, "Installation Start", out.notes, tag),
                    end=day(r[22], year, "Installation End", out.notes, tag),
                    turned_on=on_date if on else None,
                )
            )  # fmt: skip
        except RowError as exc:
            raise RowError(f"Clients List {tag}: {exc}") from None

    rows = sheet("actual solar output")
    months = {i: month_of(h, year) for i, h in enumerate(rows[0]) if 9 <= i <= 21}
    unlabeled = [i for i, m in months.items() if m is None]
    skipped = dict.fromkeys(unlabeled, 0)
    for r in rows[1:]:
        code = text(r[1])
        if not code:
            continue
        est = number(r[8])
        if est is not None:
            out.estimate[code] = Decimal(str(round(est, 2)))
        got = {}
        for i, m in months.items():
            v = number(r[i]) if m else None
            if m and v is not None and v >= 0:
                got[m] = Decimal(str(round(v, 2)))
            elif not m and number(r[i]) is not None:
                skipped[i] += 1
        if got:
            out.output[code] = got
    for i, n in skipped.items():
        if n:
            out.notes.append(f"Actual Solar Output: column {i + 1} has {n} figures but no month heading; left out (which month is it?)")

    rows = sheet("billing period")
    months = {i: month_of(h, year) for i, h in enumerate(rows[0]) if i >= 6}
    # Most billing rows have no project code, only the address: found by the Clients List's own address.
    by_address = {(c.address or "").lower(): c.code for c in out.clients if c.code}
    unmatched = 0
    for r in rows[1:]:
        code = text(r[1]) or by_address.get((text(r[3]) or "").lower())
        if not code:
            unmatched += any(text(c) for c in r[2:8])
            continue
        periods = {m: text(r[i]) for i, m in months.items() if m and text(r[i])}
        out.billing[code] = (text(r[5]), {m: p for m, p in periods.items() if p})
    if unmatched:
        out.notes.append(f"Billing Period: {unmatched} rows match no client by code or address; left out")

    rows = sheet("feedback")
    for r in rows[1:]:
        code, said = text(r[0]), text(r[3])
        if code and said:
            out.feedback[code] = said

    rows = sheet("inverter warranties")
    for r in rows[1:]:
        model = text(r[0])
        if not model:
            continue
        model = re.sub(r"\s*-\s*", "-", model).upper()
        years = re.match(r"(\d+)", text(r[4]) or "")
        out.warranties.append({
            "model_key": model_key(model), "model": model, "phase": phase(r[1]),
            "price_ex_gst": Decimal(str(round(float(r[2]), 2))) if isinstance(r[2], int | float) else None,
            "price_incl_gst": Decimal(str(round(float(r[3]), 2))) if isinstance(r[3], int | float) else None,
            "warranty_years": int(years.group(1)) if years else None,
        })  # fmt: skip
    return out


# ------------------------------------------------------------------ writing


def house_key(address: str | None, postal_code: str | None) -> tuple[str, str]:
    num = re.match(r"\s*(\d+[A-Za-z]?)", address or "")
    return ((postal_code or "").zfill(6), num.group(1).upper() if num else "")


@dataclass
class Counts:
    systems_updated: int = 0
    systems_added: int = 0
    projects_added: int = 0
    projects_updated: int = 0
    output_months: int = 0
    billing_months: int = 0
    feedback: int = 0
    warranties: int = 0
    notes: list[str] = field(default_factory=list)


def record(c: Client) -> dict[str, Any]:
    """The client-record columns a system keeps."""
    return {
        "project_code": c.code, "salutation": c.salutation, "homeowner_email": c.email, "signed_on": c.signed_on,
        "salesperson": c.salesperson, "referrer": c.referrer, "solar_plan": c.plan, "rate_per_kwh": c.rate, "epc": c.epc,
        "inverter_serials": c.serials, "dongle_serials": c.dongles, "installation_start": c.start, "installation_end": c.end,
    }  # fmt: skip


def _addr(a: str | None) -> str:
    return re.sub(r"\s+", " ", (a or "")).strip().lower()


def duplicates(cur: psycopg.Cursor, wb: Workbook, allow_shared_postal: bool = False) -> list[str]:
    """What would end up twice: in the file itself, or against what's already in the app. Checked before anything is written."""
    problems: list[str] = []
    seen: dict[tuple[str, str], list[str]] = {}
    for c in wb.clients:
        tag = c.code or c.ref
        for kind, key in (("postal code", c.postal), ("address", _addr(c.address))):
            if key:
                seen.setdefault((kind, key), []).append(tag)
    for (kind, _key), tags in seen.items():
        if len(tags) > 1 and not (kind == "postal code" and allow_shared_postal):
            problems.append(f"the list has the same {kind} for {', '.join(tags)}")
    # Against the app: anything already at this postal code must be the very record the list updates.
    systems = cur.execute("select system_id, address, postal_code, project_code from maintenance_systems").fetchall()
    projects = cur.execute("select project_id, address, postal_code, project_code from projects").fetchall()
    by_house = {house_key(s["address"], s["postal_code"]) for s in systems}
    for c in wb.clients:
        if not c.postal or allow_shared_postal:
            continue
        tag = c.code or c.ref
        same_sys = [s for s in systems if s["postal_code"] == c.postal]
        same_proj = [p for p in projects if p["postal_code"] == c.postal]
        if c.turned_on:
            others = [s for s in same_sys if s["project_code"] not in (None, c.code)]
            matched = house_key(c.address, c.postal) in by_house
            if others or (same_sys and not matched and not any(s["project_code"] == c.code for s in same_sys)):
                problems.append(f"{tag}: postal code {c.postal} is already used by another maintenance system")
            if [p for p in same_proj if p["project_code"] != c.code]:
                problems.append(f"{tag}: postal code {c.postal} is already used by a project in the app")
        else:
            if [p for p in same_proj if p["project_code"] != c.code]:
                problems.append(f"{tag}: postal code {c.postal} is already used by another project")
            if same_sys:
                problems.append(f"{tag}: postal code {c.postal} is already a maintenance system (turned on?), not a new project")
    return problems


def write(cur: psycopg.Cursor, wb: Workbook, today: date, geocode: bool = True, allow_shared_postal: bool = False) -> Counts:
    k = Counts()
    found = duplicates(cur, wb, allow_shared_postal)
    if found:
        raise RowError("Duplicates found, so nothing was written:\n  " + "\n  ".join(found))
    systems = cur.execute("select system_id, address, postal_code, project_code, homeowner_name, homeowner_contact_no from maintenance_systems").fetchall()
    by_code = {s["project_code"]: s for s in systems if s["project_code"]}
    by_house = {house_key(s["address"], s["postal_code"]): s for s in systems}
    code_to_system: dict[str, int] = {}
    code_to_project: dict[str, int] = {}

    for c in wb.clients:
        if c.turned_on:
            s = by_code.get(c.code) if c.code else None
            s = s or by_house.get(house_key(c.address, c.postal))
            rec = record(c)
            if s:
                cur.execute(
                    "update maintenance_systems set " + ", ".join(f"{col} = %({col})s" for col in rec)
                    + ", homeowner_name = coalesce(homeowner_name, %(name)s), homeowner_contact_no = coalesce(homeowner_contact_no, %(contact)s)"
                    + " where system_id = %(sid)s",
                    {**rec, "name": c.name, "contact": c.contact, "sid": s["system_id"]},
                )
                k.systems_updated += 1
                sid = s["system_id"]
            else:
                if not c.postal:
                    raise RowError(f"{c.code}: a new system needs a six-digit postal code")
                panels = json.dumps([{"count": c.panels, "wp": c.wp}] if c.panels and c.wp else [])
                kwp = c.kwp if c.kwp is not None else (Decimal(c.panels * c.wp) / 1000 if c.panels and c.wp else None)
                cur.execute(
                    """
                    insert into maintenance_systems (import_ref, address, postal_code, homeowner_name, homeowner_contact_no,
                      ppa_kind, ppa_years, panels, kwp, phase, inverters, turned_on_on, six_month_due, one_year_due,
                      project_code, salutation, homeowner_email, signed_on, salesperson, referrer, solar_plan, rate_per_kwh, epc,
                      inverter_serials, dongle_serials, installation_start, installation_end)
                    values (%(ref)s, %(address)s, %(postal)s, %(name)s, %(contact)s, %(ppa_kind)s, %(ppa_years)s, %(panels)s::jsonb,
                      %(kwp)s, %(phase)s, %(inverters)s, %(on)s, %(six)s, %(year)s,
                      %(project_code)s, %(salutation)s, %(homeowner_email)s, %(signed_on)s, %(salesperson)s, %(referrer)s,
                      %(solar_plan)s, %(rate_per_kwh)s, %(epc)s, %(inverter_serials)s, %(dongle_serials)s,
                      %(installation_start)s, %(installation_end)s)
                    returning system_id
                    """,
                    {**rec, "ref": c.ref, "address": c.address, "postal": c.postal, "name": c.name, "contact": c.contact,
                     "ppa_kind": c.ppa_kind, "ppa_years": c.ppa_years, "panels": panels, "kwp": kwp, "phase": c.phase,
                     "inverters": c.inverters, "on": c.turned_on, "six": add_months(c.turned_on, 6), "year": add_months(c.turned_on, 12)},
                )  # fmt: skip
                sid = cur.fetchone()["system_id"]
                k.systems_added += 1
            if c.code:
                code_to_system[c.code] = sid
            continue

        # Signed, not yet turned on: a project in progress, waiting for a manager.
        existing = cur.execute("select project_id from projects where project_code = %s", (c.code,)).fetchone() if c.code else None
        start, end, note = c.start, c.end, None
        if not start and not end:
            start, end = today, today + timedelta(days=21)
            note = f"The project list had no installation dates; the import set {start.isoformat()} to {end.isoformat()}. Change them in Edit project."
        elif not start:
            start = end - timedelta(days=21)
        elif not end or end < start:
            end = start + timedelta(days=21)
        values = {
            "name": c.address, "address": c.address, "postal": c.postal, "homeowner_name": c.name or "Homeowner",
            "contact": c.contact or "Not in the list", "contractor_text": c.epc, "sales": (c.salesperson or "")[:160] or None,
            "start": start, "end": end, "panels": c.panels, "wp": c.wp,
            "inverter": " + ".join(c.inverters) or None, "serial": (" + ".join(c.serials))[:120] or None,
            "code": c.code, "salutation": c.salutation, "email": c.email, "signed_on": c.signed_on, "referrer": c.referrer,
            "plan": c.plan, "rate": c.rate, "ppa_kind": c.ppa_kind, "ppa_years": c.ppa_years, "phase": c.phase,
            "dongle": " + ".join(c.dongles) or None, "ref": c.ref, "note": note,
        }  # fmt: skip
        listed = """homeowner_name = %(homeowner_name)s, homeowner_contact_no = %(contact)s, contractor_text = %(contractor_text)s,
            sales = %(sales)s, panel_quantity_estimate = %(panels)s, panel_capacity = %(wp)s, inverter_to_order = %(inverter)s,
            inverter_serial_number = %(serial)s, salutation = %(salutation)s, homeowner_email = %(email)s, signed_on = %(signed_on)s,
            referrer = %(referrer)s, solar_plan = %(plan)s, rate_per_kwh = %(rate)s, ppa_kind = %(ppa_kind)s,
            ppa_years = %(ppa_years)s, phase = %(phase)s, dongle_serial = %(dongle)s"""
        if existing:
            cur.execute(f"update projects set {listed} where project_id = %(pid)s", {**values, "pid": existing["project_id"]})
            k.projects_updated += 1
            code_to_project[c.code] = existing["project_id"]
            continue
        loc = None
        if geocode and c.postal:
            try:
                loc = onemap.resolve(None, c.postal)
            except onemap.GeocodeError:
                k.notes.append(f"{c.code or c.ref}: the site couldn't be found on OneMap; check-in stays off until it's located")
        cur.execute(
            """
            insert into projects (name, address, postal_code, site_lat, site_lng, geocoded_address, geocode_source, geocoded_at,
              homeowner_name, homeowner_contact_no, contractor_text, sales, installation_start_date, target_end_date,
              installation_end_date, panel_quantity_estimate, panel_capacity, inverter_to_order, inverter_serial_number,
              project_code, salutation, homeowner_email, signed_on, referrer, solar_plan, rate_per_kwh, ppa_kind, ppa_years,
              phase, dongle_serial, import_ref, record_note, status)
            values (%(name)s, %(address)s, %(postal)s, %(lat)s, %(lng)s, %(geo)s, %(src)s, case when %(lat)s::float8 is not null then now() end,
              %(homeowner_name)s, %(contact)s, %(contractor_text)s, %(sales)s, %(start)s, %(end)s, %(installed)s, %(panels)s, %(wp)s,
              %(inverter)s, %(serial)s, %(code)s, %(salutation)s, %(email)s, %(signed_on)s, %(referrer)s, %(plan)s, %(rate)s,
              %(ppa_kind)s, %(ppa_years)s, %(phase)s, %(dongle)s, %(ref)s, %(note)s, 'in_progress')
            returning project_id
            """,
            {**values, "lat": loc.lat if loc else None, "lng": loc.lng if loc else None, "geo": c.address if loc else None,
             "src": "onemap" if loc else None, "installed": c.end},
        )  # fmt: skip
        pid = cur.fetchone()["project_id"]
        k.projects_added += 1
        if c.code:
            code_to_project[c.code] = pid

    for code, months in wb.output.items():
        sid = code_to_system.get(code)
        if not sid:
            k.notes.append(f"{code}: solar output for a system that isn't turned on in the list; left out")
            continue
        for m, kwh in months.items():
            cur.execute(
                "insert into system_output (system_id, month, kwh) values (%s, %s, %s) "
                "on conflict (system_id, month) do update set kwh = excluded.kwh",
                (sid, m, kwh),
            )
            k.output_months += 1
    for code, est in wb.estimate.items():
        if code in code_to_system:
            cur.execute("update maintenance_systems set est_monthly_kwh = %s where system_id = %s", (est, code_to_system[code]))
    for code, (period, months) in wb.billing.items():
        sid = code_to_system.get(code)
        if not sid:
            continue
        cur.execute("update maintenance_systems set billing_period = %s where system_id = %s", (period, sid))
        for m, p in months.items():
            cur.execute(
                "insert into system_billing (system_id, month, period) values (%s, %s, %s) "
                "on conflict (system_id, month) do update set period = excluded.period",
                (sid, m, p),
            )
            k.billing_months += 1
    for code, said in wb.feedback.items():
        sid, pid = code_to_system.get(code), code_to_project.get(code)
        if not sid and not pid:
            k.notes.append(f"{code}: feedback for a project code not in the Clients List; left out")
            continue
        cur.execute(
            "insert into client_feedback (system_id, project_id, body, import_ref) values (%s, %s, %s, %s) "
            "on conflict (import_ref) where import_ref is not null do update set body = excluded.body",
            (sid, pid, said, f"feedback#{code}"),
        )
        k.feedback += 1
    for w in wb.warranties:
        cur.execute(
            """insert into inverter_models (model_key, model, phase, price_ex_gst, price_incl_gst, warranty_years)
               values (%(model_key)s, %(model)s, %(phase)s, %(price_ex_gst)s, %(price_incl_gst)s, %(warranty_years)s)
               on conflict (model_key) do update set model = excluded.model, phase = excluded.phase, price_ex_gst = excluded.price_ex_gst,
                 price_incl_gst = excluded.price_incl_gst, warranty_years = excluded.warranty_years""",
            w,
        )
        k.warranties += 1
    return k
