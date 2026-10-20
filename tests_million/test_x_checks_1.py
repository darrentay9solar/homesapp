# ruff: noqa: E501  (case tables read better whole)
"""Million · a maintenance check's state, every day of 2026 (January to June).

The Maintenance page (docs/PROCESS_FLOW.md): a check is done once it has been done; otherwise overdue
the day after it was due, due soon from 30 days before, and scheduled before
that. A check without a date is unscheduled. Every day as today, against due
dates from 150 days before to 150 days after, done and not done.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from _routes import maintenance

TODAYS = [date(2026, 1, 1) + timedelta(days=i) for i in range(0, 182)]
CASES = [(t, off, done) for t in TODAYS for off in range(-150, 151) for done in (False, True)]


@pytest.mark.parametrize(("today", "off", "done"), CASES, ids=[f"check:{i}" for i in range(len(CASES))])
def test_check_state(today, off, done) -> None:
    due = today + timedelta(days=off)
    want = "done" if done else "overdue" if off < 0 else "due_soon" if off <= 30 else "scheduled"
    assert maintenance.check_state(due, today - timedelta(days=1) if done else None, today) == want


@pytest.mark.parametrize("today", TODAYS, ids=[f"unscheduled:{i}" for i in range(len(TODAYS))])
def test_no_date_is_unscheduled(today) -> None:
    assert maintenance.check_state(None, None, today) == "unscheduled"
