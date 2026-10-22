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
