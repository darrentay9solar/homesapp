# ruff: noqa: E501  (SQL reads better whole)
"""Bringing FusionSolar's figures into the app (solar_* tables, migration 0051).

The 15-minute job calls run(). Each kind of call has its own pace, so FusionSolar's
limits are kept and a run stays short:

  plants        the plant list (new plants, names, sizes)        once a day
  devices       each plant's inverters                            once a day
  live          every plant's figures now, and each inverter's    every run
  alarms        the alarms raised in the last 30 days             every run
  hours         today's yield, hour by hour                       every hour
  days          this month's yield, day by day                    every 6 hours
  months        this year's yield, month by month                 once a day
  years         every year's yield                                once a week
  invoices      last month's kWh into system_output               once a day

The full history since each plant was connected comes in with scripts/solar_import.py.
A refusal for calling too often only puts that kind off to the next run.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from _lib import fusionsolar as fs
from _lib.db import fetch_all, fetch_one, transaction
from _lib.duplicates import address_key

SG = ZoneInfo("Asia/Singapore")
HEALTH = {1: "disconnected", 2: "faulty", 3: "normal"}
LEVEL = {1: "critical", 2: "major", 3: "minor", 4: "warning"}
# FusionSolar's device types for inverters: string (1) and residential (38). Its other devices
# (WiFi dongles, 62; meters; batteries) have no power of their own to show.
INVERTERS = (1, 38)
PACE = {
    "plants": timedelta(hours=24),
    "devices": timedelta(hours=24),
    "live": timedelta(minutes=5),
    "alarms": timedelta(minutes=5),
    "hours": timedelta(hours=1),
    "days": timedelta(hours=6),
    "months": timedelta(hours=24),
    "years": timedelta(days=7),
    "invoices": timedelta(hours=24),
}


# ------------------------------------------------------------------ small helpers


def _num(v: Any) -> Decimal | None:
    """FusionSolar's numbers come as numbers, strings, or "N/A"/"--" when there's none."""
    if v is None or v == "" or str(v).strip().upper() in ("N/A", "--", "NULL"):
        return None
    try:
        return Decimal(str(v))
    except ArithmeticError:
        return None


def _readings(m: dict[str, Any]) -> dict[str, float]:
    """A device's live readings as FusionSolar names them (a_u, pv1_i, mppt_3_cap, open_time...),
    numbers only: what it doesn't report is left out rather than kept as 0."""
    out: dict[str, float] = {}
    for k, v in m.items():
        n = _num(v)
        if n is not None and re.fullmatch(r"[A-Za-z0-9_]{1,40}", str(k)):
            out[str(k)] = float(n)
    return out


def _first(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if d.get(k) not in (None, ""):
            return d[k]
    return None


def _when(v: Any) -> datetime | None:
    """A time in milliseconds, or an ISO date-time; Singapore time when it has none."""
    if v in (None, ""):
        return None
    if isinstance(v, int | float) or (isinstance(v, str) and v.isdigit()):
        return datetime.fromtimestamp(int(v) / 1000, UTC)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=SG)


def _kwp(v: Any) -> Decimal | None:
    """A plant's size. FusionSolar gives MWp in some answers, kWp in others: a home system is under 1 MWp.
    Many plants have no size set there (0); that's unknown, not zero (the linked system's size is used)."""
    n = _num(v)
    if n is None or n <= 0:
        return None
    return (n * 1000).quantize(Decimal("0.001")) if n < 1 else n


def _due(kind: str, now: datetime) -> bool:
    row = fetch_one("select at from solar_sync where key = %s", (f"ran:{kind}",))
    return row is None or row["at"] + PACE[kind] <= now


def _ran(kind: str, now: datetime, note: Any = None) -> None:
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_sync (key, value, at) values (%s, %s, %s) "
            "on conflict (key) do update set value = excluded.value, at = excluded.at",
            (f"ran:{kind}", json.dumps(note), now),
        )


def codes() -> list[str]:
    return [r["station_code"] for r in fetch_all("select station_code from solar_plants order by station_code")]


