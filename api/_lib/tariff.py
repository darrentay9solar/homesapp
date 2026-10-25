# ruff: noqa: E501  (the page's pattern and the figures read better whole)
"""SP Group's household electricity tariff: what electricity costs to buy from SP, and what SP pays for solar
sent to the grid (docs/tariffs.md).

SP Group sets the tariff each quarter and publishes it on its tariff page, with what it's made of: energy
costs, network costs (SP's grid), the market support services fee and the market admin and power system
operation fee. There's no feed to read, so the page is read once a day (sync): a new quarter is kept in
sp_tariffs the day SP publishes it. The months before come from data.gov.sg, SP Group's own monthly series
("Low Tension Supplies - Domestic", before GST), without the parts.

  buying     the tariff with GST: what a household pays SP for each kWh it uses
  selling    the tariff less the network costs, before GST: what SP credits for each kWh a household's
             solar sends to the grid (EMA's simplified credit treatment: the network costs are SP's own)
"""

from __future__ import annotations

import html
import json
import re
import urllib.request
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from _lib.db import fetch_all, fetch_one, transaction

SP_PAGE = "https://www.spgroup.com.sg/our-services/utilities/tariff-information"
HISTORY = "https://data.gov.sg/api/action/datastore_search?resource_id=d_61eac3cdb086814af485dcc682b75ae9&limit=50"
SERIES = "Low Tension Supplies - Domestic"
EVERY = timedelta(hours=12)
MONTHS = {
    m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)
}


def gst_rate(on: date) -> Decimal:
    """Singapore's GST on that day: 7% to 2022, 8% in 2023, 9% from 2024."""
    return Decimal("0.07") if on.year <= 2022 else Decimal("0.08") if on.year == 2023 else Decimal("0.09")


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (GetHomeApps; 9 Solar Home)"})
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf8", "replace")


def _text(page: str) -> str:
    page = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", "", page)
    return re.sub(r"\s*\n\s*", "\n", html.unescape(re.sub(r"<[^>]+>", "\n", page)))


def _day(d: str, year: int) -> date:
    day, mon = d.split()
    return date(year, MONTHS[mon[:3].lower()], int(day))


def read_sp(page: str) -> dict[str, Any]:
    """The quarter's tariff from SP Group's tariff page, checked: its parts must add up to its total."""
    t = _text(page)
    m = re.search(
        r"([\d.]+)\s*cents/kWh\s*([\d.]+)\s*cents/kWh\s*\(w/o GST\)\s*ELECTRICITY TARIFF\s*\(wef\s*(\d{1,2} \w+)\s*-\s*(\d{1,2} \w+)\s*(\d{2,4})\)",
        t,
        re.IGNORECASE,
    )
    if not m:
        raise ValueError("SP Group's tariff page no longer shows the electricity tariff where it did")
    year = int(m.group(5)) + (2000 if len(m.group(5)) == 2 else 0)
    ends = _day(m.group(4), year)
    starts = _day(m.group(3), year if _day(m.group(3), year) <= ends else year - 1)
    out: dict[str, Any] = {
        "starts_on": starts,
        "ends_on": ends,
        "cents_with_gst": Decimal(m.group(1)),
        "cents_without_gst": Decimal(m.group(2)),
    }
    parts = {
        "energy_cents": r"Energy Costs\s*([\d.]+)\s*c/kWh",
        "network_cents": r"Network Costs\s*([\d.]+)\s*c/kWh",
        "mss_cents": r"MSS Fee\s*([\d.]+)\s*c/kWh",
        "market_admin_cents": r"Market Admin(?:istration)? & PSO Fee\s*([\d.]+)\s*c/kWh",
    }
    found = {k: re.search(rx, t, re.IGNORECASE) for k, rx in parts.items()}
    if all(found.values()):
        values = {k: Decimal(v.group(1)) for k, v in found.items() if v}
        # The parts are only kept when they add up to the total (the page shows one quarter's of each).
        if abs(sum(values.values()) - out["cents_without_gst"]) <= Decimal("0.02"):
            out.update(values)
    return out


# The four parts as SP's pages have shown them: "Network Costs 6.10c/kWh" (since 2023) and, before,
# ">>Network Costs >>5.77" (a chart's labels and values).
PARTS = {
    "energy_cents": r"Energy Costs\s*(?:>>)?\s*([\d.]+)",
    "network_cents": r"Network Costs\s*(?:>>)?\s*([\d.]+)",
    "mss_cents": r"MSS Fee\s*(?:>>)?\s*([\d.]+)",
    "market_admin_cents": r"Market Admin(?:istration)? & PSO Fee\s*(?:>>)?\s*([\d.]+)",
}


