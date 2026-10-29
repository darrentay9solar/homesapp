# ruff: noqa: E501
"""GetApps (9 Solar Fintech) acceptance: its project workflow, groups and phases, Works checklists, timing,
and its words, by every kind of person at every point of a project (docs/getapps-workflow.md).

The rules are written out plainly below (STAGES, SP, FINAL, opens(), blocked()), not taken from the app, and
the app is checked against them. The edition is read once as the app starts, so the modules that check it are
switched to GetApps for this file's run, and back after; the last part checks 9 Solar Home doesn't serve any of it.
"""

from __future__ import annotations

import calendar
import io
import json
import os
import re
import subprocess
import sys
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from _routes import projects as projects_route
from _routes import workflow as workflow_route
from uat import world as world_mod

# ------------------------------------------------------------------ the rules, written out

STAGES: list[tuple[str, list[str]]] = [
    ("pre_install", ["ifc_pv_layout", "pv_system", "single_line_diagram", "structure_drawing"]),
    ("mechanical", ["solar_panels", "as_built_pvl", "railings"]),
    ("electrical", ["pvdb", "isolators", "inverters", "msb_modules", "as_built_pvsl", "as_built_sld"]),
    ("commissioning", ["pre_commissioning_report", "scdf_final_acceptance"]),
]
CHECKLIST_OF = {"mechanical": "mechanical", "electrical": "electrical"}
SP = [
    ("cs1_application", ("stage", "pre_install")),
    ("pv1_letter", ("item", "cs1_application")),
    ("pq_submission", ("stage", "electrical")),
    ("pv2_letter", ("item", "pq_submission")),
    ("connection_agreement", ("item", "pv2_letter")),
]
FINAL = ["sp_turn_on", "qa_qc_checklist"]
ITEMS = [i for _, items in STAGES for i in items] + [k for k, _ in SP] + FINAL
LABEL = {"pre_install": "Pre-Installation", "mechanical": "Mechanical Installation", "electrical": "Electrical Installation",
         "commissioning": "Commissioning", "sp_turn_on": "SP Turn-On", "complete": "Complete"}  # fmt: skip

# Who: the project's manager (a superadmin runs every project) and its crew work it; Admin sees it; the rest don't.
ACTORS = ["sa", "pm", "pm2", "crew_admin", "crew_epc", "assigned_epc", "out_admin", "out_epc", "inactive", "fin"]
WORKERS = {"sa", "pm", "crew_admin", "crew_epc", "assigned_epc"}
VIEWERS = {"fin"}
OFFICE = {"sa", "pm", "pm2"}


def sees(actor: str) -> int:
    """What opening the project's workflow gives ``actor``."""
    if actor == "inactive":
        return 403
    return 200 if actor in WORKERS | VIEWERS else 404


# The points a project is at, by what's done (checklist ticks are added for the stages they belong to).
def _upto(*parts: str) -> list[str]:
    out: list[str] = []
    for p in parts:
        stage = dict(STAGES).get(p)
        out += stage if stage is not None else [p]
        if p in CHECKLIST_OF:
            out.append(f"@checks:{p}")
    return out


STATES: dict[str, list[str]] = {
    "fresh": [],
    "pre_done": _upto("pre_install"),
    "mech_done": _upto("pre_install", "cs1_application", "pv1_letter", "mechanical"),
    "elec_half": _upto("pre_install", "cs1_application", "pv1_letter", "mechanical", "pvdb", "isolators", "inverters"),
    "elec_done": _upto("pre_install", "cs1_application", "pv1_letter", "mechanical", "electrical"),
    "comm_done": _upto("pre_install", "cs1_application", "pv1_letter", "mechanical", "electrical", "pq_submission", "pv2_letter", "commissioning"),
    "sp_done": _upto("pre_install", "cs1_application", "pv1_letter", "mechanical", "electrical", "pq_submission", "pv2_letter", "commissioning", "connection_agreement"),
    "complete": _upto("pre_install", "cs1_application", "pv1_letter", "mechanical", "electrical", "pq_submission", "pv2_letter", "commissioning", "connection_agreement", *FINAL),
}  # fmt: skip


