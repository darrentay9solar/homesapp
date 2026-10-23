# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · maintenance the project manager starts (migration 0057), person by person, written from the brief:

start      the system's manager (any manager while nobody runs it, a superadmin) starts it, for a yearly
           check or other work; Admin only looks; another manager's system isn't found; crew, homeowners
           and anyone switched off can't; one at a time; the 6-month record has no workflow
finish     the same people finish it: done records its check, called off leaves it; the homeowner hears
homeowner  told when it starts and ends (never which check); their project's Maintenance tab shows no
           schedule, nothing due and no office notes; no reminders; the assistant knows no check dates
six-month  an office record: recorded by those who edit, never due, late or next
audit      starting and finishing are in the audit log under who did it
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

import pytest

from _lib import assistant
from _lib import checks as yearly
from _lib import maintenance_reminders as reminders
from uat import spec

pytestmark = pytest.mark.uat

KINDS = ["pm", "pm2", "none"]
GRID = [(a, k) for a in spec.ACTORS for k in KINDS]
IDS = [f"{a}-{k}" for a, k in GRID]
# Who acts for a system to set things up: its manager, or a manager while nobody runs it.
SETUP = {"pm": "pm", "pm2": "pm2", "none": "pm"}


@pytest.fixture(scope="module")
def system(world) -> Any:
    """A fresh system per test, turned on 25 months ago on a 5-year plan, so its year-2 check is overdue."""
    c = world.conn
    n = iter(range(10_000, 99_999))

    def make(owner: str, homeowner: str | None = None) -> int:
        # One system per homeowner (migration 0043): each gets a homeowner of their own, under that key.
        if homeowner:
            world.homeowner(homeowner)
        return c.execute(
            "insert into maintenance_systems (import_ref, address, postal_code, run_by, homeowner_id, panels, "
            "turned_on_on, plan_years) values (%s, %s, '358791', %s, %s, %s, %s, 5) returning system_id",
            (
                f"uat-{world.tag}-job#{next(n)}", f"{next(n)} UAT Job Road {world.tag}",
                world.uid(owner) if owner != "none" else None, world.uid(homeowner) if homeowner else None,
                json.dumps([{"count": 20, "wp": 620}]), yearly.add_months(date.today(), -25),
            ),
        ).fetchone()["system_id"]  # fmt: skip

    return make


def _start(api, world, sid: int, who: str, **body: Any):
    return api.post(f"/api/py/maintenance/{sid}/jobs", headers=world.h(who), json=body)


def _told(world, actor: str, kind: str, sid: int) -> list[dict]:
    """What ``actor`` was told about system ``sid`` (its address ends each title)."""
    return world.conn.execute(
        "select n.title, n.body, n.link from notifications n, maintenance_systems m where m.system_id = %s "
        "and n.recipient_uid = %s and n.kind = %s and n.title like '%%· ' || m.address",
        (sid, world.uid(actor), kind),
    ).fetchall()


# ------------------------------------------------------------------- start


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_who_starts_maintenance(api, world, system, actor, kind) -> None:
    sid = system(kind)
    r = _start(api, world, sid, actor, checkKey="year_2", note=f"Started by {actor}")
    assert r.status_code == spec.starts_maintenance(actor, kind), r.text
    if r.status_code == 200:
        m = r.json()["maintenance"]
        assert m["status"] == "started" and m["checkKey"] == "year_2" and m["note"] == f"Started by {actor}"
        # One at a time.
        assert _start(api, world, sid, actor).status_code == 409


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_who_starts_other_maintenance(api, world, system, actor, kind) -> None:
    r = _start(api, world, system(kind), actor)
    assert r.status_code == spec.starts_maintenance(actor, kind), r.text
    if r.status_code == 200:
        assert r.json()["maintenance"]["checkKey"] is None


@pytest.mark.parametrize("check", ["six_month", "year_1", "year_7", "year_x", ""])
def test_only_the_plans_yearly_checks_have_a_workflow(api, world, system, check) -> None:
    # A 5-year plan: years 2 to 5 (year 1 is the installer's); the 6-month check is a record only.
    assert _start(api, world, system("pm"), "pm", checkKey=check).status_code == 400


@pytest.mark.parametrize("check", ["year_2", "year_3", "year_4", "year_5"])
def test_each_of_the_plans_checks_can_be_started(api, world, system, check) -> None:
    assert _start(api, world, system("pm"), "pm", checkKey=check).status_code == 200


# ------------------------------------------------------------------ finish


@pytest.mark.parametrize("outcome", ["done", "cancelled"])
@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_who_finishes_maintenance(api, world, system, actor, kind, outcome) -> None:
    sid = system(kind)
    job = _start(api, world, sid, SETUP[kind], checkKey="year_2").json()["maintenance"]
    r = api.post(
        f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish", headers=world.h(actor), json={"outcome": outcome}
    )
    assert r.status_code == spec.starts_maintenance(actor, kind), r.text
    if r.status_code == 200:
        year2 = next(c for c in r.json()["system"]["checks"] if c["key"] == "year_2")
        assert r.json()["maintenance"] is None
        assert year2["state"] == ("done" if outcome == "done" else "overdue")


