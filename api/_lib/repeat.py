"""When a repeating meeting happens: the dates a rule gives, as Google Calendar offers them.

  daily            every day
  weekdays         every Monday to Friday
  weekly           the same weekday every week
  fortnightly      the same weekday every other week
  monthly_day      the same date every month (a month without it is skipped: the 31st)
  monthly_weekday  the same weekday of the month: the 2nd Tuesday, or the last Friday
  yearly           the same date every year (29 Feb only in leap years)

A repeat ends on a date, after a number of meetings, or never; "never" is set
up six months ahead. Each meeting is stored on its own (meetings.series_id).
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

RULES = ("daily", "weekdays", "weekly", "fortnightly", "monthly_day", "monthly_weekday", "yearly")
HORIZON = timedelta(days=182)  # how far ahead "never" is set up
LONGEST = timedelta(days=366)  # an end date at most a year after the first
MOST = 200  # meetings in one series, whatever the rule


def nth_weekday(d: date) -> int:
    """Which of its weekday in the month ``d`` is: 1 to 4, or -1 for the last (a 5th is the last)."""
    n = (d.day - 1) // 7 + 1
    return -1 if n == 5 else n


def _on_nth_weekday(year: int, month: int, weekday: int, n: int) -> date | None:
    days = calendar.monthrange(year, month)[1]
    if n == -1:
        last = date(year, month, days)
        return last - timedelta(days=(last.weekday() - weekday) % 7)
    first = date(year, month, 1)
    d = first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    return d if d.month == month else None


def _months_on(first: date, k: int) -> tuple[int, int]:
    y, m = divmod(first.month - 1 + k, 12)
    return first.year + y, m + 1


def dates(first: date, rule: str, *, until: date | None = None, count: int | None = None) -> list[date]:
    """The days the meeting is on, the first included, oldest first."""
    if rule not in RULES:
        raise ValueError(rule)
    last = min(until or first + HORIZON, first + LONGEST)
    most = min(count or MOST, MOST)
    out: list[date] = []

    def add(d: date | None) -> bool:
        """False once past the end."""
        if d is None:
            return True
        if d > last or len(out) >= most:
            return False
        if d >= first:
            out.append(d)
        return True

    if rule in ("daily", "weekdays"):
        d = first
        while d <= last and len(out) < most:
            if rule == "daily" or d.weekday() < 5:
                out.append(d)
            d += timedelta(days=1)
    elif rule in ("weekly", "fortnightly"):
        step = timedelta(weeks=1 if rule == "weekly" else 2)
        d = first
        while add(d):
            d += step
    elif rule == "monthly_day":
        k = 0
        while True:
            y, m = _months_on(first, k)
            if date(y, m, 1) > last or len(out) >= most:
                break
            if first.day <= calendar.monthrange(y, m)[1] and not add(date(y, m, first.day)):
                break
            k += 1
    elif rule == "monthly_weekday":
        n, wd, k = nth_weekday(first), first.weekday(), 0
        while True:
            y, m = _months_on(first, k)
            if date(y, m, 1) > last or not add(_on_nth_weekday(y, m, wd, n)):
                break
            k += 1
    else:  # yearly
        k = 0
        while True:
            y = first.year + k
            if date(y, 1, 1) > last:
                break
            leap_ok = (first.month, first.day) != (2, 29) or calendar.isleap(y)
            if leap_ok and not add(date(y, first.month, first.day)):
                break
            k += 1
    return out


ORDINAL = {1: "first", 2: "second", 3: "third", 4: "fourth", -1: "last"}


def describe(rule: str, first: date) -> str:
    """'Weekly on Tuesday', for messages (the screens word it themselves)."""
    day = first.strftime("%A")
    return {
        "daily": "Daily",
        "weekdays": "Every weekday (Monday to Friday)",
        "weekly": f"Weekly on {day}",
        "fortnightly": f"Every 2 weeks on {day}",
        "monthly_day": f"Monthly on day {first.day}",
        "monthly_weekday": f"Monthly on the {ORDINAL[nth_weekday(first)]} {day}",
        "yearly": f"Annually on {first.day} {first.strftime('%B')}",
    }[rule]
