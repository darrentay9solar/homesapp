"""A system's yearly maintenance checks (migration 0046).

There's no check in a system's first year. From the second, one a year for
the years of its maintenance plan: the first 24 months after turn-on, then
every 12 months, the last in the plan's final year. A plan of 5 years has
four checks (years 2 to 5); a plan of 8, seven. "Free for 5 years" and "5
years excluding 1st year" both mean years 2 to 5. Without a plan's years the
contract's (the PPA's) are used; with neither, or no turn-on date, there are
no dates and the record says what's missing.

Each check's key is "year_<n>" (year_2, year_3, ...), the same key a booked
visit (meetings.check_key) and a reminder carry. What's stored is when each
one was done (maintenance_checks); when it's due follows from the turn-on
date, so moving that date moves them all.

The 6-month check is a record for the office only (maintenance_systems.six_month_due
and six_month_done_on, migration 0057): six months after turn-on unless the client
list gave its own date, recorded when done; no reminders, no workflow, and never
shown to the homeowner. The old 1-year check (one_year_*) is no longer used.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from _lib.db import fetch_all

FIRST_YEAR = 2  # no yearly check in the first year
SIX_MONTH = "six_month"
KEY = re.compile(r"^year_([2-9]|[1-3][0-9]|40)$")


@dataclass(frozen=True)
class Check:
    key: str
    year: int
    due: date | None
    done_on: date | None


def key_for(year: int) -> str:
    return f"year_{year}"


def year_of(key: str) -> int | None:
    m = KEY.match(key or "")
    return int(m.group(1)) if m else None


def label(key: str) -> str:
    """'Year 2 check' (put through TR()/tr() where it's shown)."""
    if key == SIX_MONTH:
        return "6-month check"
    n = year_of(key)
    return f"Year {n} check" if n else "Maintenance check"


def add_months(d: date, n: int) -> date:
    """d plus n months, on the month's last day when it's shorter (29 Feb + 12 months = 28 Feb)."""
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def term(s: dict[str, Any]) -> int | None:
    """How many years the checks run: the maintenance plan's, else the contract's."""
    return s.get("plan_years") or s.get("ppa_years") or None


def years(term_years: int | None) -> range:
    """The years that have a check: 2 to the term's last."""
    return range(FIRST_YEAR, (term_years or 0) + 1)


def due_on(turned_on: date | None, year: int) -> date | None:
    """Year n's check: n x 12 months after turn-on (year 2, 24 months)."""
    return add_months(turned_on, 12 * year) if turned_on else None


def done(system_ids: list[int]) -> dict[int, dict[int, date]]:
    """When each system's checks were done: {system_id: {year: done_on}}."""
    out: dict[int, dict[int, date]] = {}
    if not system_ids:
        return out
    for r in fetch_all(
        "select system_id, year, done_on from maintenance_checks where system_id = any(%s) and done_on is not null",
        (system_ids,),
    ):
        out.setdefault(r["system_id"], {})[r["year"]] = r["done_on"]
    return out


def six_month(s: dict[str, Any]) -> Check | None:
    """The 6-month check, for the office's record: its own date from the client list, or 6 months after turn-on."""
    due = s.get("six_month_due") or (add_months(s["turned_on_on"], 6) if s.get("turned_on_on") else None)
    if not due and not s.get("six_month_done_on"):
        return None
    return Check(SIX_MONTH, 0, due, s.get("six_month_done_on"))


def for_system(s: dict[str, Any], done_years: dict[int, date] | None = None, *, office: bool = False) -> list[Check]:
    """A maintenance_systems row's yearly checks, in order; for the office, the 6-month check first."""
    got = done_years or {}
    yearly = [Check(key_for(y), y, due_on(s["turned_on_on"], y), got.get(y)) for y in years(term(s))]
    first = six_month(s) if office else None
    return [first, *yearly] if first else yearly


def open_checks(s: dict[str, Any], done_years: dict[int, date] | None = None) -> list[Check]:
    """The checks with a date and not done yet."""
    return [c for c in for_system(s, done_years) if c.due and not c.done_on]


def all_systems(sql_where: str = "true", params: Any = None) -> list[tuple[dict[str, Any], list[Check]]]:
    """Every system matching sql_where (on maintenance_systems m), with its checks."""
    rows = fetch_all(f"select m.* from maintenance_systems m where {sql_where}", params)
    got = done([r["system_id"] for r in rows])
    return [(r, for_system(r, got.get(r["system_id"]))) for r in rows]


def summary(s: dict[str, Any], done_years: dict[int, date] | None = None) -> tuple[date | None, str | None]:
    """For a sheet or a sentence: the next check's due date, and the done ones ("Year 2: 2027-03-01; ...")."""
    cs = for_system(s, done_years)
    nxt = next((c.due for c in cs if c.due and not c.done_on), None)
    done_text = "; ".join(f"{label(c.key)}: {c.done_on.isoformat()}" for c in cs if c.done_on) or None
    return nxt, done_text
