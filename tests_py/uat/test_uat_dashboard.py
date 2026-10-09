"""UAT · the dashboard, figure by figure.

Two halves:

lab     Eight projects built for this test, run by their own project manager,
        each with a known history (created, approved, milestones, signed,
        closed, site visits, check-ins) spread over 400 days. A superadmin
        narrows the dashboard to that manager, so every figure has one right
        answer, worked out by hand below, for each period.

world   The shared UAT world (eleven people, eleven stages): for every person
        who may see the dashboard, at every period, each project lands in the
        right tile and stage, its drop-down list matches the Projects list, and
        the dashboard never counts a project its reader can't see.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from uat import spec
from uat import world as world_mod

pytestmark = pytest.mark.uat
SG = ZoneInfo("Asia/Singapore")
PERIODS = ["30d", "90d", "12m", "all"]

# key: state, created (days ago), target end (days from today), postal, retailer, sales, (panels, watts)
LAB = {
    "A": ("in_progress_m1", 5, -10, "569933", "SP Group", "Ann Tan · X1", (20, 610)),
    "B": ("in_progress_m0", 8, 5, "469000", "Geneco", "Ben Ong", (10, 500)),
    "C": ("closed", 45, -5, "609000", "Geneco", "Ann Tan · Y", (24, 610)),
    "D": ("closed", 200, -110, "738099", "SP Group", None, (16, 580)),
    "E": ("awaiting_homeowner", 0, 30, "018956", None, None, None),
    "F": ("homeowner_declined", 20, 30, "828768", None, None, None),
    "G": ("awaiting_signature", 60, 10, "289000", "SP Group", "Ann Tan", (20, 610)),
    "H": ("draft", 400, -300, "520000", None, None, None),
}
# When each happened, in days after the project was created.
APPROVED, PM_OK = 1, 2
MILESTONES = {"A": {1: 4}, "C": {1: 10, 2: 20, 3: 30}, "D": {1: 10, 2: 20, 3: 30}, "G": {1: 10, 2: 20, 3: 30}}
SIGNED = {"C": 32, "D": 32}
CLOSED = {"C": 35, "D": 100}


@pytest.fixture(scope="module")
def lab(world) -> dict[str, Any]:
    c = world.conn
    now = datetime.now(SG).replace(microsecond=0)
    today = now.date()
    world.people["lab_pm"] = world.person("lab_pm", "project_manager", name="UAT Lab PM")
    retailer = {
        n: c.execute(
            "insert into electricity_retailers (name) values (%s) on conflict (name) do update set name = excluded.name "
            "returning retailer_id",
            (n,),
        ).fetchone()["retailer_id"]
        for n in ("SP Group", "Geneco")
    }
    pid: dict[str, int] = {}
    created: dict[str, datetime] = {}
    for key, (state, ago, target, postal, ret, sales, kit) in LAB.items():
        p = world.project(state, name=f"UAT lab {key}", manager="lab_pm")
        pid[key] = p
        created[key] = now - timedelta(days=ago)
        c.execute(
            "update projects set created_at = %s, installation_start_date = %s, target_end_date = %s, postal_code = %s, "
            "electricity_retailer_id = %s, "
            "sales = %s, panel_quantity_actual = %s, panel_quantity_estimate = %s, panel_capacity = %s "
            "where project_id = %s",
            (created[key], today + timedelta(days=target - 21), today + timedelta(days=target), postal, retailer.get(ret) if ret else None, sales,
             kit[0] if kit else None, kit[0] if kit else None, kit[1] if kit else None, p),
        )  # fmt: skip

        def audit(status: str, days: float, p: int = p, key: str = key) -> None:
            c.execute(
                "insert into audit_log (occurred_at, action, entity_table, entity_id, changes, project_id) "
                "values (%s, 'update', 'projects', %s, %s, %s)",
                (created[key] + timedelta(days=days), str(p), json.dumps({"status": {"to": status}}), p),
            )

        if key in ("A", "B", "C", "D", "G"):
            audit("homeowner_approved", APPROVED)
            audit("pm_approved", PM_OK)
        if key == "F":
            audit("homeowner_declined", 2)
        for n, d in MILESTONES.get(key, {}).items():
            c.execute(
                "update project_milestones set completed_at = %s where project_id = %s and milestone_no = %s",
                (created[key] + timedelta(days=d), p, n),
            )
        if key in SIGNED:
            c.execute(
                "update project_signatures set signed_at = %s where project_id = %s",
                (created[key] + timedelta(days=SIGNED[key]), p),
            )
        if key in CLOSED:
            c.execute(
                "update projects set closed_at = %s where project_id = %s",
                (created[key] + timedelta(days=CLOSED[key]), p),
            )

    # B's site work: a no-show yesterday, a check-in 90 minutes late three days ago, one visit next week.
    b = pid["B"]
    visits = {}
    for name, days in (("missed", -1), ("late", -3), ("next", 3)):
        visits[name] = c.execute(
            "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note, created_by) "
            "values (%s, %s, '09:00', 'UAT', %s) returning visit_id",
            (b, today + timedelta(days=days), world.uid("lab_pm")),
        ).fetchone()["visit_id"]
    arrived = datetime(today.year, today.month, today.day, 10, 30, tzinfo=SG) - timedelta(days=3)
    with c.transaction():
        c.execute("alter table site_check_ins disable trigger enforce_check_in_radius_insert")
        c.execute(
            "insert into site_check_ins (project_id, visit_id, user_id, checked_in_at, crew_in, lat, lng, distance_m, "
            "accuracy_m, checked_out_at, crew_out) values (%s, %s, %s, %s, 4, %s, %s, 12, 8, %s, 0)",
            (b, visits["late"], world.uid("crew_epc"), arrived, *world_mod.SITE, arrived + timedelta(hours=6)),
        )
        c.execute("alter table site_check_ins enable trigger enforce_check_in_radius_insert")
    return {"pid": pid, "created": created, "today": today, "arrived": arrived}


_LAB_VIEWS: dict[str, dict] = {}


class _Lazy(dict):
    """Fetched on first use, inside a test (where the test sign-in keys are in place), then kept."""

    def __init__(self, load: Any) -> None:
        super().__init__()
        self.load = load

    def __missing__(self, key: Any) -> Any:
        self[key] = value = self.load(key)
        return value


@pytest.fixture
def lab_view(api, world, lab) -> dict[str, dict]:
    """The dashboard narrowed to the lab's project manager, by a superadmin, for each period."""

    def load(p: str) -> dict:
        r = api.get(f"/api/py/analytics?period={p}&pm={world.uid('lab_pm')}", headers=world.h("sa"))
        assert r.status_code == 200, r.text
        return r.json()

    if "views" not in _LAB_VIEWS:
        _LAB_VIEWS["views"] = _Lazy(load)
    return _LAB_VIEWS["views"]


