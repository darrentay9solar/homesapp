"""Electricity prices: SP Group's tariff now and before, what SP pays for solar sent to the grid, and (for a
homeowner) what their own solar costs beside it (api/_lib/tariff.py, docs/tariffs.md).

  GET /tariffs                         everyone signed in: homeowners as well as staff
  GET /tariffs?from=YYYY-MM-DD&to=…     with the averages between two dates (either may be left out)
  GET /tariffs?on=YYYY-MM-DD            with the figures in force on one day
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from _lib import tariff
from _lib.account import Account
from _lib.db import fetch_one
from _lib.solar_sync import SG
from _lib.web import active

router = APIRouter()


def _mine(acct: Account, buying: float | None, now: datetime) -> dict[str, Any] | None:
    """A homeowner's own: their contract's rate for solar, this month's yield, and what it saved on SP's tariff."""
    if acct.role != "homeowner":
        return None
    s = fetch_one(
        "select m.system_id, m.rate_per_kwh, p.station_code from maintenance_systems m "
        "left join solar_plants p on p.system_id = m.system_id where m.homeowner_id = %s limit 1",
        (acct.uid,),
    )
    if not s:
        return None
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    got = (
        fetch_one(
            "select kwh from solar_readings where station_code = %s and period = 'month' and at = %s",
            (s["station_code"], month),
        )
        if s["station_code"]
        else None
    )
    kwh = float(got["kwh"]) if got and got["kwh"] is not None else None
    rate = float(s["rate_per_kwh"]) * 100 if s["rate_per_kwh"] is not None else None  # cents per kWh
    known = kwh is not None and rate is not None and buying is not None
    saved = round(kwh * (buying - rate) / 100, 2) if known else None  # type: ignore[operator]
    return {
        "rateCents": round(rate, 2) if rate is not None else None,
        "monthKwh": round(kwh, 1) if kwh is not None else None,
        "savedSgd": saved,
        "cheaperCents": round(buying - rate, 2) if rate is not None and buying is not None else None,
    }


def _date(v: str | None, what: str) -> date | None:
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError as exc:
        raise HTTPException(400, f"That isn't a date for {what} (YYYY-MM-DD).") from exc


@router.get("/tariffs")
def tariffs(
    acct: Account = Depends(active),
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    on: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(SG)
    lo, hi, day = _date(start, "From"), _date(end, "To"), _date(on, "the date")
    if lo and hi and lo > hi:
        raise HTTPException(400, "From comes after To.")
    out = tariff.overview(now.date(), lo, hi, day)
    buying = out["current"]["buying"] if out["current"] else None
    out["mine"] = _mine(acct, buying, now)
    return out
