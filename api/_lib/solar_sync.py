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
from _lib import weather
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
    "power": timedelta(minutes=5),
    "weather": timedelta(minutes=30),
    "device_days": timedelta(hours=6),
    "device_months": timedelta(hours=24),
    "device_years": timedelta(days=7),
    "alarms": timedelta(minutes=5),
    "hours": timedelta(hours=1),
    "days": timedelta(hours=6),
    "months": timedelta(hours=24),
    "years": timedelta(days=7),
    "invoices": timedelta(hours=24),
}
# The scheduler is meant to run every 15 minutes, but GitHub's free one runs hours apart. So opening
# a FusionSolar page fetches the live figures itself once they're older than this: every plant's in
# one call (FusionSolar limits how often each call is made), by whoever opens a page first.
LIVE_ON_VIEW = timedelta(minutes=10)
VIEW_TIMEOUT = 8  # seconds a call may take then, so a slow FusionSolar doesn't hold the page up


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


# ------------------------------------------------------------------ power through the day


# The readings kept every 5 minutes for an inverter's history charts (migration 0056): strings, phases,
# temperature, efficiency... Its running totals and on/off times are kept only as its live figures.
SIGNAL = re.compile(
    r"^(temperature|efficiency|elec_freq|power_factor|reactive_power|mppt_power|[abc]_[ui]|(ab|bc|ca)_u|pv\d+_[ui])$"
)


def save_device_power(rows: list[dict[str, Any]]) -> int:
    """Each inverter's kW at each 5 minutes (migration 0054), with its other readings (0056)."""
    points = []
    for r in rows:
        if r.get("devId") is None or not (at := _when(r.get("collectTime"))):
            continue
        m = r.get("dataItemMap") or {}
        signals = {k: v for k, v in _readings(m).items() if SIGNAL.match(k)}
        points.append((int(r["devId"]), at, _num(m.get("active_power")), json.dumps(signals) if signals else None))
    with transaction(None) as cur:
        cur.executemany(
            "insert into solar_device_power (dev_id, at, kw, readings) select %s, %s, %s, %s "
            "where exists (select 1 from solar_devices where dev_id = %s) "
            "on conflict (dev_id, at) do update set kw = excluded.kw, readings = excluded.readings "
            "where solar_device_power.kw is distinct from excluded.kw "
            "or solar_device_power.readings is distinct from excluded.readings",
            [(d, at, kw, sig, d) for d, at, kw, sig in points],
        )
    return len(points)


def save_device_yield(period: str, rows: list[dict[str, Any]]) -> int:
    """Each inverter's kWh by day, month or year (FusionSolar's device report), and its installed size;
    a plant with no size of its own takes the sum of its inverters' (migration 0056)."""
    n = 0
    sizes: dict[int, Decimal] = {}
    with transaction(None) as cur:
        for r in rows:
            m = r.get("dataItemMap") or {}
            at = _when(r.get("collectTime"))
            if r.get("devId") is None or not at:
                continue
            dev = int(r["devId"])
            if size := _kwp(m.get("installed_capacity")):
                sizes[dev] = size
            kwh = _num(m.get("product_power"))
            if kwh is None:
                continue
            cur.execute(
                "insert into solar_device_yield (dev_id, period, at, kwh) select %s, %s, %s, %s "
                "where exists (select 1 from solar_devices where dev_id = %s) "
                "on conflict (dev_id, period, at) do update set kwh = excluded.kwh "
                "where solar_device_yield.kwh is distinct from excluded.kwh",
                (dev, period, _start(period, at), kwh, dev),
            )
            n += cur.rowcount
        for dev, size in sizes.items():
            cur.execute(
                "update solar_devices set installed_kwp = %s where dev_id = %s and installed_kwp is distinct from %s",
                (size, dev, size),
            )
        cur.execute(
            "update solar_plants p set capacity_kwp = s.kwp from (select station_code, sum(installed_kwp) as kwp "
            "from solar_devices where installed_kwp > 0 group by 1) s "
            "where s.station_code = p.station_code and p.capacity_kwp is null"
        )
    return n


def device_yield(period: str, when: datetime) -> int:
    """Every inverter's kWh for ``period`` around ``when`` (both kinds)."""
    n = 0
    for kind in INVERTERS:
        ids = [r["dev_id"] for r in fetch_all("select dev_id from solar_devices where type_id = %s", (kind,))]
        if ids:
            n += save_device_yield(period, fs.device_history(period, ids, kind, when))
    return n