def ids(lab: dict, *keys: str) -> list[int]:
    return [lab["pid"][k] for k in keys]


# ================================================================== the lab

TILES = {
    # tile: {period: projects}
    "ongoing": dict.fromkeys(PERIODS, "AB"),
    "late": dict.fromkeys(PERIODS, "HA"),  # the latest first
    "noShow": dict.fromkeys(PERIODS, "B"),
    "awaitingHomeowner": dict.fromkeys(PERIODS, "EF"),
    "awaitingPm": dict.fromkeys(PERIODS, ""),
    "handover": dict.fromkeys(PERIODS, "G"),
    "new": {"30d": "ABEF", "90d": "ABCEFG", "12m": "ABCDEFG", "all": "ABCDEFGH"},
    "closed": {"30d": "C", "90d": "C", "12m": "CD", "all": "CD"},
}
TILE_GRID = [(t, p) for t in TILES for p in PERIODS]


@pytest.mark.parametrize(("tile", "period"), TILE_GRID, ids=[f"{t}-{p}" for t, p in TILE_GRID])
def test_lab_tile_and_its_drop_down(lab, lab_view, tile, period) -> None:
    got = lab_view[period]["tiles"][tile]
    want = ids(lab, *TILES[tile][period])
    if tile == "late":
        assert got["ids"] == want, "late projects, the latest first"
    else:
        assert sorted(got["ids"]) == sorted(want)
    assert got["count"] == len(want)


