# ruff: noqa: E501, RUF001  (case tables read better whole; odd digits are typed on purpose)
"""Million · the dashboard's periods: which days count, the period before, the chart's columns.

As the dashboard says it (docs/STATUS.md, "Dashboard periods"):

  a period    "the last N days": today and the N-1 days before it. Any N from 1 to 3,650
              ("45d"), or one of the named ones; anything else means the last 90 days.
  before      the N days just before those, for "up/down on the period before"
  columns     weeks (Monday to Sunday) when the period is 120 days or less, as many as
              cover it, the last one this week; otherwise months, the last one this month:
              12, or for a period over a year as many as it covers, never more than 24.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from itertools import pairwise

import pytest

from _lib import analytics

TODAYS = [
    date(2024, 2, 29),
    date(2024, 12, 31),
    date(2025, 1, 1),
    date(2025, 3, 1),
    date(2026, 6, 15),
    date(2026, 10, 19),
    date(2027, 2, 28),
    date(2028, 2, 29),
]
LENGTHS = [*range(1, 121), 150, 180, 200, 365, 366, 400, 730, 1000, 1826, 3650]
# Up to 120 days: every day from before the period before it to after today. Longer: the days at its edges.
MEMBERS = [
    (t, n, off)
    for t in TODAYS
    for n in LENGTHS
    for off in (
        range(-2 * n - 2, 3)
        if n <= 120
        else sorted({-2 * n - 1, -2 * n, -2 * n + 1, -n - 1, -n, -n + 1, -n + 2, -1, 0, 1, 2, -(n // 2), -(3 * n // 2)})
    )
]
COLUMNS = [
    (t, n)
    for t in [date(2024, 1, 1) + timedelta(days=i * 37) for i in range(40)]
    for n in [*range(1, 130), 150, 200, 366, 367, 400, 500, 730, 731, 1000, 2000, 3650]
]
KEYS = [
    *[(f"{n}d", n) for n in range(1, 3651)],
    *[(f"{n}d", None) for n in range(3651, 4500)],
    *[
        (k, None)
        for k in (
            "0d",
            "00d",
            "01d",
            "007d",
            "-5d",
            "5",
            "5D",
            " 5d",
            "5d ",
            "5 d",
            "d",
            "",
            "1.5d",
            "1e3d",
            "10000d",
            "abc",
            "30days",
            "90",
            "٣d",
            "５d",
        )
    ],
]


def in_period(n: int, today: date, d: date) -> bool:
    return 0 <= (today - d).days < n


def in_period_before(n: int, today: date, d: date) -> bool:
    return n <= (today - d).days < 2 * n


@pytest.mark.parametrize(("today", "n", "off"), MEMBERS, ids=[f"member:{i}" for i in range(len(MEMBERS))])
def test_which_days_count(today, n, off) -> None:
    w = analytics.window(f"{n}d", today)
    d = today + timedelta(days=off)
    assert w.has(d) is in_period(n, today, d)
    assert w.had_before(d) is in_period_before(n, today, d)


@pytest.mark.parametrize(("today", "n"), COLUMNS, ids=[f"columns:{i}" for i in range(len(COLUMNS))])
def test_chart_columns(today, n) -> None:
    cols = analytics.buckets(analytics.window(f"{n}d", today), today)
    if n <= 120:
        monday = today - timedelta(days=today.weekday())
        assert len(cols) == max(1, math.ceil(n / 7))
        for i, (_, start, end) in enumerate(reversed(cols)):
            assert start == monday - timedelta(weeks=i)
            assert start.weekday() == 0 and end == start + timedelta(days=6)
        # They cover the period.
        assert cols[0][1] <= today - timedelta(days=n - 1) or len(cols) * 7 >= n
    else:
        want = 12 if n <= 366 else min(24, math.ceil(n / 30.44))
        assert len(cols) == want
        assert cols[-1][1] == today.replace(day=1)
        for (_, s1, e1), (_, s2, _) in pairwise(cols):
            assert s1.day == 1 and e1 + timedelta(days=1) == s2


@pytest.mark.parametrize(("key", "days"), KEYS, ids=[f"key:{i}" for i in range(len(KEYS))])
def test_what_a_period_means(key, days) -> None:
    got = analytics.period(key)
    if days is None:
        # Not a period: the dashboard falls back to the last 90 days.
        assert got is None or key in analytics.PERIODS
        assert analytics.window(key, date(2026, 10, 19)).key == (key if key in analytics.PERIODS else "90d")
    else:
        assert got == (("Last day" if days == 1 else f"Last {days} days"), days) or key in analytics.PERIODS
        assert analytics.window(key, date(2026, 10, 19)).start == date(2026, 10, 19) - timedelta(days=days - 1)
