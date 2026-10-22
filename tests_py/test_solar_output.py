"""A plant making much less than similar plants: the app's own alarm, and who hears about it (0055)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest

from _lib import solar_sync as sync

# A June noon, far from any other test's figures.
NOON = datetime(2026, 6, 15, 12, 0, tzinfo=sync.SG)


@pytest.fixture
def plants(fx):
    """Eight 10 kWp plants with the last half hour of power: six normal, one low, one making nothing."""
    tag = uuid.uuid4().hex[:6]
    pm, ho = fx.user("project_manager"), fx.user("homeowner")
    sid = fx.conn.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id) values (%s, %s, %s) returning system_id",
        (f"1 Output Road {tag}", pm["uid"], ho["uid"]),
    ).fetchone()["system_id"]
    codes = {f"p{i}": f"NE=OUT{tag}{i}" for i in range(6)} | {"low": f"NE=OUT{tag}L", "none": f"NE=OUT{tag}N"}
    for k, code in codes.items():
        fx.conn.execute(
            "insert into solar_plants (station_code, name, capacity_kwp, system_id) values (%s, %s, 10, %s)",
            (code, f"Plant {k} {tag}", sid if k == "low" else None),
        )
    yield {"codes": codes, "pm": pm, "ho": ho, "sid": sid}
    fx.conn.execute("delete from solar_plants where station_code = any(%s)", (list(codes.values()),))
    fx.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def _power(fx, codes: dict[str, str], low: float, none: float = 0.0, at: datetime = NOON) -> None:
    for minutes in (25, 20, 15, 10, 5, 0):
        t = at - timedelta(minutes=minutes)
        for k, code in codes.items():
            kw = low if k == "low" else none if k == "none" else 5.0 + int(k[1]) * 0.1
            fx.conn.execute(
                "insert into solar_plant_power (station_code, at, kw) values (%s, %s, %s) "
                "on conflict (station_code, at) do update set kw = excluded.kw",
                (code, t, kw),
            )


def _open(fx, code: str):
    return fx.conn.execute(
        "select name, level, source, cause from solar_alarms where station_code = %s and cleared_at is null", (code,)
    ).fetchall()


def test_a_plant_far_below_its_peers_gets_an_alarm(fx, plants) -> None:
    _power(fx, plants["codes"], low=1.0)
    out = sync.check_output(NOON)
    assert out["opened"] == 2
    low = _open(fx, plants["codes"]["low"])
    assert [(a["name"], a["level"], a["source"]) for a in low] == [("Output below expected", "major", "app")]
    assert "about 5.20 kW expected (19% of what similar plants" in low[0]["cause"]  # the median of the others
    assert [(a["name"], a["level"]) for a in _open(fx, plants["codes"]["none"])] == [("No output", "critical")]
    assert _open(fx, plants["codes"]["p0"]) == []
    # Still low a quarter of an hour later: no second alarm.
    _power(fx, plants["codes"], low=1.0, at=NOON + timedelta(minutes=15))
    assert sync.check_output(NOON + timedelta(minutes=15))["opened"] == 0


def test_it_clears_when_the_plant_recovers(fx, plants) -> None:
    _power(fx, plants["codes"], low=1.0)
    sync.check_output(NOON)
    later = NOON + timedelta(minutes=45)
    _power(fx, plants["codes"], low=4.8, none=5.0, at=later)
    assert sync.check_output(later)["cleared"] == 2
    assert _open(fx, plants["codes"]["low"]) == []


def test_not_judged_under_heavy_cloud_or_at_night(fx, plants) -> None:
    for k, code in plants["codes"].items():
        for minutes in (25, 20, 15, 10, 5, 0):
            fx.conn.execute(
                "insert into solar_plant_power (station_code, at, kw) values (%s, %s, %s)",
                (code, NOON - timedelta(minutes=minutes), 0.0 if k == "none" else 0.5),  # 50 W per kWp: dark
            )
    assert sync.check_output(NOON)["opened"] == 0
    assert sync.check_output(NOON.replace(hour=20)) == {"skipped": "outside 9 am to 5 pm"}


def test_everyone_on_the_project_hears_about_it(fx, plants) -> None:
    _power(fx, plants["codes"], low=1.0)
    sync.check_output(NOON)
    sync.alert_alarms()
    got = fx.conn.execute(
        "select recipient_uid, title, body, link from notifications "
        "where kind = 'solar_alarm' and recipient_uid = any(%s)",
        ([plants["pm"]["uid"], plants["ho"]["uid"]],),
    ).fetchall()
    by = {g["recipient_uid"]: g for g in got}
    assert set(by) == {plants["pm"]["uid"], plants["ho"]["uid"]}
    assert (
        by[plants["pm"]["uid"]]["link"].startswith("/solar/")
        and by[plants["ho"]["uid"]]["link"] == "/my-solar?tab=alarms"
    )
    assert "Output below expected" in by[plants["ho"]["uid"]]["body"]
    # Alerted once.
    assert (
        sync.alert_alarms() == 0
        or not fx.conn.execute(
            "select 1 from solar_alarms where station_code = %s and notified_at is null", (plants["codes"]["low"],)
        ).fetchone()
    )


def test_fusionsolar_alarms_dont_clear_the_apps_own(fx, plants) -> None:
    _power(fx, plants["codes"], low=1.0)
    sync.check_output(NOON)
    sync.save_alarms([], NOON + timedelta(minutes=5))  # FusionSolar lists nothing
    assert len(_open(fx, plants["codes"]["low"])) == 1
