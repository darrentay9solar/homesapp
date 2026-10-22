# ruff: noqa: E501  (FusionSolar's answers read better whole)
"""Solar monitoring: FusionSolar's figures into the app (migration 0051).

FusionSolar is replaced by a stand-in that answers as its Northbound API does
(the same paths, failCodes and field names), so these run without an account.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from _lib import fusionsolar as fs
from _lib import solar_sync as sync

NOW = datetime(2026, 10, 22, 4, 30, tzinfo=UTC)  # 12:30 in Singapore


@pytest.fixture
def plant_codes(fx):
    made: list[str] = []
    yield made
    if made:
        fx.conn.execute("delete from solar_plants where station_code = any(%s)", (made,))
    fx.conn.execute("delete from solar_sync where key like 'ran:%' or key = 'token'")


def _code() -> str:
    return f"NE=TEST{uuid.uuid4().hex[:8]}"


def _system(fx, address: str, postal: str) -> int:
    return fx.conn.execute(
        "insert into maintenance_systems (address, postal_code) values (%s, %s) returning system_id", (address, postal)
    ).fetchone()["system_id"]


def test_plants_come_in_and_link_to_the_system_at_their_address(fx, plant_codes) -> None:
    a, b = _code(), _code()
    plant_codes += [a, b]
    sid = _system(fx, f"349 Onan Road {a[-4:]}, Singapore 424715", "424715")
    n = sync.save_plants(
        [
            {
                "plantCode": a,
                "plantName": f"349 Onan Rd {a[-4:]}",
                "plantAddress": "SingaporeSingapore349 Onan",
                "capacity": 0.015,
                "gridConnectionDate": "2026-10-20T00:00:00+08:00",
                "latitude": "1.31",
                "longitude": "103.9",
            },
            {"plantCode": b, "plantName": "Nowhere Lane 999", "capacity": "12.5"},
        ]
    )
    assert n == 2
    pa = fx.conn.execute("select * from solar_plants where station_code = %s", (a,)).fetchone()
    assert pa["system_id"] == sid and pa["linked_by"] == "address"
    assert pa["capacity_kwp"] == Decimal("15.000")  # MWp in, kWp kept
    assert pa["grid_connected_on"] == date(2026, 10, 20)
    pb = fx.conn.execute("select * from solar_plants where station_code = %s", (b,)).fetchone()
    assert pb["system_id"] is None and pb["capacity_kwp"] == Decimal("12.5")
    fx.conn.execute("delete from solar_plants where station_code = %s", (a,))
    fx.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def test_live_figures_and_health(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Live test"}])
    sync.save_live(
        [
            {
                "stationCode": a,
                "dataItemMap": {
                    "day_power": "14.55",
                    "month_power": 53.95,
                    "total_power": "N/A",
                    "day_income": 0,
                    "real_health_state": 2,
                },
            }
        ],
        NOW,
    )
    p = fx.conn.execute("select * from solar_plants where station_code = %s", (a,)).fetchone()
    assert p["today_kwh"] == Decimal("14.55") and p["month_kwh"] == Decimal("53.95")
    assert p["total_kwh"] is None and p["health"] == "faulty" and p["live_at"] == NOW


def test_inverters_add_up_to_the_plants_power_now(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Inverter test"}])
    base = int(uuid.uuid4().int % 10**12)
    sync.save_devices(
        [
            {"id": base, "stationCode": a, "devName": "INV-1", "esnCode": "ES1", "devTypeId": 1},
            {"id": base + 1, "stationCode": a, "devName": "INV-2", "devTypeId": 1},
        ]
    )
    sync.save_device_live(
        [
            {"devId": base, "dataItemMap": {"active_power": 2.5, "run_state": 1}},
            {"devId": base + 1, "dataItemMap": {"active_power": "1.792", "run_state": 1}},
        ],
        NOW,
    )
    assert fx.conn.execute("select current_kw from solar_plants where station_code = %s", (a,)).fetchone()[
        "current_kw"
    ] == Decimal("4.292")


def test_history_and_a_finished_month_into_the_invoices(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sid = _system(fx, f"Invoice Lane {a[-5:]}", "123456")
    sync.save_plants([{"plantCode": a, "plantName": f"Invoice Lane {a[-5:]}"}])
    sept = int(datetime(2026, 9, 1, tzinfo=sync.SG).timestamp() * 1000)
    hour = int(datetime(2026, 10, 22, 11, tzinfo=sync.SG).timestamp() * 1000)
    assert (
        sync.save_history(
            "month",
            [{"stationCode": a, "collectTime": sept, "dataItemMap": {"inverter_power": "412.7", "power_profit": "0"}}],
        )
        == 1
    )
    assert (
        sync.save_history("hour", [{"stationCode": a, "collectTime": hour, "dataItemMap": {"inverter_power": 2.1}}])
        == 1
    )
    # The same figure again changes nothing.
    assert (
        sync.save_history(
            "month",
            [{"stationCode": a, "collectTime": sept, "dataItemMap": {"inverter_power": "412.7", "power_profit": "0"}}],
        )
        == 0
    )
    assert sync.month_into_invoices(date(2026, 9, 1)) >= 1
    out = fx.conn.execute(
        "select kwh from system_output where system_id = %s and month = '2026-09-01'", (sid,)
    ).fetchone()
    assert out["kwh"] == Decimal("412.700")
    fx.conn.execute("delete from solar_plants where station_code = %s", (a,))
    fx.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def test_alarms_are_kept_and_cleared_when_fusionsolar_no_longer_lists_them(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Alarm test"}])
    raised = int((NOW - timedelta(hours=2)).timestamp() * 1000)
    alarm = {
        "stationCode": a,
        "devName": "INV-1",
        "alarmName": "Grid Overvoltage",
        "lev": 2,
        "raiseTime": raised,
        "alarmCause": "Grid voltage high",
        "repairSuggestion": "Check the grid",
    }
    sync.save_alarms([alarm], NOW)
    row = fx.conn.execute("select level, cleared_at from solar_alarms where station_code = %s", (a,)).fetchone()
    assert row["level"] == "major" and row["cleared_at"] is None
    sync.save_alarms([], NOW + timedelta(minutes=15))
    assert (
        fx.conn.execute("select cleared_at from solar_alarms where station_code = %s", (a,)).fetchone()["cleared_at"]
        is not None
    )


# ------------------------------------------------------------------ talking to FusionSolar


class FakeFusionSolar:
    """Answers as the Northbound API does: a token on login, failCodes otherwise."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.logins = 0
        self.expire_once = False
        self.too_often: set[str] = set()
        self.kinds: list[int] = []

    def post(self, path: str, body: dict[str, Any], token: str | None) -> tuple[dict[str, Any], dict[str, str]]:
        self.calls.append(path)
        if path == "/thirdData/login":
            self.logins += 1
            return {"success": True, "failCode": 0}, {"xsrf-token": f"tok{self.logins}"}
        if path in self.too_often:
            return {"success": False, "failCode": 407}, {}
        if self.expire_once:
            self.expire_once = False
            return {"success": False, "failCode": 305}, {}
        if path == "/thirdData/getDevList":
            return {
                "success": True,
                "data": [
                    {"id": 7001, "stationCode": "NE=FAKE1", "devName": "INV-1", "devTypeId": 1},
                    {"id": 7002, "stationCode": "NE=FAKE1", "devName": "Home inverter", "devTypeId": 38},
                    {"id": 7003, "stationCode": "NE=FAKE1", "devName": "Dongle", "devTypeId": 62},
                ],
            }, {}
        if path == "/thirdData/getDevRealKpi":
            self.kinds.append(body["devTypeId"])
        if path == "/thirdData/stations":
            return {
                "success": True,
                "data": {"list": [{"plantCode": "NE=FAKE1", "plantName": "Fake Plant"}], "pageCount": 1},
            }, {}
        return {"success": True, "data": []}, {}


