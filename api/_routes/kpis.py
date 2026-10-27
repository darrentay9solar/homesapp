# ruff: noqa: E501  (the calculations read better whole)
"""The business in figures, for the company and its investors: each figure with the inputs it's worked out
from, so the page can show the calculation beside it (docs/kpis.md).

  GET /kpis          superadmins and Admin (it has the amounts)

  portfolio    systems running, installed kWp, installs in progress, growth over 12 months
  generation   lifetime and recent kWh, kWh per kWp a day, actual beside the client record's estimate
  revenue      last month's billing (kWh x each system's rate), the run-rate, what the contracts still
               bring in (an estimate), admin fees, invoiced and collected
  customers    the price beside SP's tariff, what customers saved, CO2 avoided
  operations   plant health, alarms, how fresh the figures are
  checks       what makes a figure less certain: missing rates, contract terms the invoices don't follow…

Everything is totals: no homeowner's name, address or figures of their own.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from _lib import invoices as iv
from _lib import tariff
from _lib.account import Account
from _lib.db import fetch_all, fetch_one
from _lib.solar_sync import SG
from _lib.web import active

router = APIRouter()

CO2_KG_PER_KWH = Decimal("0.475")  # the same as the FusionSolar pages (api/_routes/solar.py)
CO2_KG_PER_TREE = Decimal("18.3")
IN_PROGRESS = ("awaiting_homeowner", "homeowner_approved", "pm_approved", "in_progress", "awaiting_signature", "signed")


def _f(v: Any, digits: int = 2) -> float | None:
    return None if v is None else round(float(v), digits)


def _months_between(first: date, last: date) -> int:
    """Months from ``first``'s month to ``last``'s, both counted."""
    return (last.year - first.year) * 12 + last.month - first.month + 1


def figures(today: date) -> dict[str, Any]:
    s = fetch_one("select * from finance_settings where id = 1") or {
        "admin_fee": Decimal(0),
        "plan_years": 8,
        "due_days": 14,
    }
    last = iv.add_months(iv.month_start(today), -1)  # the last finished month
    months = [iv.add_months(last, -i) for i in range(11, -1, -1)]  # the 12 finished months up to it

    systems = fetch_all(
        "select system_id, project_code, kwp, rate_per_kwh, ppa_kind, ppa_years, turned_on_on, est_monthly_kwh, "
        "billing_period, solar_plan from maintenance_systems"
    )
    by_id = {r["system_id"]: r for r in systems}
    output = fetch_all(
        "select system_id, month, kwh from system_output where month between %s and %s", (months[0], last)
    )
    kwh_at: dict[tuple[int, date], Decimal] = {
        (r["system_id"], r["month"]): Decimal(r["kwh"]) for r in output if r["kwh"] is not None
    }

    # ---------------------------------------------------------------- portfolio
    year_ago = iv.add_months(today, -12)
    in_progress = fetch_one("select count(*)::int n from projects where status::text = any(%s)", (list(IN_PROGRESS),))[
        "n"
    ]
    kwp_known = [Decimal(r["kwp"]) for r in systems if r["kwp"] is not None]
    new = [r for r in systems if r["turned_on_on"] and r["turned_on_on"] >= year_ago]
    portfolio = {
        "systems": len(systems),
        "byPlan": sorted(
            ({"plan": k or "—", "n": v} for k, v in _count(r["solar_plan"] for r in systems).items()),
            key=lambda x: -x["n"],
        ),
        "kwp": _f(sum(kwp_known, Decimal(0)), 1),
        "kwpKnown": len(kwp_known),
        "inProgress": in_progress,
        "newIn12Months": len(new),
        "kwpNewIn12Months": _f(sum((Decimal(r["kwp"]) for r in new if r["kwp"] is not None), Decimal(0)), 1),
        "firstOn": min((r["turned_on_on"] for r in systems if r["turned_on_on"]), default=None),
    }

    # ---------------------------------------------------------------- generation and revenue, month by month
    def billed(month: date) -> dict[str, Any]:
        """A month as invoiced: each system's kWh x its rate, to the cent."""
        kwh = Decimal(0)
        amount = Decimal(0)
        n = 0
        no_rate = 0
        for (sid, m), k in kwh_at.items():
            if m != month:
                continue
            rate = by_id.get(sid, {}).get("rate_per_kwh")
            kwh += k
            n += 1
            if rate is None:
                no_rate += 1
                continue
            amount += iv.monthly_amount(k, rate)
        return {"month": month.isoformat()[:7], "kwh": kwh, "amount": amount, "systems": n, "noRate": no_rate}

    series = [billed(m) for m in months]
    lm = series[-1]
    three = series[-3:]
    run_rate_3 = sum((m["amount"] for m in three), Decimal(0)) / len(three) * 12 if three else Decimal(0)

    # kWh per kWp a day, last month: only systems with both a size and a figure.
    days = (iv.add_months(last, 1) - last).days
    sized = [
        (kwh_at[(r["system_id"], last)], Decimal(r["kwp"]))
        for r in systems
        if (r["system_id"], last) in kwh_at and r["kwp"]
    ]
    sized_kwh = sum((k for k, _ in sized), Decimal(0))
    sized_kwp = sum((p for _, p in sized), Decimal(0))
    estimated = [
        (kwh_at[(r["system_id"], last)], Decimal(r["est_monthly_kwh"]))
        for r in systems
        if (r["system_id"], last) in kwh_at and r["est_monthly_kwh"]
    ]
    est_actual = sum((a for a, _ in estimated), Decimal(0))
    est_expected = sum((e for _, e in estimated), Decimal(0))
    lifetime = fetch_one("select sum(total_kwh) kwh, count(total_kwh)::int n from solar_plants")
    generation = {
        "lifetimeKwh": _f(lifetime["kwh"], 0),
        "lifetimePlants": lifetime["n"],
        "lastMonth": lm["month"],
        "lastMonthKwh": _f(lm["kwh"], 0),
        "twelveMonthKwh": _f(sum((m["kwh"] for m in series), Decimal(0)), 0),
        "specificYield": {
            "value": _f(sized_kwh / sized_kwp / days, 2) if sized_kwp else None,
            "kwh": _f(sized_kwh, 0),
            "kwp": _f(sized_kwp, 1),
            "days": days,
            "systems": len(sized),
        },
        "vsEstimate": {
            "pct": _f(est_actual / est_expected * 100, 1) if est_expected else None,
            "actualKwh": _f(est_actual, 0),
            "estimatedKwh": _f(est_expected, 0),
            "systems": len(estimated),
        },
    }

    # What the contracts still bring in: each PPA system's months left in its own term x its usual month x
    # its rate. Its usual month is its average billed month in the last 12 (3 or more of them), else the
    # client record's estimate. An estimate: no allowance for panels ageing, weather or discounting.
    term_default = int(s["plan_years"])
    remaining = Decimal(0)
    months_left_total = 0
    counted = 0
    by_basis = {"actual": 0, "estimate": 0}
    for r in systems:
        if r["ppa_kind"] != "ppa" or r["rate_per_kwh"] is None or not r["turned_on_on"]:
            continue
        term = int(r["ppa_years"] or term_default)
        left = max(0, term * 12 - _months_between(r["turned_on_on"], last))
        own = [kwh_at[(r["system_id"], m)] for m in months if (r["system_id"], m) in kwh_at]
        if len(own) >= 3:
            usual, basis = sum(own, Decimal(0)) / len(own), "actual"
        elif r["est_monthly_kwh"]:
            usual, basis = Decimal(r["est_monthly_kwh"]), "estimate"
        else:
            continue
        remaining += usual * Decimal(r["rate_per_kwh"]) * left
        months_left_total += left
        counted += 1
        by_basis[basis] += 1

    inv = fetch_one(
        "select coalesce(sum(amount) filter (where status <> 'void'), 0) issued, "
        "coalesce(sum(coalesce(paid_amount, amount)) filter (where status = 'paid'), 0) paid, "
        "coalesce(sum(amount) filter (where status = 'issued'), 0) outstanding, "
        "coalesce(sum(amount) filter (where status = 'issued' and due_on < %s), 0) overdue, "
        "count(*) filter (where status <> 'void')::int n, count(*) filter (where status = 'issued' and due_on < %s)::int overdue_n, "
        "count(*) filter (where kind = 'monthly' and status <> 'void')::int monthly_n "
        "from invoices",
        (today, today),
    )
    fees = fetch_one(
        "select count(*) filter (where status <> 'void')::int issued, count(*) filter (where status = 'paid')::int paid "
        "from invoices where kind = 'admin_fee'"
    )
    revenue = {
        "lastMonth": {
            "month": lm["month"],
            "amount": _f(lm["amount"]),
            "kwh": _f(lm["kwh"], 0),
            "systems": lm["systems"],
            "noRate": lm["noRate"],
        },
        "runRate": {
            "fromLastMonth": _f(lm["amount"] * 12),
            "fromThreeMonths": _f(run_rate_3),
            "months": [m["month"] for m in three],
        },
        "contracted": {
            "amount": _f(remaining, 0),
            "systems": counted,
            "monthsLeft": months_left_total,
            "avgYearsLeft": _f(Decimal(months_left_total) / counted / 12, 1) if counted else None,
            "byActual": by_basis["actual"],
            "byEstimate": by_basis["estimate"],
            "defaultYears": term_default,
        },
        "adminFees": {
            "fee": _f(s["admin_fee"]),
            "toCome": in_progress,
            "toComeAmount": _f(Decimal(s["admin_fee"]) * in_progress),
            "issued": fees["issued"],
            "paid": fees["paid"],
        },
        "invoices": {
            "count": inv["n"],
            "monthly": inv["monthly_n"],
            "issued": _f(inv["issued"]),
            "paid": _f(inv["paid"]),
            "outstanding": _f(inv["outstanding"]),
            "overdue": _f(inv["overdue"]),
            "overdueCount": inv["overdue_n"],
            "collectedPct": _f(Decimal(inv["paid"]) / Decimal(inv["issued"]) * 100, 1) if inv["issued"] else None,
        },
        "months": [
            {"month": m["month"], "kwh": _f(m["kwh"], 0), "amount": _f(m["amount"]), "systems": m["systems"]}
            for m in series
        ],
    }

    # ---------------------------------------------------------------- customers
    sp = {m["month"]: m["withGst"] for m in tariff.monthly(today)}
    sp_now = fetch_one(
        "select starts_on, cents_with_gst from sp_tariffs where source = 'sp_group' order by starts_on desc limit 1"
    )
    rate_kwh = sum(
        (
            kwh_at[(r["system_id"], last)]
            for r in systems
            if (r["system_id"], last) in kwh_at and r["rate_per_kwh"] is not None
        ),
        Decimal(0),
    )
    rate_amt = lm["amount"]
    avg_rate = rate_amt / rate_kwh if rate_kwh else None  # $ per kWh, weighted by kWh
    saved = Decimal(0)
    saved_kwh = Decimal(0)
    for (sid, m), k in kwh_at.items():
        rate = by_id.get(sid, {}).get("rate_per_kwh")
        cents = sp.get(m.isoformat()[:7])
        if rate is None or cents is None:
            continue
        saved += k * (Decimal(str(cents)) / 100 - Decimal(rate))
        saved_kwh += k
    sp_cents = Decimal(sp_now["cents_with_gst"]) if sp_now and sp_now["cents_with_gst"] is not None else None
    life = Decimal(lifetime["kwh"] or 0)
    customers = {
        "avgRate": _f(avg_rate, 4),
        "spWithGst": _f(sp_cents),
        "spFrom": sp_now["starts_on"].isoformat() if sp_now else None,
        "cheaperPct": _f((sp_cents / 100 - avg_rate) / (sp_cents / 100) * 100, 1) if sp_cents and avg_rate else None,
        "saved12Months": _f(saved, 0),
        "savedKwh": _f(saved_kwh, 0),
        "co2Tons": _f(life * CO2_KG_PER_KWH / 1000, 1),
        "trees": int(life * CO2_KG_PER_KWH / CO2_KG_PER_TREE),
        "co2PerKwh": float(CO2_KG_PER_KWH),
        "kgPerTree": float(CO2_KG_PER_TREE),
    }

    # ---------------------------------------------------------------- operations
    health = {"normal": 0, "faulty": 0, "disconnected": 0, "unknown": 0} | {
        r["h"]: r["n"]
        for r in fetch_all("select coalesce(health, 'unknown') h, count(*)::int n from solar_plants group by 1")
    }
    plants = sum(health.values())
    alarms = {"critical": 0, "major": 0, "minor": 0, "warning": 0} | {
        r["level"]: r["n"]
        for r in fetch_all("select level, count(*)::int n from solar_alarms where cleared_at is null group by 1")
    }
    synced = fetch_one("select max(at) at from solar_sync where key = 'ran:live'")
    linked = fetch_one("select count(distinct system_id)::int n from solar_plants where system_id is not null")["n"]
    operations = {
        "plants": plants,
        "health": health,
        "normalPct": _f(Decimal(health["normal"]) / plants * 100, 1) if plants else None,
        "alarms": alarms,
        "monitored": linked,
        "lastSync": synced["at"].isoformat() if synced and synced["at"] else None,
    }

    # ---------------------------------------------------------------- what makes a figure less certain
    differs = fetch_one(
        "select count(*)::int n from system_output o join solar_plants p on p.system_id = o.system_id "
        "join solar_readings r on r.station_code = p.station_code and r.period = 'month' "
        "and (r.at at time zone 'Asia/Singapore')::date = o.month "
        "where o.month < date_trunc('month', now()) and abs(o.kwh - r.kwh) > 0.05"
    )["n"]
    codes = lambda rows: sorted(r["project_code"] or f"#{r['system_id']}" for r in rows)  # noqa: E731
    term_differs = [
        r
        for r in systems
        if r["ppa_kind"] == "ppa" and r["ppa_years"] is not None and int(r["ppa_years"]) != term_default
    ]
    checks = [
        {"key": "no_rate", "n": sum(1 for r in systems if r["rate_per_kwh"] is None), "codes": codes(r for r in systems if r["rate_per_kwh"] is None)},
        {"key": "term_differs", "n": len(term_differs), "codes": codes(term_differs), "years": term_default},
        {"key": "not_ppa", "n": sum(1 for r in systems if r["ppa_kind"] != "ppa"), "codes": codes(r for r in systems if r["ppa_kind"] != "ppa")},
        {"key": "own_period", "n": sum(1 for r in systems if r["billing_period"] and r["billing_period"] != "Full Calendar Month"),
         "codes": codes(r for r in systems if r["billing_period"] and r["billing_period"] != "Full Calendar Month")},
        {"key": "unmonitored", "n": len(systems) - linked, "codes": []},
        {"key": "unlinked_plants", "n": fetch_one("select count(*)::int n from solar_plants where system_id is null")["n"], "codes": []},
        {"key": "kwh_differs", "n": differs, "codes": []},
        {"key": "no_size", "n": len(systems) - len(kwp_known), "codes": codes(r for r in systems if r["kwp"] is None)},
        {"key": "no_estimate", "n": sum(1 for r in systems if not r["est_monthly_kwh"]), "codes": codes(r for r in systems if not r["est_monthly_kwh"])},
    ]  # fmt: skip

    return {
        "asOf": today.isoformat(),
        "portfolio": {**portfolio, "firstOn": portfolio["firstOn"].isoformat() if portfolio["firstOn"] else None},
        "generation": generation,
        "revenue": revenue,
        "customers": customers,
        "operations": operations,
        "checks": [c for c in checks if c["n"]],
    }


def _count(values: Any) -> dict[Any, int]:
    out: dict[Any, int] = defaultdict(int)
    for v in values:
        out[v] += 1
    return out


@router.get("/kpis")
def kpis(acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.role not in ("superadmin", "finance"):
        raise HTTPException(403, "The business's figures are for superadmins and Admin.")
    return figures(datetime.now(SG).date())
