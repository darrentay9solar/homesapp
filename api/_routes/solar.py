# ruff: noqa: E501  (SQL reads better whole)
"""Solar monitoring: everything FusionSolar shows, in the app (docs/solar.md).

  GET  /solar                       the overview: power now, today, revenue, totals; plants by
                                    health; alarms by level; every plant, as its table shows it
  GET  /solar/plants/{code}         one plant: its figures, environmental benefits, inverters,
                                    alarms, and the system it's linked to
  GET  /solar/plants/{code}/energy  yield (and revenue) by hour of a day, day of a month,
                                    month of a year, or by year (?period=day|month|year|lifetime&date=)
  GET  /solar/plants/{code}/report  the same as rows, for a table and Excel (?by=hour|day|month&start=&end=)
  POST /solar/plants/{code}/link    which system in the app this plant is (or none)
  GET  /me/solar                    a homeowner's own plant

Who sees what follows Maintenance: a superadmin and Admin see every plant; a project manager
the plants of the systems they run, any system nobody runs, and plants not linked yet. A
homeowner sees only the plant of their own system. Revenue is the plant's yield at the rate in
the system's contract (FusionSolar has no tariff set); without a linked system, FusionSolar's own.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from _lib import fusionsolar as fs
from _lib import weather
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.solar_sync import INVERTERS, SG
from _lib.web import active, role

router = APIRouter()
staff = role("project_manager", "finance")

# FusionSolar's own factors, so the figures match what people saw there.
COAL_KG_PER_KWH = Decimal("0.4")
CO2_KG_PER_KWH = Decimal("0.475")
CO2_KG_PER_TREE = Decimal("18.3")
STALE = timedelta(minutes=45)  # live figures older than this are shown as not live


def _visible(acct: Account) -> tuple[str, dict[str, Any]]:
    """Which plants: the same rule as Maintenance's systems, and every plant not linked yet."""
    if acct.role in ("superadmin", "finance"):
        return "true", {}
    return "(p.system_id is null or m.run_by is null or m.run_by = %(me)s)", {"me": acct.uid}


def _f(v: Any) -> float | None:
    return None if v is None else float(v)


def _revenue(kwh: Any, rate: Any, fallback: Any = None) -> float | None:
    if kwh is not None and rate is not None:
        return round(float(Decimal(kwh) * Decimal(rate)), 2)
    return _f(fallback)


def _benefits(total_kwh: Any) -> dict[str, float | int | None]:
    if total_kwh is None:
        return {"coalTons": None, "co2Tons": None, "trees": None}
    kwh = Decimal(total_kwh)
    co2 = kwh * CO2_KG_PER_KWH
    return {
        "coalTons": round(float(kwh * COAL_KG_PER_KWH / 1000), 3),
        "co2Tons": round(float(co2 / 1000), 3),
        "trees": int((co2 / CO2_KG_PER_TREE).to_integral_value()),
    }


def _connection() -> dict[str, Any]:
    last = fetch_one("select max(at) at from solar_sync where key = 'ran:live'")
    return {"connected": fs.configured(), "lastSync": last["at"].isoformat() if last and last["at"] else None}


PLANT_COLUMNS = (
    "p.station_code, p.name, p.address, p.latitude, p.longitude, coalesce(p.capacity_kwp, m.kwp) as capacity_kwp, p.grid_connected_on, p.health, p.current_kw, p.today_kwh, "
    "p.month_kwh, p.year_kwh, p.total_kwh, p.today_income, p.total_income, p.today_feed_in_kwh, p.today_use_kwh, p.live_at, p.system_id, p.linked_by, "
    "m.rate_per_kwh, m.project_code, m.homeowner_name, m.run_by, u.full_name as homeowner_full_name"
)
FROM = "from solar_plants p left join maintenance_systems m on m.system_id = p.system_id left join users u on u.uid = m.homeowner_id"


