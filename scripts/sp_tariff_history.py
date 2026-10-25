# ruff: noqa: E501  (messages read better whole)
"""SP Power's history: what the electricity tariff was made of, quarter by quarter, before the app read
SP's page itself (docs/tariffs.md).

    node scripts/py.mjs scripts/sp_tariff_history.py --target dev
    node scripts/py.mjs scripts/sp_tariff_history.py --target prod --confirm

  SP's own pages   SP Group's tariff page has always shown the current quarter and its four parts. The
                   Internet Archive keeps copies of it (and of the page before it, "Understanding the
                   Tariff", to mid-2023). Each copy gives one quarter, kept only when its parts add up to
                   SP's own monthly total on data.gov.sg for that quarter (or, after June 2026, when there's
                   none to check against).
  EMA's years      for 2018 to June 2021, EMA's yearly parts (data.gov.sg, "Annual Electricity Tariffs by
                   Components"), put on the months that have no quarter of SP's.

The archive limits how often it's asked, so this waits between copies and when told to. It can be run
again: a quarter already kept from SP isn't fetched twice. Nothing here is about customers.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

URLS = {"dev": "DATABASE_URL", "test": "TEST_DATABASE_URL", "prod": "PROD_DATABASE_URL"}
PAGES = [
    "spgroup.com.sg/our-services/utilities/tariff-information",
    "spgroup.com.sg/sp-services/understanding-the-tariff",
]
EMA = "https://data.gov.sg/api/action/datastore_search?resource_id=d_b0b8f7a72f94e983fe42038b9aa4a464&limit=100"
SINCE = 2018
AGENT = {"User-Agent": "Mozilla/5.0 (GetHomeApps; 9 Solar Home)"}


def _get(url: str, tries: int = 6) -> str:
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=90) as r:
                return r.read().decode("utf8", "replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            code = getattr(exc, "code", None)
            if n == tries - 1 or code in (404, 403):
                raise
            wait = 90 if code == 429 else 30
            print(f"    the archive said {code or type(exc).__name__}; waiting {wait} s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def snapshots() -> list[tuple[str, str]]:
    out = []
    for page in PAGES:
        cdx = f"https://web.archive.org/cdx/search/cdx?url={page}&output=json&from={SINCE}&filter=statuscode:200&collapse=timestamp:6&fl=timestamp"
        rows = json.loads(_get(cdx))[1:]
        out += [(r[0], page) for r in rows]
        time.sleep(5)
    return sorted(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--confirm", action="store_true", help="required for production")
    a = ap.parse_args()
    if a.target == "prod" and not a.confirm:
        sys.exit("Refusing to write to production without --confirm.")
    from _lib.db import _from_env_file

    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    os.environ["DATABASE_URL"] = url  # the app's own connection, as the scheduled job writes

    from _lib import tariff
    from _lib.db import fetch_all, transaction

    tariff.save(tariff.read_history(tariff._get(tariff.HISTORY)), "data_gov_sg")
    monthly = {r["starts_on"]: Decimal(r["cents_without_gst"]) for r in fetch_all("select starts_on, cents_without_gst from sp_tariffs where source = 'data_gov_sg'")}
    have = {r["starts_on"] for r in fetch_all("select starts_on from sp_tariffs where source = 'sp_group' and network_cents is not null")}

    print("SP's pages, as the Internet Archive kept them")
    kept, odd = 0, []
    for ts, page in snapshots():
        try:
            q = tariff.read_quarter(_get(f"https://web.archive.org/web/{ts}id_/https://www.{page}"))
        except Exception as exc:
            print(f"  {ts[:8]}: couldn't read ({type(exc).__name__})")
            time.sleep(8)
            continue
        time.sleep(8)
        if not q or q["starts_on"] in have:
            continue
        check = monthly.get(q["starts_on"])
        if check is not None and abs(check - q["cents_without_gst"]) > Decimal("0.02"):
            odd.append(f"{q['starts_on']:%Y-%m}: parts add to {q['cents_without_gst']}, SP's month says {check}")
            continue
        tariff.save([q], "sp_group")
        have.add(q["starts_on"])
        kept += 1
        print(f"  {q['starts_on']:%Y} Q{(q['starts_on'].month - 1) // 3 + 1}: {q['cents_without_gst']}¢ before GST, network {q['network_cents']}¢")
    print(f"  {kept} quarters kept" + (f"; left out (didn't add up): {'; '.join(odd)}" if odd else ""))

    print("EMA's yearly parts")
    rows = json.loads(tariff._get(EMA))["result"]["records"]
    n = 0
    with transaction(None) as cur:
        for r in rows:
            y = int(r["year"])
            if y < SINCE:
                continue
            cur.execute(
                "update sp_tariffs set energy_cents = %s, network_cents = %s, mss_cents = %s, market_admin_cents = %s "
                "where source = 'data_gov_sg' and network_cents is null and starts_on >= %s and starts_on < %s",
                (
                    Decimal(r["energy_costs_cent_per_kwh"]), Decimal(r["grid_charges_cent_per_kwh"]),
                    Decimal(r["mkt_support_service_fees_cent_per_kwh"]), Decimal(r["power_sys_ops_mkt_admin_fees_cent_per_kwh"]),
                    date(y, 1, 1), date(y + 1, 1, 1),
                ),
            )  # fmt: skip
            n += cur.rowcount
    print(f"  {n} months given EMA's parts for their year")
    gaps = fetch_all(
        "select to_char(starts_on, 'YYYY-MM') as m from sp_tariffs t where starts_on >= %s and network_cents is null "
        "and not exists (select 1 from sp_tariffs q where q.source = 'sp_group' and q.network_cents is not null "
        "and t.starts_on between q.starts_on and q.ends_on) order by 1",
        (date(SINCE, 1, 1),),
    )
    print("months still without parts:", ", ".join(g["m"] for g in gaps) or "none")


if __name__ == "__main__":
    main()
