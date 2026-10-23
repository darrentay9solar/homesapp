# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · who hears about a plant's alarm (migration 0055), person by person, written from the brief:

output below expected   the app's own alarm: everyone on the project (the manager who runs the system, its
                        homeowner, the assigned crew and the contractor group), by email too; superadmins
                        only when nobody runs it; never another manager, another homeowner or outside crew
FusionSolar's           the manager who runs the system for critical, major and minor; its homeowner for
                        critical and major only; superadmins when nobody runs it
links                   each opens what that person can open: Solar for the office, My solar for the
                        homeowner, the project for crew
once                    an alarm is alerted once
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest

from _lib import solar_sync as sync
from uat import spec
from uat.conftest import SENT

pytestmark = pytest.mark.uat

# On the world's handed-over project: its manager, its homeowner ("ho" there), the crew assigned and the
# contractor group's members still active.
ON_PROJECT = {"pm", "ho", "assigned_epc", "crew_admin", "crew_epc"}


@pytest.fixture
def plant(world):
    """A plant on the world's handed-over project's system, and one not linked to any system."""
    c = world.conn
    sid = c.execute(
        "select system_id from maintenance_systems where project_id = %s", (world.pid["closed"],)
    ).fetchone()["system_id"]
    tag = uuid.uuid4().hex[:8]
    codes = {"linked": f"NE=ALERT{tag}L", "loose": f"NE=ALERT{tag}X"}
    names = {k: f"UAT alert plant {k} {tag}" for k in codes}
    for k, code in codes.items():
        c.execute(
            "insert into solar_plants (station_code, name, capacity_kwp, system_id) values (%s, %s, 10, %s)",
            (code, names[k], sid if k == "linked" else None),
        )
    yield {"codes": codes, "names": names, "pid": world.pid["closed"]}
    c.execute("delete from solar_plants where station_code = any(%s)", (list(codes.values()),))


def _raise(world, code: str, source: str, level: str) -> None:
    world.conn.execute(
        "insert into solar_alarms (station_code, device, name, level, cause, suggestion, raised_at, source) "
        "values (%s, '', %s, %s, 'UAT', 'UAT', %s, %s)",
        (code, sync.LOW_NAME if source == "app" else "String reverse connection", level, datetime.now(sync.SG), source),
    )


def _heard(world, actor: str, name: str, pid: int) -> list[dict]:
    return world.conn.execute(
        "select title, body, link from notifications where kind = 'solar_alarm' and recipient_uid = %s "
        "and (title like %s or body like %s)",
        (world.uid(actor, pid), f"%{name}%", f"%{name}%"),
    ).fetchall()


@pytest.mark.parametrize("level", ["critical", "major", "minor"])
def test_everyone_on_the_project_hears_the_output_is_low(world, plant, level) -> None:
    pid, name = plant["pid"], plant["names"]["linked"]
    _raise(world, plant["codes"]["linked"], "app", level)
    SENT.clear()
    sync.alert_alarms()
    for actor in spec.ACTORS:
        got = _heard(world, actor, name, pid)
        assert len(got) == (1 if actor in ON_PROJECT else 0), actor
        if got:
            want = {"ho": "/my-solar?tab=alarms", "pm": f"/solar/{plant['codes']['linked']}?tab=alarms"}.get(
                actor, f"/projects/{pid}"
            )
            assert got[0]["link"] == want, actor
    emailed = {m["to"] for m in SENT if m["channel"] == "email" and name in (m["subject"] + m["text"])}
    assert emailed == {world.people[world.key(a, pid)]["email"] for a in ON_PROJECT}
    # Once.
    sync.alert_alarms()
    assert all(len(_heard(world, a, name, pid)) == (a in ON_PROJECT) for a in spec.ACTORS)


@pytest.mark.parametrize("level", ["critical", "major", "minor", "warning"])
def test_fusionsolars_alarms_go_to_the_manager_and_the_serious_ones_to_the_homeowner(world, plant, level) -> None:
    pid, name = plant["pid"], plant["names"]["linked"]
    _raise(world, plant["codes"]["linked"], "fusionsolar", level)
    sync.alert_alarms()
    want = {"pm"} if level in sync.ALERT_STAFF else set()
    if level in sync.ALERT_HOMEOWNER:
        want.add("ho")
    for actor in spec.ACTORS:
        assert len(_heard(world, actor, name, pid)) == (1 if actor in want else 0), actor


@pytest.mark.parametrize("source", ["app", "fusionsolar"])
def test_a_plant_nobody_runs_goes_to_the_superadmins(world, plant, source) -> None:
    name = plant["names"]["loose"]
    _raise(world, plant["codes"]["loose"], source, "major")
    sync.alert_alarms()
    for actor in spec.ACTORS:
        assert len(_heard(world, actor, name, plant["pid"])) == (1 if actor == "sa" else 0), actor


def test_a_cleared_alarm_isnt_alerted(world, plant) -> None:
    name = plant["names"]["linked"]
    _raise(world, plant["codes"]["linked"], "app", "major")
    world.conn.execute(
        "update solar_alarms set cleared_at = now() where station_code = %s", (plant["codes"]["linked"],)
    )
    sync.alert_alarms()
    assert all(_heard(world, a, name, plant["pid"]) == [] for a in spec.ACTORS)
