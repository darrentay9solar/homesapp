# ruff: noqa: E501  (case tables read better whole)
"""Solar monitoring API (/solar, /me/solar): who sees which plant, and what each shows."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest

from _lib.solar_sync import SG
from conftest import bearer


@pytest.fixture
def world(fx):
    """Two systems run by different managers, each with a plant, and a plant not linked yet."""
    pm, other_pm, admin, ho, crew = (
        fx.user("project_manager"),
        fx.user("project_manager"),
        fx.user("finance"),
        fx.user("homeowner"),
        fx.user("epc_team"),
    )
    tag = uuid.uuid4().hex[:6]
    mine = fx.conn.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id, rate_per_kwh) values (%s, %s, %s, 0.25) returning system_id",
        (f"1 Mine Road {tag}", pm["uid"], ho["uid"]),
    ).fetchone()["system_id"]
    theirs = fx.conn.execute(
        "insert into maintenance_systems (address, run_by) values (%s, %s) returning system_id",
        (f"2 Theirs Road {tag}", other_pm["uid"]),
    ).fetchone()["system_id"]
    codes = {k: f"NE=API{tag}{k}" for k in ("mine", "theirs", "loose")}
    now = datetime.now(SG)
    for k, sid in (("mine", mine), ("theirs", theirs), ("loose", None)):
        fx.conn.execute(
            "insert into solar_plants (station_code, name, capacity_kwp, system_id, health, current_kw, today_kwh, total_kwh, live_at) "
            "values (%s, %s, 10, %s, %s, 4.2, 14.5, 1000, %s)",
            (codes[k], f"{k} plant {tag}", sid, "faulty" if k == "theirs" else "normal", now),
        )
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for h in (9, 10, 11):
        fx.conn.execute(
            "insert into solar_readings (station_code, period, at, kwh) values (%s, 'hour', %s, %s)",
            (codes["mine"], day + timedelta(hours=h), h / 10),
        )
    fx.conn.execute(
        "insert into solar_alarms (station_code, name, level, raised_at) values (%s, 'Grid Overvoltage', 'major', now())",
        (codes["theirs"],),
    )
    yield {"pm": pm, "other_pm": other_pm, "admin": admin, "ho": ho, "crew": crew, "codes": codes, "mine": mine}
    fx.conn.execute("delete from solar_plants where station_code = any(%s)", (list(codes.values()),))
    fx.conn.execute("delete from maintenance_systems where system_id = any(%s)", ([mine, theirs],))


def _names(client, who) -> set[str]:
    r = client.get("/api/py/solar", headers=bearer(who["clerk_user_id"]))
    assert r.status_code == 200, r.text
    return {p["code"] for p in r.json()["plants"]}


def test_admin_sees_every_plant(client, world) -> None:
    assert set(world["codes"].values()) <= _names(client, world["admin"])


def test_a_manager_sees_theirs_and_unlinked_not_another_managers(client, world) -> None:
    seen = _names(client, world["pm"])
    assert world["codes"]["mine"] in seen and world["codes"]["loose"] in seen
    assert world["codes"]["theirs"] not in seen


def test_crew_and_homeowners_dont_get_the_overview(client, world) -> None:
    for who in ("crew", "ho"):
        assert client.get("/api/py/solar", headers=bearer(world[who]["clerk_user_id"])).status_code == 403


def test_the_overview_adds_up(client, world) -> None:
    d = client.get("/api/py/solar", headers=bearer(world["admin"]["clerk_user_id"])).json()
    mine = next(p for p in d["plants"] if p["code"] == world["codes"]["mine"])
    assert mine["todayRevenue"] == pytest.approx(3.62)  # 14.5 kWh at the contract's S$0.25
    assert mine["specificYield"] == pytest.approx(1.45)
    assert d["health"]["faulty"] >= 1 and d["alarms"]["major"] >= 1


def test_a_plant_and_its_day_by_the_hour(client, world) -> None:
    h = bearer(world["pm"]["clerk_user_id"])
    code = world["codes"]["mine"]
    p = client.get(f"/api/py/solar/plants/{code}", headers=h).json()
    assert p["benefits"]["coalTons"] == pytest.approx(0.4)  # 1,000 kWh at FusionSolar's 0.4 kg/kWh
    e = client.get(f"/api/py/solar/plants/{code}/energy", params={"period": "day"}, headers=h).json()
    assert len(e["points"]) == 24 and e["totalKwh"] == pytest.approx(3.0)
    assert e["points"][10]["kwh"] == pytest.approx(1.0) and e["points"][3]["kwh"] is None
    rep = client.get(f"/api/py/solar/plants/{code}/report", params={"by": "hour"}, headers=h).json()
    assert [r["kwh"] for r in rep["rows"]] == pytest.approx([0.9, 1.0, 1.1])
    # Another manager's plant isn't theirs to open.
    assert client.get(f"/api/py/solar/plants/{world['codes']['theirs']}", headers=h).status_code == 404


def test_a_homeowner_sees_only_their_own(client, world) -> None:
    h = bearer(world["ho"]["clerk_user_id"])
    p = client.get("/api/py/me/solar", headers=h).json()["plant"]
    assert p["code"] == world["codes"]["mine"] and "homeowner" not in p
    assert client.get("/api/py/me/solar/energy", params={"period": "month"}, headers=h).status_code == 200
    assert client.get(f"/api/py/solar/plants/{world['codes']['mine']}", headers=h).status_code == 403


def test_linking_a_plant(client, world, fx) -> None:
    h = bearer(world["pm"]["clerk_user_id"])
    loose = world["codes"]["loose"]
    # Already linked to another plant: refused, and says which.
    r = client.post(f"/api/py/solar/plants/{loose}/link", json={"systemId": world["mine"]}, headers=h)
    assert r.status_code == 409 and "already linked" in r.json()["error"]
    client.post(f"/api/py/solar/plants/{world['codes']['mine']}/link", json={"systemId": None}, headers=h)
    assert (
        client.post(f"/api/py/solar/plants/{loose}/link", json={"systemId": world["mine"]}, headers=h).status_code
        == 200
    )
    row = fx.conn.execute("select system_id, linked_by from solar_plants where station_code = %s", (loose,)).fetchone()
    assert row == {"system_id": world["mine"], "linked_by": "person"}
    # Admin reads, doesn't link.
    assert (
        client.post(
            f"/api/py/solar/plants/{loose}/link",
            json={"systemId": None},
            headers=bearer(world["admin"]["clerk_user_id"]),
        ).status_code
        == 403
    )


def test_every_device_and_an_inverters_readings(client, world, fx) -> None:
    code = world["codes"]["mine"]
    fx.conn.execute(
        "insert into solar_devices (dev_id, station_code, name, serial, type_id, software_version, readings, live_at) values "
        "(%s, %s, 'INV-1', 'SN1', 38, 'V100', %s, now()), (%s, %s, 'Dongle', 'SN2', 62, 'V200', null, null)",
        (
            910001,
            code,
            '{"active_power": 3.2, "a_u": 231.4, "a_i": 4.6, "pv1_u": 510, "pv1_i": 3.2, "pv2_u": 0, "pv2_i": 0, '
            '"mppt_1_cap": 900.5, "open_time": 1792549920000, "inverter_state": 512, "efficiency": 98.4}',
            910002,
            code,
        ),
    )
    try:
        p = client.get(f"/api/py/solar/plants/{code}", headers=bearer(world["pm"]["clerk_user_id"])).json()
        kinds = [d["kind"] for d in p["devices"]]
        assert kinds == ["inverter", "dongle"]  # inverters first
        r = p["devices"][0]["readings"]
        assert r["phases"] == [{"phase": "A", "voltage": 231.4, "current": 4.6}]
        assert r["strings"] == [{"n": 1, "voltage": 510.0, "current": 3.2}]  # a string reading 0 isn't listed
        assert r["mppts"] == [{"n": 1, "kwh": 900.5}] and r["inverterState"] == 512 and r["startedAt"]
        assert p["devices"][1]["readings"] is None and p["devices"][1]["softwareVersion"] == "V200"
        # A homeowner sees the readings, not the serial numbers.
        mine = client.get("/api/py/me/solar", headers=bearer(world["ho"]["clerk_user_id"])).json()["plant"]
        assert mine["devices"][0]["readings"]["efficiency"] == 98.4 and mine["devices"][0]["serial"] is None
    finally:
        fx.conn.execute("delete from solar_devices where dev_id in (910001, 910002)")


def test_the_report_has_specific_yield_and_benefits(client, world, fx) -> None:
    h = bearer(world["pm"]["clerk_user_id"])
    rows = client.get(f"/api/py/solar/plants/{world['codes']['mine']}/report", params={"by": "hour"}, headers=h).json()[
        "rows"
    ]
    first = rows[0]  # 0.9 kWh on a 10 kWp plant
    assert first["specificYield"] == 0.09 and first["co2Kg"] == 0.4 and first["coalKg"] == 0.4


def test_power_through_the_day(client, world, fx) -> None:
    code = world["codes"]["mine"]
    h = bearer(world["pm"]["clerk_user_id"])
    day = datetime.now(SG).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    for minutes, kw in ((600, 4.0), (605, 4.5), (720, 6.25)):
        fx.conn.execute(
            "insert into solar_plant_power (station_code, at, kw) values (%s, %s, %s)",
            (code, day + timedelta(minutes=minutes), kw),
        )
    p = client.get(f"/api/py/solar/plants/{code}/power", params={"date": day.date().isoformat()}, headers=h).json()
    assert p["by"] == "5min" and len(p["points"]) == 288
    assert (
        p["points"][120] == {"label": "10:00", "kw": 4.0}
        and p["points"][121]["kw"] == 4.5
        and p["points"][122]["kw"] is None
    )
    assert p["peakKw"] == 6.25 and p["peakAt"] == "12:00" and p["latestKw"] is None  # not today
    # Today, before any 5-minute points: drawn from the hourly kWh (9 to 11 in the fixture).
    t = client.get(f"/api/py/solar/plants/{code}/power", headers=h).json()
    assert t["by"] == "hour" and len(t["points"]) == 24 and t["points"][10]["kw"] == 1.0
    # All plants one can see, together; another manager's isn't counted.
    fx.conn.execute(
        "insert into solar_plant_power (station_code, at, kw) values (%s, %s, 100)",
        (world["codes"]["theirs"], day + timedelta(minutes=600)),
    )
    allp = client.get("/api/py/solar/power", params={"date": day.date().isoformat()}, headers=h).json()
    assert allp["points"][120]["kw"] == 4.0
    # The homeowner's own.
    mine = client.get(
        "/api/py/me/solar/power", params={"date": day.date().isoformat()}, headers=bearer(world["ho"]["clerk_user_id"])
    ).json()
    assert mine["peakKw"] == 6.25


def test_an_inverters_power_and_all_plants_yield(client, world, fx) -> None:
    code = world["codes"]["mine"]
    h = bearer(world["pm"]["clerk_user_id"])
    fx.conn.execute(
        "insert into solar_devices (dev_id, station_code, name, type_id) values (920001, %s, 'INV', 38)", (code,)
    )
    try:
        noon = datetime.now(SG).replace(hour=12, minute=0, second=0, microsecond=0)
        fx.conn.execute("insert into solar_device_power (dev_id, at, kw) values (920001, %s, 2.5)", (noon,))
        d = client.get(f"/api/py/solar/plants/{code}/devices/920001/power", headers=h).json()
        assert d["points"][144]["kw"] == 2.5
        # A device on another plant isn't reachable through this one.
        assert (
            client.get(f"/api/py/solar/plants/{world['codes']['loose']}/devices/920001/power", headers=h).status_code
            == 404
        )
        e = client.get("/api/py/solar/energy", params={"period": "day"}, headers=h).json()
        assert e["points"][10]["kwh"] == 1.0 and e["points"][10]["revenue"] is None
    finally:
        fx.conn.execute("delete from solar_devices where dev_id = 920001")