def _row(r: dict[str, Any], now: datetime) -> dict[str, Any]:
    live = r["live_at"] is not None and now - r["live_at"] <= STALE
    cap = r["capacity_kwp"]
    return {
        "code": r["station_code"],
        "name": r["name"],
        "address": r["address"],
        "capacityKwp": _f(cap),
        "gridConnectedOn": r["grid_connected_on"].isoformat() if r["grid_connected_on"] else None,
        "health": r["health"] or "unknown",
        "live": live,
        "currentKw": _f(r["current_kw"]) if live else None,
        "todayKwh": _f(r["today_kwh"]),
        "monthKwh": _f(r["month_kwh"]),
        "totalKwh": _f(r["total_kwh"]),
        # Only where the plant has a meter: FusionSolar gives 0 otherwise, which isn't a reading.
        "feedInTodayKwh": _f(r["today_feed_in_kwh"]) if r["today_feed_in_kwh"] else None,
        "usedTodayKwh": _f(r["today_use_kwh"]) if r["today_use_kwh"] else None,
        # kWh for each kWp installed today: how well a plant is doing whatever its size.
        "specificYield": round(float(r["today_kwh"] / cap), 2) if r["today_kwh"] is not None and cap else None,
        "todayRevenue": _revenue(r["today_kwh"], r["rate_per_kwh"], r["today_income"]),
        "totalRevenue": _revenue(r["total_kwh"], r["rate_per_kwh"], r["total_income"]),
        "rate": _f(r["rate_per_kwh"]),
        "liveAt": r["live_at"].isoformat() if r["live_at"] else None,
        "systemId": r["system_id"],
        "projectCode": r["project_code"],
        "homeowner": r["homeowner_full_name"] or r["homeowner_name"],
        "linkedBy": r["linked_by"],
    }


@router.get("/solar")
def overview(acct: Account = Depends(staff)) -> dict[str, Any]:
    where, params = _visible(acct)
    now = datetime.now(SG)
    plants = [_row(r, now) for r in fetch_all(f"select {PLANT_COLUMNS} {FROM} where {where} order by p.name", params)]
    codes = [p["code"] for p in plants]
    alarms = fetch_all(
        "select level, count(*)::int n from solar_alarms where cleared_at is null and station_code = any(%s) group by level",
        (codes,),
    )
    by_level = {"critical": 0, "major": 0, "minor": 0, "warning": 0} | {a["level"]: a["n"] for a in alarms}
    health = {"normal": 0, "faulty": 0, "disconnected": 0, "unknown": 0}
    for p in plants:
        health[p["health"]] += 1

    def total(key: str, digits: int = 3) -> float | None:
        vals = [p[key] for p in plants if p[key] is not None]
        return round(sum(vals), digits) if vals else None

    return {
        "connection": _connection(),
        "kpis": {
            "currentKw": total("currentKw"),
            "todayKwh": total("todayKwh"),
            "todayRevenue": total("todayRevenue", 2),
            "totalKwh": total("totalKwh"),
            "capacityKwp": total("capacityKwp"),
        },
        "health": health,
        "alarms": by_level,
        "plants": plants,
        "unlinked": sum(1 for p in plants if p["systemId"] is None),
    }


def _plant(code: str, acct: Account) -> dict[str, Any]:
    if acct.role == "homeowner":
        r = fetch_one(
            f"select {PLANT_COLUMNS} {FROM} where p.station_code = %s and m.homeowner_id = %s", (code, acct.uid)
        )
    else:
        where, params = _visible(acct)
        r = fetch_one(
            f"select {PLANT_COLUMNS} {FROM} where p.station_code = %(code)s and {where}", {"code": code, **params}
        )
    if not r:
        raise HTTPException(404, "No such plant, or it isn't one of yours.")
    return r


