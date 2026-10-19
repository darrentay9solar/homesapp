# ruff: noqa: E501  (case tables read better whole)
"""Million · the 8-year plan: which months a system is billed for.

docs/payments.md: a homeowner pays every month for the power their system
generated, for the plan's years (8) from the month it was turned on. So a month
is in the plan when it is the month the system was turned on, or one of the
95 after it; never before, never the 97th.

  in the plan     every turn-on day from 2024 to 2027 (leap years and month ends included),
                  against 71 months from 3 before to 13 past the end
  the plan        every turn-on day, plans of 1 to 10 years: the months, in order, no gaps
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from _lib import invoices

TURNED_ON = [date(2024, 1, 1) + timedelta(days=i) for i in range((date(2027, 12, 31) - date(2024, 1, 1)).days + 1)]
# Months around the start and the end of an 8-year plan (96 months), and a day inside each.
OFFSETS = [*range(-3, 30), *range(80, 110)]
DAYS_IN = [1, 15, 28]
IN_PLAN = [(t, k, d) for t in TURNED_ON for k in OFFSETS for d in DAYS_IN[: 1 + (k % 3 == 0) * 2]]
PLANS = [(t, years) for t in TURNED_ON for years in range(1, 11)]


def month_number(d: date) -> int:
    return d.year * 12 + d.month - 1


def month_from_number(n: int, day: int = 1) -> date:
    return date(n // 12, n % 12 + 1, day)


@pytest.mark.parametrize(("turned_on", "k", "day"), IN_PLAN, ids=[f"in_plan:{i}" for i in range(len(IN_PLAN))])
def test_in_plan(turned_on, k, day) -> None:
    month = month_from_number(month_number(turned_on) + k, day)
    assert invoices.in_plan(month, turned_on, 8) is (0 <= k < 96)


@pytest.mark.parametrize(("turned_on", "years"), PLANS, ids=[f"plan:{i}" for i in range(len(PLANS))])
def test_plan_months(turned_on, years) -> None:
    first = month_number(turned_on)
    assert invoices.plan_months(turned_on, years) == [month_from_number(first + i) for i in range(years * 12)]


def test_no_turn_on_no_plan() -> None:
    assert invoices.plan_months(None, 8) == []
    assert invoices.in_plan(date(2026, 1, 1), None, 8) is False