def read_quarter(page: str) -> dict[str, Any] | None:
    """A quarter's tariff from its parts, as SP's tariff pages label them ("Q1 2022 Electricity Tariff (before
    GST)" beside energy, network and the two fees): the total before GST is their sum. None without all four.
    For SP's pages of earlier quarters (kept by the Internet Archive), checked against SP's monthly totals."""
    t = _text(page)
    q = re.search(r"Q([1-4])\s*(\d{4})\s*Electricity Tariff\s*\(before GST\)", t, re.IGNORECASE)
    found = {k: re.search(rx, t, re.IGNORECASE) for k, rx in PARTS.items()}
    if not q or not all(found.values()):
        return None
    year, n = int(q.group(2)), int(q.group(1))
    starts = date(year, 3 * (n - 1) + 1, 1)
    ends = (starts.replace(day=28) + timedelta(days=4 + 62)).replace(day=1) - timedelta(days=1)
    parts = {k: Decimal(m.group(1)) for k, m in found.items() if m}
    total = sum(parts.values())
    return {
        "starts_on": starts,
        "ends_on": ends,
        "cents_without_gst": total,
        "cents_with_gst": (total * (1 + gst_rate(starts))).quantize(Decimal("0.01")),
        **parts,
    }


def read_history(body: str) -> list[dict[str, Any]]:
    """Each month's household tariff before GST from data.gov.sg (SP Group's series)."""
    rows = json.loads(body)["result"]["records"]
    row = next((r for r in rows if (r.get("DataSeries") or "").strip() == SERIES), None)
    if not row:
        raise ValueError(f"data.gov.sg no longer has the series {SERIES!r}")
    out = []
    for k, v in row.items():
        m = re.fullmatch(r"(\d{4})([A-Za-z]{3})", k)
        if m and v not in (None, "", "na", "-"):
            starts = date(int(m.group(1)), MONTHS[m.group(2).lower()], 1)
            ends = (starts.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            out.append({"starts_on": starts, "ends_on": ends, "cents_without_gst": Decimal(str(v))})
    return sorted(out, key=lambda r: r["starts_on"])


def save(rows: list[dict[str, Any]], source: str) -> int:
    cols = [
        "starts_on",
        "ends_on",
        "cents_without_gst",
        "cents_with_gst",
        "energy_cents",
        "network_cents",
        "mss_cents",
        "market_admin_cents",
    ]
    n = 0
    with transaction(None) as cur:
        for r in rows:
            vals = [r.get(c) for c in cols]
            # SP's own quarter is never replaced by data.gov.sg's month.
            cur.execute(
                f"insert into sp_tariffs ({', '.join(cols)}, source) values ({', '.join(['%s'] * len(cols))}, %s) "
                "on conflict (starts_on) do update set "
                + ", ".join(f"{c} = excluded.{c}" for c in cols[1:])
                + ", source = excluded.source, fetched_at = now() "
                + ("" if source == "sp_group" else "where sp_tariffs.source = 'data_gov_sg'"),
                (*vals, source),
            )
            n += cur.rowcount
    return n


# Quarters SP Group published before the app read its page, as its releases state them: Q3 2026 "increase by
# 4.64 cents per kWh" on Q2's 27.27 (data.gov.sg). Its parts are in an image only, so they're left out.
KNOWN = [
    {
        "starts_on": date(2026, 7, 1),
        "ends_on": date(2026, 9, 30),
        "cents_without_gst": Decimal("31.91"),
        "cents_with_gst": Decimal("34.78"),
    },
]


def sync(now: datetime) -> dict[str, Any]:
    """Twice a day at most: SP's current quarter, and data.gov.sg's months when there are none yet or
    it's a new month. Either failing leaves what's kept."""
    last = fetch_one("select max(fetched_at) as at from sp_tariffs where source = 'sp_group'")
    out: dict[str, Any] = {}
    if not fetch_one("select 1 from sp_tariffs where starts_on = %s", (KNOWN[0]["starts_on"],)):
        save(KNOWN, "sp_group")
    if not last or not last["at"] or now - last["at"] >= EVERY:
        out["sp"] = save([read_sp(_get(SP_PAGE))], "sp_group")
    months = fetch_one("select max(fetched_at) as at, count(*) as n from sp_tariffs where source = 'data_gov_sg'")
    if not months or not months["n"] or (now - months["at"]).days >= 7:
        out["history"] = save(read_history(_get(HISTORY)), "data_gov_sg")
    return out


# ------------------------------------------------------------------ for the screen


def _f(v: Any) -> float | None:
    return round(float(v), 2) if v is not None else None


def _month_end(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def monthly(today: date) -> list[dict[str, Any]]:
    """Each month up to this one: the tariff before and with GST, its four parts and what SP pays for solar
    where they're known. A quarter SP published covers its three months; before those, a month has SP's
    total from data.gov.sg and (2018 to mid-2021) EMA's parts for its year."""
    rows = fetch_all("select * from sp_tariffs order by starts_on")
    quarters = [r for r in rows if r["source"] == "sp_group"]
    by_month = {r["starts_on"]: r for r in rows if r["source"] == "data_gov_sg"}
    if not rows:
        return []
    out = []
    m = min(r["starts_on"] for r in rows).replace(day=1)
    while m <= today:
        q = next((r for r in quarters if r["starts_on"] <= m <= (r["ends_on"] or _month_end(r["starts_on"]))), None)
        r = q or by_month.get(m)
        if r:
            without = Decimal(r["cents_without_gst"])
            # The parts: the quarter's own, else the month's (EMA's year); a quarter without them borrows none.
            src = q if q and q["network_cents"] is not None else by_month.get(m) if not q else None
            network = src["network_cents"] if src else None
            out.append(
                {
                    "month": m.isoformat()[:7],
                    "withoutGst": _f(without),
                    "withGst": _f(
                        r["cents_with_gst"] if q and r["cents_with_gst"] is not None else without * (1 + gst_rate(m))
                    ),
                    "selling": _f(without - Decimal(network)) if network is not None else None,
                    "energy": _f(src["energy_cents"]) if src else None,
                    "network": _f(network),
                    "mss": _f(src["mss_cents"]) if src else None,
                    "marketAdmin": _f(src["market_admin_cents"]) if src else None,
                    # Where the parts come from: SP's quarter, or EMA's year.
                    "partsFrom": ("sp" if src is q else "ema") if src else None,
                    "source": r["source"],
                }
            )
        m = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


def _months_back(today: date, n: int) -> str:
    """The month n months before this one, as YYYY-MM."""
    y, m = divmod(today.year * 12 + today.month - 1 - n, 12)
    return f"{y:04d}-{m + 1:02d}"


FIGURES = ("withGst", "withoutGst", "selling", "energy", "network", "mss", "marketAdmin")


def _avg(xs: list[float | None]) -> float | None:
    vals = [x for x in xs if x is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def summary(months: list[dict[str, Any]]) -> dict[str, Any]:
    """The average of every figure over these months, and how many months each average is over."""
    return {
        "months": len(months),
        "from": months[0]["month"] if months else None,
        "to": months[-1]["month"] if months else None,
        **{k: _avg([m[k] for m in months]) for k in FIGURES},
        "partsMonths": sum(1 for m in months if m["network"] is not None),
    }


def on_day(months: list[dict[str, Any]], day: date) -> dict[str, Any] | None:
    """The tariff in force on a day: its month's figures (SP's tariff changes each quarter, never within a month)."""
    key = day.isoformat()[:7]
    return next(({**m, "date": day.isoformat()} for m in months if m["month"] == key), None)


def overview(
    today: date, start: date | None = None, end: date | None = None, day: date | None = None
) -> dict[str, Any]:
    """The current quarter and its parts; every month; the averages over the last 12 months and 8 years; and,
    when asked, the averages between two dates and the figures on one day."""
    cur = fetch_one(
        "select * from sp_tariffs where source = 'sp_group' and starts_on <= %s order by starts_on desc limit 1",
        (today,),
    )
    months = monthly(today)
    current = None
    if cur:
        without = Decimal(cur["cents_without_gst"])
        network = cur["network_cents"]
        with_gst = cur["cents_with_gst"] if cur["cents_with_gst"] is not None else without * (1 + gst_rate(today))
        current = {
            "startsOn": cur["starts_on"].isoformat(),
            "endsOn": cur["ends_on"].isoformat() if cur["ends_on"] else None,
            "withGst": _f(with_gst),
            "withoutGst": _f(without),
            "buying": _f(with_gst),
            "selling": _f(without - Decimal(network)) if network is not None else None,
            "parts": {
                "energy": _f(cur["energy_cents"]),
                "network": _f(network),
                "mss": _f(cur["mss_cents"]),
                "marketAdmin": _f(cur["market_admin_cents"]),
            },
            "gstRate": float(gst_rate(today)) * 100,
            "checkedAt": cur["fetched_at"].isoformat(),
        }
    # Calendar months up to this one (a month without figures isn't replaced by an older one).
    last12 = [m for m in months if m["month"] >= _months_back(today, 11)]
    out: dict[str, Any] = {
        "current": current,
        "history": months,
        "average12": {**summary(last12), "sellingMonths": sum(1 for m in last12 if m["selling"] is not None)},
        "average8y": summary([m for m in months if m["month"] >= _months_back(today, 95)]),
        "source": {
            "sp": SP_PAGE,
            "history": "https://data.gov.sg/datasets/d_61eac3cdb086814af485dcc682b75ae9/view",
            "parts": "https://data.gov.sg/datasets/d_b0b8f7a72f94e983fe42038b9aa4a464/view",
        },
    }
    if start or end:
        lo = (start or date(2000, 1, 1)).isoformat()[:7]
        hi = (end or today).isoformat()[:7]
        out["range"] = summary([m for m in months if lo <= m["month"] <= hi])
    if day:
        out["on"] = on_day(months, day)
    return out