@pytest.mark.parametrize(
    ("tile", "period", "change"),
    [("new", "30d", 3.0), ("new", "90d", None), ("new", "12m", 6.0), ("new", "all", None),
     ("closed", "30d", None), ("closed", "90d", 0.0), ("closed", "12m", None), ("closed", "all", None)],
)  # fmt: skip
def test_lab_change_against_the_period_before(lab_view, tile, period, change) -> None:
    assert lab_view[period]["tiles"][tile]["delta"] == change


STAGE = {"A": "m2", "B": "m1", "C": "closed", "D": "closed", "E": "awaiting_homeowner", "F": "homeowner_declined",
         "G": "awaiting_signature", "H": "draft"}  # fmt: skip


@pytest.mark.parametrize("period", PERIODS)
@pytest.mark.parametrize("key", list(LAB))
def test_lab_pipeline_stage(lab, lab_view, period, key) -> None:
    stages = {s["key"]: s["ids"] for s in lab_view[period]["pipeline"]}
    assert lab["pid"][key] in stages[STAGE[key]]
    assert sum(len(v) for v in stages.values()) == len(LAB), "every project in exactly one stage"


@pytest.mark.parametrize(("period", "closed", "on_time", "rate"), [("30d", 1, 1, 1.0), ("90d", 1, 1, 1.0),
                                                                  ("12m", 2, 1, 0.5), ("all", 2, 1, 0.5)])  # fmt: skip
def test_lab_on_time_delivery(lab_view, period, closed, on_time, rate) -> None:
    assert lab_view[period]["onTime"] == {"closed": closed, "onTime": on_time, "rate": rate}


# stage: {period: (average days, projects)}
STAGES = {
    "homeowner": {"30d": (1.0, 2), "90d": (1.0, 4), "12m": (1.0, 5), "all": (1.0, 5)},
    "pm": {"30d": (1.0, 2), "90d": (1.0, 4), "12m": (1.0, 5), "all": (1.0, 5)},
    "m1": {"30d": (2.0, 1), "90d": (6.0, 3), "12m": (6.5, 4), "all": (6.5, 4)},
    "m2": {"30d": (10.0, 1), "90d": (10.0, 2), "12m": (10.0, 3), "all": (10.0, 3)},
    "m3": {"30d": (10.0, 1), "90d": (10.0, 2), "12m": (10.0, 3), "all": (10.0, 3)},
    "sign": {"30d": (2.0, 1), "90d": (2.0, 1), "12m": (2.0, 2), "all": (2.0, 2)},
    "close": {"30d": (3.0, 1), "90d": (3.0, 1), "12m": (35.5, 2), "all": (35.5, 2)},
}
STAGE_GRID = [(s, p) for s in STAGES for p in PERIODS]


@pytest.mark.parametrize(("stage", "period"), STAGE_GRID, ids=[f"{s}-{p}" for s, p in STAGE_GRID])
def test_lab_days_per_stage(lab_view, stage, period) -> None:
    got = next(s for s in lab_view[period]["delivery"]["stages"] if s["key"] == stage)
    assert (got["avgDays"], got["n"]) == STAGES[stage][period]


@pytest.mark.parametrize(
    ("period", "days", "n"), [("30d", 35.0, 1), ("90d", 35.0, 1), ("12m", 67.5, 2), ("all", 67.5, 2)]
)
def test_lab_project_length(lab_view, period, days, n) -> None:
    d = lab_view[period]["delivery"]
    assert (d["cycleDays"], d["cycleN"]) == (days, n)


