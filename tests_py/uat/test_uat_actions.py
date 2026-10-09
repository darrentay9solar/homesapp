"""UAT · every button on a project, pressed by every person, at every stage.

The brief's approval flow (homeowner, then a project manager), reminders,
reopening a milestone, the handover (the homeowner signs; a project manager
closes), editing details, scheduling site visits and checking in.

A press that should be refused is tried on the shared world project (nothing
changes). A press that should work and changes the project is tried on a
fresh project at the same stage, and the test checks where it ends up.
"""

from __future__ import annotations

import base64
from datetime import date, timedelta

import pytest

from uat import spec
from uat import world as world_mod

pytestmark = pytest.mark.uat

STALE_SIGN = {
    "fingerprint": "0" * 64,
    "signerName": "UAT Ho",
    "signature": "data:image/jpeg;base64," + base64.b64encode(world_mod.SIGNATURE).decode(),
    "agree": True,
}

# name, method, path, body, expected status from the spec, status after a success
ACTIONS = {
    "approve": ("post", "approve", None, spec.approve),
    "decline": ("post", "decline", {"reason": "UAT: not now"}, spec.decline),
    "remind": ("post", "remind", None, spec.remind),
    "reopen_1": ("post", "milestones/1/reopen", None, lambda a, s: spec.reopen(a, s, 1)),
    "reopen_2": ("post", "milestones/2/reopen", None, lambda a, s: spec.reopen(a, s, 2)),
    "reopen_3": ("post", "milestones/3/reopen", None, lambda a, s: spec.reopen(a, s, 3)),
    "handover_request": ("post", "handover/request", None, spec.handover_request),
    "handover_remind": ("post", "handover/remind", None, spec.handover_remind),
    "sign_stale": ("post", "handover/sign", STALE_SIGN, spec.sign_with_stale_fingerprint),
    "close": ("post", "close", None, spec.close),
    "edit_details": ("patch", "", "details", spec.edit_details),
}
# Successes that change the project: run on a project of their own.
MUTATES = {"approve", "decline", "remind", "reopen_1", "reopen_2", "reopen_3", "close", "edit_details"}

GRID = [(a, s, n) for n in ACTIONS for a in spec.ACTORS for s in spec.STATE_KEYS]


def _details(world, pid: int) -> dict:
    p = world.conn.execute("select * from projects where project_id = %s", (pid,)).fetchone()
    return {
        "name": p["name"],
        "postalCode": p["postal_code"],
        "address": p["address"],
        "homeownerId": p["homeowner_id"],
        "homeownerName": p["homeowner_name"] or "",
        "contactNo": p["homeowner_contact_no"],
        "contractor": {"type": "group", "groupId": p["contractor_group_id"]},
        "startDate": p["installation_start_date"].isoformat(),
        "endDate": p["target_end_date"].isoformat(),
    }


def after(name: str, actor: str, state: str) -> str:
    """Where a successful press leaves the project."""
    rel = spec.relation(actor, state)
    s = spec.STATUS[state]
    return {
        "approve": "homeowner_approved" if rel == "homeowner" else "pm_approved",
        "decline": "homeowner_declined",
        "remind": "awaiting_homeowner",
        "close": "closed",
        "reopen_1": "in_progress" if s == "awaiting_signature" else s,
        "reopen_2": "in_progress" if s == "awaiting_signature" else s,
        "reopen_3": "in_progress" if s == "awaiting_signature" else s,
        "edit_details": s,
    }.get(name, s)


@pytest.mark.parametrize(("actor", "state", "name"), GRID, ids=[f"{n}-{a}-{s}" for a, s, n in GRID])
def test_press(api, world, actor, state, name) -> None:
    method, path, body, rule = ACTIONS[name]
    expect = rule(actor, state)
    fresh = expect == 200 and name in MUTATES
    pid = world.project(state, name=f"UAT fresh {name}") if fresh else world.pid[state]
    json = _details(world, pid) if body == "details" else body
    url = f"/api/py/projects/{pid}" + (f"/{path}" if path else "")
    r = getattr(api, method)(url, headers=world.h(actor), **({"json": json} if json is not None else {}))
    assert r.status_code == expect, r.text
    if fresh:
        assert world.status(pid) == after(name, actor, state)
        if name.startswith("reopen_"):
            n = int(name[-1])
            left = (
                world.conn.execute(
                    "select array_agg(milestone_no order by milestone_no) as m from project_milestones where project_id = %s",
                    (pid,),
                ).fetchone()["m"]
                or []
            )
            assert left == list(range(1, n)), "the milestone and every one after it are reopened"
    else:
        assert world.status(pid) == spec.STATUS[state], "a refused press changes nothing"