def plant_power(day: date) -> int:
    """A plant's kW at each 5 minutes of ``day``: the sum of its inverters'."""
    start = datetime(day.year, day.month, day.day, tzinfo=SG)
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_plant_power (station_code, at, kw) "
            "select d.station_code, p.at, sum(p.kw) from solar_device_power p join solar_devices d using (dev_id) "
            "where p.at >= %s and p.at < %s group by 1, 2 "
            "on conflict (station_code, at) do update set kw = excluded.kw where solar_plant_power.kw is distinct from excluded.kw",
            (start, start + timedelta(days=1)),
        )
        return cur.rowcount


def power_on(day: datetime) -> int:
    """Every inverter's 5-minute power through ``day``, and so each plant's."""
    n = 0
    for kind in INVERTERS:
        ids = [r["dev_id"] for r in fetch_all("select dev_id from solar_devices where type_id = %s", (kind,))]
        if ids:
            n += save_device_power(fs.five_minutes(ids, kind, day))
    plant_power(day.astimezone(SG).date())
    return n


POWER_TURN = "power:next"  # where the job's 5-minute power left off: {"day": "2026-10-27", "next": 3}


def power_in_turn(day: datetime) -> int:
    """The job's 5-minute power: FusionSolar takes 10 inverters a call and refuses calls that come too
    often, so asking for every inverter at once was refused part-way and kept nothing. Instead each run
    goes on from where the last left off, as many tens as FusionSolar will answer, keeping each as it
    comes; when it says too often, the rest wait for the next run."""
    on = day.astimezone(SG).date()
    batches = []
    for kind in INVERTERS:
        ids = [
            r["dev_id"]
            for r in fetch_all("select dev_id from solar_devices where type_id = %s order by dev_id", (kind,))
        ]
        batches += [(kind, ids[i : i + 10]) for i in range(0, len(ids), 10)]
    if not batches:
        return 0
    row = fetch_one("select value from solar_sync where key = %s", (POWER_TURN,))
    mark = row["value"] if row and isinstance(row["value"], dict) else {}
    start = int(mark.get("next", 0)) % len(batches) if mark.get("day") == on.isoformat() else 0
    n, done, limited = 0, 0, False
    for k in range(len(batches)):
        kind, ids = batches[(start + k) % len(batches)]
        try:
            n += save_device_power(fs.five_minutes(ids, kind, day))
        except fs.RateLimitedError:
            limited = True
            break
        done += 1
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_sync (key, value, at) values (%s, %s, now()) "
            "on conflict (key) do update set value = excluded.value, at = now()",
            (POWER_TURN, json.dumps({"day": on.isoformat(), "next": (start + done) % len(batches)})),
        )
    if done:
        plant_power(on)
    elif limited:
        raise fs.RateLimitedError("FusionSolar: 5-minute power was called too often; trying again on the next run.")
    return n


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
            "update solar_alarms set cleared_at = %s where cleared_at is null and source = 'fusionsolar' "
            "and not (alarm_id = any(%s))",
            (now, seen),
        )
    return len(seen)


# Who hears about an alarm: staff for these levels, the homeowner for the serious ones.
ALERT_STAFF = ("critical", "major", "minor")
ALERT_HOMEOWNER = ("critical", "major")


def involved(system_id: int | None) -> list[int]:
    """Everyone on a system's project: the manager who runs it, its homeowner, and its project's manager,
    homeowner, assigned crew and contractor group. Superadmins when nobody runs it."""
    if system_id is None:
        return []
    rows = fetch_all(
        """
        select m.run_by as uid from maintenance_systems m where m.system_id = %(s)s
        union select m.homeowner_id from maintenance_systems m where m.system_id = %(s)s
        union select p.project_manager_id from maintenance_systems m join projects p using (project_id) where m.system_id = %(s)s
        union select p.homeowner_id from maintenance_systems m join projects p using (project_id) where m.system_id = %(s)s
        union select a.user_id from maintenance_systems m join project_assignments a using (project_id) where m.system_id = %(s)s
        union select g.user_id from maintenance_systems m join projects p using (project_id)
          join contractor_group_members g on g.group_id = p.contractor_group_id where m.system_id = %(s)s
        """,
        {"s": system_id},
    )
    return [r["uid"] for r in rows if r["uid"] is not None]


