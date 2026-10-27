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
        self.timeouts: list[float] = []
        self.five_left: int | None = None  # 5-minute power calls answered before "too often"
        self.five_asked: list[str] = []

    def post(self, path: str, body: dict[str, Any], token: str | None, timeout: float = 30) -> tuple[dict[str, Any], dict[str, str]]:
        self.calls.append(path)
        self.timeouts.append(timeout)
        if path == "/thirdData/login":
            self.logins += 1
            return {"success": True, "failCode": 0}, {"xsrf-token": f"tok{self.logins}"}
        if path in self.too_often:
            return {"success": False, "failCode": 407}, {}
        if path == "/thirdData/getDevFiveMinutes" and self.five_left is not None:
            if self.five_left == 0:
                return {"success": False, "failCode": 407}, {}
            self.five_left -= 1
            self.five_asked.append(body["devIds"])
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


def test_an_inverters_full_readings_are_kept(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Readings test"}])
    base = int(uuid.uuid4().int % 10**12)
    sync.save_devices(
        [
            {
                "id": base,
                "stationCode": a,
                "devName": "INV-1",
                "devTypeId": 38,
                "softwareVersion": "V100",
                "optimizerNumber": 0,
            },
            {"id": base + 1, "stationCode": a, "devName": "Dongle", "devTypeId": 62, "softwareVersion": "V200"},
        ]
    )
    sync.save_device_live(
        [
            {
                "devId": base,
                "dataItemMap": {
                    "active_power": 0,
                    "run_state": 1,
                    "a_u": "231.4",
                    "pv1_u": 412,
                    "pv1_i": None,
                    "temperature": "N/A",
                },
            }
        ],
        NOW,
    )
    d = fx.conn.execute("select * from solar_devices where dev_id = %s", (base,)).fetchone()
    # Reachable but making nothing (at night) is standby, not "producing"; what it doesn't report is left out.
    assert d["state"] == "standby" and d["software_version"] == "V100"
    assert d["readings"] == {"active_power": 0.0, "run_state": 1.0, "a_u": 231.4, "pv1_u": 412.0}
    sync.save_device_live([{"devId": base, "dataItemMap": {"run_state": 0}}], NOW)
    assert (
        fx.conn.execute("select state from solar_devices where dev_id = %s", (base,)).fetchone()["state"] == "offline"
    )


def test_a_plants_size_and_specific_yield_come_from_its_daily_figures(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Size test", "capacity": 0}])
    day = int(datetime(2026, 10, 21, tzinfo=sync.SG).timestamp() * 1000)
    sync.save_history(
        "day",
        [
            {
                "stationCode": a,
                "collectTime": day,
                "dataItemMap": {"inverter_power": 38.5, "perpower_ratio": 3.85, "installed_capacity": 10},
            }
        ],
    )
    assert fx.conn.execute("select capacity_kwp from solar_plants where station_code = %s", (a,)).fetchone()[
        "capacity_kwp"
    ] == Decimal("10")
    assert fx.conn.execute(
        "select specific_yield from solar_readings where station_code = %s and period = 'day'", (a,)
    ).fetchone()["specific_yield"] == Decimal("3.850")
    # The plant list again, still with no size: the size from the daily figures stays.
    sync.save_plants([{"plantCode": a, "plantName": "Size test", "capacity": 0}])
    assert fx.conn.execute("select capacity_kwp from solar_plants where station_code = %s", (a,)).fetchone()[
        "capacity_kwp"
    ] == Decimal("10")


def test_fed_into_the_grid_and_used_today(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Meter test"}])
    sync.save_live(
        [{"stationCode": a, "dataItemMap": {"day_power": 20, "day_on_grid_energy": 12.5, "day_use_energy": 7.5}}], NOW
    )
    p = fx.conn.execute(
        "select today_feed_in_kwh, today_use_kwh from solar_plants where station_code = %s", (a,)
    ).fetchone()
    assert p == {"today_feed_in_kwh": Decimal("12.5"), "today_use_kwh": Decimal("7.5")}


def test_power_every_5_minutes_adds_up_to_the_plants(fx, plant_codes) -> None:
    a = _code()
    plant_codes.append(a)
    sync.save_plants([{"plantCode": a, "plantName": "Power test"}])
    base = int(uuid.uuid4().int % 10**12)
    sync.save_devices(
        [{"id": base, "stationCode": a, "devTypeId": 1}, {"id": base + 1, "stationCode": a, "devTypeId": 38}]
    )
    noon = datetime(2026, 10, 21, 12, tzinfo=sync.SG)
    ms = lambda d: int(d.timestamp() * 1000)  # noqa: E731
    rows = [
        {"devId": base, "collectTime": ms(noon), "dataItemMap": {"active_power": 3.5}},
        {"devId": base + 1, "collectTime": ms(noon), "dataItemMap": {"active_power": "2.25"}},
        {"devId": base, "collectTime": ms(noon + timedelta(minutes=5)), "dataItemMap": {"active_power": 3.0}},
        {"devId": 999999999999, "collectTime": ms(noon), "dataItemMap": {"active_power": 9}},  # not a known device
    ]
    assert sync.save_device_power(rows) == 4
    sync.plant_power(noon.date())
    got = fx.conn.execute("select at, kw from solar_plant_power where station_code = %s order by at", (a,)).fetchall()
    assert [g["kw"] for g in got] == [Decimal("5.750"), Decimal("3.000")]
    # Saving the same again changes nothing.
    sync.save_device_power(rows)
    assert sync.plant_power(noon.date()) == 0


# ------------------------------------------------------------------ live when someone looks


def _last_live(fx, at: datetime) -> None:
    """The live figures were last fetched ``at``, for a plant (the fake's; it goes when the test ends)."""
    fx.conn.execute("insert into solar_plants (station_code, name) values ('NE=FAKE1', 'Fake Plant') on conflict do nothing")
    fx.conn.execute(
        "insert into solar_sync (key, value, at) values ('ran:live', 'null', %s) on conflict (key) do update set at = excluded.at",
        (at,),
    )


def test_opening_a_page_fetches_stale_figures_once(fx, fake) -> None:
    _last_live(fx, NOW - timedelta(hours=4))  # the scheduler ran hours ago
    assert sync.refresh_on_view(NOW) is True
    asked = [t for c, t in zip(fake.calls, fake.timeouts, strict=True) if c == "/thirdData/getStationRealKpi"]
    assert asked == [sync.VIEW_TIMEOUT], "asked once, and quickly, so the page isn't held up"
    before = len(fake.calls)
    assert sync.refresh_on_view(NOW + timedelta(minutes=1)) is False and len(fake.calls) == before, "the next viewer doesn't ask again"
    assert sync.refresh_on_view(NOW + timedelta(minutes=11)) is True


def test_fresh_figures_arent_fetched_again(fx, fake) -> None:
    _last_live(fx, NOW - timedelta(minutes=3))
    assert sync.refresh_on_view(NOW) is False and fake.calls == []


def test_fusionsolar_refusing_never_breaks_the_page(fx, fake) -> None:
    _last_live(fx, NOW - timedelta(hours=4))
    fake.too_often.add("/thirdData/getStationRealKpi")
    assert sync.refresh_on_view(NOW) is False


def test_not_connected_never_asks(monkeypatch) -> None:
    monkeypatch.setattr(fs, "configured", lambda: False)
    assert sync.refresh_on_view(NOW) is False


def test_the_fusionsolar_page_asks_when_its_figures_are_stale(client, fx, fake) -> None:
    from conftest import bearer

    _last_live(fx, datetime.now(UTC) - timedelta(hours=4))
    pm = fx.user("project_manager")
    assert client.get("/api/py/solar", headers=bearer(pm["clerk_user_id"])).status_code == 200
    assert "/thirdData/getStationRealKpi" in fake.calls


# ------------------------------------------------------------------ 5-minute power, a few tens a run


@pytest.fixture
def inverters(fx, fake):
    """25 inverters on the fake's plant: three calls' worth (FusionSolar takes 10 a call)."""
    fx.conn.execute("insert into solar_plants (station_code, name) values ('NE=FAKE1', 'Fake Plant') on conflict do nothing")
    ids = list(range(880001, 880026))
    for i in ids:
        fx.conn.execute("insert into solar_devices (dev_id, station_code, type_id) values (%s, 'NE=FAKE1', 1) on conflict do nothing", (i,))
    fx.conn.execute("delete from solar_sync where key = %s", (sync.POWER_TURN,))
    yield ids
    fx.conn.execute("delete from solar_sync where key = %s", (sync.POWER_TURN,))
    fx.conn.execute("delete from solar_devices where dev_id = any(%s)", (ids,))


def test_power_carries_on_where_fusionsolar_stopped_it(fake, inverters) -> None:
    fake.five_left = 2  # FusionSolar answers two calls, then says too often
    sync.power_in_turn(NOW)
    assert len(fake.five_asked) == 2, "what it answered is kept"
    fake.five_left = 2
    sync.power_in_turn(NOW + timedelta(minutes=15))
    third = fake.five_asked[2].split(",")
    assert third[0] == "880021" and len(third) == 5, "the next run starts with the ones still waiting"
    assert fake.five_asked[3].startswith("880001"), "then round again"


def test_power_refused_from_the_start_is_put_off(fake, inverters) -> None:
    fake.five_left = 0
    with pytest.raises(fs.RateLimitedError):
        sync.power_in_turn(NOW)
    fake.five_left = 1
    sync.power_in_turn(NOW + timedelta(minutes=15))
    assert fake.five_asked[0].startswith("880001"), "nothing was skipped"


def test_a_new_day_starts_from_the_first(fake, inverters) -> None:
    fake.five_left = 1
    sync.power_in_turn(NOW)
    fake.five_left = 1
    sync.power_in_turn(NOW + timedelta(days=1))
    assert fake.five_asked == [fake.five_asked[0]] * 2


def test_a_run_out_of_time_leaves_the_rest_for_the_next(fake) -> None:
    out = sync.run(NOW, budget=0)  # a scheduler that won't wait: nothing fits
    assert "plants" in out["next run"] and "live" in out["next run"] and fake.calls == []
    later = sync.run(NOW + timedelta(minutes=15))
    assert "plants" in later and "live" in later, "still due, so done next time"