class Rules:
    """The workflow's rules for one set of Works checklist items."""

    def __init__(self, checks: dict[str, list[str]]) -> None:
        self.checks = checks  # stage -> ["check:12", ...]

    def stage_keys(self, stage: str) -> list[str]:
        return dict(STAGES)[stage] + self.checks.get(stage, [])

    def done(self, state: str) -> set[str]:
        out: set[str] = set()
        for k in STATES[state]:
            out |= set(self.checks[k.split(":")[1]]) if k.startswith("@checks:") else {k}
        return out

    def stage_done(self, stage: str, done: set[str]) -> bool:
        return all(k in done for k in self.stage_keys(stage))

    def where(self, key: str) -> str:
        for s, _ in STAGES:
            if key in self.stage_keys(s):
                return s
        return "sp" if key in dict(SP) else "final"

    def opens(self, key: str, done: set[str]) -> bool:
        w = self.where(key)
        if w == "sp":
            kind, what = dict(SP)[key]
            return self.stage_done(what, done) if kind == "stage" else what in done
        if w == "final":
            return all(self.stage_done(s, done) for s, _ in STAGES) and all(k in done for k, _ in SP)
        order = [s for s, _ in STAGES]
        return all(self.stage_done(s, done) for s in order[: order.index(w)])

    def blocked(self, key: str, done: set[str]) -> bool:
        """Whether something that depends on ``key`` is done, so it can't be taken back first."""
        w = self.where(key)
        if w == "final":
            return False
        if any(k in done for k in FINAL):
            return True
        if w == "sp":
            keys = [k for k, _ in SP]
            return any(k in done for k in keys[keys.index(key) + 1 :])
        order = [s for s, _ in STAGES]
        later = [k for s in order[order.index(w) + 1 :] for k in self.stage_keys(s)]
        opened = {"pre_install": "cs1_application", "electrical": "pq_submission"}.get(w)
        return any(k in done for k in later) or (opened is not None and opened in done)

    def current(self, done: set[str]) -> str:
        for s, _ in STAGES:
            if not self.stage_done(s, done):
                return s
        return "complete" if all(k in done for k in FINAL) and self.opens(FINAL[0], done) else "sp_turn_on"

    def progress(self, done: set[str]) -> int:
        total = len(ITEMS) + sum(len(v) for v in self.checks.values())
        return round(len(done) * 100 / total)


# ------------------------------------------------------------------ the scene


class Scene:
    def __init__(self, w: world_mod.World, rules: Rules, made_items: list[int]) -> None:
        self.w, self.rules, self.made_items = w, rules, made_items
        self.pid: dict[str, int] = {}
        self.extra: list[int] = []
        self.groups: list[int] = []
        # Read once, inside the first test that needs them (signing in is set up per test).
        self.cache: dict[str, Any] = {}

    def project(self, name: str, start: date) -> int:
        c, w = self.w.conn, self.w
        pid = c.execute(
            "insert into projects (name, address, postal_code, site_lat, site_lng, homeowner_name, homeowner_contact_no, "
            "contractor_group_id, installation_start_date, target_end_date, status, project_manager_id, created_by, "
            "electricity_retailer_id) values (%s, '1 Tuas Avenue 2', '639443', %s, %s, 'Acme Factory Pte Ltd', "
            "'+65 9123 4567', %s, %s, %s, 'draft', %s, %s, %s) returning project_id",
            (
                name,
                world_mod.SITE[0],
                world_mod.SITE[1],
                w.group,
                start,
                add_months(start, 10),
                w.uid("pm"),
                w.uid("pm"),
                w.retailer,
            ),
        ).fetchone()["project_id"]
        w.made_pids.append(pid)
        c.execute(
            "insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s)",
            (pid, w.uid("assigned_epc"), w.uid("pm")),
        )
        c.execute("update projects set status = 'in_progress' where project_id = %s", (pid,))
        return pid

    def mark(self, pid: int, keys: set[str], at: datetime | None = None) -> None:
        for k in keys:
            self.w.conn.execute(
                "insert into project_steps (project_id, step, done_by, data, done_at) values (%s, %s, %s, %s::jsonb, coalesce(%s, now())) "
                "on conflict (project_id, step) do nothing",
                (
                    pid,
                    k,
                    self.w.uid("crew_epc"),
                    json.dumps({"serial": "HV-UAT-1", "size": "50 kW"} if k == "inverters" else {}),
                    at,
                ),
            )


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, min(d.day, calendar.monthrange(d.year + y, m + 1)[1]))


@pytest.fixture(scope="module")
def scene(world: world_mod.World) -> Iterator[Scene]:
    mp = pytest.MonkeyPatch()
    mp.setattr(workflow_route, "EDITION", "fintech")
    mp.setattr(projects_route, "EDITION", "fintech")
    c = world.conn
    # The Works checklists as the office uploaded them; three UAT items each if none are up yet.
    made: list[int] = []
    for stage in CHECKLIST_OF:
        if not c.execute("select 1 from workflow_checklist_items where stage = %s and active", (stage,)).fetchone():
            for n in range(3):
                made.append(c.execute(
                    "insert into workflow_checklist_items (stage, sort, label, source_file) values (%s, %s, %s, %s) returning item_id",
                    (stage, n, f"UAT {stage} check {n + 1}", f"uat-{world.tag}.xlsx"),
                ).fetchone()["item_id"])  # fmt: skip
    checks = {
        stage: [f"check:{r['item_id']}" for r in c.execute(
            "select item_id from workflow_checklist_items where stage = %s and active order by sort, item_id", (stage,))]
        for stage in CHECKLIST_OF
    }  # fmt: skip
    s = Scene(world, Rules(checks), made)
    start = date.today() - timedelta(days=60)
    for state in STATES:
        s.pid[state] = s.project(f"UAT GetApps {state} {world.tag}", start)
        s.mark(s.pid[state], s.rules.done(state))
    try:
        yield s
    finally:
        c.execute("delete from project_steps where project_id = any(%s)", (world.made_pids,))
        c.execute("update projects set group_id = null, phase_id = null where project_id = any(%s)", (world.made_pids,))
        c.execute(
            "delete from project_groups where group_id = any(%s) or name like %s", (s.groups, f"UAT {world.tag}%")
        )
        c.execute("delete from workflow_checklist_items where item_id = any(%s)", (made,))
        mp.undo()