def _detail(r: dict[str, Any], acct: Account) -> dict[str, Any]:
    now = datetime.now(SG)
    out = _row(r, now)
    year_start = datetime(now.year, 1, 1, tzinfo=SG)
    yr = fetch_one(
        "select sum(kwh) kwh from solar_readings where station_code = %s and period = 'month' and at >= %s",
        (r["station_code"], year_start),
    )
    out["yearKwh"] = _f(yr["kwh"]) if yr and yr["kwh"] is not None else _f(r["year_kwh"])
    out["benefits"] = _benefits(r["total_kwh"])
    out["weather"] = weather.for_place(r["latitude"], r["longitude"], now)
    out["devices"] = [
        _device(d, acct, now)
        for d in fetch_all(
            "select * from solar_devices where station_code = %s order by type_id = any(%s) desc, name",
            (r["station_code"], list(INVERTERS)),
        )
    ]
    out["alarms"] = [
        {
            "level": a["level"],
            "name": a["name"],
            "device": a["device"] or None,
            "cause": a["cause"],
            "suggestion": a["suggestion"],
            "raisedAt": a["raised_at"].isoformat(),
            "clearedAt": a["cleared_at"].isoformat() if a["cleared_at"] else None,
            # FusionSolar's own alarm, or the app's output check (solar_sync.check_output).
            "source": a["source"],
        }
        for a in fetch_all(
            "select * from solar_alarms where station_code = %s and (cleared_at is null or cleared_at > now() - interval '90 days') "
            "order by cleared_at is not null, raised_at desc limit 100",
            (r["station_code"],),
        )
    ]
    if acct.role == "homeowner":
        for k in ("homeowner", "linkedBy", "projectCode"):
            out.pop(k, None)
    out["connection"] = _connection()
    return out


KINDS = {1: "inverter", 38: "inverter", 62: "dongle", 47: "meter", 39: "battery"}


def _ms_iso(v: Any) -> str | None:
    return datetime.fromtimestamp(v / 1000, SG).isoformat() if isinstance(v, int | float) and v > 0 else None


def _device(d: dict[str, Any], acct: Account, now: datetime) -> dict[str, Any]:
    """One device, with an inverter's live readings as FusionSolar shows them, grouped."""
    live = d["live_at"] is not None and now - d["live_at"] <= STALE
    r: dict[str, float] = (d["readings"] or {}) if live else {}
    g = r.get
    strings = [
        {"n": i, "voltage": g(f"pv{i}_u"), "current": g(f"pv{i}_i")}
        for i in range(1, 49)
        if g(f"pv{i}_u") or g(f"pv{i}_i")  # a string not in use (or at night) reads 0
    ]
    return {
        "id": d["dev_id"],
        "name": d["name"],
        "kind": KINDS.get(d["type_id"], "device"),
        "serial": d["serial"] if acct.role != "homeowner" else None,
        "model": d["model"],
        "softwareVersion": d["software_version"],
        "optimizers": d["optimizers"] or None,
        "currentKw": _f(d["active_kw"]) if live else None,
        "todayKwh": _f(d["today_kwh"]),
        "totalKwh": _f(d["total_kwh"]),
        "state": d["state"],
        "liveAt": d["live_at"].isoformat() if d["live_at"] else None,
        "readings": {
            "inverterState": int(g("inverter_state")) if g("inverter_state") is not None else None,
            "reactiveKvar": g("reactive_power"),
            "powerFactor": g("power_factor"),
            "efficiency": g("efficiency"),
            "frequencyHz": g("elec_freq"),
            "temperatureC": g("temperature"),
            "inputKw": g("mppt_power"),
            "startedAt": _ms_iso(g("open_time")),
            "stoppedAt": _ms_iso(g("close_time")),
            "phases": [
                {"phase": p.upper(), "voltage": g(f"{p}_u"), "current": g(f"{p}_i")}
                for p in "abc"
                if g(f"{p}_u") or g(f"{p}_i")
            ],
            "lineVoltages": [{"between": k.upper(), "voltage": g(f"{k}_u")} for k in ("ab", "bc", "ca") if g(f"{k}_u")],
            "strings": strings,
            "mppts": [{"n": i, "kwh": g(f"mppt_{i}_cap")} for i in range(1, 21) if g(f"mppt_{i}_cap")],
            "mpptTotalKwh": g("mppt_total_cap"),
        }
        if r
        else None,
    }


