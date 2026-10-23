"""An inverter's history (every reading each 5 minutes), its yield by day, month and year, and the sizes
it gives a plant (migration 0056); the yearly report and the overview's benefits and places."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from _lib import solar_sync as sync
from conftest import bearer

SG = sync.SG
ms = lambda d: int(d.timestamp() * 1000)  # noqa: E731


@pytest.fixture
def plant(fx):
    tag = uuid.uuid4().hex[:6]
    pm, ho = fx.user("project_manager"), fx.user("homeowner")
    sid = fx.conn.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id) values (%s, %s, %s) returning system_id",
        (f"9 Inverter Lane {tag}", pm["uid"], ho["uid"]),
    ).fetchone()["system_id"]
    code = f"NE=INV{tag}"
    fx.conn.execute(
        "insert into solar_plants (station_code, name, system_id, latitude, longitude) "
        "values (%s, %s, %s, 1.33, 103.85)",
        (code, f"Inverter plant {tag}", sid),
    )
    dev = int(uuid.uuid4().int % 10**12)
    sync.save_devices([{"id": dev, "stationCode": code, "devName": "INV-1", "devTypeId": 38}])
    yield {"code": code, "dev": dev, "pm": pm, "ho": ho}
    fx.conn.execute("delete from solar_plants where station_code = %s", (code,))
    fx.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def test_every_reading_is_kept_each_5_minutes(fx, plant) -> None:
    noon = datetime(2026, 10, 20, 12, tzinfo=SG)
    sync.save_device_power(
        [
            {
                "devId": plant["dev"],
                "collectTime": ms(noon),
                "dataItemMap": {
                    "active_power": 3.2,
                    "temperature": 45.5,
                    "pv1_u": "510",
                    "day_cap": 9.1,
                    "open_time": 1,
                },
            }
        ]
    )
    row = fx.conn.execute("select kw, readings from solar_device_power where dev_id = %s", (plant["dev"],)).fetchone()
    # Running totals and on/off times aren't readings to chart.
    assert row["kw"] == Decimal("3.200") and row["readings"] == {"temperature": 45.5, "pv1_u": 510.0}


def test_an_inverters_yield_and_size_come_in(fx, plant) -> None:
    oct20 = datetime(2026, 10, 20, tzinfo=SG)
    n = sync.save_device_yield(
        "day",
        [
            {
                "devId": plant["dev"],
                "collectTime": ms(oct20),
                "dataItemMap": {"product_power": 38.2, "installed_capacity": 10.0},
            }
        ],
    )
    assert n == 1
    assert fx.conn.execute("select installed_kwp from solar_devices where dev_id = %s", (plant["dev"],)).fetchone()[
        "installed_kwp"
    ] == Decimal("10")
    # The plant had no size of its own: it takes its inverters'.
    assert fx.conn.execute(
        "select capacity_kwp from solar_plants where station_code = %s", (plant["code"],)
    ).fetchone()["capacity_kwp"] == Decimal("10")


def test_the_history_and_yield_screens(client, fx, plant) -> None:
    h = bearer(plant["pm"]["clerk_user_id"])
    noon = datetime(2026, 10, 20, 12, tzinfo=SG)
    for i, t in enumerate((40.0, 42.5)):
        fx.conn.execute(
            "insert into solar_device_power (dev_id, at, kw, readings) values (%s, %s, 3, %s)",
            (plant["dev"], noon + timedelta(minutes=5 * i), f'{{"temperature": {t}, "pv1_u": 500, "pv1_i": 4.1}}'),
        )
    base = f"/api/py/solar/plants/{plant['code']}/devices/{plant['dev']}"
    hist = client.get(f"{base}/history", params={"date": "2026-10-20"}, headers=h).json()
    assert hist["signal"] == "temperature" and set(hist["signals"]) == {"temperature", "pv1_u", "pv1_i"}
    assert hist["points"][144] == {"label": "12:00", "value": 40.0} and hist["points"][145]["value"] == 42.5
    v = client.get(f"{base}/history", params={"date": "2026-10-20", "signal": "pv1_u"}, headers=h).json()
    assert v["points"][144]["value"] == 500
    fx.conn.execute(
        "insert into solar_device_yield (dev_id, period, at, kwh) values (%s, 'day', %s, 38.2)",
        (plant["dev"], datetime(2026, 10, 20, tzinfo=SG)),
    )
    e = client.get(f"{base}/energy", params={"period": "month", "date": "2026-10-20"}, headers=h).json()
    assert e["by"] == "day" and e["points"][19]["kwh"] == 38.2 and e["totalKwh"] == 38.2
    assert client.get(f"{base}/energy", params={"period": "day"}, headers=h).status_code == 400
    # The homeowner's own inverter.
    mine = client.get(
        f"/api/py/me/solar/devices/{plant['dev']}/history",
        params={"date": "2026-10-20"},
        headers=bearer(plant["ho"]["clerk_user_id"]),
    )
    assert mine.status_code == 200 and mine.json()["points"][144]["value"] == 40.0


def test_the_report_by_year_and_the_overviews_extras(client, fx, plant) -> None:
    h = bearer(plant["pm"]["clerk_user_id"])
    fx.conn.execute(
        "insert into solar_readings (station_code, period, at, kwh) values (%s, 'year', %s, 5200)",
        (plant["code"], datetime(2025, 1, 1, tzinfo=SG)),
    )
    rep = client.get(f"/api/py/solar/plants/{plant['code']}/report", params={"by": "year"}, headers=h).json()
    assert [r["period"] for r in rep["rows"]] == ["2025"] and rep["rows"][0]["kwh"] == 5200
    o = client.get("/api/py/solar", headers=h).json()
    assert set(o["benefits"]) == {"coalTons", "co2Tons", "trees"}
    mine = next(p for p in o["plants"] if p["code"] == plant["code"])
    assert mine["latitude"] == 1.33 and mine["longitude"] == 103.85
