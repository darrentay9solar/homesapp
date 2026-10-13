"""The dashboard's Maintenance tab numbers (_lib/analytics.maintenance), from rows alone.

Shaped on the real listing: checks already overdue, one maker's inverters
under many model names, a few large systems among many small ones, and PPAs
of different lengths.
"""

from __future__ import annotations

from datetime import date

import pytest

from _lib import analytics as an

TODAY = date(2026, 10, 13)


def system(sid: int, **over) -> dict:
    row = {
        "system_id": sid,
        "address": f"{sid} Test Street",
        "postal_code": "560123",
        "run_by": None,
        "pm_name": None,
        "kwp": 12.0,
        "phase": 3,
        "inverters": ["SUN2000-10K-LC0"],
        "ppa_kind": "ppa",
        "ppa_years": 7,
        "plan_years": 7,
        "plan_excludes_first_year": True,
        "turned_on_on": date(2026, 5, 1),
        "six_month_due": date(2026, 11, 1),
        "six_month_done_on": None,
        "one_year_due": date(2027, 5, 1),
        "one_year_done_on": None,
        "urgent": False,
    }
    return {**row, **over}


def test_overdue_checks_are_counted_apart_from_the_months_ahead() -> None:
    rows = [
        system(1, six_month_due=date(2026, 3, 29), one_year_due=date(2026, 9, 29)),
        system(2, six_month_due=date(2026, 8, 15)),
        system(3, six_month_due=date(2026, 8, 15), six_month_done_on=date(2026, 8, 20)),
        system(4),
    ]
    u = an.maintenance(rows, TODAY)
    assert u["overdueChecks"] == {"six": 2, "year": 1}
    assert sum(m["six"] + m["year"] for m in u["upcoming"]) == 4, "1-year checks of 2-4, and the 6-month of 4"
    assert u["tiles"]["overdue"]["count"] == 2


def test_inverters_group_by_rating_with_every_model_kept() -> None:
    rows = [
        system(1, inverters=["SUN2000-10K-LC0"]),
        system(2, inverters=["SUN2000-10KTL-MAP0"]),
        system(3, inverters=["SUN2000-12K-MB0", "SUN2000-12K-MB0"]),
        system(4, inverters=["Mystery box"]),
    ]
    u = an.maintenance(rows, TODAY)
    assert u["inverterPower"] == [
        {"label": "10 kW", "count": 2, "models": ["SUN2000-10K-LC0", "SUN2000-10KTL-MAP0"]},
        {"label": "12 kW", "count": 2, "models": ["SUN2000-12K-MB0"]},
        {"label": "Other", "count": 1, "models": ["Mystery box"]},
    ]
    assert len(u["inverters"]) == 4, "the table lists every model; nothing folds into Other"


@pytest.mark.parametrize(
    ("model", "rating"),
    [("SUN2000-5KTL-L1", "5 kW"), ("SUN2000-36KTL-M3", "36 kW"), ("SUN2000-2.5K", "2.5 kW"), ("Huawei", "Other")],
)
def test_inverter_rating(model: str, rating: str) -> None:
    assert an.inverter_power(model) == rating


def test_sizes_come_in_bands_and_the_typical_size_is_the_median() -> None:
    sizes = [8.68, 9.9, 10.0, 12.0, 14.08, 15.0, 19.99, 20.0, 76.8]
    u = an.maintenance([system(i, kwp=k) for i, k in enumerate(sizes, 1)], TODAY)
    # Under 10, 10 to 15, 15 to 20, 20 to 40, 40 and over: smallest first.
    bands = [label for _, label in an.SIZE_BANDS]
    assert [(g["label"], g["count"]) for g in u["bySize"]] == list(zip(bands, [2, 3, 2, 1, 1], strict=True))
    assert u["medianKwp"] == 14.08
    assert u["avgKwp"] > u["medianKwp"], "one big system pulls the average up"


def test_an_even_count_takes_the_middle_two() -> None:
    u = an.maintenance([system(1, kwp=10), system(2, kwp=20)], TODAY)
    assert u["medianKwp"] == 15.0


def test_ppas_by_the_year_they_end() -> None:
    rows = [
        system(1, ppa_years=5, turned_on_on=date(2026, 5, 1)),
        system(2, ppa_years=7, turned_on_on=date(2026, 5, 1)),
        system(3, ppa_years=5, turned_on_on=date(2025, 12, 1)),
        system(4, ppa_kind="value_buy", ppa_years=None),
        system(5, ppa_years=4, turned_on_on=date(2028, 2, 29)),
    ]
    u = an.maintenance(rows, TODAY)
    assert [(g["label"], g["count"], g["ids"]) for g in u["ppaEnds"]] == [
        ("2030", 1, [3]),
        ("2031", 1, [1]),
        ("2032", 1, [5]),
        ("2033", 1, [2]),
    ], "a value buy has no end; a 29 February start ends on the 28th"


def test_nothing_yet() -> None:
    u = an.maintenance([], TODAY)
    assert u["medianKwp"] is None and u["bySize"] == [] and u["ppaEnds"] == [] and u["inverterPower"] == []
    assert u["overdueChecks"] == {"six": 0, "year": 0}
