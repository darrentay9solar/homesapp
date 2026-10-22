# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · solar monitoring (FusionSolar's figures in the app, migration 0051), person by person.

Written from the brief, independent of the code:

  superadmin, Admin (fin)     Solar: every plant, its charts, inverters, alarms and report
  project managers            the plants of the systems they run, and plants not linked yet; a
                              plant on another manager's system isn't theirs; they link plants
  a homeowner                 My Solar: their own system's plant only; not the Solar overview
  crew and outsiders          nothing about solar
  an account switched off     nothing at all
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest

from _lib.solar_sync import SG
from uat import spec

pytestmark = pytest.mark.uat

SEES_ALL = {"sa", "fin"}
MANAGERS = {"sa", "pm", "pm2"}


@pytest.fixture(scope="module")
def plants(world):
    """A system run by pm with ho2 as its homeowner and a plant on it; a plant on pm2's system; a plant not linked."""
    c = world.conn
    tag = uuid.uuid4().hex[:6]
    mine = c.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id, rate_per_kwh) values (%s, %s, %s, 0.25) returning system_id",
        (f"1 UAT Solar Road {tag}", world.uid("pm"), world.uid("ho2")),
    ).fetchone()["system_id"]
    theirs = c.execute(
        "insert into maintenance_systems (address, run_by) values (%s, %s) returning system_id",
        (f"2 UAT Solar Road {tag}", world.uid("pm2")),
    ).fetchone()["system_id"]
    codes = {k: f"NE=UAT{tag}{k}" for k in ("mine", "theirs", "loose")}
    now = datetime.now(SG)
    for k, sid in (("mine", mine), ("theirs", theirs), ("loose", None)):
        c.execute(
            "insert into solar_plants (station_code, name, capacity_kwp, system_id, health, current_kw, today_kwh, total_kwh, live_at) "
            "values (%s, %s, 10, %s, 'normal', 4, 12, 900, %s)",
            (codes[k], f"UAT {k} {tag}", sid, now),
        )
        c.execute(
            "insert into solar_readings (station_code, period, at, kwh) values (%s, 'day', %s, 12)",
            (codes[k], now.replace(hour=0, minute=0, second=0, microsecond=0)),
        )
    yield codes
    c.execute("delete from solar_plants where station_code = any(%s)", (list(codes.values()),))
    c.execute("delete from maintenance_systems where system_id = any(%s)", ([mine, theirs],))


def overview_code(actor: str) -> int:
    if actor == "inactive":
        return 403
    return 200 if actor in SEES_ALL | MANAGERS else 403


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_sees_the_solar_overview(api, world, plants, actor) -> None:
    r = api.get("/api/py/solar", headers=world.h(actor))
    assert r.status_code == overview_code(actor), r.text
    if r.status_code != 200:
        return
    seen = {p["code"] for p in r.json()["plants"]}
    assert plants["mine"] in seen if actor in SEES_ALL | {"pm"} else plants["mine"] not in seen
    assert (plants["theirs"] in seen) == (actor in SEES_ALL or actor == "pm2")
    assert plants["loose"] in seen


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("which", ["mine", "theirs", "loose"])
@pytest.mark.parametrize("part", ["", "/energy?period=month", "/report?by=day"])
def test_who_opens_a_plant(api, world, plants, actor, which, part) -> None:
    r = api.get(f"/api/py/solar/plants/{plants[which]}{part}", headers=world.h(actor))
    if overview_code(actor) == 403:
        assert r.status_code == 403
        return
    yours = (
        actor in SEES_ALL
        or which == "loose"
        or (which == "mine" and actor == "pm")
        or (which == "theirs" and actor == "pm2")
    )
    assert r.status_code == (200 if yours else 404), r.text


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_has_a_plant_of_their_own(api, world, plants, actor) -> None:
    r = api.get("/api/py/me/solar", headers=world.h(actor))
    if actor == "inactive" or spec.ROLE[actor] != "homeowner":
        assert r.status_code == 403
    else:
        plant = r.json()["plant"]
        assert (plant is not None and plant["code"] == plants["mine"]) == (actor == "ho2")


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_links_a_plant(api, world, plants, actor) -> None:
    r = api.post(f"/api/py/solar/plants/{plants['loose']}/link", json={"systemId": None}, headers=world.h(actor))
    assert r.status_code == (200 if actor in MANAGERS else 403), r.text


def test_a_plant_on_another_managers_system_cant_be_linked_to_by_pm(api, world, plants) -> None:
    theirs = world.conn.execute(
        "select system_id from solar_plants where station_code = %s", (plants["theirs"],)
    ).fetchone()["system_id"]
    world.conn.execute("update solar_plants set system_id = null where station_code = %s", (plants["theirs"],))
    try:
        r = api.post(f"/api/py/solar/plants/{plants['loose']}/link", json={"systemId": theirs}, headers=world.h("pm"))
        assert r.status_code == 403
    finally:
        world.conn.execute("update solar_plants set system_id = %s where station_code = %s", (theirs, plants["theirs"]))


def test_stale_figures_are_not_shown_as_live(api, world, plants) -> None:
    world.conn.execute(
        "update solar_plants set live_at = now() - interval '2 hours' where station_code = %s", (plants["loose"],)
    )
    try:
        p = next(
            p for p in api.get("/api/py/solar", headers=world.h("sa")).json()["plants"] if p["code"] == plants["loose"]
        )
        assert p["live"] is False and p["currentKw"] is None
    finally:
        world.conn.execute("update solar_plants set live_at = now() where station_code = %s", (plants["loose"],))
