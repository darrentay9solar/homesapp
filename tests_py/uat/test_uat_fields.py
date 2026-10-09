"""UAT · every milestone field: who may fill it in, and when.

The brief: milestone fields open once the homeowner and a project manager
have approved; Milestone 2 opens once Milestone 1 is complete, and Milestone 3
once Milestone 2 is; a completed milestone is fixed for the crew (a project
manager can still correct it or reopen it); the homeowner only reads; and at
handover everything becomes the signed record.

Each test is one field, one person, one stage: first what the screen says
(the lock and its reason), then what happens when they actually try to save.
"""

from __future__ import annotations

import pytest

from uat import spec

pytestmark = pytest.mark.uat

VIEWERS = [(a, s) for a in spec.ACTORS for s in spec.STATE_KEYS if spec.sees(a, s) == 200]
FIELD_GRID = [(a, s, f) for a, s in VIEWERS for f in spec.FIELDS]
SECTION_GRID = [(a, s, sec) for a, s in VIEWERS for sec in spec.SECTIONS]
SAVABLE = [f for f in spec.FIELDS if f.kind not in spec.FILE_KINDS]
SAVE_GRID = [(a, s, f) for a in spec.ACTORS for s in spec.STATE_KEYS for f in SAVABLE]
OPTIONAL_UNSET = {
    "moc_change",
    "panel_quantity_actual",
    "meter_replacement_date",
    "retailer_contract_end_date",
    "inverter_date",
    "commission_date",
    "rcb_breaker_replacement_date",
    "sp_pending_days",
}


def _field(body: dict, key: str) -> dict:
    return next(f for sec in body["sections"] for f in sec["fields"] if f["key"] == key)


@pytest.mark.parametrize(("actor", "state", "f"), FIELD_GRID, ids=[f"{a}-{s}-{f.key}" for a, s, f in FIELD_GRID])
def test_field_lock(cached, actor, state, f) -> None:
    _, body = cached.get("/api/py/projects/{pid}/fields", actor, state)
    got = _field(body, f.key)["lockedReason"]
    assert got == spec.field_lock(spec.relation(actor, state), state, f)


@pytest.mark.parametrize(
    ("actor", "state", "section"), SECTION_GRID, ids=[f"{a}-{s}-{sec}" for a, s, sec in SECTION_GRID]
)
def test_section_lock(cached, actor, state, section) -> None:
    _, body = cached.get("/api/py/projects/{pid}/fields", actor, state)
    sec = next(x for x in body["sections"] if x["key"] == section)
    assert sec["lockedReason"] == spec.section_lock(state, section)
    assert sec["milestone"] == spec.SECTION_MILESTONE[section]


@pytest.mark.parametrize(
    ("state", "section"),
    [(s, sec) for s in spec.STATE_KEYS for sec in spec.SECTIONS],
    ids=[f"{s}-{sec}" for s in spec.STATE_KEYS for sec in spec.SECTIONS],
)
def test_section_complete(cached, state, section) -> None:
    _, body = cached.get("/api/py/projects/{pid}/fields", "pm", state)
    sec = next(x for x in body["sections"] if x["key"] == section)
    assert sec["complete"] == spec.section_complete(state, section), (sec["done"], sec["total"])


def _filled(state: str, f: spec.F) -> bool:
    if f.key in OPTIONAL_UNSET:
        return False
    if f.key.startswith("homeowner."):
        return state != "draft"
    if f.key == "electricity_retailer_id":
        return spec.STATUS[state] in {"in_progress", *spec.AT_HANDOVER}
    if state == "in_progress_m0":
        return f.key in ("sp_application_status", "utility_bill")
    return spec.section_complete(state, f.group)


@pytest.mark.parametrize(
    ("state", "f"),
    [(s, f) for s in spec.STATE_KEYS for f in spec.FIELDS],
    ids=[f"{s}-{f.key}" for s in spec.STATE_KEYS for f in spec.FIELDS],
)
def test_field_filled(cached, state, f) -> None:
    _, body = cached.get("/api/py/projects/{pid}/fields", "pm", state)
    assert _field(body, f.key)["filled"] == _filled(state, f)


@pytest.mark.parametrize(
    ("actor", "state"),
    [(a, s) for a, s in VIEWERS],
    ids=[f"{a}-{s}" for a, s in VIEWERS],
)
def test_milestone_reached(cached, actor, state) -> None:
    _, body = cached.get("/api/py/projects/{pid}/fields", actor, state)
    assert body["milestoneReached"] == spec.RECORDED[state]
    assert body["recordedMilestones"] == list(range(1, spec.RECORDED[state] + 1))


@pytest.mark.parametrize(("actor", "state"), VIEWERS, ids=[f"{a}-{s}" for a, s in VIEWERS])
def test_buttons_on_the_page(cached, actor, state) -> None:
    """Approve, Decline, Remind, Edit and Reopen show for the person who can use them, and nobody else."""
    _, body = cached.get("/api/py/projects/{pid}/fields", actor, state)
    a = body["actions"]
    assert a["approve"] == (spec.approve(actor, state) == 200)
    assert a["decline"] == (spec.decline(actor, state) == 200)
    assert a["remind"] == (spec.remind(actor, state) == 200)
    assert a["editDetails"] == (spec.edit_details(actor, state) == 200)
    assert a["reopen"] == [n for n in (1, 2, 3) if spec.reopen(actor, state, n) == 200]


# ------------------------------------------------------------- saving


def _current(cached, state: str, f: spec.F):
    """The value already there, so a permitted save changes nothing."""
    _, body = cached.get("/api/py/projects/{pid}/fields", "pm", state)
    v = _field(body, f.key)["value"]
    if f.kind == "retailer":
        return v["id"] if v else None
    if f.key == "homeowner.ic_last4":
        return "567D" if v else ""
    return v


def save_expect(actor: str, state: str, f: spec.F) -> int:
    rel = spec.relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    if f.kind == "auto" or f.kind in spec.FILE_KINDS:
        return 400 if f.kind in spec.FILE_KINDS else 403
    return 403 if spec.field_lock(rel, state, f) else 200


@pytest.mark.parametrize(("actor", "state", "f"), SAVE_GRID, ids=[f"{a}-{s}-{f.key}" for a, s, f in SAVE_GRID])
def test_save(api, world, cached, actor, state, f) -> None:
    pid = world.pid[state]
    value = _current(cached, state, f) if spec.sees("pm", state) == 200 else f.sample
    expect = save_expect(actor, state, f)
    r = api.patch(f"/api/py/projects/{pid}/fields", headers=world.h(actor), json={"key": f.key, "value": value})
    assert r.status_code == expect, r.text
    if expect == 200 and spec.STATUS[state] == "pm_approved":
        # The brief: the first piece of work starts an approved project.
        assert world.status(pid) == "in_progress"
        world.conn.execute("update projects set status = 'pm_approved' where project_id = %s", (pid,))
    else:
        assert world.status(pid) == spec.STATUS[state], "a save never moves the project on by itself here"
