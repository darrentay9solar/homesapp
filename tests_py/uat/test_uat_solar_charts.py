# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · Solar's charts, person by person (migrations 0054 and 0056), written from the brief:

superadmin, Admin (fin)     power and yield for every plant together; each plant's power curve; each
                            inverter's reading history and yield; reports by year
project managers            the same for the plants they look after and plants not linked yet; not
                            another manager's
a homeowner                 their own plant's power, and their own inverters' history and yield; no one
                            else's; not the all-plants charts
crew, outsiders             no solar charts at all
an account switched off     nothing
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta

import pytest

from _lib.solar_sync import SG
from uat import spec

pytestmark = pytest.mark.uat

DAY = datetime(2026, 6, 17, tzinfo=SG)  # a day no other test draws on


@pytest.fixture(scope="module")
def plants(world):
    """Three plants, each with an inverter, a day of power and readings, and its yield:
    "mine" on pm's system (ho2 its homeowner), "theirs" on pm2's, "loose" not linked."""
    c = world.conn
    tag = uuid.uuid4().hex[:6]
    mine = c.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id, rate_per_kwh, kwp) values (%s, %s, %s, 0.25, 10) returning system_id",
        (f"1 UAT Chart Road {tag}", world.uid("pm"), world.uid("ho2")),
    ).fetchone()["system_id"]
    theirs = c.execute(
        "insert into maintenance_systems (address, run_by, kwp) values (%s, %s, 10) returning system_id",
        (f"2 UAT Chart Road {tag}", world.uid("pm2")),
    ).fetchone()["system_id"]
    codes = {k: f"NE=CHART{tag}{k}" for k in ("mine", "theirs", "loose")}
    devs: dict[str, int] = {}
    for i, (k, sid) in enumerate((("mine", mine), ("theirs", theirs), ("loose", None))):
        c.execute(
            "insert into solar_plants (station_code, name, capacity_kwp, system_id, latitude, longitude) values (%s, %s, 10, %s, 1.33, 103.85)",
            (codes[k], f"UAT chart {k} {tag}", sid),
        )
        devs[k] = int(uuid.uuid4().int % 10**12) + i
        c.execute(
            "insert into solar_devices (dev_id, station_code, name, type_id) values (%s, %s, 'INV-1', 38)",
            (devs[k], codes[k]),
        )
        noon = DAY + timedelta(hours=12)
        c.execute("insert into solar_plant_power (station_code, at, kw) values (%s, %s, 5)", (codes[k], noon))
        c.execute(
            "insert into solar_device_power (dev_id, at, kw, readings) values (%s, %s, 5, %s)",
            (devs[k], noon, json.dumps({"temperature": 44.5, "pv1_u": 510})),
        )
        c.execute("insert into solar_device_yield (dev_id, period, at, kwh) values (%s, 'day', %s, 30)", (devs[k], DAY))
        c.execute(
            "insert into solar_readings (station_code, period, at, kwh) values (%s, 'year', %s, 9000)",
            (codes[k], DAY.replace(month=1, day=1)),
        )
    yield {"codes": codes, "devs": devs}
    c.execute("delete from solar_plants where station_code = any(%s)", (list(codes.values()),))
    c.execute("delete from maintenance_systems where system_id = any(%s)", ([mine, theirs],))


def yours(actor: str, which: str) -> bool:
    return (
        actor in ("sa", "fin")
        or which == "loose"
        or (which == "mine" and actor == "pm")
        or (which == "theirs" and actor == "pm2")
    )


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("what", ["/solar/power", "/solar/energy?period=month"])
def test_who_sees_every_plants_charts(api, world, plants, actor, what) -> None:
    r = api.get(f"/api/py{what}{'&' if '?' in what else '?'}date={DAY.date().isoformat()}", headers=world.h(actor))
    assert r.status_code == spec.solar_staff(actor), r.text
    if r.status_code == 200 and what == "/solar/power":
        # Each plant one can see adds its 5 kW at noon; another manager's doesn't.
        seen = sum(yours(actor, w) for w in plants["codes"])
        assert r.json()["points"][144]["kw"] >= 5 * seen


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("which", ["mine", "theirs", "loose"])
@pytest.mark.parametrize("part", ["power", "history", "energy", "report"])
def test_who_opens_a_plants_charts(api, world, plants, actor, which, part) -> None:
    code, dev, day = plants["codes"][which], plants["devs"][which], DAY.date().isoformat()
    path = {
        "power": f"/solar/plants/{code}/power?date={day}",
        "history": f"/solar/plants/{code}/devices/{dev}/history?date={day}&signal=pv1_u",
        "energy": f"/solar/plants/{code}/devices/{dev}/energy?period=month&date={day}",
        "report": f"/solar/plants/{code}/report?by=year",
    }[part]
    r = api.get(f"/api/py{path}", headers=world.h(actor))
    if spec.solar_staff(actor) == 403:
        assert r.status_code == 403
        return
    assert r.status_code == (200 if yours(actor, which) else 404), r.text
    if r.status_code == 200:
        got = r.json()
        if part == "power":
            assert got["peakKw"] == 5 and got["by"] == "5min"
        elif part == "history":
            assert got["signal"] == "pv1_u" and got["points"][144]["value"] == 510
        elif part == "energy":
            assert got["points"][DAY.day - 1]["kwh"] == 30
        else:
            assert [x["kwh"] for x in got["rows"]] == [9000]


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("part", ["power", "history", "energy"])
def test_who_has_charts_of_their_own(api, world, plants, actor, part) -> None:
    dev, day = plants["devs"]["mine"], DAY.date().isoformat()
    path = {
        "power": f"/me/solar/power?date={day}",
        "history": f"/me/solar/devices/{dev}/history?date={day}",
        "energy": f"/me/solar/devices/{dev}/energy?period=month&date={day}",
    }[part]
    r = api.get(f"/api/py{path}", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
    else:
        # Only ho2 has a plant (on pm's system); anyone else has none of their own.
        assert r.status_code == (200 if actor == "ho2" else 404), r.text


def test_a_homeowner_cant_open_another_plants_inverter(api, world, plants) -> None:
    for which in ("theirs", "loose"):
        r = api.get(f"/api/py/me/solar/devices/{plants['devs'][which]}/history", headers=world.h("ho2"))
        assert r.status_code == 404


@pytest.mark.parametrize("actor", ["sa", "pm", "pm2", "fin"])
def test_the_overview_has_benefits_and_places(api, world, plants, actor) -> None:
    o = api.get("/api/py/solar", headers=world.h(actor)).json()
    assert set(o["benefits"]) == {"coalTons", "co2Tons", "trees"}
    mine = [p for p in o["plants"] if p["code"] in plants["codes"].values()]
    assert mine and all(p["latitude"] == 1.33 and p["longitude"] == 103.85 for p in mine)