@pytest.mark.parametrize("period", PERIODS)
def test_lab_how_late_and_due_soon(lab, lab_view, period) -> None:
    d = lab_view[period]["delivery"]
    bands = {a["label"]: a["ids"] for a in d["aging"]}
    assert bands == {"1–7 days": [], "8–14 days": ids(lab, "A"), "15–30 days": [], "Over 30 days": ids(lab, "H")}  # noqa: RUF001
    assert d["dueSoon"] == ids(lab, "B"), "ongoing, target within 14 days; G is at handover, so not counted"
    assert d["late"] == ids(lab, "H", "A")
    projects = lab_view[period]["projects"]
    assert projects[str(lab["pid"]["H"])]["daysLate"] == 300 and projects[str(lab["pid"]["A"])]["daysLate"] == 10


@pytest.mark.parametrize("period", PERIODS)
def test_lab_site_work(lab, lab_view, period) -> None:
    s = lab_view[period]["site"]
    assert {k: s[k] for k in ("visits", "attended", "missed", "attendance", "lateArrivals", "checkIns", "avgCrew", "upcoming")} == {
        "visits": 2, "attended": 1, "missed": 1, "attendance": 0.5, "lateArrivals": 1, "checkIns": 1, "avgCrew": 4.0,
        "upcoming": 1,
    }  # fmt: skip
    counts = s["heatmap"]["counts"]
    day = lab["arrived"].weekday()
    assert counts[day][s["heatmap"]["hours"].index(10)] == 1 and sum(map(sum, counts)) == 1


@pytest.mark.parametrize("period", PERIODS)
def test_lab_contractor_scorecard(world, lab_view, period) -> None:
    crews = lab_view[period]["site"]["crews"]
    assert len(crews) == 1
    c = crews[0]
    assert c["name"].startswith("UAT crew")
    assert {k: c[k] for k in ("projects", "ongoing", "late", "visits", "attended", "missed", "lateArrivals",
                              "attendance")} == {"projects": 8, "ongoing": 2, "late": 2, "visits": 2, "attended": 1,
                                                 "missed": 1, "lateArrivals": 1, "attendance": 0.5}  # fmt: skip


@pytest.mark.parametrize(("period", "installed", "count"), [("30d", 14.64, 1), ("90d", 14.64, 1), ("12m", 23.92, 2),
                                                            ("all", 23.92, 2)])  # fmt: skip
def test_lab_capacity(lab_view, period, installed, count) -> None:
    s = lab_view[period]["sales"]
    assert (s["installedKwp"], s["installedCount"]) == (installed, count)
    assert s["pipelineKwp"] == 29.4, "A 12.2 + B 5.0 + G 12.2, not yet closed"
    assert s["avgKwp"] == 10.7, "(12.2 + 5.0 + 14.64 + 9.28 + 12.2) / 5"


@pytest.mark.parametrize(("period", "approved", "declined", "rate"), [("30d", 2, 1, 0.667), ("90d", 4, 1, 0.8),
                                                                      ("12m", 5, 1, 0.833), ("all", 5, 1, 0.833)])  # fmt: skip
def test_lab_homeowner_approval(lab_view, period, approved, declined, rate) -> None:
    a = lab_view[period]["sales"]["approval"]
    assert a == {"approved": approved, "declined": declined, "rate": rate, "avgDays": 1.0}


GROUPS = {
    "byRegion": {
        "30d": {"North-East": 2, "East": 1, "Central": 1},
        "90d": {"North-East": 2, "East": 1, "Central": 2, "West": 1},
        "12m": {"North-East": 2, "East": 1, "Central": 2, "West": 1, "North": 1},
        "all": {"North-East": 2, "East": 2, "Central": 2, "West": 1, "North": 1},
    },
    "byRetailer": {
        "30d": {"SP Group": 1, "Geneco": 1, "Not recorded": 2},
        "90d": {"SP Group": 2, "Geneco": 2, "Not recorded": 2},
        "12m": {"SP Group": 3, "Geneco": 2, "Not recorded": 2},
        "all": {"SP Group": 3, "Geneco": 2, "Not recorded": 3},
    },
    "bySales": {
        "30d": {"Ann Tan": 1, "Ben Ong": 1, "Not recorded": 2},
        "90d": {"Ann Tan": 3, "Ben Ong": 1, "Not recorded": 2},
        "12m": {"Ann Tan": 3, "Ben Ong": 1, "Not recorded": 3},
        "all": {"Ann Tan": 3, "Ben Ong": 1, "Not recorded": 4},
    },
}
GROUP_GRID = [(g, p) for g in GROUPS for p in PERIODS]