@router.get("/solar/plants/{code}")
def plant(code: str, acct: Account = Depends(staff)) -> dict[str, Any]:
    return _detail(_plant(code, acct), acct)


Period = Literal["day", "month", "year", "lifetime"]


def _series(codes: list[str], rate: Any, period: Period, day: date) -> dict[str, Any]:
    """Yield by hour, day, month or year for one plant (with its contract's revenue) or several (summed)."""
    if period == "day":
        start = datetime(day.year, day.month, day.day, tzinfo=SG)
        end, step, fmt = start + timedelta(days=1), "hour", "%H:%M"
    elif period == "month":
        start = datetime(day.year, day.month, 1, tzinfo=SG)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        step, fmt = "day", "%d"
    elif period == "year":
        start, end, step, fmt = (
            datetime(day.year, 1, 1, tzinfo=SG),
            datetime(day.year + 1, 1, 1, tzinfo=SG),
            "month",
            "%b",
        )
    else:
        start, end, step, fmt = datetime(2000, 1, 1, tzinfo=SG), datetime(2100, 1, 1, tzinfo=SG), "year", "%Y"
    rows = fetch_all(
        "select at, sum(kwh) as kwh, sum(income) as income from solar_readings "
        "where station_code = any(%s) and period = %s and at >= %s and at < %s group by at order by at",
        (codes, step, start, end),
    )
    have = {r["at"].astimezone(SG): r for r in rows}
    points: list[dict[str, Any]] = []
    if period == "lifetime":
        slots = sorted(have)
    else:
        slots, t = [], start
        while t < end:
            slots.append(t)
            t = (
                t + timedelta(hours=1)
                if step == "hour"
                else t + timedelta(days=1)
                if step == "day"
                else (t.replace(day=28) + timedelta(days=4)).replace(day=1)
            )
    for t in slots:
        r = have.get(t)
        kwh = r["kwh"] if r else None
        points.append(
            {
                "at": t.isoformat(),
                "label": t.strftime(fmt),
                "kwh": _f(kwh),
                "revenue": _revenue(kwh, rate, r["income"] if r else None),
            }
        )
    known = [p["kwh"] for p in points if p["kwh"] is not None]
    return {
        "period": period,
        "date": day.isoformat(),
        "by": step,
        "points": points,
        "totalKwh": round(sum(known), 3) if known else None,
    }


@router.get("/solar/plants/{code}/energy")
def energy(
    code: str, period: Period = "day", on: str | None = Query(None, alias="date"), acct: Account = Depends(staff)
) -> dict[str, Any]:
    r = _plant(code, acct)
    return _series([code], r["rate_per_kwh"], period, _day(on))


def _day(v: str | None) -> date:
    if not v:
        return datetime.now(SG).date()
    try:
        return date.fromisoformat(v[:10])
    except ValueError as exc:
        raise HTTPException(400, "Choose a date.") from exc


@router.get("/solar/plants/{code}/report")
def report(
    code: str,
    by: Literal["hour", "day", "month"] = "day",
    start: str | None = None,
    end: str | None = None,
    acct: Account = Depends(staff),
) -> dict[str, Any]:
    r = _plant(code, acct)
    return _report(r, by, start, end)