# --------------------------------------------------- visits and check-ins

VISIT_GRID = [(a, s) for a in spec.ACTORS for s in spec.STATE_KEYS]


@pytest.mark.parametrize(("actor", "state"), VISIT_GRID, ids=[f"{a}-{s}" for a, s in VISIT_GRID])
def test_schedule_a_visit(api, world, actor, state) -> None:
    pid = world.pid[state]
    day = (date.today() + timedelta(days=30)).isoformat()
    r = api.post(
        f"/api/py/projects/{pid}/visits", headers=world.h(actor), json={"date": day, "time": "09:00", "note": "UAT"}
    )
    assert r.status_code == spec.schedule_visit(actor, state), r.text
    if r.status_code == 200:
        # And it can be cancelled again, by the same people.
        gone = api.delete(f"/api/py/projects/{pid}/visits/{r.json()['id']}", headers=world.h(actor))
        assert gone.status_code == 200, gone.text


@pytest.mark.parametrize(("actor", "state"), VISIT_GRID, ids=[f"{a}-{s}" for a, s in VISIT_GRID])
def test_check_in(api, world, actor, state) -> None:
    pid = world.pid[state]
    r = api.post(f"/api/py/projects/{pid}/check-ins", headers=world.h(actor), json={**world_mod.NEAR, "crew": 3})
    assert r.status_code == spec.check_in(actor, state), r.text
    if r.status_code == 200:
        cid = world.conn.execute(
            "select check_in_id from site_check_ins where project_id = %s and user_id = %s and checked_out_at is null",
            (pid, world.uid(actor)),
        ).fetchone()["check_in_id"]
        again = api.post(
            f"/api/py/projects/{pid}/check-ins", headers=world.h(actor), json={**world_mod.NEAR, "crew": 3}
        )
        assert again.status_code == 409, "one open check-in per person per site"
        out = api.post(f"/api/py/check-ins/{cid}/check-out", headers=world.h(actor), json={**world_mod.NEAR, "crew": 0})
        assert out.status_code == 200, out.text


@pytest.mark.parametrize("actor", [a for a in spec.ACTORS if a not in ("crew_epc", "inactive")])
def test_only_the_person_who_checked_in_checks_out(api, world, actor) -> None:
    pid = world.pid["in_progress_m1"]
    r = api.post(f"/api/py/projects/{pid}/check-ins", headers=world.h("crew_epc"), json={**world_mod.NEAR, "crew": 2})
    assert r.status_code == 200, r.text
    cid = world.conn.execute(
        "select check_in_id from site_check_ins where project_id = %s and user_id = %s and checked_out_at is null",
        (pid, world.uid("crew_epc")),
    ).fetchone()["check_in_id"]
    try:
        other = api.post(
            f"/api/py/check-ins/{cid}/check-out", headers=world.h(actor), json={**world_mod.NEAR, "crew": 0}
        )
        assert other.status_code == 404
    finally:
        mine = api.post(
            f"/api/py/check-ins/{cid}/check-out", headers=world.h("crew_epc"), json={**world_mod.NEAR, "crew": 0}
        )
        assert mine.status_code == 200


@pytest.mark.parametrize("metres", [150, 300, 1000, 5000, 20000])
def test_a_check_in_away_from_the_house_is_refused(api, world, metres) -> None:
    pid = world.pid["in_progress_m1"]
    far = {"lat": world_mod.SITE[0] + metres / 111_195, "lng": world_mod.SITE[1], "accuracy": 10.0, "crew": 2}
    r = api.post(f"/api/py/projects/{pid}/check-ins", headers=world.h("assigned_epc"), json=far)
    assert r.status_code == 400 and r.json()["error"].startswith("You're not at the check-in location"), r.text