# ------------------------------------------------------------------ plants


def _postal(address: str | None) -> str | None:
    m = re.search(r"\b(\d{6})\b", address or "")
    return m.group(1) if m else None


def save_plants(rows: list[dict[str, Any]]) -> int:
    """Adds or updates each plant, and links a new one to the app's system at the same address
    when exactly one system is there."""
    n = 0
    with transaction(None) as cur:
        for r in rows:
            code = _first(r, "plantCode", "stationCode")
            if not code:
                continue
            name = _first(r, "plantName", "stationName") or code
            address = _first(r, "plantAddress", "stationAddr")
            grid = _when(_first(r, "gridConnectionDate", "gridConnTime"))
            cur.execute(
                "insert into solar_plants (station_code, name, address, capacity_kwp, grid_connected_on, latitude, longitude, seen_at) "
                "values (%s, %s, %s, %s, %s, %s, %s, now()) "
                "on conflict (station_code) do update set name = excluded.name, address = excluded.address, "
                "capacity_kwp = coalesce(excluded.capacity_kwp, solar_plants.capacity_kwp), grid_connected_on = excluded.grid_connected_on, "
                "latitude = excluded.latitude, longitude = excluded.longitude, seen_at = now()",
                (
                    code,
                    name,
                    address,
                    _kwp(_first(r, "capacity")),
                    grid.astimezone(SG).date() if grid else None,
                    _num(_first(r, "latitude")),
                    _num(_first(r, "longitude")),
                ),
            )
            n += 1
    link_by_address()
    return n


def _place(address: str | None, postal: str | None) -> str:
    """An address to compare by: no country, no postal code, spelling and spacing set aside."""
    return address_key(address, postal).replace("singapore", "") if address else ""


def link_by_address() -> int:
    """Each unlinked plant to the one system whose address (or postal code and house) matches its own."""
    plants = fetch_all("select station_code, name, address from solar_plants where system_id is null")
    if not plants:
        return 0
    systems = fetch_all(
        "select s.system_id, s.address, s.postal_code from maintenance_systems s "
        "where not exists (select 1 from solar_plants p where p.system_id = s.system_id)"
    )
    by_key: dict[str, list[int]] = {}
    for s in systems:
        if k := _place(s["address"], s["postal_code"]):
            by_key.setdefault(k, []).append(s["system_id"])
    linked = 0
    with transaction(None) as cur:
        for p in plants:
            # FusionSolar's plants are named by their address ("349 Onan Road"); its address field is often untidy.
            keys = [k for k in (_place(p["name"], None), _place(p["address"], _postal(p["address"]))) if k]
            found = next((by_key[k] for k in keys if by_key.get(k)), [])
            if len(found) == 1:
                cur.execute(
                    "update solar_plants set system_id = %s, linked_by = 'address' where station_code = %s and system_id is null",
                    (found[0], p["station_code"]),
                )
                by_key = {k: [x for x in v if x != found[0]] for k, v in by_key.items()}
                linked += cur.rowcount
    return linked


# ------------------------------------------------------------------ live figures


def save_live(rows: list[dict[str, Any]], now: datetime) -> int:
    n = 0
    with transaction(None) as cur:
        for r in rows:
            m = r.get("dataItemMap") or {}
            health = HEALTH.get(int(_num(m.get("real_health_state")) or 0))
            cur.execute(
                "update solar_plants set today_kwh = %s, month_kwh = %s, total_kwh = %s, today_income = %s, "
                "total_income = %s, today_feed_in_kwh = %s, today_use_kwh = %s, health = coalesce(%s, health), "
                "live_at = %s where station_code = %s",
                (
                    _num(m.get("day_power")),
                    _num(m.get("month_power")),
                    _num(m.get("total_power")),
                    _num(m.get("day_income")),
                    _num(m.get("total_income")),
                    _num(m.get("day_on_grid_energy")),
                    _num(m.get("day_use_energy")),
                    health,
                    now,
                    r.get("stationCode"),
                ),
            )
            n += cur.rowcount
    return n