@pytest.mark.parametrize(("group", "period"), GROUP_GRID, ids=[f"{g}-{p}" for g, p in GROUP_GRID])
def test_lab_sales_breakdowns(lab_view, group, period) -> None:
    rows = lab_view[period]["sales"][group]
    assert {r["label"]: r["count"] for r in rows} == GROUPS[group][period]
    counts = [r["count"] for r in rows]
    assert counts == sorted(counts, reverse=True), "biggest first"


def test_lab_capacity_by_salesperson(lab_view) -> None:
    ann = next(r for r in lab_view["all"]["sales"]["bySales"] if r["label"] == "Ann Tan")
    assert ann["kwp"] == 39.04 and ann["closed"] == 1, "A 12.2 + C 14.64 + G 12.2; C is closed"


@pytest.mark.parametrize(
    ("period", "closed", "on_time"), [("30d", 1, 1.0), ("90d", 1, 1.0), ("12m", 2, 0.5), ("all", 2, 0.5)]
)
def test_lab_project_manager_row(world, lab_view, period, closed, on_time) -> None:
    assert lab_view[period]["team"] == [
        {"uid": world.uid("lab_pm"), "name": "UAT Lab PM", "projects": 8, "ongoing": 2, "late": 2, "closed": closed,
         "onTime": on_time},
    ]  # fmt: skip


def _bucket(period: str, d) -> str | None:
    """Which trend column a date falls in, worked out independently of the app."""
    from datetime import date as _d

    today = datetime.now(SG).date()
    if period in ("30d", "90d"):
        monday = today - timedelta(days=today.weekday())
        weeks = 5 if period == "30d" else 13
        start = d - timedelta(days=d.weekday())
        return start.isoformat() if monday - timedelta(weeks=weeks - 1) <= start <= monday else None
    first = _d(today.year, today.month, 1)
    for _ in range(11):
        first = _d(first.year - (first.month == 1), (first.month - 2) % 12 + 1, 1)
    return f"{d:%Y-%m}" if d >= first else None


@pytest.mark.parametrize("period", PERIODS)
def test_lab_started_and_finished_columns(lab, lab_view, period) -> None:
    started: dict[str, int] = {}
    finished: dict[str, int] = {}
    for key in LAB:
        b = _bucket(period, lab["created"][key].date())
        if b:
            started[b] = started.get(b, 0) + 1
        if key in CLOSED:
            b = _bucket(period, (lab["created"][key] + timedelta(days=CLOSED[key])).date())
            if b:
                finished[b] = finished.get(b, 0) + 1
    trend = lab_view[period]["trend"]
    assert {t["label"]: t["started"] for t in trend if t["started"]} == started
    assert {t["label"]: t["closed"] for t in trend if t["closed"]} == finished
    assert len(trend) == {"30d": 5, "90d": 13, "12m": 12, "all": 12}[period]
    new = lab_view[period]["sales"]["trend"]
    assert [t["count"] for t in new] == [t["started"] for t in trend], "Sales' new projects match Overview's started"


@pytest.mark.parametrize("period", PERIODS)
def test_lab_drop_down_lists_read_like_the_projects_list(api, world, lab, lab_view, period) -> None:
    listed = {p["id"]: p for p in api.get("/api/py/projects", headers=world.h("sa")).json()["projects"]}
    for key, p in lab["pid"].items():
        mini = lab_view[period]["projects"][str(p)]
        # Handed over, a project is on the Maintenance page rather than the list: read it directly.
        row = listed.get(p) or api.get(f"/api/py/projects/{p}", headers=world.h("sa")).json()
        assert (mini["name"], mini["status"], mini["statusLabel"], mini["progress"], mini["pm"]) == (
            row["name"], row["status"], row["statusLabel"], row["progress"], row["pm"]["name"]), key  # fmt: skip
        assert mini["flags"] == [f["text"] for f in row["flags"]]


