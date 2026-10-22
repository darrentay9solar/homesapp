# ruff: noqa: E501  (messages read better whole)
"""Brings in everything FusionSolar already has: the plants, their inverters, and their
history since each was connected (by year, month and day, and the last weeks by hour);
then each finished month's kWh into the monthly invoices' records (system_output).

    node scripts/py.mjs scripts/solar_import.py --target dev
    node scripts/py.mjs scripts/solar_import.py --target prod --confirm

It needs FUSIONSOLAR_URL, FUSIONSOLAR_USER and FUSIONSOLAR_PASSWORD in .env.local (an API
account from FusionSolar's Northbound Management; docs/solar.md). FusionSolar limits how
often each kind of call is made, so this waits and tries again when told it's too often:
a full import of many plants takes a while. It can be stopped and run again; what's in
already isn't fetched twice (solar_sync "import:..." keys).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

URLS = {"dev": "DATABASE_URL", "prod": "PROD_DATABASE_URL"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--confirm", action="store_true", help="needed for production")
    ap.add_argument("--hours", type=int, default=31, help="days back to fetch hour by hour (default 31)")
    ap.add_argument("--power-days", type=int, default=7, help="days back of 5-minute power for the charts (default 7)")
    a = ap.parse_args()
    if a.target == "prod" and not a.confirm:
        sys.exit("Production needs --confirm.")

    from _lib.db import _from_env_file

    url = os.environ.get(URLS[a.target]) or _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set.")
    os.environ["DATABASE_URL"] = url  # everything below writes to this database

    from _lib import fusionsolar as fs
    from _lib import solar_sync as sync
    from _lib.db import fetch_all, fetch_one, transaction

    if not fs.configured():
        sys.exit(
            "FusionSolar isn't connected: set FUSIONSOLAR_URL, FUSIONSOLAR_USER and FUSIONSOLAR_PASSWORD in .env.local."
        )

    def patient(label: str, fn):
        """Runs a call, waiting a minute and trying again (up to 15 times) when FusionSolar says it's too often."""
        for attempt in range(15):
            try:
                return fn()
            except fs.RateLimitedError:
                print(f"  {label}: FusionSolar says too often; waiting a minute (try {attempt + 1})", flush=True)
                time.sleep(65)
        raise SystemExit(f"{label}: still refused after 15 minutes. Run again later; it carries on where it stopped.")

    def done(key: str) -> bool:
        return fetch_one("select 1 from solar_sync where key = %s", (f"import:{key}",)) is not None

    def mark(key: str) -> None:
        with transaction(None) as cur:
            cur.execute(
                "insert into solar_sync (key, value, at) values (%s, %s, now()) on conflict (key) do update set at = now()",
                (f"import:{key}", json.dumps(True)),
            )

    print("Plants…", flush=True)
    n = sync.save_plants(patient("plants", fs.plants))
    linked = fetch_one("select count(*)::int n from solar_plants where system_id is not null")["n"]
    print(f"  {n} plants; {linked} linked to a system in the app", flush=True)
    codes = sync.codes()
    print("Inverters…", flush=True)
    print(f"  {sync.save_devices(patient('devices', lambda: fs.devices(codes)))} devices", flush=True)

    # Power every 5 minutes for the last few days (the power curves); the 15-minute job keeps today's.
    print("Power every 5 minutes…", flush=True)
    now_sg = datetime.now(sync.SG)
    for back in range(a.power_days, -1, -1):
        day = now_sg - timedelta(days=back)
        key = f"power:{day.date().isoformat()}"
        if back and done(key):
            continue
        n = patient(key, lambda day=day: sync.power_on(day))
        print(f"  {key}: {n} readings", flush=True)
        mark(key)

    first = fetch_one("select min(grid_connected_on) d from solar_plants")["d"] or (date.today() - timedelta(days=365))
    today = datetime.now(sync.SG)
    years = list(range(first.year, today.year + 1))

    def fetch(period: str, when: datetime, key: str) -> None:
        if done(key) and key[-7:] != today.strftime("%Y-%m") and key[-10:] != today.strftime("%Y-%m-%d"):
            return
        rows = patient(key, lambda: fs.history(period, codes, when))
        print(f"  {key}: {sync.save_history(period, rows)} new or changed", flush=True)
        mark(key)

    print("By year…", flush=True)
    fetch("year", today, f"year:{today.year}")
    print("By month…", flush=True)
    for y in years:
        fetch("month", datetime(y, 6, 1, tzinfo=sync.SG), f"month:{y}")
    print("By day…", flush=True)
    m = date(first.year, first.month, 1)
    while m <= today.date():
        fetch("day", datetime(m.year, m.month, 15, tzinfo=sync.SG), f"day:{m:%Y-%m}")
        m = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
    print("By hour…", flush=True)
    for back in range(a.hours, -1, -1):
        d = (today - timedelta(days=back)).replace(hour=12, minute=0, second=0, microsecond=0)
        fetch("hour", d, f"hour:{d:%Y-%m-%d}")

    print("Finished months into the invoices' records…", flush=True)
    months = fetch_all(
        "select distinct (at at time zone 'Asia/Singapore')::date m from solar_readings where period = 'month' "
        "and at < date_trunc('month', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore' order by 1"
    )
    total = sum(sync.month_into_invoices(r["m"]) for r in months)
    print(f"  {total} system-months written", flush=True)
    unlinked = fetch_all("select name from solar_plants where system_id is null order by name")
    if unlinked:
        print(f"{len(unlinked)} plants aren't linked to a system yet (link them in the app: Solar → a plant → Link):")
        for r in unlinked:
            print("  -", r["name"])
    print("Done.")


if __name__ == "__main__":
    main()
