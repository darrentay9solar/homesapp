# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · records imported from 9 Solar Home's lists (api/_lib/to_fill.py, migration 0058), person by person:

see       an imported system's record project, with every required field still empty flagged: its manager
          and superadmins; Admin and any manager while nobody runs it, read-only; not another manager;
          crew and outsiders not at all; its homeowner sees the checklist but nothing flagged
fill      its manager and superadmins fill any field, in any order, though it's handed over
told      a superadmin hands the system to a manager: that manager is alerted to what's still to fill,
          once; nobody else hands it over or is told
photos    importing the installed photos: a superadmin's alone
"""

from __future__ import annotations

import json
from datetime import date

import pytest

from _lib import client_list
from uat import spec

pytestmark = pytest.mark.uat


@pytest.fixture(scope="module")
def record(world):
    """An imported system and its record project, for each kind of owner (and one with its homeowner)."""
    c = world.conn
    made: dict[str, tuple[int, int]] = {}
    for i, owner in enumerate(["pm", "none", "homeowner"]):
        ho = world.homeowner(f"ho@record@{i}") if owner == "homeowner" else None
        sid = c.execute(
            "insert into maintenance_systems (import_ref, address, postal_code, run_by, homeowner_id, homeowner_name, panels, "
            "turned_on_on, plan_years, project_code) values (%s, %s, '358791', %s, %s, 'Mr Tan', %s, %s, 5, %s) returning system_id",
            (
                f"uat-{world.tag}-rec#{i}", f"{i + 1} UAT Record Road {world.tag}", world.uid("pm") if owner != "none" else None,
                world.uid(ho) if ho else None, json.dumps([{"count": 20, "wp": 620}]), date(2024, 3, 1), f"9SHU{world.tag}{i}",
            ),
        ).fetchone()["system_id"]  # fmt: skip
        with c.cursor() as cur:
            ((pid, _, _),) = client_list.record_projects(cur, [sid])
        made[owner] = (pid, sid)
    yield made
    pids = [p for p, _ in made.values()]
    c.execute("update maintenance_systems set project_id = null where project_id = any(%s)", (pids,))
    c.execute("delete from projects where project_id = any(%s)", (pids,))


def sees(actor: str, owner: str) -> int:
    if actor == "inactive":
        return 403
    if actor in ("sa", "fin") or (actor in ("pm", "pm2") and owner == "none") or (actor == "pm" and owner == "pm"):
        return 200
    return 404


def fills(actor: str, owner: str) -> int:
    if sees(actor, owner) != 200:
        return sees(actor, owner)
    return 200 if actor == "sa" or (actor == "pm" and owner == "pm") else 403


GRID = [(a, o) for a in spec.ACTORS for o in ("pm", "none")]
IDS = [f"{a}-{o}" for a, o in GRID]


@pytest.mark.parametrize(("actor", "owner"), GRID, ids=IDS)
def test_who_sees_a_records_fields_and_whats_flagged(api, world, record, actor, owner) -> None:
    pid, _ = record[owner]
    r = api.get(f"/api/py/projects/{pid}/fields", headers=world.h(actor))
    assert r.status_code == sees(actor, owner), r.text
    if r.status_code == 200:
        d = r.json()
        assert d["imported"] is True and d["toFill"] > 0
        assert all(s["lockedReason"] is None for s in d["sections"]) or d["relation"] == "viewer"


@pytest.mark.parametrize(("actor", "owner"), GRID, ids=IDS)
def test_who_fills_a_record(api, world, record, actor, owner) -> None:
    pid, _ = record[owner]
    r = api.patch(
        f"/api/py/projects/{pid}/fields",
        headers=world.h(actor),
        json={"key": "pre_inspection_date", "value": "2024-02-01"},
    )
    assert r.status_code == fills(actor, owner), r.text


def test_its_homeowner_sees_nothing_flagged(api, world, record) -> None:
    pid, _ = record["homeowner"]
    d = api.get(f"/api/py/projects/{pid}/fields", headers=world.h("ho@record@2")).json()
    assert d["relation"] == "homeowner" and d["toFill"] == 0
    assert not any(f["toFill"] for s in d["sections"] for f in s["fields"])
    row = next(
        p
        for p in api.get("/api/py/projects?handed=true", headers=world.h("ho@record@2")).json()["projects"]
        if p["id"] == pid
    )
    assert row["toFill"] == 0 and row["flags"] == []


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_hands_an_imported_system_over_and_who_is_told(api, world, record, actor) -> None:
    pid, sid = record["none"]
    c = world.conn
    c.execute("update maintenance_systems set run_by = null where system_id = %s", (sid,))
    c.execute("update projects set project_manager_id = null where project_id = %s", (pid,))
    before = c.execute(
        "select count(*) as n from notifications where title like 'Fields to fill%%' and link = %s",
        (f"/maintenance/{sid}",),
    ).fetchone()["n"]
    r = api.patch(f"/api/py/maintenance/{sid}", headers=world.h(actor), json={"runBy": world.uid("pm")})
    seen = spec.maintenance_edit(actor, "none")
    assert r.status_code == (seen if seen != 200 else 200 if actor == "sa" else 403), r.text
    told = c.execute(
        "select recipient_uid from notifications where title like 'Fields to fill%%' and link = %s order by notification_id",
        (f"/maintenance/{sid}",),
    ).fetchall()[before:]
    assert [t["recipient_uid"] for t in told] == ([world.uid("pm")] if actor == "sa" else [])
    if actor == "sa":
        assert c.execute("select project_manager_id from projects where project_id = %s", (pid,)).fetchone()[
            "project_manager_id"
        ] == world.uid("pm")


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_imports_photos(api, world, actor) -> None:
    r = api.post(
        "/api/py/import/photos/check",
        headers=world.h(actor),
        json={"folders": [{"folder": "9SH0001-1 Nowhere Road", "files": []}]},
    )
    assert r.status_code == (200 if actor == "sa" else 403), r.text