def test_the_lab_pm_sees_the_same_figures_themselves(api, world, lab_view) -> None:
    mine = api.get("/api/py/analytics?period=12m", headers=world.h("lab_pm")).json()
    theirs = lab_view["12m"]
    for k in ("tiles", "pipeline", "onTime", "delivery", "site"):
        assert mine[k] == theirs[k], k
    assert mine["team"] is None and mine["scope"]["superadmin"] is False


@pytest.mark.parametrize("period", PERIODS)
def test_sign_ups_count_each_request_once(api, world, period) -> None:
    def signups() -> dict:
        return api.get(f"/api/py/analytics?period={period}", headers=world.h("sa")).json()["sales"]["signups"]

    before = signups()
    rid = world.conn.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) "
        "values (%s, %s, 'UAT Sign-up', 'epc_team', '+65 8000 0000') returning request_id",
        (f"user_uat_signup_{period}", f"uat-signup-{period}@example.com"),
    ).fetchone()["request_id"]
    try:
        after = signups()
        assert after["count"] == before["count"] + 1 and after["pending"] == before["pending"] + 1
        roles = {r["label"]: r["count"] for r in after["byRole"]}
        assert roles["epc_team"] == {r["label"]: r["count"] for r in before["byRole"]}.get("epc_team", 0) + 1
    finally:
        world.conn.execute("update account_requests set status = 'rejected' where request_id = %s", (rid,))


# ================================================================== the world

DASH_ACTORS = [a for a in spec.ACTORS if spec.ROLE[a] in ("project_manager", "superadmin") and a != "inactive"]
WORLD_TILE = {
    "draft": None, "awaiting_homeowner": "awaitingHomeowner", "homeowner_declined": "awaitingHomeowner",
    "homeowner_approved": "awaitingPm", "pm_approved": "ongoing", "in_progress_m0": "ongoing",
    "in_progress_m1": "ongoing", "in_progress_m2": "ongoing", "awaiting_signature": "handover", "signed": "handover",
    "closed": None,
}  # fmt: skip
WORLD_STAGE = {
    "draft": "draft", "awaiting_homeowner": "awaiting_homeowner", "homeowner_declined": "homeowner_declined",
    "homeowner_approved": "homeowner_approved", "pm_approved": "m0", "in_progress_m0": "m1", "in_progress_m1": "m2",
    "in_progress_m2": "m3", "awaiting_signature": "awaiting_signature", "signed": "signed", "closed": "closed",
}  # fmt: skip


_WORLD_VIEWS: dict[str, Any] = {}


@pytest.fixture
def views(api, world) -> dict[tuple[str, str], dict]:
    def load(key: tuple[str, str]) -> dict:
        r = api.get(f"/api/py/analytics?period={key[1]}", headers=world.h(key[0]))
        assert r.status_code == 200, r.text
        return r.json()

    if "views" not in _WORLD_VIEWS:
        _WORLD_VIEWS["views"] = _Lazy(load)
    return _WORLD_VIEWS["views"]


WORLD_GRID = [(a, p, s) for a in DASH_ACTORS for p in PERIODS for s in spec.STATE_KEYS]


