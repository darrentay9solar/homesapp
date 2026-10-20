# ruff: noqa: E501  (case tables read better whole)
"""Million · which reminder a maintenance check gets, every day of 2026.

The check reminders (api/_lib/maintenance_reminders.py, docs/STATUS.md): the homeowner and their manager hear 14 days before a
check is due ("soon"), on the day ("due"), and then while it's overdue, for up
to 90 days; nothing before 14 days out or after 90 days late. Every day as
today, against due dates from 120 days before to 120 after.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from _lib import maintenance_reminders

TODAYS = [date(2026, 1, 1) + timedelta(days=i) for i in range(365)]
CASES = [(t, off) for t in TODAYS for off in range(-120, 121)]


@pytest.mark.parametrize(("today", "off"), CASES, ids=[f"stage:{i}" for i in range(len(CASES))])
def test_reminder_stage(today, off) -> None:
    want = "soon" if 1 <= off <= 14 else "due" if off == 0 else "overdue" if -90 <= off <= -1 else None
    assert maintenance_reminders.stage_for(today + timedelta(days=off), today) == want
