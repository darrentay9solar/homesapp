# ruff: noqa: E501  (one assertion per line reads best here)
"""GetApps' project workflow and groups (9 Solar Fintech; api/_lib/workflow.py, api/_routes/workflow.py).

The edition is read once as the app starts, so these switch the modules that check it to GetApps for their
own run, and back after.
"""

from __future__ import annotations

import base64
import io
import uuid
from datetime import date, timedelta

import pytest
from test_project_work import PNG, _onemap, team  # noqa: F401

from _lib import workflow as wf
from _routes import projects as projects_route
from _routes import workflow as workflow_route
from conftest import bearer


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


@pytest.fixture
def getapps(monkeypatch):
    monkeypatch.setattr(workflow_route, "EDITION", "fintech")
    monkeypatch.setattr(projects_route, "EDITION", "fintech")


@pytest.fixture
def project(client, fx, team, getapps):  # noqa: F811
    r = client.post("/api/py/projects", headers=h(team["pm"]), json={
        "name": f"GetApps Site {uuid.uuid4().hex[:5]}", "postalCode": "569933", "address": "53 Ang Mo Kio Ave 3",
        "homeownerName": "Acme Logistics", "contactNo": "+65 9123 4567",
        "contractor": {"type": "group", "groupId": team["group"]}, "startDate": "2026-03-15", "samePostalOk": True,
    })  # fmt: skip
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    team["projects"].append(pid)
    yield pid
    fx.conn.execute("delete from project_steps where project_id = %s", (pid,))


def put_drawing(client, who, pid, key, data=PNG, ctype="image/png"):
    link = client.post(
        f"/api/py/projects/{pid}/workflow/{key}/upload-link",
        headers=h(who),
        json={"fileName": f"{key}.png", "contentType": ctype, "size": len(data)},
    )
    if link.status_code != 200:
        return link
    assert client.put(link.json()["uploadUrl"], content=data, headers={"Content-Type": ctype}).status_code == 200
    return client.post(
        f"/api/py/projects/{pid}/workflow/{key}/files",
        headers=h(who),
        json={"key": link.json()["key"], "fileName": f"{key}.png"},
    )


def do(client, who, pid, key, data=None):
    if not key.startswith("check:"):
        r = put_drawing(client, who, pid, key)
        assert r.status_code == 200, (key, r.text)
    r = client.post(f"/api/py/projects/{pid}/workflow/{key}/done", headers=h(who), json={"data": data or {}})
    assert r.status_code == 200, (key, r.text)
    return r.json()["workflow"]


def flow(client, who, pid):
    r = client.get(f"/api/py/projects/{pid}/workflow", headers=h(who))
    assert r.status_code == 200, r.text
    return r.json()


def stage(w, key):
    return next(s for s in w["stages"] if s["key"] == key)


INVERTERS = {"serial": "HV2240012345", "size": "10 kW"}


def finish_stage(client, who, pid, key):
    s = stage(flow(client, who, pid), key)
    for i in s["items"]:
        do(client, who, pid, i["key"], INVERTERS if i["key"] == "inverters" else None)
    for c in s["checklist"]:
        do(client, who, pid, c["key"])


def test_a_getapps_project_starts_at_once_and_runs_ten_months(client, fx, project) -> None:
    p = fx.conn.execute(
        "select status, installation_start_date, target_end_date from projects where project_id = %s", (project,)
    ).fetchone()
    assert p["status"] == "in_progress", "no homeowner approval in GetApps"
    assert (p["installation_start_date"], p["target_end_date"]) == (date(2026, 3, 15), date(2027, 1, 15))


def test_the_stages_open_in_order(client, team, project) -> None:  # noqa: F811
    w = flow(client, team["pm"], project)
    assert [s["open"] for s in w["stages"]] == [True, False, False, False] and w["progress"] == 0
    assert w["current"] == "pre_install" and not w["final"]["open"]
    assert put_drawing(client, team["pm"], project, "solar_panels").status_code == 409, "Mechanical isn't open yet"
    r = client.post(f"/api/py/projects/{project}/workflow/ifc_pv_layout/done", headers=h(team["pm"]), json={})
    assert r.status_code == 400 and "drawing" in r.text, "a tick needs its drawing"
    finish_stage(client, team["epc"], project, "pre_install")
    w = flow(client, team["pm"], project)
    assert stage(w, "pre_install")["done"] and stage(w, "mechanical")["open"] and w["current"] == "mechanical"
    sp = {i["key"]: i["open"] for i in w["sp"]["items"]}
    assert sp == {
        "cs1_application": True,
        "pv1_letter": False,
        "pq_submission": False,
        "pv2_letter": False,
        "connection_agreement": False,
    }