@pytest.mark.parametrize(("actor", "period", "state"), WORLD_GRID, ids=[f"{a}-{p}-{s}" for a, p, s in WORLD_GRID])
def test_world_project_in_the_right_tile(world, views, actor, period, state) -> None:
    d = views[(actor, period)]
    pid = world.pid[state]
    if spec.sees(actor, state) != 200:
        assert str(pid) not in d["projects"], "never counts a project its reader can't see"
        assert all(pid not in t["ids"] for t in d["tiles"].values())
        return
    for tile, t in d["tiles"].items():
        if tile == "new":
            assert pid in t["ids"], "set up during this run, so new in every period"
        elif tile == "closed":
            assert (pid in t["ids"]) == (state == "closed")
        elif tile in ("late", "noShow"):
            assert pid not in t["ids"], "the world's projects are on time and have no missed visits"
        else:
            assert (pid in t["ids"]) == (WORLD_TILE[state] == tile), tile


@pytest.mark.parametrize(("actor", "period", "state"), WORLD_GRID, ids=[f"{a}-{p}-{s}" for a, p, s in WORLD_GRID])
def test_world_project_in_the_right_stage(world, views, actor, period, state) -> None:
    d = views[(actor, period)]
    pid = world.pid[state]
    stages = {s["key"]: s["ids"] for s in d["pipeline"]}
    holding = [k for k, v in stages.items() if pid in v]
    assert holding == ([WORLD_STAGE[state]] if spec.sees(actor, state) == 200 else [])


INV = [(a, p) for a in DASH_ACTORS for p in PERIODS]


@pytest.mark.parametrize(("actor", "period"), INV, ids=[f"{a}-{p}" for a, p in INV])
def test_every_number_adds_up(views, actor, period) -> None:
    d = views[(actor, period)]
    known = {int(k) for k in d["projects"]}
    assert sum(s["count"] for s in d["pipeline"]) == len(known), "every project in exactly one stage"
    for name, t in d["tiles"].items():
        assert t["count"] == len(t["ids"]) and set(t["ids"]) <= known, name
    for s in d["pipeline"] + d["delivery"]["aging"]:
        assert s["count"] == len(s["ids"]) and set(s["ids"]) <= known
    assert set(d["delivery"]["dueSoon"]) <= known and d["delivery"]["late"] == d["tiles"]["late"]["ids"]
    assert sum(a["count"] for a in d["delivery"]["aging"]) == d["tiles"]["late"]["count"]
    site = d["site"]
    assert site["visits"] >= site["attended"] + site["missed"] - 0 and site["checkIns"] >= 0
    assert sum(c["projects"] for c in site["crews"]) == len(known)
    s = d["sales"]
    for g in ("byRegion", "byRetailer", "bySales"):
        assert sum(r["count"] for r in s[g]) == (d["tiles"]["new"]["count"] if period != "all" else len(known)), g
    assert 0 <= (d["onTime"]["rate"] or 0) <= 1


@pytest.mark.parametrize(("actor", "period"), INV, ids=[f"{a}-{p}" for a, p in INV])
def test_the_dashboard_matches_the_projects_list(api, world, views, actor, period) -> None:
    listed = {p["id"]: p for p in api.get("/api/py/projects", headers=world.h(actor)).json()["projects"]}
    d = views[(actor, period)]
    # The dashboard counts handed-over projects too; the list leaves them to Maintenance.
    assert {int(k) for k, m in d["projects"].items() if m["status"] != "closed"} == set(listed)
    for k, m in d["projects"].items():
        if m["status"] == "closed":
            assert api.get(f"/api/py/projects/{k}", headers=world.h(actor)).status_code == 200
    late = {p for p, row in listed.items() if any(f["kind"] == "overdue" for f in row["flags"])}
    assert set(d["tiles"]["late"]["ids"]) == late, "late on the dashboard is late on the list"
    noshow = {p for p, row in listed.items() if any(f["kind"] == "no_show" for f in row["flags"])}
    assert set(d["tiles"]["noShow"]["ids"]) == noshow


@pytest.mark.parametrize("period", PERIODS)
def test_only_the_superadmin_has_the_team_table_and_the_pm_picker(views, period) -> None:
    for a in DASH_ACTORS:
        d = views[(a, period)]
        assert (d["team"] is not None) == (a == "sa") and d["scope"]["superadmin"] == (a == "sa")
        assert bool(d["scope"]["managers"]) == (a == "sa")
