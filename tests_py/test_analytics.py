"""The dashboard's numbers (_lib/analytics.py) and who may see them (GET /analytics).

maths      every figure from hand-made rows, where the right answer is known
periods    weeks or months, and the period before for the change arrows
places     region from the postal code, salesperson from the Sales field, kWp
access     project managers and superadmins only; a PM sees their own projects
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest

from _lib import analytics as an
from conftest import bearer

SG = an.SG
TODAY = date(2026, 10, 9)


def at(d: date, h: int = 9, m: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, h, m, tzinfo=SG)


def project(i: int, status: str, *, milestone: int = 0, created: date, end: date | None = None,
            closed: date | None = None,
            flags: list[dict] | None = None, pm: int = 1, postal: str = "569933", panels: int | None = 20,
            watts: int | None = 610, retailer: str | None = "SP Group", sales: str | None = "K. Chandra · Q3",
            contractor: str = "Apex") -> tuple[dict, dict]:  # fmt: skip
    row = {
        "id": i, "name": f"P{i}", "status": status, "statusLabel": status, "milestone": milestone,
        "endDate": end.isoformat() if end else None, "flags": flags or [], "progress": 50,
        "pm": {"uid": pm, "name": f"PM {pm}"}, "homeowner": {"name": "H"},
        "contractor": {"type": "group", "label": contractor},
    }  # fmt: skip
    raw = {
        "project_id": i, "status": status, "created_at": at(created), "closed_at": at(closed, 16) if closed else None,
        "target_end_date": end, "postal_code": postal, "panel_quantity_actual": panels, "panel_quantity_estimate": None,
        "panel_capacity": watts, "retailer_name": retailer, "sales": sales,
    }  # fmt: skip
    return row, raw


def build(projects, *, period="90d", milestones=(), signatures=None, history=(), visits=(), check_ins=(),
          requests=(), managers=None):  # fmt: skip
    rows = [p[0] for p in projects]
    raw = {p[1]["project_id"]: p[1] for p in projects}
    return an.build(
        today=TODAY, w=an.window(period, TODAY), rows=rows, raw=raw, milestones=list(milestones),
        signatures=signatures or {}, history=list(history), visits=list(visits), check_ins=list(check_ins),
        requests=list(requests), managers=managers,
    )  # fmt: skip


LATE = {"kind": "overdue", "text": "Target end date passed 5 days ago"}
NOSHOW = {"kind": "no_show", "text": "No check-in for the EPC visit on …"}


# ------------------------------------------------------------------ maths


def test_tiles_count_what_needs_a_decision() -> None:
    d = build([
        project(1, "in_progress", milestone=1, created=date(2026, 9, 1), end=date(2026, 10, 4), flags=[LATE]),
        project(2, "pm_approved", created=date(2026, 9, 20), end=date(2026, 11, 1), flags=[NOSHOW]),
        project(3, "awaiting_homeowner", created=date(2026, 10, 1)),
        project(4, "homeowner_declined", created=date(2026, 10, 2)),
        project(5, "homeowner_approved", created=date(2026, 10, 3)),
        project(6, "awaiting_signature", milestone=3, created=date(2026, 7, 1)),
        project(7, "signed", milestone=3, created=date(2026, 7, 2)),
        project(8, "closed", milestone=3, created=date(2026, 6, 1), end=date(2026, 9, 30), closed=date(2026, 9, 20)),
    ])  # fmt: skip
    t = d["tiles"]
    assert {k: v["count"] for k, v in t.items()} == {
        "ongoing": 2, "late": 1, "noShow": 1, "awaitingHomeowner": 2, "awaitingPm": 1, "handover": 2, "closed": 1,
        "new": 5,
    }  # fmt: skip
    assert t["late"]["ids"] == [1] and t["handover"]["ids"] == [6, 7]
    assert d["projects"][1]["daysLate"] == 5


def test_the_pipeline_follows_the_flow() -> None:
    d = build([
        project(1, "draft", created=TODAY),
        project(2, "pm_approved", created=TODAY),
        project(3, "in_progress", milestone=0, created=TODAY),
        project(4, "in_progress", milestone=1, created=TODAY),
        project(5, "in_progress", milestone=2, created=TODAY),
        project(6, "closed", milestone=3, created=TODAY, closed=TODAY),
    ])  # fmt: skip
    counts = {p["key"]: p["count"] for p in d["pipeline"]}
    assert [p["key"] for p in d["pipeline"]] == [k for k, _ in an.PIPELINE]
    assert counts["draft"] == 1 and counts["m0"] == 1 and counts["m1"] == 1 and counts["m2"] == 1 and counts["m3"] == 1
    assert counts["closed"] == 1 and sum(counts.values()) == 6


@pytest.mark.parametrize(
    ("closes", "rate"),
    [([(5, 10)], 1.0), ([(12, 10)], 0.0), ([(5, 10), (12, 10)], 0.5), ([(10, 10)], 1.0), ([], None)],
)
def test_on_time_rate(closes, rate) -> None:
    ps = [project(i, "closed", milestone=3, created=date(2026, 8, 1), closed=date(2026, 9, c), end=date(2026, 9, e))
          for i, (c, e) in enumerate(closes, start=1)]  # fmt: skip
    assert build(ps)["onTime"]["rate"] == rate


def test_stage_durations_from_the_audit_log_milestones_signature_and_closing() -> None:
    created = date(2026, 8, 1)
    d = build(
        [project(1, "closed", milestone=3, created=created, closed=date(2026, 9, 21), end=date(2026, 10, 1))],
        history=[
            {"project_id": 1, "occurred_at": at(date(2026, 8, 3)), "status": "homeowner_approved"},
            {"project_id": 1, "occurred_at": at(date(2026, 8, 4)), "status": "pm_approved"},
        ],
        milestones=[
            {"project_id": 1, "milestone_no": 1, "completed_at": at(date(2026, 8, 14))},
            {"project_id": 1, "milestone_no": 2, "completed_at": at(date(2026, 8, 24))},
            {"project_id": 1, "milestone_no": 3, "completed_at": at(date(2026, 9, 13))},
        ],
        signatures={1: at(date(2026, 9, 15))},
    )
    days = {s["key"]: s["avgDays"] for s in d["delivery"]["stages"]}
    assert days == {"homeowner": 2.0, "pm": 1.0, "m1": 10.0, "m2": 10.0, "m3": 20.0, "sign": 2.0, "close": 6.3}
    assert d["delivery"]["cycleDays"] == 51.3


def test_late_projects_age_into_bands_and_due_soon_is_the_next_fortnight() -> None:
    ps = [project(i, "in_progress", created=date(2026, 6, 1), end=TODAY - timedelta(days=n), flags=[LATE])
          for i, n in enumerate([1, 7, 8, 14, 15, 30, 31, 90], start=1)]  # fmt: skip
    ps += [project(20, "in_progress", created=date(2026, 9, 1), end=TODAY + timedelta(days=3)),
           project(21, "in_progress", created=date(2026, 9, 1), end=TODAY + timedelta(days=14)),
           project(22, "in_progress", created=date(2026, 9, 1), end=TODAY + timedelta(days=15))]  # fmt: skip
    d = build(ps)
    assert [a["count"] for a in d["delivery"]["aging"]] == [2, 2, 2, 2]
    assert d["delivery"]["dueSoon"] == [20, 21]
    assert d["delivery"]["late"][0] == 8, "the latest first"


def test_site_work_attendance_late_arrivals_and_the_heatmap() -> None:
    p = project(1, "in_progress", created=date(2026, 9, 1))
    day = date(2026, 10, 6)  # a Tuesday
    visits = [
        {"visit_id": 1, "project_id": 1, "scheduled_date": day, "scheduled_time": "09:00"},
        {"visit_id": 2, "project_id": 1, "scheduled_date": day - timedelta(days=1), "scheduled_time": "09:00"},
        {"visit_id": 3, "project_id": 1, "scheduled_date": TODAY + timedelta(days=2), "scheduled_time": None},
    ]
    checks = [{"project_id": 1, "visit_id": 1, "user_id": 9, "checked_in_at": at(day, 10, 15), "crew_in": 4}]
    s = build([p], visits=visits, check_ins=checks)["site"]
    assert (s["visits"], s["attended"], s["missed"], s["attendance"]) == (2, 1, 1, 0.5)
    assert s["lateArrivals"] == 1 and s["avgCrew"] == 4.0 and s["upcoming"] == 1
    assert s["heatmap"]["counts"][1][an.HOURS.index(10)] == 1 and sum(map(sum, s["heatmap"]["counts"])) == 1
    crew = s["crews"][0]
    assert (crew["name"], crew["attended"], crew["missed"], crew["lateArrivals"]) == ("Apex", 1, 1, 1)


def test_sales_capacity_approval_and_groupings() -> None:
    ps = [
        project(1, "closed", milestone=3, created=date(2026, 9, 1), closed=date(2026, 10, 1), postal="828768",
                retailer="Geneco", sales="Mei Ling · Q4"),
        project(2, "in_progress", created=date(2026, 9, 2), postal="469000", panels=10, watts=500, sales=""),
        project(3, "homeowner_declined", created=date(2026, 9, 3), postal="609000", retailer=None),
    ]  # fmt: skip
    hist = [
        {"project_id": 1, "occurred_at": at(date(2026, 9, 3)), "status": "homeowner_approved"},
        {"project_id": 2, "occurred_at": at(date(2026, 9, 3)), "status": "homeowner_approved"},
        {"project_id": 3, "occurred_at": at(date(2026, 9, 4)), "status": "homeowner_declined"},
    ]
    s = build(ps, history=hist)["sales"]
    assert s["installedKwp"] == 12.2 and s["installedCount"] == 1
    assert s["pipelineKwp"] == 5.0 + 12.2
    assert s["approval"] == {"approved": 2, "declined": 1, "rate": 0.667, "avgDays": 1.5}
    assert {g["label"] for g in s["byRegion"]} == {"North-East", "East", "West"}
    assert {g["label"] for g in s["byRetailer"]} == {"Geneco", "SP Group", "Not recorded"}
    assert {g["label"] for g in s["bySales"]} == {"Mei Ling", "K. Chandra", "Not recorded"}


def test_signups_and_their_change() -> None:
    reqs = [{"created_at": at(TODAY - timedelta(days=n)), "requested_type": t, "status": s}
            for n, t, s in [(1, "homeowner", "pending"), (5, "homeowner", "approved"), (20, "epc_team", "approved"),
                            (100, "homeowner", "approved")]]  # fmt: skip
    s = build([], period="90d", requests=reqs)["sales"]["signups"]
    assert (s["count"], s["approved"], s["pending"], s["delta"]) == (3, 2, 1, 2.0)
    assert s["byRole"][0] == {"label": "homeowner", "count": 2}


def test_a_superadmin_sees_each_project_manager() -> None:
    ps = [project(1, "in_progress", created=TODAY, pm=1, flags=[LATE], end=TODAY - timedelta(days=2)),
          project(2, "in_progress", created=TODAY, pm=2),
          project(3, "closed", milestone=3, created=date(2026, 8, 1), closed=date(2026, 9, 1), end=date(2026, 9, 5),
                  pm=2)]  # fmt: skip
    team = build(ps, managers=[{"uid": 1, "name": "A"}, {"uid": 2, "name": "B"}])["team"]
    assert team == [
        {"uid": 2, "name": "B", "projects": 2, "ongoing": 1, "late": 0, "closed": 1, "onTime": 1.0},
        {"uid": 1, "name": "A", "projects": 1, "ongoing": 1, "late": 1, "closed": 0, "onTime": None},
    ]
    assert build(ps)["team"] is None, "a project manager's view has no team table"


def test_nothing_to_show() -> None:
    d = build([])
    assert d["tiles"]["ongoing"]["count"] == 0 and d["onTime"]["rate"] is None and d["site"]["attendance"] is None


# ------------------------------------------------------------------ periods


@pytest.mark.parametrize(("key", "n", "first"), [("30d", 5, "2026-09-07"), ("90d", 13, "2026-07-13"),
                                                 ("12m", 12, "2025-11"), ("all", 12, "2025-11")])  # fmt: skip
def test_trend_columns(key, n, first) -> None:
    b = an.buckets(an.window(key, TODAY), TODAY)
    assert len(b) == n and b[0][0] == first and b[-1][1] <= TODAY <= b[-1][2]


@pytest.mark.parametrize(("key", "start"), [("30d", date(2026, 9, 10)), ("90d", date(2026, 7, 12)),
                                            ("12m", date(2025, 10, 10)), ("all", None)])  # fmt: skip
def test_periods_end_today(key, start) -> None:
    w = an.window(key, TODAY)
    assert w.start == start and w.end == TODAY and w.has(TODAY)
    if start:
        assert not w.has(start - timedelta(days=1)) and w.had_before(start - timedelta(days=1))


@pytest.mark.parametrize(("now", "before", "want"), [(10, 5, 1.0), (5, 10, -0.5), (3, 0, None), (3, None, None),
                                                     (0, 4, -1.0)])  # fmt: skip
def test_change_against_the_period_before(now, before, want) -> None:
    assert an.delta(now, before) == want


def test_an_unknown_period_falls_back_to_90_days() -> None:
    assert an.window("week", TODAY).key == "90d"


# ------------------------------------------------------------------ places


@pytest.mark.parametrize(
    ("postal", "region"),
    [("018956", "Central"), ("238839", "Central"), ("569933", "North-East"), ("828768", "North-East"),
     ("807021", "North-East"), ("469000", "East"), ("518180", "East"), ("819663", "East"), ("528600", "East"),
     ("738099", "North"), ("768675", "North"), ("609000", "West"), ("120456", "West"), ("680123", "West"),
     ("289000", "Central"), ("", "Unknown"), (None, "Unknown"), ("ab1234", "Unknown")],
)  # fmt: skip
def test_region_from_postal_code(postal, region) -> None:
    assert an.region(postal) == region


@pytest.mark.parametrize(
    ("sales", "name"),
    [("K. Chandra · Q3-2026-118", "K. Chandra"), ("Mei Ling", "Mei Ling"), ("  Jason Lim  ·  x", "Jason Lim"),
     ("", "Not recorded"), (None, "Not recorded"), ("· only a code", "Not recorded")],
)  # fmt: skip
def test_salesperson(sales, name) -> None:
    assert an.salesperson(sales) == name


@pytest.mark.parametrize(
    ("actual", "est", "watts", "kwp"),
    [(20, None, 610, 12.2), (None, 18, 610, 10.98), (None, None, 610, 0), (20, 18, None, 0), (36, 30, 455, 16.38)],
)
def test_kwp(actual, est, watts, kwp) -> None:
    assert an.kwp({"panel_quantity_actual": actual, "panel_quantity_estimate": est, "panel_capacity": watts}) == kwp


# ------------------------------------------------------------------ access


@pytest.fixture
def two_pms(fx):
    pm, pm2, sa = fx.user("project_manager"), fx.user("project_manager"), fx.user("superadmin")
    tag = uuid.uuid4().hex[:6]
    made = []
    for owner in (pm, pm, pm2):
        made.append(fx.conn.execute(
            "insert into projects (name, address, postal_code, homeowner_name, homeowner_contact_no, contractor_text, "
            "status, project_manager_id, created_by, installation_start_date, target_end_date) "
            "values (%s, 'x road', '569933', 'H', '+65 9000 0000', 'C', 'draft', %s, %s, current_date, "
            "current_date + 21) returning project_id",
            (f"analytics {tag}", owner["uid"], owner["uid"]),
        ).fetchone()["project_id"])  # fmt: skip
    yield {"pm": pm, "pm2": pm2, "sa": sa, "pids": made}
    fx.conn.execute("delete from projects where project_id = any(%s)", (made,))


def test_a_project_manager_sees_only_their_projects(client, two_pms) -> None:
    t = two_pms
    mine = client.get("/api/py/analytics", headers=bearer(t["pm"]["clerk_user_id"])).json()
    assert set(mine["projects"]) == {str(p) for p in t["pids"][:2]} and mine["team"] is None
    theirs = client.get("/api/py/analytics", headers=bearer(t["pm2"]["clerk_user_id"])).json()
    assert set(theirs["projects"]) == {str(t["pids"][2])}


def test_a_superadmin_sees_all_and_can_narrow_to_one_pm(client, two_pms) -> None:
    t = two_pms
    h = bearer(t["sa"]["clerk_user_id"])
    every = client.get("/api/py/analytics", headers=h).json()
    assert {str(p) for p in t["pids"]} <= set(every["projects"])
    assert any(m["uid"] == t["pm"]["uid"] for m in every["team"]) and every["scope"]["superadmin"] is True
    one = client.get(f"/api/py/analytics?pm={t['pm2']['uid']}", headers=h).json()
    assert set(one["projects"]) == {str(t["pids"][2])} and [m["uid"] for m in one["team"]] == [t["pm2"]["uid"]]


def test_only_a_superadmin_narrows_by_pm(client, two_pms) -> None:
    t = two_pms
    r = client.get(f"/api/py/analytics?pm={t['pm2']['uid']}", headers=bearer(t["pm"]["clerk_user_id"]))
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["homeowner", "contractor", "epc_team"])
def test_nobody_else_sees_the_dashboard(client, fx, role) -> None:
    u = fx.user(role)
    assert client.get("/api/py/analytics", headers=bearer(u["clerk_user_id"])).status_code == 403


def test_signed_out_is_refused(client) -> None:
    assert client.get("/api/py/analytics").status_code == 401


@pytest.mark.parametrize("period", ["30d", "90d", "12m", "all"])
def test_every_period(client, two_pms, period) -> None:
    r = client.get(f"/api/py/analytics?period={period}", headers=bearer(two_pms["pm"]["clerk_user_id"]))
    assert r.status_code == 200 and r.json()["period"]["key"] == period


def test_a_made_up_period_is_refused(client, two_pms) -> None:
    r = client.get("/api/py/analytics?period=week", headers=bearer(two_pms["pm"]["clerk_user_id"]))
    assert r.status_code == 400
