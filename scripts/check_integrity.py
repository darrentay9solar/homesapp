# ruff: noqa: E501  (SQL reads better whole)
"""Data integrity, read-only: what in the database doesn't add up.

    node scripts/py.mjs scripts/check_integrity.py --target prod
    node scripts/py.mjs scripts/check_integrity.py --target prod --list "<Project List.xlsx>"

Runs in one read-only transaction (nothing is written) and prints only counts, record numbers and
project codes: never a name, address, phone number or email. Each check says OK, or what it found.
With --list, the client list's own figures are compared with what the database holds for each code.

  duplicates   the same postal code, address or project code on two records (a system and its own
               record project are one record)
  shape        postal codes, project codes, addresses (no postal code or "Singapore" in the street),
               phone numbers
  records      dates in order, sizes adding up, what a system needs to be billed and maintained
  links        systems and their projects, plants and their systems (the postal codes agree), people
  figures      output and billing months, invoices
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import psycopg
from psycopg.rows import dict_row

from _lib.db import _from_env_file
from _lib.duplicates import address_key

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}
RECORD = "record:"
found = 0


def report(name: str, bad: list[Any], note: str = "") -> None:
    global found
    if not bad:
        print(f"  OK    {name}")
        return
    found += len(bad)
    shown = ", ".join(str(b) for b in bad[:15]) + (f" … and {len(bad) - 15} more" if len(bad) > 15 else "")
    print(f"  {len(bad):>4}  {name}{' (' + note + ')' if note else ''}: {shown}")


def tag(r: dict[str, Any], kind: str) -> str:
    return r.get("project_code") or f"{kind}#{r['system_id' if kind == 'system' else 'project_id']}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--list", type=Path, help="the client list (.xlsx) to compare with, code by code")
    a = ap.parse_args()
    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        c = conn
        c.execute("set transaction read only")
        q = lambda sql, *p: c.execute(sql, p or None).fetchall()  # noqa: E731
        systems = q("select * from maintenance_systems order by system_id")
        projects = q("select p.*, p.status::text as st from projects p order by project_id")
        users = q("select uid, user_type::text as role, active, email, contact_no, is_demo from users")
        plants = q("select * from solar_plants")
        today = date.today()
        by_pid = {p["project_id"]: p for p in projects}
        record_pids = {p["project_id"] for p in projects if (p["import_ref"] or "").startswith(RECORD)}
        linked_pids = {s["project_id"] for s in systems if s["project_id"]}
        # One record per home: a system, or a project that isn't a system's own.
        homes = [("system", s) for s in systems] + [
            ("project", p) for p in projects if p["project_id"] not in linked_pids
        ]
        print(
            f"{a.target}: {len(systems)} systems, {len(projects)} projects ({len(record_pids)} record projects), {len(plants)} plants, {len(users)} people"
        )

        print("\nduplicates")
        for what, key in (
            ("postal code", lambda r: r["postal_code"]),
            ("address", lambda r: address_key(r["address"], r["postal_code"])),
            ("project code", lambda r: r["project_code"]),
        ):
            seen: dict[str, list[str]] = defaultdict(list)
            for kind, r in homes:
                if k := key(r):
                    seen[k].append(tag(r, kind))
            report(f"the same {what} on two homes", [" + ".join(v) for v in seen.values() if len(v) > 1])
        report(
            "a homeowner on two systems", [u for u, n in _count(s["homeowner_id"] for s in systems).items() if n > 1]
        )
        report(
            "a homeowner on two projects", [u for u, n in _count(p["homeowner_id"] for p in projects).items() if n > 1]
        )
        report(
            "two plants on one system",
            [f"system#{s}" for s, n in _count(p["system_id"] for p in plants).items() if n > 1],
        )

        print("\nshape")
        for kind, rows in (("system", systems), ("project", projects)):
            report(
                f"{kind} postal code not 6 digits",
                [tag(r, kind) for r in rows if not re.fullmatch(r"\d{6}", r["postal_code"] or "")],
            )
            report(
                f"{kind} project code not 9SH and 4 digits",
                [tag(r, kind) for r in rows if r["project_code"] and not re.fullmatch(r"9SH\d{4}", r["project_code"])],
            )
            report(
                f"{kind} street carries a postal code or 'Singapore'",
                [
                    tag(r, kind)
                    for r in rows
                    if re.search(r"\b\d{6}\b", r["address"] or "") or re.search(r"singapore", r["address"] or "", re.I)
                ],
            )
            report(
                f"{kind} street empty or untidy (double spaces, stray commas)",
                [
                    tag(r, kind)
                    for r in rows
                    if not (r["address"] or "").strip() or re.search(r"\s{2,}|,\s*,|^\s|\s$|,$", r["address"] or "")
                ],
            )
        phone = re.compile(r"^\+65 [3689]\d{3} ?\d{4}$")
        report(
            "system contact number not +65 and 8 digits",
            [
                tag(s, "system")
                for s in systems
                if s["homeowner_contact_no"] and not phone.match(s["homeowner_contact_no"])
            ],
            "kept as written by the import",
        )
        report(
            "project contact number not +65 and 8 digits",
            [
                tag(p, "project")
                for p in projects
                if p["homeowner_contact_no"]
                and p["homeowner_contact_no"] != "Not in the list"
                and not phone.match(p["homeowner_contact_no"])
            ],
        )
        report(
            "person's mobile not +65 and 8 digits",
            [f"user#{u['uid']}" for u in users if u["contact_no"] and not phone.match(u["contact_no"])],
        )
        report(
            "two people with one email",
            [e for e, n in _count((u["email"] or "").lower() for u in users if u["email"]).items() if n > 1],
        )
        report(
            "two people with one mobile",
            [m for m, n in _count(u["contact_no"] for u in users if u["contact_no"]).items() if n > 1],
        )

        print("\nrecords: maintenance systems")
        report(
            "turned on in the future",
            [tag(s, "system") for s in systems if s["turned_on_on"] and s["turned_on_on"] > today],
        )
        report(
            "no turn-on date", [tag(s, "system") for s in systems if not s["turned_on_on"]], "no checks can be dated"
        )
        report(
            "installation ends before it starts",
            [
                tag(s, "system")
                for s in systems
                if s["installation_start"] and s["installation_end"] and s["installation_end"] < s["installation_start"]
            ],
        )
        report(
            "signed after it was turned on",
            [
                tag(s, "system")
                for s in systems
                if s["signed_on"] and s["turned_on_on"] and s["signed_on"] > s["turned_on_on"]
            ],
        )
        report(
            "installed after it was turned on",
            [
                tag(s, "system")
                for s in systems
                if s["installation_end"] and s["turned_on_on"] and s["installation_end"] > s["turned_on_on"]
            ],
        )
        report(
            "no panels",
            [tag(s, "system") for s in systems if not any(int(p.get("count") or 0) for p in s["panels"] or [])],
        )
        report("no inverter", [tag(s, "system") for s in systems if not [x for x in s["inverters"] or [] if x]])

        def off(s: dict[str, Any]) -> bool:
            dc = sum(int(p.get("count") or 0) * int(p.get("wp") or 0) for p in s["panels"] or []) / 1000
            return bool(dc and s["kwp"] and abs(float(s["kwp"]) - dc) / dc > 0.05)

        report("kWp doesn't match its panels (over 5%)", [tag(s, "system") for s in systems if off(s)])
        report("no size (kWp)", [tag(s, "system") for s in systems if not s["kwp"]])
        report(
            "PPA with no years", [tag(s, "system") for s in systems if s["ppa_kind"] == "ppa" and not s["ppa_years"]]
        )
        report("no PPA or value buy", [tag(s, "system") for s in systems if not s["ppa_kind"]])
        report(
            "maintenance plan longer than its PPA",
            [
                tag(s, "system")
                for s in systems
                if s["plan_years"] and s["ppa_years"] and s["plan_years"] > s["ppa_years"]
            ],
        )
        report(
            "PPA without a rate per kWh (can't be billed)",
            [tag(s, "system") for s in systems if s["ppa_kind"] == "ppa" and not s["rate_per_kwh"]],
        )
        report(
            "rate per kWh outside $0.05 to $0.60",
            [tag(s, "system") for s in systems if s["rate_per_kwh"] and not 0.05 <= float(s["rate_per_kwh"]) <= 0.6],
        )
        report(
            "no homeowner name",
            [tag(s, "system") for s in systems if not s["homeowner_id"] and not (s["homeowner_name"] or "").strip()],
        )
        report("no manager yet", [tag(s, "system") for s in systems if not s["run_by"]], "assigned later, as decided")

        print("\nrecords: projects")
        live = [p for p in projects if p["project_id"] not in record_pids]
        report(
            "target end before the start",
            [
                tag(p, "project")
                for p in projects
                if p["installation_start_date"]
                and p["target_end_date"]
                and p["target_end_date"] < p["installation_start_date"]
            ],
        )
        report(
            "in progress with no manager",
            [tag(p, "project") for p in live if p["st"] not in ("maintenance",) and not p["project_manager_id"]],
            "taken on later, as decided",
        )
        report(
            "in progress, target end passed",
            [
                tag(p, "project")
                for p in live
                if p["st"] == "in_progress" and p["target_end_date"] and p["target_end_date"] < today
            ],
        )
        report("site not located (no check-in)", [tag(p, "project") for p in live if p["site_lat"] is None])
        report(
            "imported dates set by the import (none in the list)",
            [
                tag(p, "project")
                for p in live
                if (p["record_note"] or "").startswith("The project list had no installation dates")
            ],
        )

        print("\nlinks")
        report(
            "system points at a missing project",
            [tag(s, "system") for s in systems if s["project_id"] and s["project_id"] not in by_pid],
        )
        report(
            "system's project isn't handed over",
            [
                tag(s, "system")
                for s in systems
                if s["project_id"] in by_pid and by_pid[s["project_id"]]["st"] != "maintenance"
            ],
        )
        report(
            "handed-over project with no system",
            [tag(p, "project") for p in projects if p["st"] == "maintenance" and p["project_id"] not in linked_pids],
        )
        report(
            "record project's code differs from its system's",
            [
                tag(s, "system")
                for s in systems
                if s["project_id"] in record_pids and by_pid[s["project_id"]]["project_code"] != s["project_code"]
            ],
        )
        report(
            "record project's manager differs from its system's",
            [
                tag(s, "system")
                for s in systems
                if s["project_id"] in record_pids and by_pid[s["project_id"]]["project_manager_id"] != s["run_by"]
            ],
        )
        report(
            "imported system with no record project yet",
            [tag(s, "system") for s in systems if s["import_ref"] and not s["project_id"]],
            "made by the next client-list import",
        )
        roles = {u["uid"]: u for u in users}
        report(
            "run by someone not an active manager",
            [
                tag(s, "system")
                for s in systems
                if s["run_by"]
                and not (
                    roles.get(s["run_by"])
                    and roles[s["run_by"]]["active"]
                    and roles[s["run_by"]]["role"] in ("project_manager", "superadmin")
                )
            ],
        )
        report(
            "project run by someone not an active manager",
            [
                tag(p, "project")
                for p in projects
                if p["project_manager_id"]
                and not (
                    roles.get(p["project_manager_id"])
                    and roles[p["project_manager_id"]]["active"]
                    and roles[p["project_manager_id"]]["role"] in ("project_manager", "superadmin")
                )
            ],
        )
        report(
            "homeowner account isn't a homeowner",
            [
                tag(s, "system")
                for s in systems
                if s["homeowner_id"] and (roles.get(s["homeowner_id"]) or {}).get("role") != "homeowner"
            ],
        )
        sys_by = {s["system_id"]: s for s in systems}

        def postal_of(raw: str | None) -> set[str]:
            return set(re.findall(r"\d{6}", raw or ""))

        report(
            "plant linked to a missing system",
            [p["station_code"][-6:] for p in plants if p["system_id"] and p["system_id"] not in sys_by],
        )
        report(
            "plant's FusionSolar postal code differs from its system's (wrong link?)",
            [
                tag(sys_by[p["system_id"]], "system")
                for p in plants
                if p["system_id"] in sys_by
                and postal_of(p["address"])
                and sys_by[p["system_id"]]["postal_code"] not in postal_of(p["address"])
            ],
        )
        report(
            "plant not linked to a system",
            [p["name"][:0] + p["station_code"][-6:] for p in plants if not p["system_id"]],
            "FusionSolar plants with no system in the app yet",
        )
        report("plant with no size (kWp)", [p["station_code"][-6:] for p in plants if not p["capacity_kwp"]])

        print("\nfigures")
        out = q("select system_id, month, kwh from system_output")
        report(
            "output month in the future", [f"system#{o['system_id']}" for o in out if o["month"] > today.replace(day=1)]
        )
        report("negative output", [f"system#{o['system_id']}" for o in out if o["kwh"] is not None and o["kwh"] < 0])
        avg = defaultdict(list)
        for o in out:
            if o["kwh"]:
                avg[o["system_id"]].append(float(o["kwh"]))
        report(
            "a month over 3 times the system's usual (typo?)",
            sorted(
                {
                    tag(sys_by[s], "system")
                    for s, v in avg.items()
                    if s in sys_by and len(v) > 2
                    for x in v
                    if x > 3 * sorted(v)[len(v) // 2]
                }
            ),
        )
        report("output for a missing system", [o["system_id"] for o in out if o["system_id"] not in sys_by])
        bill = q("select system_id, month from system_billing")
        report("billing for a missing system", [b["system_id"] for b in bill if b["system_id"] not in sys_by])
        inv = q(
            "select invoice_id, kind::text as kind, status::text as status, amount, system_id, project_id from invoices"
        )
        report(
            "invoice with a negative total",
            [i["invoice_id"] for i in inv if i["amount"] is not None and i["amount"] < 0],
        )
        report(
            "invoice for a missing system or project",
            [
                i["invoice_id"]
                for i in inv
                if (i["system_id"] and i["system_id"] not in sys_by)
                or (i["project_id"] and i["project_id"] not in by_pid)
            ],
        )

        if a.list:
            print("\nthe client list, code by code")
            from _lib.client_list import read

            m = re.search(r"(\d{4}-\d{2}-\d{2})", a.list.stem)
            wb = read(a.list, date.fromisoformat(m.group(1)) if m else today)
            sys_code = {s["project_code"]: s for s in systems if s["project_code"]}
            proj_code = {
                p["project_code"]: p for p in projects if p["project_code"] and p["project_id"] not in record_pids
            }
            report(
                "in the list, not in the app",
                [c.code for c in wb.clients if c.code and c.code not in sys_code and c.code not in proj_code],
            )
            report(
                "turned on in the list but a project in the app",
                [c.code for c in wb.clients if c.turned_on and c.code in proj_code and c.code not in sys_code],
            )
            listed = {c.code for c in wb.clients if c.code}
            report("in the app with a code the list doesn't have", sorted((set(sys_code) | set(proj_code)) - listed))
            diffs: dict[str, list[str]] = defaultdict(list)
            for c in wb.clients:
                s = sys_code.get(c.code)
                if not s or not c.turned_on:
                    continue
                for field, mine, theirs in (
                    ("postal code", s["postal_code"], c.postal),
                    ("turn-on date", s["turned_on_on"], c.turned_on),
                    ("phase", s["phase"], c.phase),
                    ("PPA", (s["ppa_kind"], s["ppa_years"]), (c.ppa_kind, c.ppa_years)),
                    (
                        "rate",
                        float(s["rate_per_kwh"]) if s["rate_per_kwh"] is not None else None,
                        float(c.rate) if c.rate is not None else None,
                    ),
                    ("inverters", sorted(x for x in s["inverters"] or [] if x), sorted(c.inverters)),
                ):
                    if theirs not in (None, "", [], (None, None)) and mine != theirs:
                        diffs[field].append(c.code)
            for field in ("postal code", "turn-on date", "phase", "PPA", "rate", "inverters"):
                report(
                    f"{field} differs from the list",
                    diffs.get(field, []),
                    "changed in the app since, or kept from the earlier listing",
                )
        conn.rollback()
    print(f"\n{'Nothing found.' if not found else f'{found} findings above.'} Read-only: nothing was changed.")


def _count(xs: Any) -> dict[Any, int]:
    out: dict[Any, int] = defaultdict(int)
    for x in xs:
        if x:
            out[x] += 1
    return out


if __name__ == "__main__":
    main()