def hdr(scene: Scene, actor: str) -> dict[str, str]:
    return scene.w.h(actor)


# ------------------------------------------------------------------ seeing the workflow


@pytest.mark.parametrize("state", list(STATES))
@pytest.mark.parametrize("actor", ACTORS)
def test_who_sees_the_workflow(api: TestClient, scene: Scene, actor: str, state: str) -> None:
    r = api.get(f"/api/py/projects/{scene.pid[state]}/workflow", headers=hdr(scene, actor))
    assert r.status_code == sees(actor), r.text
    if r.status_code == 200:
        assert r.json()["canWork"] is (actor in WORKERS), "only the manager and the crew work it"


@pytest.fixture
def flows(api: TestClient, scene: Scene) -> dict[str, dict[str, Any]]:
    if "flows" not in scene.cache:
        scene.cache["flows"] = {
            st: api.get(f"/api/py/projects/{pid}/workflow", headers=hdr(scene, "pm")).json()
            for st, pid in scene.pid.items()
        }
    return scene.cache["flows"]


def _lines(w: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out = {i["key"]: i for s in w["stages"] for i in s["items"]}
    out |= {c["key"]: c for s in w["stages"] for c in s["checklist"]}
    out |= {i["key"]: i for i in w["sp"]["items"]}
    return out | {i["key"]: i for i in w["final"]["items"]}


def _all_keys() -> list[str]:
    return [*ITEMS, "@check:mechanical", "@check:electrical"]


@pytest.mark.parametrize("key", _all_keys())
@pytest.mark.parametrize("state", list(STATES))
def test_what_is_open_and_done(scene: Scene, flows: dict[str, Any], state: str, key: str) -> None:
    rules, done = scene.rules, scene.rules.done(state)
    keys = rules.checks[key.split(":")[1]] if key.startswith("@check:") else [key]
    lines = _lines(flows[state])
    for k in keys:
        assert k in lines, f"{k} is on the workflow"
        assert lines[k]["open"] is rules.opens(k, done), (state, k, "open")
        assert lines[k]["done"] is (k in done), (state, k, "done")


@pytest.mark.parametrize("state", list(STATES))
def test_the_stage_progress_and_completion(scene: Scene, flows: dict[str, Any], state: str) -> None:
    rules, done, w = scene.rules, scene.rules.done(state), flows[state]
    assert w["current"] == rules.current(done)
    assert w["currentLabel"] == LABEL[w["current"]]
    assert w["progress"] == rules.progress(done)
    assert w["complete"] is (state == "complete")
    for s in w["stages"]:
        assert s["done"] is rules.stage_done(s["key"], done)
        assert s["open"] is rules.opens(dict(STAGES)[s["key"]][0], done)
        assert [i["key"] for i in s["items"] if i["endorsed"]] == {
            "mechanical": ["as_built_pvl", "railings"],
            "electrical": ["as_built_pvsl", "as_built_sld"],
        }.get(s["key"], [])
    assert w["sp"]["done"] is all(k in done for k, _ in SP)
    assert w["final"]["open"] is rules.opens("sp_turn_on", done)


@pytest.mark.parametrize("state", list(STATES))
def test_the_projects_list_shows_the_workflow(api: TestClient, scene: Scene, state: str) -> None:
    rows = {p["id"]: p for p in api.get("/api/py/projects", headers=hdr(scene, "pm")).json()["projects"]}
    p, done = rows[scene.pid[state]], scene.rules.done(state)
    assert (p["stage"], p["stageLabel"], p["complete"], p["progress"]) == (
        scene.rules.current(done),
        LABEL[scene.rules.current(done)],
        state == "complete",
        scene.rules.progress(done),
    )
    assert p["status"] == "in_progress", "no homeowner approval in GetApps"
    assert p["flags"] == [] and p["attention"] is False, "two months in, nothing's late"


# ------------------------------------------------------------------ uploading and ticking


PDF = b"%PDF-1.4 uat ".ljust(2048, b"0")


def _link(api: TestClient, scene: Scene, actor: str, pid: int, key: str):
    return api.post(f"/api/py/projects/{pid}/workflow/{key}/upload-link", headers=hdr(scene, actor),
                    json={"fileName": f"{key}.pdf", "contentType": "application/pdf", "size": 2048})  # fmt: skip


@pytest.mark.parametrize("key", ITEMS)
@pytest.mark.parametrize("state", list(STATES))
@pytest.mark.parametrize("actor", ACTORS)
def test_who_can_upload_a_drawing_when(api: TestClient, scene: Scene, actor: str, state: str, key: str) -> None:
    done = scene.rules.done(state)
    if sees(actor) != 200:
        want = sees(actor)
    elif actor not in WORKERS:
        want = 403
    else:
        want = 200 if scene.rules.opens(key, done) and key not in done else 409
    r = _link(api, scene, actor, scene.pid[state], key)
    assert r.status_code == want, r.text


@pytest.mark.parametrize("key", ITEMS)
@pytest.mark.parametrize("state", list(STATES))
def test_an_item_is_ticked_only_with_its_drawing(api: TestClient, scene: Scene, state: str, key: str) -> None:
    done = scene.rules.done(state)
    r = api.post(
        f"/api/py/projects/{scene.pid[state]}/workflow/{key}/done",
        headers=hdr(scene, "crew_epc"),
        json={"data": {"serial": "X1", "size": "5 kW"}},
    )
    if key in done:
        assert r.status_code == 409, "it's ticked already"
    elif not scene.rules.opens(key, done):
        assert r.status_code == 409, "it isn't open yet"
    else:
        assert r.status_code == 400 and "drawing first" in r.text, r.text


@pytest.mark.parametrize("which", ["mechanical", "electrical"])
@pytest.mark.parametrize("state", list(STATES))
def test_a_checklist_item_is_ticked_when_its_stage_is_open(
    api: TestClient, scene: Scene, state: str, which: str
) -> None:
    done, pid = scene.rules.done(state), scene.pid[state]
    for k in scene.rules.checks[which]:
        r = api.post(f"/api/py/projects/{pid}/workflow/{k}/done", headers=hdr(scene, "crew_admin"), json={})
        if k in done or not scene.rules.opens(k, done):
            assert r.status_code == 409, (k, r.text)
        else:
            assert r.status_code == 200, (k, r.text)
            scene.w.conn.execute("delete from project_steps where project_id = %s and step = %s", (pid, k))
        assert api.post(f"/api/py/projects/{pid}/workflow/{k}/upload-link", headers=hdr(scene, "pm"),
                        json={"fileName": "x.pdf", "contentType": "application/pdf", "size": 10}).status_code == 400, "a checklist item has no drawing"  # fmt: skip


def _done_pairs() -> list[tuple[str, str]]:
    # Every item done at each point (checklist ticks by their stage).
    return [(st, k) for st in STATES for k in STATES[st]]


@pytest.mark.parametrize(("state", "key"), _done_pairs())
def test_untick_only_when_nothing_after_it_is_done(api: TestClient, scene: Scene, state: str, key: str) -> None:
    rules, done, pid = scene.rules, scene.rules.done(state), scene.pid[state]
    keys = rules.checks[key.split(":")[1]] if key.startswith("@checks:") else [key]
    for k in keys:
        r = api.delete(f"/api/py/projects/{pid}/workflow/{k}/done", headers=hdr(scene, "pm"))
        if rules.blocked(k, done):
            assert r.status_code == 409, (k, r.text)
        else:
            assert r.status_code == 200, (k, r.text)
            scene.mark(pid, {k})


@pytest.mark.parametrize("actor", ACTORS)
def test_who_can_tick_and_untick(api: TestClient, scene: Scene, actor: str) -> None:
    pid = scene.pid["elec_half"]
    tick = api.post(f"/api/py/projects/{pid}/workflow/msb_modules/done", headers=hdr(scene, actor), json={})
    untick = api.delete(f"/api/py/projects/{pid}/workflow/inverters/done", headers=hdr(scene, actor))
    if sees(actor) != 200:
        assert (tick.status_code, untick.status_code) == (sees(actor), sees(actor))
    elif actor not in WORKERS:
        assert (tick.status_code, untick.status_code) == (403, 403), "Admin looks, changes nothing"
    else:
        assert tick.status_code == 400, "no drawing yet"
        assert untick.status_code == 200, untick.text
        scene.mark(pid, {"inverters"})


def test_a_whole_project_through_the_api(api: TestClient, scene: Scene) -> None:
    """One project worked from start to SP Turn-On by its crew, drawing by drawing, as on the phone."""
    pid = scene.project(f"UAT GetApps flow {scene.w.tag}", date.today() - timedelta(days=30))
    order = _upto(
        "pre_install",
        "cs1_application",
        "pv1_letter",
        "mechanical",
        "electrical",
        "pq_submission",
        "pv2_letter",
        "commissioning",
        "connection_agreement",
        *FINAL,
    )
    for k in order:
        keys = scene.rules.checks[k.split(":")[1]] if k.startswith("@checks:") else [k]
        for key in keys:
            if not key.startswith("check:"):
                link = _link(api, scene, "crew_epc", pid, key)
                assert link.status_code == 200, (key, link.text)
                assert (
                    api.put(
                        link.json()["uploadUrl"], content=PDF, headers={"Content-Type": "application/pdf"}
                    ).status_code
                    == 200
                )
                got = api.post(
                    f"/api/py/projects/{pid}/workflow/{key}/files",
                    headers=hdr(scene, "crew_epc"),
                    json={"key": link.json()["key"], "fileName": f"{key}.pdf"},
                )
                assert got.status_code == 200, got.text
                if key == "inverters":
                    assert _link(api, scene, "crew_epc", pid, key).status_code == 409, "the inverters take one picture"
                    assert (
                        api.post(
                            f"/api/py/projects/{pid}/workflow/{key}/done",
                            headers=hdr(scene, "crew_epc"),
                            json={"data": {"serial": "HV1"}},
                        ).status_code
                        == 400
                    ), "and their size"
            r = api.post(
                f"/api/py/projects/{pid}/workflow/{key}/done",
                headers=hdr(scene, "crew_epc"),
                json={"data": {"serial": "HV-1", "size": "50 kW"}},
            )
            assert r.status_code == 200, (key, r.text)
    w = r.json()["workflow"]
    assert w["complete"] and w["progress"] == 100 and w["current"] == "complete"
    assert r.json()["message"].endswith("is complete.")
    row = next(p for p in api.get("/api/py/projects", headers=hdr(scene, "pm")).json()["projects"] if p["id"] == pid)
    assert row["complete"] and row["stage"] == "complete"


# ------------------------------------------------------------------ timing


@pytest.mark.parametrize("offset", range(0, 731))
def test_a_project_runs_ten_months(offset: int) -> None:
    from _lib import workflow as wf

    start = date(2026, 1, 1) + timedelta(days=offset)
    end = wf.target_end(start)
    assert 303 <= (end - start).days <= 306, "ten months"
    assert end.day == min(
        start.day, calendar.monthrange(end.year, end.month)[1]
    ), "the same day of the month, or its last"
    assert (end.year * 12 + end.month) - (start.year * 12 + start.month) == 10


def test_late_projects_and_an_overdue_connection_agreement(api: TestClient, scene: Scene) -> None:
    old = date.today() - timedelta(days=330)
    late = scene.project(f"UAT GetApps late {scene.w.tag}", old)
    done_late = scene.project(f"UAT GetApps done late {scene.w.tag}", old)
    scene.mark(done_late, scene.rules.done("complete"))
    ca = scene.project(f"UAT GetApps CA {scene.w.tag}", date.today() - timedelta(days=90))
    scene.mark(ca, scene.rules.done("comm_done") - {"pv2_letter"})
    scene.mark(ca, {"pv2_letter"}, at=datetime.now() - timedelta(days=8))
    rows = {p["id"]: p for p in api.get("/api/py/projects", headers=hdr(scene, "pm")).json()["projects"]}
    assert [f["kind"] for f in rows[late]["flags"]] == ["overdue"] and rows[late]["attention"]
    assert re.fullmatch(r"Past its 10 months by \d+ days", rows[late]["flags"][0]["text"])
    assert rows[done_late]["flags"] == [], "a complete project isn't late"
    assert [f["kind"] for f in rows[ca]["flags"]] == ["sp"], "the Connection Agreement was due a week after PV2"
    w = api.get(f"/api/py/projects/{ca}/workflow", headers=hdr(scene, "pm")).json()
    item = next(i for i in w["sp"]["items"] if i["key"] == "connection_agreement")
    assert item["overdue"] is True and item["dueOn"] < date.today().isoformat()
    w = api.get(f"/api/py/projects/{scene.pid['sp_done']}/workflow", headers=hdr(scene, "pm")).json()
    assert next(i for i in w["sp"]["items"] if i["key"] == "connection_agreement")["overdue"] is False


# ------------------------------------------------------------------ groups and phases


@pytest.fixture
def group(api: TestClient, scene: Scene) -> dict[str, Any]:
    if "group" not in scene.cache:
        scene.cache["group"] = _make_group(api, scene)
    return scene.cache["group"]


def _make_group(api: TestClient, scene: Scene) -> dict[str, Any]:
    r = api.post(
        "/api/py/project-groups",
        headers=hdr(scene, "sa"),
        json={"name": f"UAT {scene.w.tag} Tuas Factories", "contractRef": "C-1", "client": "Acme"},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    scene.groups.append(gid)
    ph = api.post(f"/api/py/project-groups/{gid}/phases", headers=hdr(scene, "sa"), json={"name": "Phase 1"}).json()[
        "id"
    ]
    for st in ("fresh", "elec_done", "complete"):
        assert (
            api.put(
                f"/api/py/projects/{scene.pid[st]}/group",
                headers=hdr(scene, "pm"),
                json={"groupId": gid, "phaseId": ph if st != "fresh" else None},
            ).status_code
            == 200
        )
    return {"id": gid, "phase": ph}


def _scratch_group(scene: Scene) -> tuple[int, int]:
    c = scene.w.conn
    gid = c.execute(
        "insert into project_groups (name) values (%s) returning group_id",
        (f"UAT {scene.w.tag} scratch {uuid.uuid4().hex[:6]}",),
    ).fetchone()["group_id"]
    scene.groups.append(gid)
    ph = c.execute(
        "insert into project_phases (group_id, name) values (%s, 'Phase X') returning phase_id", (gid,)
    ).fetchone()["phase_id"]
    return gid, ph


def _want(actor: str, office_only: bool) -> int:
    if actor == "inactive":
        return 403
    return 200 if not office_only or actor in OFFICE else 403


@pytest.mark.parametrize("actor", ACTORS)
def test_groups_are_seen_by_everyone_and_managed_by_the_office(
    api: TestClient, scene: Scene, group: dict[str, Any], actor: str
) -> None:
    h, gid = hdr(scene, actor), group["id"]
    lst = api.get("/api/py/project-groups", headers=h)
    assert lst.status_code == _want(actor, False)
    if lst.status_code == 200:
        assert lst.json()["canManage"] is (actor in OFFICE)
    assert api.get(f"/api/py/project-groups/{gid}", headers=h).status_code == _want(actor, False)
    assert api.get("/api/py/workflow/checklists", headers=h).status_code == _want(actor, False)
    made = api.post("/api/py/project-groups", headers=h, json={"name": f"UAT {scene.w.tag} by {actor}"})
    assert made.status_code == _want(actor, True), made.text
    if made.status_code == 200:
        scene.groups.append(made.json()["id"])
    assert api.patch(
        f"/api/py/project-groups/{gid}", headers=h, json={"notes": f"seen by {actor}"}
    ).status_code == _want(actor, True)
    sg, sph = _scratch_group(scene)
    assert api.post(
        f"/api/py/project-groups/{sg}/phases", headers=h, json={"name": f"Phase {actor}"}
    ).status_code == _want(actor, True)
    assert api.patch(
        f"/api/py/project-phases/{sph}", headers=h, json={"name": f"Renamed {actor}"}
    ).status_code == _want(actor, True)
    assert api.delete(f"/api/py/project-phases/{sph}", headers=h).status_code == _want(actor, True)
    assert api.delete(f"/api/py/project-groups/{sg}", headers=h).status_code == _want(actor, True)
    # A checklist upload: the office gets as far as checking the sheet (not an Excel file); nobody else.
    up = api.post(
        "/api/py/workflow/checklists/mechanical",
        headers=h,
        json={"fileName": "x.xlsx", "contentBase64": "bm90IGV4Y2Vs"},
    )
    assert up.status_code == (400 if actor in OFFICE else _want(actor, True))


@pytest.mark.parametrize("actor", ACTORS)
def test_who_moves_a_project_between_groups(api: TestClient, scene: Scene, group: dict[str, Any], actor: str) -> None:
    pid = scene.pid["mech_done"]
    r = api.put(
        f"/api/py/projects/{pid}/group",
        headers=hdr(scene, actor),
        json={"groupId": group["id"], "phaseId": group["phase"]},
    )
    want = 403 if actor == "inactive" or actor not in OFFICE else 200 if actor in {"sa", "pm"} else 404
    assert r.status_code == want, r.text
    api.put(f"/api/py/projects/{pid}/group", headers=hdr(scene, "pm"), json={})


def test_a_groups_figures(api: TestClient, scene: Scene, group: dict[str, Any]) -> None:
    g = api.get(f"/api/py/project-groups/{group['id']}", headers=hdr(scene, "pm")).json()
    assert sorted(p["id"] for p in g["projects"]) == sorted(scene.pid[s] for s in ("fresh", "elec_done", "complete"))
    f = g["figures"]
    assert (f["projects"], f["complete"], f["late"]) == (3, 1, 0)
    assert f["byStage"] == {
        "pre_install": 1,
        "mechanical": 0,
        "electrical": 0,
        "commissioning": 1,
        "sp_turn_on": 0,
        "complete": 1,
    }
    assert f["sp"] == {
        "cs1_application": 2,
        "pv1_letter": 2,
        "pq_submission": 1,
        "pv2_letter": 1,
        "connection_agreement": 1,
    }
    assert f["byPhase"] == {str(group["phase"]): 2} or f["byPhase"] == {group["phase"]: 2}
    rows = {p["id"]: p for p in api.get("/api/py/projects", headers=hdr(scene, "pm")).json()["projects"]}
    assert (
        rows[scene.pid["elec_done"]]["group"]["id"] == group["id"]
        and rows[scene.pid["elec_done"]]["phase"]["id"] == group["phase"]
    )
    assert rows[scene.pid["fresh"]]["phase"] is None
    assert (
        api.delete(f"/api/py/project-groups/{group['id']}", headers=hdr(scene, "sa")).status_code == 409
    ), "it still has projects"


def test_group_and_phase_names_are_checked(api: TestClient, scene: Scene, group: dict[str, Any]) -> None:
    sa = hdr(scene, "sa")
    name = f"UAT {scene.w.tag} Tuas Factories"
    assert api.post("/api/py/project-groups", headers=sa, json={"name": name.upper()}).status_code == 409
    assert api.post("/api/py/project-groups", headers=sa, json={"name": " "}).status_code == 400
    assert (
        api.post(f"/api/py/project-groups/{group['id']}/phases", headers=sa, json={"name": "phase 1"}).status_code
        == 409
    )
    other, _ = _scratch_group(scene)
    other_phase = api.post(f"/api/py/project-groups/{other}/phases", headers=sa, json={"name": "Phase 9"}).json()["id"]
    assert (
        api.put(
            f"/api/py/projects/{scene.pid['pre_done']}/group",
            headers=sa,
            json={"groupId": group["id"], "phaseId": other_phase},
        ).status_code
        == 400
    ), "a phase of another group"


# ------------------------------------------------------------------ the Works checklists from Excel


def _xlsx(rows: list[list[Any]]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    for r in rows:
        wb.active.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


SHEETS: list[tuple[str, list[list[Any]], list[str] | int]] = [
    ("plain", [["Rails fixed"], ["Clamps torqued"]], ["Rails fixed", "Clamps torqued"]),
    ("a heading row", [["Item"], ["Rails fixed"]], ["Rails fixed"]),
    ("numbered", [[1, "Rails fixed"], [2, "Clamps torqued"]], ["Rails fixed", "Clamps torqued"]),
    ("S/N heading and numbering", [["S/N", "Description"], ["1.1", "Rails fixed"]], ["Rails fixed"]),
    ("blank rows", [["Rails fixed"], [None], [], ["Clamps torqued"]], ["Rails fixed", "Clamps torqued"]),
    ("repeats once", [["Rails fixed"], ["Rails fixed"]], ["Rails fixed"]),
    ("spaces tidied", [["  Rails   fixed "]], ["Rails fixed"]),
    ("numbers only are left out", [[12], [3.5], ["Rails fixed"]], ["Rails fixed"]),
    ("a later column when the first is a number", [["a)", "Earth bonded"]], ["Earth bonded"]),
    ("Chinese words beside English", [["Isolator labelled 隔离开关已标记"]], ["Isolator labelled 隔离开关已标记"]),
    ("Description heading", [["Description"], ["DC polarity tested"]], ["DC polarity tested"]),
    ("Works heading", [["Works"], ["Trunking secured"]], ["Trunking secured"]),
    ("headings before the first item", [["Checklist"], ["Item"], ["Rails"]], ["Rails"]),
    ("long items cut at 300", [["x" * 10 + " " + "y" * 400]], 1),
    ("nothing usable", [[1], [2]], 0),
    ("empty sheet", [], 0),
]


@pytest.mark.parametrize(("name", "rows", "want"), SHEETS, ids=[s[0] for s in SHEETS])
def test_reading_a_checklist_sheet(name: str, rows: list[list[Any]], want: list[str] | int) -> None:
    from fastapi import HTTPException

    if want == 0:
        with pytest.raises(HTTPException) as e:
            workflow_route.read_sheet(_xlsx(rows))
        assert e.value.status_code == 400
        return
    got = workflow_route.read_sheet(_xlsx(rows))
    if isinstance(want, int):
        assert len(got) == want and len(got[0]) <= 300
    else:
        assert got == want


def test_not_an_excel_file() -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        workflow_route.read_sheet(b"%PDF-1.4 not a sheet")


# ------------------------------------------------------------------ 9 Solar Home doesn't serve any of it

HOME_ROUTES = [
    ("GET", "/projects/{pid}/workflow", None),
    (
        "POST",
        "/projects/{pid}/workflow/pv_system/upload-link",
        {"fileName": "a.pdf", "contentType": "application/pdf", "size": 10},
    ),
    ("POST", "/projects/{pid}/workflow/pv_system/files", {"key": "x"}),
    ("DELETE", "/projects/{pid}/workflow/pv_system/files/1", None),
    ("POST", "/projects/{pid}/workflow/pv_system/done", {}),
    ("DELETE", "/projects/{pid}/workflow/pv_system/done", None),
    ("GET", "/workflow/checklists", None),
    ("POST", "/workflow/checklists/mechanical", {"fileName": "a.xlsx", "contentBase64": ""}),
    ("GET", "/project-groups", None),
    ("POST", "/project-groups", {"name": "Nope"}),
    ("GET", "/project-groups/1", None),
    ("PATCH", "/project-groups/1", {"name": "Nope"}),
    ("DELETE", "/project-groups/1", None),
    ("POST", "/project-groups/1/phases", {"name": "Nope"}),
    ("PATCH", "/project-phases/1", {"name": "Nope"}),
    ("DELETE", "/project-phases/1", None),
    ("PUT", "/projects/{pid}/group", {}),
]


@pytest.mark.parametrize(("method", "path", "body"), HOME_ROUTES, ids=[f"{m} {p}" for m, p, _ in HOME_ROUTES])
@pytest.mark.parametrize("actor", ACTORS)
def test_9_solar_home_has_none_of_it(
    api: TestClient, scene: Scene, actor: str, method: str, path: str, body: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(workflow_route, "EDITION", "home")
    monkeypatch.setattr(projects_route, "EDITION", "home")
    r = api.request(method, "/api/py" + path.format(pid=scene.pid["pre_done"]), headers=hdr(scene, actor), json=body)
    assert r.status_code == (403 if actor == "inactive" else 404), r.text


def test_9_solar_home_projects_are_unchanged(api: TestClient, scene: Scene, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_route, "EDITION", "home")
    monkeypatch.setattr(projects_route, "EDITION", "home")
    row = next(
        p
        for p in api.get("/api/py/projects", headers=hdr(scene, "pm")).json()["projects"]
        if p["id"] == scene.pid["elec_done"]
    )
    assert not {"stage", "stageLabel", "complete", "group", "phase"} & set(
        row
    ), "9 Solar Home's rows carry nothing of GetApps"


# ------------------------------------------------------------------ GetApps' words: every phrase, both languages

API_DIR = str(Path(__file__).resolve().parents[2] / "api")
ZH = json.loads((Path(API_DIR) / "_lib" / "i18n" / "zh.json").read_text("utf8"))


def _fill(s: str) -> str:
    return re.sub(r"\{\w+\}", "Q", s)


def _renamed() -> dict[str, tuple[str, str, bool]]:
    """Every phrase through GetApps' renaming (a fresh process: the edition is read as it starts)."""
    code = (
        "import json, re, sys\nfrom _lib.edition import rebrand\n"
        "d = json.loads(sys.stdin.read())\n"
        "out = {k: (rebrand(re.sub(r'\\{\\w+\\}', 'Q', k)), rebrand(re.sub(r'\\{\\w+\\}', 'Q', v)), "
        "rebrand(rebrand(re.sub(r'\\{\\w+\\}', 'Q', k))) == rebrand(re.sub(r'\\{\\w+\\}', 'Q', k))) for k, v in d.items()}\n"
        "sys.stdout.write(json.dumps(out, ensure_ascii=False))"
    )
    env = {**os.environ, "EDITION": "fintech", "PYTHONIOENCODING": "utf8"}
    r = subprocess.run([sys.executable, "-c", f"import sys; sys.path.insert(0, {API_DIR!r})\n{code}"], input=json.dumps(ZH),
                       env=env, capture_output=True, text=True, encoding="utf8", check=True)  # fmt: skip
    return {k: tuple(v) for k, v in json.loads(r.stdout).items()}  # type: ignore[misc]


RENAMED = _renamed()
OLD_EN = re.compile(
    r"\b[Hh]omeowners?\b|9 Solar Home|9 SOLAR HOME|GetHomeApps|GETHOMEAPPS|(?<!EPC )\b[Pp]roject [Mm]anagers?\b|\bEPC [Tt]eams?\b|\bhomes?\b|\bHomes\b"
)
OLD_ZH = re.compile(r"屋主|九太阳家|住宅|住家|(?<!EPC )项目经理|EPC 团队")


@pytest.mark.parametrize("key", sorted(RENAMED))
def test_getapps_words(key: str) -> None:
    en, zh, steady = RENAMED[key]
    assert not OLD_EN.search(en), f"English still says {OLD_EN.search(en).group(0)!r}: {en}"  # type: ignore[union-attr]
    assert not OLD_ZH.search(zh), f"Chinese still says {OLD_ZH.search(zh).group(0)!r}: {zh}"  # type: ignore[union-attr]
    assert steady, "renaming twice changes nothing more"


def test_the_two_rename_lists_match() -> None:
    """The browser's list (lib/client/edition.ts) and the server's (api/_lib/edition.py) say the same."""
    root = Path(API_DIR).parent
    ts = re.findall(r'\[/(.+?)/g, "(.*?)"\]', (root / "lib" / "client" / "edition.ts").read_text("utf8"))
    py = re.findall(r'\(re\.compile\(r"(.+?)"\), "(.*?)"\)', (root / "api" / "_lib" / "edition.py").read_text("utf8"))
    assert ts == py and len(ts) > 20