@pytest.fixture
def fake(monkeypatch, fx):
    f = FakeFusionSolar()
    monkeypatch.setattr(fs, "_post", f.post)
    monkeypatch.setattr(fs, "configured", lambda: True)
    monkeypatch.setattr(
        fs,
        "env",
        lambda k: {
            "FUSIONSOLAR_URL": "https://fake.example",
            "FUSIONSOLAR_USER": "api",
            "FUSIONSOLAR_PASSWORD": "x",
        }.get(k, ""),
    )
    fx.conn.execute("delete from solar_sync where key = 'token' or key like 'ran:%'")
    yield f
    fx.conn.execute("delete from solar_sync where key = 'token' or key like 'ran:%'")
    fx.conn.execute("delete from solar_plants where station_code = 'NE=FAKE1'")


def test_logs_in_once_and_reuses_the_token(fake) -> None:
    fs.call("/thirdData/getStationRealKpi", {"stationCodes": "x"})
    fs.call("/thirdData/getStationRealKpi", {"stationCodes": "x"})
    assert fake.logins == 1


def test_logs_in_again_when_the_session_ends(fake) -> None:
    fs.call("/thirdData/getStationRealKpi", {"stationCodes": "x"})
    fake.expire_once = True
    fs.call("/thirdData/getStationRealKpi", {"stationCodes": "x"})
    assert fake.logins == 2


def test_too_often_is_put_off_not_failed(fake) -> None:
    fake.too_often.add("/thirdData/getStationRealKpi")
    with pytest.raises(fs.RateLimitedError):
        fs.call("/thirdData/getStationRealKpi", {"stationCodes": "x"})
    out = sync.run(NOW)
    assert out["live"] == "later (FusionSolar's limit)"
    assert out["plants"] == 1  # the plant list still came in


def test_each_kind_keeps_its_own_pace(fake) -> None:
    sync.run(NOW)
    first = len(fake.calls)
    second = sync.run(NOW + timedelta(minutes=1))  # nothing is due a minute later
    assert len(fake.calls) == first and second == {}
    third = sync.run(NOW + timedelta(minutes=6))  # live figures and alarms again, not the plant list
    assert "live" in third and "alarms" in third and "plants" not in third


def test_not_connected_does_nothing(monkeypatch) -> None:
    monkeypatch.setattr(fs, "configured", lambda: False)
    assert sync.run(NOW) == {"skipped": "FusionSolar isn't connected"}


def test_both_kinds_of_inverter_are_asked_for_their_power_not_the_dongles(fake) -> None:
    sync.run(NOW)
    assert sorted(fake.kinds) == [1, 38]


def test_a_plant_with_no_size_in_fusionsolar_has_none_not_zero(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "No size", "capacity": 0.0}])
    assert (
        fx.conn.execute("select capacity_kwp from solar_plants where station_code = %s", (a,)).fetchone()[
            "capacity_kwp"
        ]
        is None
    )
