"""UAT · the 19 Oct 2026 review: every person against the rules it set (spec.py).

timing      a homeowner never sees on time, late or a no-show, on any project at any stage
meetings    a homeowner doesn't arrange a meeting (they block out time and answer); everyone else may
library     My Files is a shared drive: a project's files are everyone's who sees the project
unassigned  files with no project yet are staff's alone
tables      any list downloads as its table shows it, by who may download that list
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from uat import spec

pytestmark = pytest.mark.uat
SG = ZoneInfo("Asia/Singapore")
SEEN = [(a, s) for a in spec.ACTORS for s in spec.STATE_KEYS]


@pytest.mark.parametrize(("actor", "state"), SEEN, ids=[f"{a}-{s}" for a, s in SEEN])
def test_timing_verdicts(api, world, actor, state) -> None:
    pid = world.pid[state]
    r = api.get(f"/api/py/projects/{pid}", headers=world.h(actor, pid))
    assert r.status_code == spec.sees(actor, state), r.text
    if r.status_code == 200 and not spec.sees_timing(actor):
        p = r.json()
        assert p["flags"] == [] and p["attention"] is False, "no timing verdict for a homeowner"


@pytest.mark.parametrize("actor", [a for a in spec.ACTORS if a != "inactive"])
def test_who_arranges_a_meeting(api, world, actor) -> None:
    pid = world.pid["in_progress_m1"]
    contacts = api.get("/api/py/calendar/contacts", headers=world.h(actor, pid)).json().get("people", [])
    other = next((c["uid"] for c in contacts if c["uid"] != world.uid(actor, pid)), None)
    # Each person on a day of their own, far ahead, so nobody is busy then.
    day = datetime(2031, 3, 3, 9, tzinfo=SG) + timedelta(days=spec.ACTORS.index(actor))
    body = {"title": "UAT review", "people": [other] if other else [], "startsAt": day.strftime("%Y-%m-%dT%H:%M"),
            "endsAt": (day + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"), "place": "online"}  # fmt: skip
    r = api.post("/api/py/meetings", headers=world.h(actor, pid), json=body)
    if not spec.arranges_meetings(actor):
        assert r.status_code == 403 and "arranges meetings" in r.json()["error"]
    else:
        assert r.status_code != 403 or other is None, r.text
        if r.status_code == 200:
            world.conn.execute("delete from meetings where meeting_id = %s", (r.json()["meeting"]["id"],))


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_the_library_is_everyone_on_the_project(api, world, actor) -> None:
    r = api.get("/api/py/library", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
        return
    assert r.status_code == 200, r.text
    lib = r.json()
    on = {p["id"] for p in lib["projects"]}
    for state in spec.STATE_KEYS:
        pid = world.pid[state]
        # "ho" is each project's own homeowner: ask as that one.
        mine = api.get("/api/py/library", headers=world.h(actor, pid)).json() if actor == "ho" else lib
        ids = {p["id"] for p in mine["projects"]}
        assert (pid in ids) is spec.in_library(actor, state), state
        has = world.conn.execute("select count(*) as n from project_files where project_id = %s", (pid,)).fetchone()["n"]
        shown = sum(1 for f in mine["files"] if f["projectId"] == pid)
        assert shown == (has if spec.in_library(actor, state) else 0), state
    assert (lib["unassigned"] is not None) is (spec.keeps_unassigned(actor) == 200)
    assert on == {p["id"] for p in lib["projects"]}


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_keeps_files_with_no_project(api, world, actor) -> None:
    r = api.post("/api/py/unassigned-files/upload-link", headers=world.h(actor), json={"contentType": "application/pdf", "size": 1200, "fileName": "x.pdf"})
    assert r.status_code == spec.keeps_unassigned(actor), r.text


TABLES = [(a, w) for a in spec.ACTORS for w in spec.TABLE_EXPORTS]


@pytest.mark.parametrize(("actor", "what"), TABLES, ids=[f"{a}-{w}" for a, w in TABLES])
def test_who_downloads_a_table(api, world, actor, what) -> None:
    r = api.post("/api/py/export/table.xlsx", headers=world.h(actor), json={"what": what, "title": "UAT", "head": ["A", "B"], "rows": [["x", 1]]})
    assert r.status_code == spec.table_export(actor, what), r.text
    if r.status_code == 200:
        last = world.conn.execute(
            "select what, row_count from data_exports where exported_by = %s order by export_id desc limit 1", (world.uid(actor),)
        ).fetchone()
        assert last == {"what": what, "row_count": 1}
