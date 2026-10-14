"""The client record from 9 Solar Home's project list (migration 0038), as project managers see it.

For a maintenance system: the client record, the monthly solar output against
the estimate, the billing periods, what the homeowner said, and the
inverters' warranties. For a project: the same record and warranties.
Project managers and superadmins only: the API decides who asks.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from _lib.db import fetch_all, fetch_one


def model_key(model: str) -> str:
    """SUN2000-10KTL-LC0 and SUN2000-10K-LC0 are the same inverter (scripts/import_client_list.py)."""
    k = re.sub(r"\s+", "", (model or "").upper())
    return re.sub(r"(\d+)KTL", r"\1K", k)


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _num(v: Any) -> float | None:
    return float(v) if v is not None else None


def _years_after(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 February
        return d.replace(year=d.year + years, day=28)


def warranties(models: list[str], since: date | None) -> list[dict[str, Any]]:
    """Each inverter's warranty (and price), and until when it runs from the turn-on."""
    keys = list(dict.fromkeys(model_key(m) for m in models if m))
    if not keys:
        return []
    found = {r["model_key"]: r for r in fetch_all("select * from inverter_models where model_key = any(%s)", (keys,))}
    out = []
    for k in keys:
        r = found.get(k)
        out.append({
            "model": r["model"] if r else k,
            "known": r is not None,
            "years": r["warranty_years"] if r else None,
            "until": _iso(_years_after(since, r["warranty_years"])) if r and since and r["warranty_years"] else None,
            "priceExGst": _num(r["price_ex_gst"]) if r else None,
            "priceInclGst": _num(r["price_incl_gst"]) if r else None,
        })  # fmt: skip
    return out


def feedback(*, system_id: int | None = None, project_id: int | None = None) -> list[dict[str, Any]]:
    rows = fetch_all(
        "select feedback_id, body, created_at from client_feedback "
        "where (%(s)s::int is not null and system_id = %(s)s) or (%(p)s::int is not null and project_id = %(p)s) "
        "order by created_at desc",
        {"s": system_id, "p": project_id},
    )
    return [{"id": r["feedback_id"], "body": r["body"], "at": r["created_at"].isoformat()} for r in rows]


def for_system(r: dict[str, Any]) -> dict[str, Any]:
    """A maintenance system's client record, output, billing, feedback and warranties."""
    sid = r["system_id"]
    output = fetch_all("select month, kwh from system_output where system_id = %s order by month", (sid,))
    billing = fetch_all("select month, period from system_billing where system_id = %s order by month", (sid,))
    est = _num(r.get("est_monthly_kwh"))
    months = [{"month": _iso(o["month"]), "kwh": float(o["kwh"])} for o in output]
    total = round(sum(m["kwh"] for m in months), 2)
    return {
        "record": {
            "projectCode": r.get("project_code"),
            "salutation": r.get("salutation"),
            "email": r.get("homeowner_email"),
            "signedOn": _iso(r.get("signed_on")),
            "salesperson": r.get("salesperson"),
            "referrer": r.get("referrer"),
            "plan": r.get("solar_plan"),
            "ratePerKwh": _num(r.get("rate_per_kwh")),
            "epc": r.get("epc"),
            "inverterSerials": list(r.get("inverter_serials") or []),
            "dongleSerials": list(r.get("dongle_serials") or []),
            "installationStart": _iso(r.get("installation_start")),
            "installationEnd": _iso(r.get("installation_end")),
            "billingPeriod": r.get("billing_period"),
        },
        "output": {
            "estMonthlyKwh": est,
            "months": months,
            "total": total,
            # Against the estimate: the average month as a share of it.
            "ofEstimate": round(total / len(months) / est, 3) if months and est else None,
        },
        "billing": [{"month": _iso(b["month"]), "period": b["period"]} for b in billing],
        "feedback": feedback(system_id=sid),
        "warranties": warranties(list(r.get("inverters") or []), r.get("turned_on_on")),
    }


def for_project(pid: int) -> dict[str, Any] | None:
    p = fetch_one("select * from projects where project_id = %s", (pid,))
    if not p:
        return None
    models = [m.strip() for m in re.split(r"\s*\+\s*|\n", p.get("inverter_to_order") or "") if m.strip()]
    return {
        "record": {
            "projectCode": p.get("project_code"),
            "salutation": p.get("salutation"),
            "email": p.get("homeowner_email"),
            "signedOn": _iso(p.get("signed_on")),
            "salesperson": p.get("sales"),
            "referrer": p.get("referrer"),
            "plan": p.get("solar_plan"),
            "ratePerKwh": _num(p.get("rate_per_kwh")),
            "ppa": {"kind": p.get("ppa_kind"), "years": p.get("ppa_years")} if p.get("ppa_kind") else None,
            "phase": p.get("phase"),
            "dongleSerial": p.get("dongle_serial"),
            "note": p.get("record_note"),
        },
        "feedback": feedback(project_id=pid),
        "warranties": warranties(models, p.get("sp_turn_on_inspection_date")),
    }
