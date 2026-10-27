# ruff: noqa: E501  (one assertion per line reads best here)
"""The KPI page's figures (api/_routes/kpis.py): each worked out as its calculation says.

The test database has other tests' systems in it, so each test takes the figures, adds systems whose
answers are known, and checks what changed.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from _routes.kpis import figures
from conftest import bearer

TODAY = date(2026, 10, 27)  # the last finished month is September 2026


@pytest.fixture
def fleet(fx):
    """Three systems:
    A  a 5-year PPA at S$0.20, turned on 10 Jun 2026, 100/200/300/400 kWh Jun to Sep
    B  no rate yet, 50 kWh in September
    C  bought outright (not a PPA) at S$0.30, 100 kWh in September"""
    made = []

    def system(rate, kind, years, on, kwp, months):
        sid = fx.conn.execute(
            "insert into maintenance_systems (import_ref, address, postal_code, rate_per_kwh, ppa_kind, ppa_years, turned_on_on, kwp) "
            "values (%s, '1 KPI Road', '466003', %s, %s, %s, %s, %s) returning system_id",
            (f"pytest-kpi-{uuid.uuid4().hex[:8]}", rate, kind, years, on, kwp),
        ).fetchone()["system_id"]
        for m, kwh in months.items():
            fx.conn.execute("insert into system_output (system_id, month, kwh) values (%s, %s, %s)", (sid, m, kwh))
        made.append(sid)
        return sid

    before = figures(TODAY)
    system(0.20, "ppa", 5, date(2026, 6, 10), 10, {date(2026, 6, 1): 100, date(2026, 7, 1): 200, date(2026, 8, 1): 300, date(2026, 9, 1): 400})
    system(None, "ppa", 8, date(2026, 9, 1), 8, {date(2026, 9, 1): 50})
    system(0.30, "value_buy", None, date(2026, 9, 1), 5, {date(2026, 9, 1): 100})
    yield before, figures(TODAY)
    fx.conn.execute("delete from system_output where system_id = any(%s)", (made,))
    fx.conn.execute("delete from maintenance_systems where system_id = any(%s)", (made,))


def _check(f, key):
    return next((c["n"] for c in f["checks"] if c["key"] == key), 0)


def test_last_months_revenue_is_each_systems_kwh_times_its_rate(fleet) -> None:
    before, after = fleet
    b, a = before["revenue"]["lastMonth"], after["revenue"]["lastMonth"]
    assert a["month"] == "2026-09"
    assert round(a["amount"] - b["amount"], 2) == 110.00, "400 x 0.20 + 100 x 0.30; B has no rate"
    assert a["kwh"] - b["kwh"] == 550 and a["systems"] - b["systems"] == 3 and a["noRate"] - b["noRate"] == 1
    assert round(after["revenue"]["runRate"]["fromLastMonth"] - before["revenue"]["runRate"]["fromLastMonth"], 2) == 1320.00


def test_what_the_contracts_still_bring_in(fleet) -> None:
    before, after = fleet
    b, a = before["revenue"]["contracted"], after["revenue"]["contracted"]
    # A: 5 years = 60 months, 4 billed (Jun to Sep), 56 left x its usual month (250 kWh) x S$0.20.
    assert round(a["amount"] - b["amount"]) == 2800
    assert a["systems"] - b["systems"] == 1, "B has no rate, C isn't a PPA"
    assert a["monthsLeft"] - b["monthsLeft"] == 56 and a["byActual"] - b["byActual"] == 1


def test_whats_less_certain_is_counted(fleet) -> None:
    before, after = fleet
    assert _check(after, "no_rate") - _check(before, "no_rate") == 1
    assert _check(after, "not_ppa") - _check(before, "not_ppa") == 1
    years = int(after["revenue"]["contracted"]["defaultYears"])
    assert _check(after, "term_differs") - _check(before, "term_differs") == (1 if years != 5 else 0), "A's 5 years isn't what invoicing uses"


def test_portfolio_counts_and_size(fleet) -> None:
    before, after = fleet
    assert after["portfolio"]["systems"] - before["portfolio"]["systems"] == 3
    assert round(after["portfolio"]["kwp"] - before["portfolio"]["kwp"], 1) == 23.0


def test_no_names_or_addresses_in_it(fleet) -> None:
    _, after = fleet
    text = str(after)
    assert "KPI Road" not in text and "466003" not in text


@pytest.mark.parametrize(("role", "code"), [("superadmin", 200), ("finance", 200), ("project_manager", 403), ("homeowner", 403), ("contractor", 403), ("epc_team", 403)])
def test_who_sees_the_figures(client, fx, role, code) -> None:
    u = fx.user(role)
    assert client.get("/api/py/kpis", headers=bearer(u["clerk_user_id"])).status_code == code