def _report(r: dict[str, Any], by: str, start: str | None, end: str | None) -> dict[str, Any]:
    today = datetime.now(SG).date()
    last = _day(end) if end else today
    first = _day(start) if start else last - timedelta(days={"hour": 0, "day": 30, "month": 364}[by])
    if first > last:
        raise HTTPException(400, "The start comes after the end.")
    if (last - first).days > {"hour": 31, "day": 366, "month": 3660}[by]:
        raise HTTPException(400, "That's too long a stretch for this table; choose a shorter one.")
    rows = fetch_all(
        "select at, kwh, income, specific_yield from solar_readings "
        "where station_code = %s and period = %s and at >= %s and at < %s order by at",
        (
            r["station_code"],
            by,
            datetime(first.year, first.month, first.day, tzinfo=SG),
            datetime(last.year, last.month, last.day, tzinfo=SG) + timedelta(days=1),
        ),
    )
    fmt = {"hour": "%Y-%m-%d %H:00", "day": "%Y-%m-%d", "month": "%Y-%m"}[by]
    cap = r["capacity_kwp"]
    return {
        "by": by,
        "start": first.isoformat(),
        "end": last.isoformat(),
        "rows": [
            {
                "period": x["at"].astimezone(SG).strftime(fmt),
                "kwh": _f(x["kwh"]),
                "revenue": _revenue(x["kwh"], r["rate_per_kwh"], x["income"]),
                # kWh per kWp: FusionSolar's figure, or worked out from the plant's size.
                "specificYield": _f(x["specific_yield"])
                if x["specific_yield"] is not None
                else round(float(x["kwh"] / cap), 3)
                if x["kwh"] is not None and cap
                else None,
                "co2Kg": round(float(x["kwh"] * CO2_KG_PER_KWH), 1) if x["kwh"] is not None else None,
                "coalKg": round(float(x["kwh"] * COAL_KG_PER_KWH), 1) if x["kwh"] is not None else None,
            }
            for x in rows
        ],
    }


# ------------------------------------------------------------------ power through the day


def _power(sql_from: str, params: tuple[Any, ...], day: date, hourly_codes: list[str] | None) -> dict[str, Any]:
    """kW at each 5 minutes of ``day`` (FusionSolar's power curve), with a gap where there's no reading.
    Days older than the 5-minute points kept (400 days) are drawn from the hourly kWh instead."""
    start = datetime(day.year, day.month, day.day, tzinfo=SG)
    end = start + timedelta(days=1)
    rows = fetch_all(
        f"select at, sum(kw) as kw {sql_from} and at >= %s and at < %s group by at order by at", (*params, start, end)
    )
    by = "5min"
    if rows:
        have = {r["at"].astimezone(SG).strftime("%H:%M"): _f(r["kw"]) for r in rows}
        slots = [(start + timedelta(minutes=5 * i)).strftime("%H:%M") for i in range(288)]
    else:
        by = "hour"
        hourly = (
            fetch_all(
                "select at, sum(kwh) as kwh from solar_readings where station_code = any(%s) and period = 'hour' "
                "and at >= %s and at < %s group by at",
                (hourly_codes, start, end),
            )
            if hourly_codes
            else []
        )
        # A kWh in an hour is that hour's average kW.
        have = {r["at"].astimezone(SG).strftime("%H:%M"): _f(r["kwh"]) for r in hourly}
        slots = [f"{h:02d}:00" for h in range(24)]
    points = [{"label": t, "kw": have.get(t)} for t in slots]
    known = [p for p in points if p["kw"] is not None]
    peak = max(known, key=lambda p: p["kw"]) if known else None
    return {
        "date": day.isoformat(),
        "by": by,
        "points": points,
        "peakKw": peak["kw"] if peak else None,
        "peakAt": peak["label"] if peak else None,
        "latestKw": known[-1]["kw"] if known and day == datetime.now(SG).date() else None,
    }


def _plant_power(code: str, on: str | None) -> dict[str, Any]:
    return _power("from solar_plant_power where station_code = %s", (code,), _day(on), [code])


def _device_power(code: str, dev_id: int, on: str | None) -> dict[str, Any]:
    if not fetch_one("select 1 from solar_devices where dev_id = %s and station_code = %s", (dev_id, code)):
        raise HTTPException(404, "No such device on this plant.")
    return _power("from solar_device_power where dev_id = %s", (dev_id,), _day(on), None)


@router.get("/solar/power")
def all_power(on: str | None = Query(None, alias="date"), acct: Account = Depends(staff)) -> dict[str, Any]:
    """Every plant one can see, its power summed: FusionSolar's home page curve."""
    where, params = _visible(acct)
    codes = [r["station_code"] for r in fetch_all(f"select p.station_code {FROM} where {where}", params)]
    return _power("from solar_plant_power where station_code = any(%s)", (codes,), _day(on), codes)


