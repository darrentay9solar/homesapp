# ruff: noqa: E501  (messages read better whole)
"""Is what the app shows from FusionSolar right? Asks FusionSolar now and compares, figure by figure.

    node scripts/py.mjs scripts/check_fusionsolar.py --target prod

Read-only on both sides (FusionSolar's API account can't change anything; the database is only read,
apart from FusionSolar's sign-in token, which the app keeps as it always does). Prints counts and plant
codes, never a homeowner's name or address.

  plants        every plant FusionSolar has is in the app, with its name and size
  live          today's, this month's and the total yield, and each plant's health, as last synced
                (a plant synced a while ago may lag a little on today's figure)
  history       this month's days, this year's months and every year: the app's kWh = FusionSolar's
  devices       each plant's inverters and dongles, by serial number
  alarms        the alarms FusionSolar has active are the app's active ones
  the app       its own figures agree with each other: a plant's total with its years, this month with
                its days, and each linked system's invoiced kWh with FusionSolar's month
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

URLS = {"dev": "DATABASE_URL", "prod": "PROD_DATABASE_URL"}
problems = 0


def report(name: str, bad: list[str], of: int, note: str = "") -> None:
    global problems
    if not bad:
        print(f"  OK    {name} ({of} checked)")
        return
    problems += len(bad)
    shown = ", ".join(bad[:12]) + (f" … and {len(bad) - 12} more" if len(bad) > 12 else "")
    print(f"  {len(bad):>4}  {name} (of {of}){' — ' + note if note else ''}: {shown}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, required=True)
    a = ap.parse_args()
    from _lib.db import _from_env_file

    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    os.environ["DATABASE_URL"] = url
    from _lib import fusionsolar as fs
    from _lib.db import fetch_all
    from _lib.solar_sync import SG, _num, _when

    if not fs.configured():
        sys.exit("FusionSolar isn't set up in .env.local.")

    def ask(what: str, fn: Any) -> Any:
        """FusionSolar limits how often each kind of call is made: wait and ask again."""
        for n in range(15):
            try:
                return fn()
            except fs.RateLimitedError:
                print(f"    {what}: FusionSolar says too often; waiting a minute ({n + 1})")
                time.sleep(60)
        sys.exit(f"{what}: still refused after 15 minutes. Run it again later.")

    code = lambda c: c[-6:]  # noqa: E731  (enough to find it, without the whole code)
    now = datetime.now(SG)
    db_plants = {p["station_code"]: p for p in fetch_all("select * from solar_plants")}

    print(f"{a.target}: {len(db_plants)} plants in the app")
    print("\nplants")
    fs_plants = ask("plants", fs.plants)
    fs_by = {p.get("plantCode") or p.get("stationCode"): p for p in fs_plants}
    report("in FusionSolar, not in the app", [code(c) for c in fs_by if c not in db_plants], len(fs_by))
    report("in the app, no longer in FusionSolar", [code(c) for c in db_plants if c not in fs_by], len(db_plants))
    both = [c for c in fs_by if c in db_plants]
    report(
        "name differs",
        [code(c) for c in both if (fs_by[c].get("plantName") or fs_by[c].get("stationName")) != db_plants[c]["name"]],
        len(both),
    )
    sized = [c for c in both if _num(fs_by[c].get("capacity"))]
    report(
        "size differs from FusionSolar's plant list",
        [
            code(c)
            for c in sized
            if db_plants[c]["capacity_kwp"] is None
            or abs(
                float(db_plants[c]["capacity_kwp"])
                - float(_num(fs_by[c]["capacity"])) * (1000 if float(_num(fs_by[c]["capacity"])) < 1 else 1)
            )
            > 0.05
        ],
        len(sized),
    )
    codes = sorted(both)

    print("\nlive figures")
    live = {r["stationCode"]: r.get("dataItemMap") or {} for r in ask("live", lambda: fs.live(codes))}
    stale = [c for c in codes if not db_plants[c]["live_at"] or now - db_plants[c]["live_at"] > timedelta(hours=6)]
    report(
        "not synced in the last 6 hours",
        [code(c) for c in stale],
        len(codes),
        "the scheduler runs every few hours until it's set up",
    )

    def off(c: str, key: str, col: str, slack: float) -> bool:
        theirs, ours = _num(live.get(c, {}).get(key)), db_plants[c][col]
        if theirs is None:
            return ours is not None and float(ours) != 0
        if ours is None:
            return True
        return abs(float(theirs) - float(ours)) > max(slack, abs(float(theirs)) * 0.01)

    fresh = [c for c in codes if c in live and c not in stale]
    report(
        "total yield differs (over 1%)", [code(c) for c in fresh if off(c, "total_power", "total_kwh", 5)], len(fresh)
    )
    report(
        "this month's yield differs (over 1%)",
        [code(c) for c in fresh if off(c, "month_power", "month_kwh", 2)],
        len(fresh),
        "a plant synced hours ago lags by the hours since",
    )
    report(
        "today's yield differs (over 1%)",
        [code(c) for c in fresh if off(c, "day_power", "today_kwh", 1)],
        len(fresh),
        "as above",
    )
    from _lib.solar_sync import HEALTH

    report(
        "health differs",
        [
            code(c)
            for c in fresh
            if HEALTH.get(int(_num(live[c].get("real_health_state")) or 0)) not in (None, db_plants[c]["health"])
        ],
        len(fresh),
    )

    print("\nhistory")
    for period, when, label in (
        ("day", now, "this month's days"),
        ("month", now, "this year's months"),
        ("year", now, "every year"),
    ):
        rows = ask(f"{period}s", lambda p=period, w=when: fs.history(p, codes, w))
        theirs: dict[tuple[str, str], Decimal | None] = {}
        for r in rows:
            at = _when(r.get("collectTime"))
            m = r.get("dataItemMap") or {}
            kwh = _num(
                m.get("inverter_power")
                if m.get("inverter_power") is not None
                else m.get("PVYield") or m.get("inverterYield")
            )
            if at and r.get("stationCode") and kwh is not None:
                theirs[(r["stationCode"], at.astimezone(SG).strftime("%Y-%m-%d"))] = Decimal(str(kwh))
        ours = {
            (r["station_code"], r["at"].astimezone(SG).strftime("%Y-%m-%d")): r["kwh"]
            for r in fetch_all(
                "select station_code, at, kwh from solar_readings where period = %s and station_code = any(%s)",
                (period, codes),
            )
        }
        missing = [f"{code(c)} {d}" for (c, d) in theirs if (c, d) not in ours]
        differ = [
            f"{code(c)} {d}"
            for (c, d), v in theirs.items()
            if (c, d) in ours and ours[(c, d)] is not None and abs(Decimal(ours[(c, d)]) - v) > Decimal("0.05")
        ]
        # Today (and this month, this year) are still going: the app's may be from earlier today.
        running = (
            now.strftime("%Y-%m-%d")
            if period == "day"
            else now.strftime("%Y-%m-01")
            if period == "month"
            else now.strftime("%Y-01-01")
        )
        report(f"{label}: in FusionSolar, not in the app", [x for x in missing if not x.endswith(running)], len(theirs))
        report(
            f"{label}: kWh differs",
            [x for x in differ if not x.endswith(running)],
            len(theirs),
            "finished periods only",
        )

    print("\ndevices")
    fs_devs = ask("devices", lambda: fs.devices(codes))
    db_devs = {
        int(d["dev_id"]): d for d in fetch_all("select * from solar_devices where station_code = any(%s)", (codes,))
    }
    report(
        "in FusionSolar, not in the app",
        [str(d.get("id")) for d in fs_devs if int(d["id"]) not in db_devs],
        len(fs_devs),
    )
    fs_ids = {int(d["id"]) for d in fs_devs}
    report("in the app, no longer in FusionSolar", [str(i) for i in db_devs if i not in fs_ids], len(db_devs))
    report(
        "serial or plant differs",
        [
            str(d["id"])
            for d in fs_devs
            if int(d["id"]) in db_devs
            and (
                db_devs[int(d["id"])]["serial"] != d.get("esnCode")
                or db_devs[int(d["id"])]["station_code"] != d.get("stationCode")
            )
        ],
        len(fs_devs),
    )

    print("\nalarms")
    active = ask("alarms", lambda: fs.alarms(codes, datetime.now(UTC) - timedelta(days=30)))
    fs_keys = {(r.get("stationCode"), r.get("alarmName")) for r in active}
    db_keys = {
        (r["station_code"], r["name"])
        for r in fetch_all(
            "select station_code, name from solar_alarms where source = 'fusionsolar' and cleared_at is null and station_code = any(%s)",
            (codes,),
        )
    }
    report(
        "active in FusionSolar, not in the app",
        [f"{code(c)} {n}" for c, n in fs_keys - db_keys],
        len(fs_keys),
        "the next sync brings these in",
    )
    report(
        "active in the app, cleared in FusionSolar",
        [f"{code(c)} {n}" for c, n in db_keys - fs_keys],
        len(db_keys),
        "the next sync clears these",
    )

    print("\nthe app's own figures")
    years = defaultdict(Decimal)
    for r in fetch_all("select station_code, kwh from solar_readings where period = 'year' and kwh is not null"):
        years[r["station_code"]] += Decimal(r["kwh"])
    totalled = [c for c in codes if db_plants[c]["total_kwh"] is not None and years.get(c)]
    report(
        "a plant's total isn't its years added up (over 2%)",
        [
            code(c)
            for c in totalled
            if abs(Decimal(db_plants[c]["total_kwh"]) - years[c]) > max(Decimal(10), years[c] * Decimal("0.02"))
        ],
        len(totalled),
    )
    month0 = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    days = defaultdict(Decimal)
    for r in fetch_all(
        "select station_code, kwh from solar_readings where period = 'day' and at >= %s and kwh is not null", (month0,)
    ):
        days[r["station_code"]] += Decimal(r["kwh"])
    monthed = [c for c in codes if db_plants[c]["month_kwh"] is not None and c in days]
    report(
        "this month isn't its days added up (over 2%)",
        [
            code(c)
            for c in monthed
            if abs(Decimal(db_plants[c]["month_kwh"]) - days[c]) > max(Decimal(5), days[c] * Decimal("0.02"))
        ],
        len(monthed),
        "today's partial day can differ",
    )
    inv = fetch_all(
        "select o.system_id, o.month, o.kwh as invoiced, r.kwh as fusion, p.station_code from system_output o "
        "join solar_plants p on p.system_id = o.system_id "
        "join solar_readings r on r.station_code = p.station_code and r.period = 'month' "
        "and (r.at at time zone 'Asia/Singapore')::date = o.month where o.month < date_trunc('month', now())"
    )
    report(
        "a system's invoiced kWh isn't FusionSolar's month",
        [
            f"{code(r['station_code'])} {r['month']:%Y-%m}"
            for r in inv
            if r["invoiced"] is not None
            and r["fusion"] is not None
            and abs(Decimal(r["invoiced"]) - Decimal(r["fusion"])) > Decimal("0.05")
        ],
        len(inv),
        "months imported from the client list before FusionSolar was linked may differ",
    )

    print(f"\n{'Everything agrees.' if not problems else f'{problems} differences above.'}")


if __name__ == "__main__":
    main()