def alert_alarms() -> int:
    """An alert for each alarm not alerted yet (migration 0055).

    FusionSolar's: to the project manager who runs the plant's system (every superadmin when nobody does),
    and to its homeowner when it's major or critical. The app's own (output below expected): to everyone
    on the project, by email too."""
    from _lib import notify

    rows = fetch_all(
        "select a.alarm_id, a.name, a.level, a.device, a.source, p.station_code, p.name as plant, p.system_id, "
        "m.run_by, m.homeowner_id, m.project_id "
        "from solar_alarms a join solar_plants p using (station_code) "
        "left join maintenance_systems m on m.system_id = p.system_id "
        "where a.notified_at is null and a.cleared_at is null order by a.raised_at"
    )
    if not rows:
        return 0
    people = {
        u["uid"]: u
        for u in fetch_all("select uid, full_name, email, language, user_type, is_demo from users where active")
    }
    supers = [u for u in people.values() if u["user_type"] == "superadmin" and not u["is_demo"]]
    sent = 0
    for a in rows:
        code = a["station_code"]

        def link_for(u: dict[str, Any], a: dict[str, Any] = a, code: str = code) -> str:
            if u["user_type"] == "homeowner":
                return "/my-solar?tab=alarms"
            if u["user_type"] in ("project_manager", "superadmin", "finance"):
                return f"/solar/{code}?tab=alarms"
            return f"/projects/{a['project_id']}" if a["project_id"] else "/alerts"  # crew can't open Solar

        if a["source"] == "app":
            uids = involved(a["system_id"])
            if a["run_by"] is None:
                uids += [u["uid"] for u in supers]
            to = [people[uid] for uid in dict.fromkeys(uids) if uid in people]
            with_email = True
        else:
            to = []
            if a["level"] in ALERT_STAFF:
                to += [people[a["run_by"]]] if a["run_by"] in people else supers
            if a["level"] in ALERT_HOMEOWNER and a["homeowner_id"] in people:
                to.append(people[a["homeowner_id"]])
            with_email = a["level"] in ALERT_HOMEOWNER
        for u in to:
            link = link_for(u)
            lang = u["language"] or "en"
            m = notify.msg_solar_alarm(
                u["full_name"], a["plant"], a["level"], a["device"], a["name"], notify.app_url() + link, lang
            )
            try:
                notify.notify(
                    u["uid"], "solar_alarm", m["title"], m["body"], link=link, urgent=a["level"] == "critical",
                    email=(u["email"], *m["email"]) if with_email and u["email"] else None,
                )  # fmt: skip
                sent += 1
            except Exception as exc:  # one person's alert mustn't stop the others
                print(f"[solar] couldn't alert {u['uid']} about alarm {a['alarm_id']}: {exc}")
        with transaction(None) as cur:
            cur.execute("update solar_alarms set notified_at = now() where alarm_id = %s", (a["alarm_id"],))
    return sent


# ------------------------------------------------------------------ output below expected

# Each plant's output per kWp installed, against the median of the other plants at the same moments
# (all in Singapore, under much the same sky): FusionSolar gives no irradiance or theoretical yield
# for these plants, so similar plants now are the best measure of what a plant should be making.
LOW = 0.5  # an alarm below half of expected
BACK = 0.7  # cleared once back above 70%
NOTHING_KW_PER_KWP = 0.01  # "no output": under 10 W per kWp
SUNNY_ENOUGH = 0.08  # skip when the median plant makes under 80 W per kWp (heavy cloud everywhere)
WINDOW = timedelta(minutes=30)
MIN_PEERS = 5
LOW_NAME, NONE_NAME = "Output below expected", "No output"


def _median(xs: list[float]) -> float:
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def check_output(now: datetime) -> dict[str, Any]:
    """Opens an alarm for each plant making much less than similar plants over the last 30 minutes, and
    clears it once the plant has recovered. Daylight (9 am to 5 pm) only."""
    local = now.astimezone(SG)
    if not 9 <= local.hour < 17:
        return {"skipped": "outside 9 am to 5 pm"}
    rows = fetch_all(
        "select w.station_code, w.at, w.kw::float as kw, coalesce(p.capacity_kwp, m.kwp)::float as kwp, p.health "
        "from solar_plant_power w join solar_plants p using (station_code) "
        "left join maintenance_systems m on m.system_id = p.system_id "
        "where w.at > %s and w.at <= %s and coalesce(p.capacity_kwp, m.kwp) > 0 and w.kw is not null",
        (now - WINDOW, now),
    )
    at_time: dict[datetime, dict[str, float]] = {}
    size: dict[str, float] = {}
    for r in rows:
        at_time.setdefault(r["at"], {})[r["station_code"]] = r["kw"] / r["kwp"]
        size[r["station_code"]] = r["kwp"]
    open_ = {
        r["station_code"]: r
        for r in fetch_all(
            "select alarm_id, station_code from solar_alarms where source = 'app' and cleared_at is null "
            "and name in (%s, %s)",
            (LOW_NAME, NONE_NAME),
        )
    }
    opened, cleared, judged = 0, 0, 0
    for code, kwp in size.items():
        actual = expected = 0.0
        points = 0
        for ratios in at_time.values():
            if code not in ratios:
                continue
            peers = [v for c, v in ratios.items() if c != code]
            if len(peers) < MIN_PEERS:
                continue
            med = _median(peers)
            if med < SUNNY_ENOUGH:
                continue
            actual += ratios[code] * kwp
            expected += med * kwp
            points += 1
        if points < 3 or expected <= 0:
            continue
        judged += 1
        share = actual / expected
        if code in open_:
            if share >= BACK:
                with transaction(None) as cur:
                    cur.execute(
                        "update solar_alarms set cleared_at = %s where alarm_id = %s", (now, open_[code]["alarm_id"])
                    )
                cleared += 1
            continue
        if share >= LOW:
            continue
        nothing = actual / points < NOTHING_KW_PER_KWP * kwp
        with transaction(None) as cur:
            cur.execute(
                "insert into solar_alarms (station_code, device, name, level, cause, suggestion, raised_at, source) "
                "values (%s, '', %s, %s, %s, %s, %s, 'app') on conflict do nothing",
                (
                    code,
                    NONE_NAME if nothing else LOW_NAME,
                    "critical" if nothing else "major",
                    f"Making {actual / points:.2f} kW against about {expected / points:.2f} kW expected "
                    f"({round(share * 100)}% of what similar plants are making now)",
                    "Check the inverter and its alarms; then look for shading, dirty panels, a tripped breaker "
                    "or a faulty string (Devices, then the inverter's PV strings).",
                    now,
                ),
            )
            opened += cur.rowcount
    return {"judged": judged, "opened": opened, "cleared": cleared}