@router.get("/solar/energy")
def all_energy(
    period: Period = "day", on: str | None = Query(None, alias="date"), acct: Account = Depends(staff)
) -> dict[str, Any]:
    """Every plant one can see, its yield summed, by hour, day, month or year (no revenue: rates differ)."""
    where, params = _visible(acct)
    codes = [r["station_code"] for r in fetch_all(f"select p.station_code {FROM} where {where}", params)]
    return _series(codes, None, period, _day(on))


@router.get("/solar/plants/{code}/power")
def plant_power(
    code: str, on: str | None = Query(None, alias="date"), acct: Account = Depends(staff)
) -> dict[str, Any]:
    _plant(code, acct)
    return _plant_power(code, on)


@router.get("/solar/plants/{code}/devices/{dev_id}/power")
def device_power(
    code: str, dev_id: int, on: str | None = Query(None, alias="date"), acct: Account = Depends(staff)
) -> dict[str, Any]:
    _plant(code, acct)
    return _device_power(code, dev_id, on)


class LinkIn(BaseModel):
    systemId: int | None = None


@router.post("/solar/plants/{code}/link")
def link(code: str, body: LinkIn, acct: Account = Depends(role("project_manager"))) -> dict[str, Any]:
    """Which of the app's systems this plant is. A project manager may link to a system they can edit."""
    _plant(code, acct)
    if body.systemId is not None:
        s = fetch_one("select system_id, run_by from maintenance_systems where system_id = %s", (body.systemId,))
        if not s:
            raise HTTPException(404, "No such system.")
        if acct.role != "superadmin" and s["run_by"] not in (None, acct.uid):
            raise HTTPException(403, "That system is run by another project manager.")
        other = fetch_one(
            "select name from solar_plants where system_id = %s and station_code <> %s", (body.systemId, code)
        )
        if other:
            raise HTTPException(409, f"That system is already linked to the plant “{other['name']}”.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update solar_plants set system_id = %s, linked_by = %s where station_code = %s",
            (body.systemId, "person" if body.systemId is not None else None, code),
        )
    return {"ok": True}


# ------------------------------------------------------------------ a homeowner's own plant


def _own(acct: Account) -> dict[str, Any] | None:
    return fetch_one(f"select {PLANT_COLUMNS} {FROM} where m.homeowner_id = %s order by p.name limit 1", (acct.uid,))


@router.get("/me/solar")
def my_solar(acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.role != "homeowner":
        raise HTTPException(403, "Only a homeowner has a plant of their own.")
    r = _own(acct)
    return {"plant": _detail(r, acct) if r else None}


@router.get("/me/solar/energy")
def my_energy(
    period: Period = "day", on: str | None = Query(None, alias="date"), acct: Account = Depends(active)
) -> dict[str, Any]:
    r = _own(acct) if acct.role == "homeowner" else None
    if not r:
        raise HTTPException(404, "There's no plant on your system yet.")
    return _series([r["station_code"]], r["rate_per_kwh"], period, _day(on))


@router.get("/me/solar/report")
def my_report(
    by: Literal["hour", "day", "month"] = "day",
    start: str | None = None,
    end: str | None = None,
    acct: Account = Depends(active),
) -> dict[str, Any]:
    r = _own(acct) if acct.role == "homeowner" else None
    if not r:
        raise HTTPException(404, "There's no plant on your system yet.")
    return _report(r, by, start, end)


@router.get("/me/solar/power")
def my_power(on: str | None = Query(None, alias="date"), acct: Account = Depends(active)) -> dict[str, Any]:
    r = _own(acct) if acct.role == "homeowner" else None
    if not r:
        raise HTTPException(404, "There's no plant on your system yet.")
    return _plant_power(r["station_code"], on)


@router.get("/me/solar/devices/{dev_id}/power")
def my_device_power(
    dev_id: int, on: str | None = Query(None, alias="date"), acct: Account = Depends(active)
) -> dict[str, Any]:
    r = _own(acct) if acct.role == "homeowner" else None
    if not r:
        raise HTTPException(404, "There's no plant on your system yet.")
    return _device_power(r["station_code"], dev_id, on)