def save_devices(rows: list[dict[str, Any]]) -> int:
    n = 0
    with transaction(None) as cur:
        for r in rows:
            if r.get("id") is None or not r.get("stationCode"):
                continue
            cur.execute(
                "insert into solar_devices (dev_id, station_code, name, serial, type_id, model, software_version, optimizers) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s) "
                "on conflict (dev_id) do update set station_code = excluded.station_code, name = excluded.name, "
                "serial = excluded.serial, type_id = excluded.type_id, model = excluded.model, "
                "software_version = excluded.software_version, optimizers = excluded.optimizers",
                (
                    int(r["id"]),
                    r["stationCode"],
                    r.get("devName"),
                    r.get("esnCode"),
                    r.get("devTypeId"),
                    r.get("invType") or r.get("model"),
                    r.get("softwareVersion") or None,
                    int(opt) if (opt := _num(r.get("optimizerNumber"))) is not None else None,
                ),
            )
            n += 1
    return n


def save_device_live(rows: list[dict[str, Any]], now: datetime) -> None:
    """Each inverter's live readings (all of them, as FusionSolar names them); a plant's power now is
    the sum of its inverters'."""
    with transaction(None) as cur:
        for r in rows:
            m = r.get("dataItemMap") or {}
            # run_state is whether FusionSolar can reach it (0 no, 1 yes); producing is whether it's making power.
            run, kw = _num(m.get("run_state")), _num(m.get("active_power"))
            state = None if run is None else "offline" if run == 0 else "producing" if kw and kw > 0 else "standby"
            cur.execute(
                "update solar_devices set active_kw = %s, today_kwh = %s, total_kwh = %s, state = %s, readings = %s, "
                "live_at = %s where dev_id = %s",
                (
                    _num(m.get("active_power")),
                    _num(m.get("day_cap")),
                    _num(m.get("total_cap")),
                    state,
                    json.dumps(_readings(m)),
                    now,
                    r.get("devId"),
                ),
            )
        cur.execute(
            "update solar_plants p set current_kw = d.kw from (select station_code, sum(active_kw) kw from solar_devices "
            "where live_at = %s group by station_code) d where d.station_code = p.station_code",
            (now,),
        )


# ------------------------------------------------------------------ history


def _start(period: str, at: datetime) -> datetime:
    local = at.astimezone(SG)
    if period == "hour":
        local = local.replace(minute=0, second=0, microsecond=0)
    elif period == "day":
        local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        local = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        local = local.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return local


def save_history(period: str, rows: list[dict[str, Any]]) -> int:
    n = 0
    with transaction(None) as cur:
        for r in rows:
            m = r.get("dataItemMap") or {}
            at = _when(r.get("collectTime"))
            kwh = _num(_first(m, "inverter_power", "PVYield", "inverterYield"))
            if not (at and r.get("stationCode")) or (kwh is None and _num(m.get("power_profit")) is None):
                continue
            cur.execute(
                "insert into solar_readings (station_code, period, at, kwh, income, specific_yield, updated_at) "
                "values (%s, %s, %s, %s, %s, %s, now()) "
                "on conflict (station_code, period, at) do update set kwh = excluded.kwh, income = excluded.income, "
                "specific_yield = excluded.specific_yield, updated_at = now() "
                "where solar_readings.kwh is distinct from excluded.kwh or solar_readings.income is distinct from excluded.income "
                "or solar_readings.specific_yield is distinct from excluded.specific_yield",
                (
                    r["stationCode"],
                    period,
                    _start(period, at),
                    kwh,
                    _num(m.get("power_profit")),
                    _num(m.get("perpower_ratio")),
                ),
            )
            n += cur.rowcount
            # Most plants have no size on FusionSolar's plant list; its daily figures carry one.
            if size := _kwp(m.get("installed_capacity")):
                cur.execute(
                    "update solar_plants set capacity_kwp = %s where station_code = %s and capacity_kwp is distinct from %s",
                    (size, r["stationCode"], size),
                )
    return n


