# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · SP Power and FusionSolar's extras (migration 0059), person by person, written from the brief:

SP Power     everyone signed in sees SP's tariff: buying (with GST), selling (less network costs), the
             history and the 12 months' average; a homeowner also sees their own solar beside it
acknowledge  the plant's manager and superadmins note an alarm is in hand; another manager's plant
             isn't found; Admin only looks; crew, homeowners and anyone switched off can't
compare      every energy chart someone can open carries the same period a year before
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest

from _lib.solar_sync import SG
from uat import spec

pytestmark = pytest.mark.uat


@pytest.fixture(scope="module")
def plant(world):
    """A plant on pm's system (ho2 its homeowner), with an alarm, this month's yield, and a quarter of SP's tariff."""
    c = world.conn
    tag = uuid.uuid4().hex[:6]
    sid = c.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id, rate_per_kwh, kwp) values (%s, %s, %s, 0.22, 10) returning system_id",
        (f"5 UAT Tariff Road {tag}", world.uid("pm"), world.uid("ho2")),
    ).fetchone()["system_id"]
    code = f"NE=SPP{tag}"
    c.execute(
        "insert into solar_plants (station_code, name, system_id, capacity_kwp) values (%s, %s, %s, 10)",
        (code, f"UAT tariff {tag}", sid),
    )
    month = datetime.now(SG).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    c.execute("insert into solar_readings (station_code, period, at, kwh) values (%s, 'month', %s, 900)", (code, month))
    c.execute(
        "insert into solar_readings (station_code, period, at, kwh) values (%s, 'month', %s, 800)",
        (code, month.replace(year=month.year - 1)),
    )
    alarm = c.execute(
        "insert into solar_alarms (station_code, device, name, level, raised_at, notified_at) values (%s, 'INV-1', 'Grid loss', 'major', now(), now()) returning alarm_id",
        (code,),
    ).fetchone()["alarm_id"]
    yield {"code": code, "alarm": alarm, "sid": sid, "month": month}
    c.execute("delete from solar_plants where station_code = %s", (code,))
    c.execute("delete from maintenance_systems where system_id = %s", (sid,))


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_sees_sp_power(api, world, plant, actor) -> None:
    r = api.get("/api/py/tariffs", headers=world.h(actor))
    assert r.status_code == (403 if actor == "inactive" else 200), r.text
    if r.status_code == 200:
        got = r.json()
        assert set(got) >= {"current", "history", "average12", "mine"}
        if got["current"]:
            c = got["current"]
            assert c["buying"] >= c["withoutGst"], "with GST"
            if c["selling"] is not None:
                assert c["selling"] == round(
                    c["withoutGst"] - c["parts"]["network"], 2
                ), "the tariff less network costs"
        # Only a homeowner with a system has their own solar beside it.
        assert (got["mine"] is not None) is (actor == "ho2"), actor


def test_the_homeowner_sees_their_solar_beside_sps(api, world, plant) -> None:
    mine = api.get("/api/py/tariffs", headers=world.h("ho2")).json()["mine"]
    assert mine["rateCents"] == 22.0 and mine["monthKwh"] == 900


GRID = [(a, w) for a in spec.ACTORS for w in ("note", "none")]


@pytest.mark.parametrize(("actor", "note"), GRID, ids=[f"{a}-{w}" for a, w in GRID])
def test_who_acknowledges_an_alarm(api, world, plant, actor, note) -> None:
    world.conn.execute(
        "update solar_alarms set acknowledged_at = null, acknowledged_by = null, ack_note = null where alarm_id = %s",
        (plant["alarm"],),
    )
    r = api.post(
        f"/api/py/solar/plants/{plant['code']}/alarms/{plant['alarm']}/acknowledge",
        headers=world.h(actor),
        json={"note": "Crew going Friday"} if note == "note" else {},
    )
    if actor == "inactive" or spec.ROLE[actor] not in ("project_manager", "superadmin"):
        assert r.status_code == 403, r.text
    elif actor == "pm2":
        assert r.status_code == 404, "another manager's plant isn't found"
    else:
        assert r.status_code == 200, r.text
        a = world.conn.execute(
            "select acknowledged_by, ack_note from solar_alarms where alarm_id = %s", (plant["alarm"],)
        ).fetchone()
        assert a["acknowledged_by"] == world.uid(actor) and a["ack_note"] == (
            "Crew going Friday" if note == "note" else None
        )


def test_the_homeowner_sees_only_that_its_in_hand(api, world, plant) -> None:
    api.post(
        f"/api/py/solar/plants/{plant['code']}/alarms/{plant['alarm']}/acknowledge",
        headers=world.h("pm"),
        json={"note": "Inverter swap Tuesday"},
    )
    alarms = api.get("/api/py/me/solar", headers=world.h("ho2")).json()["plant"]["alarms"]
    ack = next(a for a in alarms if a["id"] == plant["alarm"])["acknowledged"]
    assert ack["at"] and ack["by"] is None and ack["note"] is None


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_every_energy_chart_has_the_year_before(api, world, plant, actor) -> None:
    day = plant["month"].date().isoformat()
    r = api.get(f"/api/py/solar/plants/{plant['code']}/energy?period=year&date={day}", headers=world.h(actor))
    if r.status_code == 200:
        prev = r.json()["previous"]
        i = plant["month"].month - 1
        assert prev["kwh"][i] == 800 and r.json()["points"][i]["kwh"] == 900
    m = api.get(f"/api/py/me/solar/energy?period=year&date={day}", headers=world.h(actor))
    if actor == "ho2":
        assert m.status_code == 200 and m.json()["previous"]["kwh"][plant["month"].month - 1] == 800


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("q", ["from=2024-01-01&to=2024-12-31", "on=2024-06-15", "from=2024-12-31&to=2024-01-01"])
def test_who_filters_sp_power_by_date(api, world, actor, q) -> None:
    r = api.get(f"/api/py/tariffs?{q}", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
    elif q.startswith("from=2024-12-31"):
        assert r.status_code == 400 and "From comes after To" in r.text
    else:
        assert r.status_code == 200, r.text
        got = r.json()
        assert ("range" in got) is q.startswith("from") and ("on" in got) is q.startswith("on")
        assert set(got["average8y"]) >= {
            "withGst",
            "withoutGst",
            "selling",
            "energy",
            "network",
            "mss",
            "marketAdmin",
            "months",
        }