def test_the_inverters_need_their_serial_size_and_one_picture(client, team, project) -> None:  # noqa: F811
    for key in ("pre_install", "mechanical"):
        finish_stage(client, team["pm"], project, key)
    assert put_drawing(client, team["pm"], project, "inverters").status_code == 200
    assert put_drawing(client, team["pm"], project, "inverters").status_code == 409, "one picture"
    r = client.post(
        f"/api/py/projects/{project}/workflow/inverters/done", headers=h(team["pm"]), json={"data": {"serial": "HV1"}}
    )
    assert r.status_code == 400 and "size" in r.text
    w = client.post(
        f"/api/py/projects/{project}/workflow/inverters/done", headers=h(team["pm"]), json={"data": INVERTERS}
    ).json()["workflow"]
    assert next(i for i in stage(w, "electrical")["items"] if i["key"] == "inverters")["data"] == INVERTERS


def test_nothing_is_taken_back_while_something_after_it_stands(client, team, project) -> None:  # noqa: F811
    finish_stage(client, team["pm"], project, "pre_install")
    do(client, team["pm"], project, "cs1_application")
    r = client.delete(f"/api/py/projects/{project}/workflow/ifc_pv_layout/done", headers=h(team["pm"]))
    assert r.status_code == 409, "CS1 depends on Pre-Installation"
    assert (
        client.delete(f"/api/py/projects/{project}/workflow/cs1_application/done", headers=h(team["pm"])).status_code
        == 200
    )
    assert (
        client.delete(f"/api/py/projects/{project}/workflow/ifc_pv_layout/done", headers=h(team["pm"])).status_code
        == 200
    )
    assert not stage(flow(client, team["pm"], project), "pre_install")["done"]


def _xlsx(rows) -> str:
    from openpyxl import Workbook

    wb = Workbook()
    for r in rows:
        wb.active.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def mechanical_works(client, fx, team, getapps):  # noqa: F811
    before = fx.conn.execute("select item_id, active from workflow_checklist_items").fetchall()
    sheet = _xlsx(
        [
            ["No.", "Item"],
            [1, "Mounting rails secured"],
            [2, "Panel clamps torqued"],
            [None, None],
            ["3", "Earthing bonded"],
        ]
    )
    r = client.post(
        "/api/py/workflow/checklists/mechanical",
        headers=h(team["pm"]),
        json={"fileName": "Mechanical Works.xlsx", "contentBase64": sheet},
    )
    assert r.status_code == 200 and r.json()["count"] == 3, r.text
    yield
    keep = [b["item_id"] for b in before]
    fx.conn.execute(
        "delete from project_steps where step like 'check:%%' and substring(step from 7)::int <> all(%s)", (keep,)
    )
    fx.conn.execute("delete from workflow_checklist_items where item_id <> all(%s)", (keep,))
    for b in before:
        fx.conn.execute(
            "update workflow_checklist_items set active = %s where item_id = %s", (b["active"], b["item_id"])
        )


def test_the_works_checklist_comes_from_the_sheet_and_must_be_ticked(client, team, project, mechanical_works) -> None:  # noqa: F811
    w = flow(client, team["pm"], project)
    assert [c["label"] for c in stage(w, "mechanical")["checklist"]] == [
        "Mounting rails secured",
        "Panel clamps torqued",
        "Earthing bonded",
    ]
    finish_stage(client, team["pm"], project, "pre_install")
    for i in stage(flow(client, team["pm"], project), "mechanical")["items"]:
        do(client, team["pm"], project, i["key"])
    assert not stage(flow(client, team["pm"], project), "mechanical")["done"], "the checklist isn't ticked yet"
    for c in stage(flow(client, team["pm"], project), "mechanical")["checklist"]:
        do(client, team["pm"], project, c["key"])
    assert stage(flow(client, team["pm"], project), "mechanical")["done"]
    assert (
        client.post(
            "/api/py/workflow/checklists/mechanical",
            headers=h(team["epc"]),
            json={"fileName": "x.xlsx", "contentBase64": _xlsx([["A thing"]])},
        ).status_code
        == 403
    )