def month_into_invoices(month: date) -> int:
    """A finished month's kWh for each linked system, into system_output (what the monthly
    invoices are made from). Written once, and again only if FusionSolar's figure changes
    (through solar_month_into_output, migration 0051: the sync isn't a manager)."""
    with transaction(None) as cur:
        cur.execute("select solar_month_into_output(%s) as n", (month.replace(day=1),))
        row = cur.fetchone()
    return int(row["n"]) if row else 0


# ------------------------------------------------------------------ alarms


def save_alarms(rows: list[dict[str, Any]], now: datetime) -> int:
    """The alarms FusionSolar has active now; any of ours it no longer lists are cleared."""
    seen: list[int] = []
    with transaction(None) as cur:
        for r in rows:
            raised = _when(_first(r, "raiseTime", "occurTime"))
            if not (r.get("stationCode") and raised):
                continue
            cur.execute(
                "insert into solar_alarms (station_code, device, name, level, cause, suggestion, raised_at, seen_at) "
                "values (%s, %s, %s, %s, %s, %s, %s, now()) "
                "on conflict (station_code, device, name, raised_at) do update set seen_at = now(), cleared_at = null, "
                "level = excluded.level, cause = excluded.cause, suggestion = excluded.suggestion returning alarm_id",
                (
                    r["stationCode"],
                    r.get("devName") or "",
                    r.get("alarmName") or "Alarm",
                    LEVEL.get(int(_num(r.get("lev")) or 4), "warning"),
                    r.get("alarmCause"),
                    r.get("repairSuggestion"),
                    raised,
                ),
            )
            seen.append(cur.fetchone()["alarm_id"])
        cur.execute(
            "update solar_alarms set cleared_at = %s where cleared_at is null and not (alarm_id = any(%s))", (now, seen)
        )
    return len(seen)


# ------------------------------------------------------------------ the job


def run(now: datetime | None = None) -> dict[str, Any]:
    """One pass of whatever is due. Never raises: FusionSolar being away mustn't stop the other jobs."""
    now = now or datetime.now(UTC)
    if not fs.configured():
        return {"skipped": "FusionSolar isn't connected"}
    out: dict[str, Any] = {}

    def step(kind: str, fn: Any) -> None:
        if not _due(kind, now):
            return
        try:
            out[kind] = fn()
            _ran(kind, now, out[kind])
        except fs.RateLimitedError:
            out[kind] = "later (FusionSolar's limit)"
        except fs.FusionSolarError as exc:
            out[kind] = f"failed: {exc}"
        except Exception as exc:  # one kind failing mustn't stop the rest
            out[kind] = f"failed: {exc}"

    local = now.astimezone(SG)
    step("plants", lambda: save_plants(fs.plants()))
    step("devices", lambda: save_devices(fs.devices(codes())))
    step("live", lambda: save_live(fs.live(codes()), now))

    def inverters() -> int:
        n = 0
        for kind in INVERTERS:
            ids = [r["dev_id"] for r in fetch_all("select dev_id from solar_devices where type_id = %s", (kind,))]
            if ids:
                save_device_live(fs.device_live(ids, kind), now)
                n += len(ids)
        return n

    if _due("live", now) or "live" in out:
        try:
            out["inverters"] = inverters()
        except fs.FusionSolarError as exc:
            out["inverters"] = f"failed: {exc}"
    step("alarms", lambda: save_alarms(fs.alarms(codes(), now - timedelta(days=30), now), now))
    step("hours", lambda: save_history("hour", fs.history("hour", codes(), local)))
    step("days", lambda: save_history("day", fs.history("day", codes(), local)))
    step("months", lambda: save_history("month", fs.history("month", codes(), local)))
    step("years", lambda: save_history("year", fs.history("year", codes(), local)))
    last_month = (local.replace(day=1) - timedelta(days=1)).date()
    step("invoices", lambda: month_into_invoices(last_month))
    return out