def save_inverters_live(now: datetime, timeout: float = 30) -> int:
    """Every inverter's readings now (and so each plant's power now)."""
    n = 0
    for kind in INVERTERS:
        ids = [r["dev_id"] for r in fetch_all("select dev_id from solar_devices where type_id = %s", (kind,))]
        if ids:
            save_device_live(fs.device_live(ids, kind, timeout), now)
            n += len(ids)
    return n


def refresh_on_view(now: datetime | None = None) -> bool:
    """Someone's opening a FusionSolar page: if the live figures are older than LIVE_ON_VIEW, fetch them
    now. Whether it did. Never raises; when FusionSolar is slow or says too often, the page shows the
    figures it has, with when they're from."""
    now = now or datetime.now(UTC)
    if not fs.configured():
        return False
    # Claimed before asking, so people opening pages at the same moment ask FusionSolar once between them.
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_sync (key, value, at) values ('ran:live', %s, %s) on conflict (key) do update "
            "set value = excluded.value, at = excluded.at where solar_sync.at <= %s returning key",
            (json.dumps("on view"), now, now - LIVE_ON_VIEW),
        )
        if cur.fetchone() is None:
            return False
    try:
        save_live(fs.live(codes(), VIEW_TIMEOUT), now)
        save_inverters_live(now, VIEW_TIMEOUT)
    except Exception as exc:  # FusionSolar away, slow or limiting: the page carries on with what it has
        print(f"[solar] live on view: {type(exc).__name__}: {exc}")
        return False
    return True


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

    if _due("live", now) or "live" in out:
        try:
            out["inverters"] = save_inverters_live(now)
        except fs.FusionSolarError as exc:
            out["inverters"] = f"failed: {exc}"
    step("alarms", lambda: save_alarms(fs.alarms(codes(), now - timedelta(days=30), now), now))
    # Power through the day, for the charts, a few inverters a run; in the first hour of a day,
    # yesterday's last points first.
    step("power", lambda: power_in_turn(local - timedelta(hours=1) if local.hour == 0 else local))
    # With fresh power figures: is any plant making much less than similar plants are?
    if isinstance(out.get("power"), int):
        try:
            out["output"] = check_output(now)
        except Exception as exc:  # the check failing mustn't stop the rest
            out["output"] = f"failed: {exc}"
    # New alarms (FusionSolar's, and the output check's) to the people who need them; cheap when there are none.
    try:
        if n := alert_alarms():
            out["alerts"] = n
    except Exception as exc:  # alerts failing mustn't stop the rest
        out["alerts"] = f"failed: {exc}"
    # Singapore's weather where each plant is (NEA, data.gov.sg), for the plant screens.
    step("weather", lambda: weather.save(now))
    # Each inverter's kWh by day, month and year (its report), and its size.
    step("device_days", lambda: device_yield("day", local))
    step("device_months", lambda: device_yield("month", local))
    step("device_years", lambda: device_yield("year", local))
    step("hours", lambda: save_history("hour", fs.history("hour", codes(), local)))
    step("days", lambda: save_history("day", fs.history("day", codes(), local)))
    step("months", lambda: save_history("month", fs.history("month", codes(), local)))
    step("years", lambda: save_history("year", fs.history("year", codes(), local)))
    last_month = (local.replace(day=1) - timedelta(days=1)).date()
    step("invoices", lambda: month_into_invoices(last_month))
    return out