def test_a_project_completes_after_both_tracks_and_sp_turn_on(client, fx, team, project) -> None:  # noqa: F811
    pm = team["pm"]
    finish_stage(client, pm, project, "pre_install")
    do(client, pm, project, "cs1_application")
    do(client, pm, project, "pv1_letter")
    for key in ("mechanical", "electrical"):
        finish_stage(client, pm, project, key)
    do(client, pm, project, "pq_submission")
    w = do(client, pm, project, "pv2_letter")
    ca = next(i for i in w["sp"]["items"] if i["key"] == "connection_agreement")
    assert ca["open"] and ca["dueOn"] == (date.today() + timedelta(days=wf.CONNECTION_DUE_DAYS)).isoformat()
    finish_stage(client, pm, project, "commissioning")
    assert not flow(client, pm, project)["final"]["open"], "the SP approvals aren't all done"
    w = do(client, pm, project, "connection_agreement")
    assert w["final"]["open"] and not w["complete"]
    do(client, pm, project, "sp_turn_on")
    w = do(client, pm, project, "qa_qc_checklist")
    assert w["complete"] and w["progress"] == 100 and w["current"] == "complete"
    row = next(p for p in client.get("/api/py/projects", headers=h(pm)).json()["projects"] if p["id"] == project)
    assert (row["stage"], row["complete"], row["progress"]) == ("complete", True, 100)


def test_groups_and_phases_add_up_their_projects(client, fx, team, project) -> None:  # noqa: F811
    pm = team["pm"]
    r = client.post(
        "/api/py/project-groups",
        headers=h(pm),
        json={"name": f"Contract {uuid.uuid4().hex[:5]}", "contractRef": "C-001", "client": "Acme"},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    try:
        p1 = client.post(f"/api/py/project-groups/{gid}/phases", headers=h(pm), json={"name": "Phase 1"}).json()["id"]
        assert (
            client.post(f"/api/py/project-groups/{gid}/phases", headers=h(pm), json={"name": "phase 1"}).status_code
            == 409
        )
        assert (
            client.put(
                f"/api/py/projects/{project}/group", headers=h(pm), json={"groupId": gid, "phaseId": p1}
            ).status_code
            == 200
        )
        finish_stage(client, pm, project, "pre_install")
        g = client.get(f"/api/py/project-groups/{gid}", headers=h(pm)).json()
        assert (
            g["figures"]["projects"] == 1
            and g["figures"]["byStage"]["mechanical"] == 1
            and g["figures"]["byPhase"][str(p1)] == 1
        )
        assert g["projects"][0]["phaseId"] == p1 and g["projects"][0]["stage"] == "mechanical"
        listed = next(x for x in client.get("/api/py/project-groups", headers=h(pm)).json()["groups"] if x["id"] == gid)
        assert listed["figures"]["projects"] == 1
        assert (
            client.post("/api/py/project-groups", headers=h(team["epc"]), json={"name": "Not mine"}).status_code == 403
        )
        assert (
            client.delete(f"/api/py/project-groups/{gid}", headers=h(pm)).status_code == 409
        ), "it still has a project"
        assert client.delete(f"/api/py/project-phases/{p1}", headers=h(pm)).status_code == 200
        assert (
            client.get(f"/api/py/project-groups/{gid}", headers=h(pm)).json()["projects"][0]["phaseId"] is None
        ), "the project stays in the group"
    finally:
        fx.conn.execute("update projects set group_id = null, phase_id = null where project_id = %s", (project,))
        fx.conn.execute("delete from project_groups where group_id = %s", (gid,))


def test_only_the_projects_team_works_it(client, team, project) -> None:  # noqa: F811
    assert client.get(f"/api/py/projects/{project}/workflow", headers=h(team["outsider"])).status_code == 404
    assert put_drawing(client, team["outsider"], project, "ifc_pv_layout").status_code == 404


def test_9_solar_homes_app_has_none_of_it(client, team) -> None:  # noqa: F811
    assert client.get("/api/py/project-groups", headers=h(team["pm"])).status_code == 404
    assert client.get("/api/py/workflow/checklists", headers=h(team["pm"])).status_code == 404