@pytest.mark.parametrize("bad", [{"outcome": "finished"}, {"outcome": ""}, {}])
def test_a_bad_outcome_is_refused(api, world, system, bad) -> None:
    sid = system("pm")
    job = _start(api, world, sid, "pm").json()["maintenance"]
    assert (
        api.post(f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish", headers=world.h("pm"), json=bad).status_code
        == 422
    )
    assert api.get(f"/api/py/maintenance/{sid}", headers=world.h("pm")).json()["maintenance"]["status"] == "started"


def test_finishing_needs_the_open_one(api, world, system) -> None:
    sid = system("pm")
    job = _start(api, world, sid, "pm").json()["maintenance"]
    path = f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish"
    assert api.post(path, headers=world.h("pm"), json={"outcome": "done"}).status_code == 200
    assert api.post(path, headers=world.h("pm"), json={"outcome": "done"}).status_code == 404, "already finished"
    assert (
        api.post(
            f"/api/py/maintenance/{sid}/jobs/999999999/finish", headers=world.h("pm"), json={"outcome": "done"}
        ).status_code
        == 404
    )


# --------------------------------------------------------------- homeowner


def test_the_homeowner_hears_when_it_starts_and_ends_and_no_one_else_does(api, world, system) -> None:
    sid = system("pm", homeowner="ho@job@told")
    job = _start(api, world, sid, "pm", checkKey="year_2", note="Inverter fan").json()["maintenance"]
    for actor in [*spec.ACTORS, "ho@job@told"]:
        got = _told(world, actor, "maintenance_started", sid)
        if actor == "ho@job@told":
            assert len(got) == 1 and "year" not in (got[0]["title"] + got[0]["body"]).lower(), "never which check"
        else:
            assert got == [], actor
    api.post(f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish", headers=world.h("pm"), json={"outcome": "done"})
    for actor in [*spec.ACTORS, "ho@job@told"]:
        done = [g["title"].split(" · ")[0] for g in _told(world, actor, "maintenance_done", sid)]
        assert done == (["Maintenance done"] if actor == "ho@job@told" else []), actor


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_the_projects_maintenance_tab_by_person(api, world, actor) -> None:
    pid = world.pid["closed"]
    sid = world.conn.execute("select system_id from maintenance_systems where project_id = %s", (pid,)).fetchone()[
        "system_id"
    ]
    world.conn.execute("update maintenance_systems set plan_years = 5 where system_id = %s", (sid,))
    r = api.get(f"/api/py/projects/{pid}/maintenance", headers=world.h(actor, pid))
    if actor == "inactive":
        assert r.status_code == 403
        return
    # Its manager and superadmins; the project's own homeowner; nobody else (Admin works from Solar and Payments).
    assert r.status_code == (200 if actor in ("sa", "pm", "ho") else 404), r.text
    if r.status_code != 200:
        return
    d = r.json()
    if actor == "ho":
        s = d["system"]
        assert s["checks"] == [] and s["next"] is None and s["attention"] is False and s["notes"] is None
        assert d["canStart"] is d["canBook"] is d["canEdit"] is False and "lastMaintained" in d
    else:
        assert d["system"]["checks"][0]["key"] == "six_month" and d["canStart"] is True


def test_reminders_go_to_the_office_not_the_homeowner(world, system) -> None:
    sid = system("pm", homeowner="ho@job@reminded")
    reminders.run()
    rows = world.conn.execute(
        "select recipient_uid from notifications where kind = 'maintenance_due' and link = %s", (f"/maintenance/{sid}",)
    ).fetchall()
    assert {r["recipient_uid"] for r in rows} == {world.uid("pm")}


def test_the_assistant_knows_no_check_dates(world) -> None:
    pid = world.pid["closed"]
    facts = " ".join(assistant.project_facts(pid)).lower()
    assert "arranged by their project manager" in facts
    for word in ("year 2", "year_2", "6-month", "six_month", "due", "overdue"):
        assert word not in facts, word


# --------------------------------------------------------------- six-month


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_the_six_month_record_by_person(api, world, system, actor, kind) -> None:
    sid = system(kind)
    seen = api.get(f"/api/py/maintenance/{sid}", headers=world.h(actor))
    assert seen.status_code == spec.maintenance_sees(actor, kind)
    if seen.status_code == 200:
        s = seen.json()["system"]
        assert s["checks"][0]["key"] == "six_month" and s["checks"][0]["state"] == "record"
        assert s["next"] is None or s["next"]["key"] != "six_month"
    r = api.post(
        f"/api/py/maintenance/{sid}/checks/six_month", headers=world.h(actor), json={"doneOn": date.today().isoformat()}
    )
    assert r.status_code == spec.maintenance_edit(actor, kind), r.text
    if r.status_code == 200:
        assert r.json()["system"]["checks"][0]["state"] == "done"


# ------------------------------------------------------------------- audit


@pytest.mark.parametrize("who", ["pm", "sa"])
def test_starting_and_finishing_are_in_the_audit_log(api, world, system, who) -> None:
    sid = system("pm")
    job = _start(api, world, sid, who, checkKey="year_2").json()["maintenance"]
    api.post(f"/api/py/maintenance/{sid}/jobs/{job['id']}/finish", headers=world.h(who), json={"outcome": "cancelled"})
    a = world.conn.execute(
        "select action, actor_uid from audit_log where entity_table = 'maintenance_jobs' and entity_id = %s order by audit_id",
        (str(job["id"]),),
    ).fetchall()
    assert [x["action"] for x in a] == ["insert", "update"] and {x["actor_uid"] for x in a} == {world.uid(who)}
