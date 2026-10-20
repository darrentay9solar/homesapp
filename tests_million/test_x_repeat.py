# ruff: noqa: E501  (case tables read better whole)
"""Million · repeating meetings: every first day from 2024 to 2028, every rule, nine ways to end.

The reference walks the calendar one day at a time and keeps each day the rule
(as worded in api/_lib/repeat.py and on the meeting form) says the meeting is
on; it shares no code with repeat.dates().

  daily            every day
  weekdays         Monday to Friday
  weekly           every 7 days from the first
  fortnightly      every 14 days from the first
  monthly_day      the same date; a month without it is skipped
  monthly_weekday  the same weekday, the same one of the month (a 5th counts as the last)
  yearly           the same date; 29 Feb only in leap years

Ends: never (six months ahead), after 1, 3, 10 or 200 meetings, or on a date
30, 100, 366 or 500 days on (never more than a year), and never more than 200.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from _lib import repeat

FIRSTS = [date(2024, 1, 1) + timedelta(days=i) for i in range((date(2028, 12, 31) - date(2024, 1, 1)).days + 1)]
ENDS = [
    ("never", None, None),
    ("count", 1, None),
    ("count", 3, None),
    ("count", 10, None),
    ("count", 200, None),
    ("until", None, 30),
    ("until", None, 100),
    ("until", None, 366),
    ("until", None, 500),
]
CASES = [(f, rule, end) for f in FIRSTS for rule in repeat.RULES for end in range(len(ENDS))]


def _nth(d: date) -> int:
    """1 to 4, or -1: the last of its weekday in the month (a 5th is always the last)."""
    if (d + timedelta(days=7)).month != d.month:
        return -1
    return (d.day - 1) // 7 + 1


def on(rule: str, first: date, d: date) -> bool:
    gap = (d - first).days
    if rule == "daily":
        return True
    if rule == "weekdays":
        return d.weekday() < 5
    if rule == "weekly":
        return gap % 7 == 0
    if rule == "fortnightly":
        return gap % 14 == 0
    if rule == "monthly_day":
        return d.day == first.day
    if rule == "monthly_weekday":
        want = -1 if (first.day - 1) // 7 + 1 == 5 else (first.day - 1) // 7 + 1
        if d.weekday() != first.weekday():
            return False
        return _nth(d) == -1 if want == -1 else (d.day - 1) // 7 + 1 == want
    return (d.month, d.day) == (first.month, first.day)  # yearly


def expected(first: date, rule: str, count: int | None, until: date | None) -> list[date]:
    last = min(until or first + timedelta(days=182), first + timedelta(days=366))
    most = min(count or 200, 200)
    out, d = [], first
    while d <= last and len(out) < most:
        if on(rule, first, d):
            out.append(d)
        d += timedelta(days=1)
    return out


@pytest.mark.parametrize(("first", "rule", "end"), CASES, ids=[f"repeat:{i}" for i in range(len(CASES))])
def test_repeat_dates(first, rule, end) -> None:
    _, count, days = ENDS[end]
    until = first + timedelta(days=days) if days is not None else None
    assert repeat.dates(first, rule, until=until, count=count) == expected(first, rule, count, until)
