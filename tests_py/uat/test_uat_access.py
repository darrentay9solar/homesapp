"""UAT · who sees which project, at every stage.

The brief: homeowners see only their own project; the contractor's people see
the projects they're on; a project manager sees the projects they run and a
superadmin sees every one. Someone whose account is switched off sees nothing.
Each test is one person, one project, one screen.
"""

from __future__ import annotations

import pytest

from uat import spec

pytestmark = pytest.mark.uat
GRID = [(a, s) for a in spec.ACTORS for s in spec.STATE_KEYS]
IDS = [f"{a}-{s}" for a, s in GRID]


@pytest.mark.parametrize(("actor", "state"), GRID, ids=IDS)
def test_project_page(cached, actor, state) -> None:
    code, body = cached.get("/api/py/projects/{pid}", actor, state)
    assert code == spec.sees(actor, state), body
    if code == 200:
        assert body["status"] == spec.STATUS[state]


@pytest.mark.parametrize(("actor", "state"), GRID, ids=IDS)
def test_milestone_fields(cached, actor, state) -> None:
    code, body = cached.get("/api/py/projects/{pid}/fields", actor, state)
    assert code == spec.sees(actor, state), body
    if code == 200:
        assert body["relation"] == spec.relation(actor, state)


@pytest.mark.parametrize(("actor", "state"), GRID, ids=IDS)
def test_site_visits(cached, actor, state) -> None:
    code, body = cached.get("/api/py/projects/{pid}/visits", actor, state)
    assert code == spec.sees(actor, state), body


@pytest.mark.parametrize(("actor", "state"), GRID, ids=IDS)
def test_handover(cached, actor, state) -> None:
    code, body = cached.get("/api/py/projects/{pid}/handover", actor, state)
    assert code == spec.sees(actor, state), body
    if code == 200:
        assert body["status"] == spec.STATUS[state]
        assert body["actions"] == spec.handover_actions(actor, state)
        signed = spec.STATUS[state] in ("signed", "closed")
        assert (body["signature"] is not None) == signed
        assert (body["pdf"] is not None) == signed
        assert (body["closed"] is not None) == (spec.STATUS[state] == "closed")


@pytest.mark.parametrize(("actor", "state"), GRID, ids=IDS)
def test_signed_certificate_pdf(cached, actor, state) -> None:
    code, body = cached.get("/api/py/projects/{pid}/handover/certificate.pdf", actor, state)
    assert code == spec.certificate_pdf(actor, state), body


@pytest.mark.parametrize(("actor", "state"), GRID, ids=IDS)
def test_projects_list(api, world, actor, state) -> None:
    r = api.get("/api/py/projects", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
        return
    listed = {p["id"] for p in r.json()["projects"]}
    assert (world.pid[state] in listed) == spec.listed(actor, state)


# Files exist from the first piece of work on.
WITH_FILES = [(a, s) for a, s in GRID if spec.STATUS[s] not in spec.BEFORE_APPROVAL | {"pm_approved"}]


@pytest.mark.parametrize(("actor", "state"), WITH_FILES, ids=[f"{a}-{s}" for a, s in WITH_FILES])
def test_files_open_for_the_project_only(api, world, actor, state) -> None:
    row = world.conn.execute(
        "select file_id from project_files where project_id = %s order by file_id limit 1", (world.pid[state],)
    ).fetchone()
    r = api.get(f"/api/py/files/{row['file_id']}", headers=world.h(actor), follow_redirects=False)
    expect = spec.sees(actor, state)
    assert r.status_code == (302 if expect == 200 else expect), r.text


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_create_project_button(api, world, actor) -> None:
    r = api.get("/api/py/projects", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
    else:
        assert r.json()["canCreate"] == (spec.ROLE[actor] in ("project_manager", "superadmin"))


# ------------------------------------------------------------------ the dashboard


def dashboard(actor: str) -> int:
    if actor == "inactive":
        return 403
    return 200 if spec.ROLE[actor] in ("project_manager", "superadmin") else 403


@pytest.mark.parametrize("period", ["30d", "90d", "12m", "all"])
@pytest.mark.parametrize("actor", spec.ACTORS)
def test_dashboard(api, world, actor, period) -> None:
    r = api.get(f"/api/py/analytics?period={period}", headers=world.h(actor))
    assert r.status_code == dashboard(actor), r.text
    if r.status_code != 200:
        return
    seen = set(r.json()["projects"])
    for state in spec.STATE_KEYS:
        # Exactly the projects they'd see in the Projects list.
        assert (str(world.pid[state]) in seen) == (spec.sees(actor, state) == 200)


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_only_a_superadmin_narrows_the_dashboard_to_one_pm(api, world, actor) -> None:
    r = api.get(f"/api/py/analytics?pm={world.uid('pm')}", headers=world.h(actor))
    expect = dashboard(actor)
    if expect == 200 and actor != "sa":
        expect = 403
    assert r.status_code == expect, r.text
    if expect == 200:
        assert {str(world.pid[s]) for s in spec.STATE_KEYS} <= set(r.json()["projects"])
