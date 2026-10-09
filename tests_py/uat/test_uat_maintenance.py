"""UAT · maintenance tracking: what happens to a project after the handover.

convert   the world's handed-over project became a maintenance record carrying its people and its system
list      handed over, a project leaves the Projects list for the Maintenance page (its homeowner keeps it)
access    every person by every kind of record (a manager's, another's, unassigned, a converted project) by every action
fields    every field by good and bad values by who changes it
checks    every due/done combination reads right; marking done refuses impossible dates
import    the project listing's wordings, row by row, and anything unexpected stops it
months    the listing's 6 Months and 1 Year columns, for every turn-on day of two years (a leap year among them)
"""

from __future__ import annotations

import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest

from _routes import maintenance as mt
from _routes import projects as proj
from uat import spec

pytestmark = pytest.mark.uat
ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("import_maintenance", ROOT / "scripts" / "import_maintenance.py")
assert _spec and _spec.loader
imp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(imp)

KINDS = ["pm", "pm2", "none", "converted"]
OWNER = {"pm": "pm", "pm2": "pm2", "none": "none", "converted": "pm"}


@pytest.fixture(scope="module")
def recs(world) -> dict[str, int]:
    """A record for each kind of owner, plus the one the world's handed-over project became."""
    c = world.conn
    out: dict[str, int] = {}
    t = date.today()
    for i, kind in enumerate(["pm", "pm2", "none"]):
        out[kind] = c.execute(
            "insert into maintenance_systems (import_ref, address, postal_code, run_by, panels, kwp, phase, inverters, "
            "turned_on_on, six_month_due, one_year_due, ppa_kind, ppa_years, plan_years, plan_excludes_first_year) "
            "values (%s, %s, '358791', %s, %s, 13.64, 1, %s, %s, %s, %s, 'ppa', 5, 5, false) returning system_id",
            (
                f"uat-{world.tag}#{i}", f"{i + 1} UAT Maintenance Road", world.uid(kind) if kind != "none" else None,
                json.dumps([{"count": 22, "wp": 620}]), ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"],
                t - timedelta(days=200), t - timedelta(days=17), t + timedelta(days=165),
            ),
        ).fetchone()["system_id"]  # fmt: skip
    out["converted"] = c.execute(
        "select system_id from maintenance_systems where project_id = %s", (world.pid["closed"],)
    ).fetchone()["system_id"]
    return out


@pytest.fixture(scope="module")
def scratch(world) -> Any:
    """A fresh record per test that changes one (so tests don't lean on each other), owned by the world's PM."""
    c = world.conn
    n = iter(range(10_000, 99_999))

    def make(**cols: Any) -> int:
        t = date.today()
        row = {
            "import_ref": f"uat-{world.tag}-s#{next(n)}",
            "address": "9 UAT Scratch Lane",
            "run_by": world.uid("pm"),
            "panels": json.dumps([{"count": 20, "wp": 620}]),
            "turned_on_on": t - timedelta(days=200),
            "six_month_due": t - timedelta(days=17),
            "one_year_due": t + timedelta(days=165),
            **cols,
        }
        return c.execute(
            f"insert into maintenance_systems ({', '.join(row)}) values ({', '.join(['%s'] * len(row))}) returning system_id",
            tuple(row.values()),
        ).fetchone()["system_id"]

    return make


# ------------------------------------------------------------------ convert


def test_the_handed_over_project_became_a_maintenance_record(world) -> None:
    m = world.conn.execute("select * from maintenance_systems where project_id = %s", (world.pid["closed"],)).fetchone()
    assert m is not None
    assert (m["run_by"], m["homeowner_id"]) == (world.uid("pm"), world.uid("ho"))
    assert m["address"] == "53 Ang Mo Kio Avenue 3" and m["postal_code"] == "569933"
    assert m["panels"] == [{"count": 20, "wp": 610}] and float(m["kwp"]) == 12.2
    assert m["inverters"] == ["Huawei SUN2000-10KTL-M1"]
    assert (m["turned_on_on"], m["six_month_due"], m["one_year_due"]) == (date(2026, 10, 10), date(2027, 4, 10), date(2027, 10, 10))


@pytest.mark.parametrize("state", [s for s in spec.STATE_KEYS if s != "closed"])
def test_only_a_handed_over_project_is_in_maintenance(world, state) -> None:
    assert world.conn.execute("select 1 from maintenance_systems where project_id = %s", (world.pid[state],)).fetchone() is None


@pytest.mark.parametrize("actor", ["sa", "pm"])
def test_the_converted_record_shows_its_project_and_certificate(api, world, recs, actor) -> None:
    d = api.get(f"/api/py/maintenance/{recs['converted']}", headers=world.h(actor)).json()
    assert d["project"]["id"] == world.pid["closed"] and d["project"]["certificate"]
    assert d["system"]["homeowner"]["linked"] and not d["system"]["imported"]


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_the_handover_points_managers_to_maintenance(api, world, recs, actor) -> None:
    r = api.get(f"/api/py/projects/{world.pid['closed']}/handover", headers=world.h(actor))
    if r.status_code != 200:
        assert r.status_code == spec.sees(actor, "closed")
        return
    assert r.json()["maintenance"] == (recs["converted"] if actor in ("sa", "pm") else None)


# --------------------------------------------------------------------- list


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_the_list_says_how_many_were_handed_over(api, world, actor) -> None:
    r = api.get("/api/py/projects", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
        return
    n = r.json()["handedOver"]
    if spec.ROLE[actor] == "homeowner":
        assert n == 0, "a homeowner's handed-over project stays in their list"
    elif spec.sees(actor, "closed") == 200:
        assert n >= 1
    else:
        assert n == 0


@pytest.mark.parametrize("state", spec.STATE_KEYS)
def test_the_status_reads_completed_then_handed_over(api, world, state) -> None:
    label = api.get(f"/api/py/projects/{world.pid[state]}", headers=world.h("pm")).json()["statusLabel"]
    assert label == proj.STATUS_LABEL[spec.STATUS[state]]
    if spec.STATUS[state] == "signed":
        assert label == "Completed"
    if spec.STATUS[state] == "closed":
        assert label == "Handed Over"


# ------------------------------------------------------------------- access


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_the_maintenance_list(api, world, recs, actor) -> None:
    r = api.get("/api/py/maintenance", headers=world.h(actor))
    assert r.status_code == spec.maintenance_list(actor), r.text
    if r.status_code != 200:
        return
    ids = {s["id"] for s in r.json()["systems"]}
    for kind in KINDS:
        assert (recs[kind] in ids) == (spec.maintenance_sees(actor, OWNER[kind]) == 200), kind
    assert r.json()["canAssign"] == (actor == "sa")


GRID = [(a, k) for a in spec.ACTORS for k in KINDS]
IDS = [f"{a}-{k}" for a, k in GRID]


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_opening_a_record(api, world, recs, actor, kind) -> None:
    r = api.get(f"/api/py/maintenance/{recs[kind]}", headers=world.h(actor))
    assert r.status_code == spec.maintenance_sees(actor, OWNER[kind]), r.text
    if r.status_code == 200:
        assert r.json()["canEdit"] is True and r.json()["canAssign"] == (actor == "sa")


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_changing_a_record(api, world, recs, actor, kind) -> None:
    r = api.patch(f"/api/py/maintenance/{recs[kind]}", headers=world.h(actor), json={"notes": f"Seen by {actor}"})
    assert r.status_code == spec.maintenance_sees(actor, OWNER[kind]), r.text


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_reopening_a_check(api, world, recs, actor, kind) -> None:
    r = api.post(f"/api/py/maintenance/{recs[kind]}/checks/one_year", headers=world.h(actor), json={"doneOn": None})
    assert r.status_code == spec.maintenance_sees(actor, OWNER[kind]), r.text


@pytest.mark.parametrize(("actor", "kind"), GRID, ids=IDS)
def test_assigning_a_record(api, world, recs, actor, kind) -> None:
    owner = OWNER[kind]
    keep = None if owner == "none" else world.uid(owner)
    r = api.patch(f"/api/py/maintenance/{recs[kind]}", headers=world.h(actor), json={"runBy": keep})
    seen = spec.maintenance_sees(actor, owner)
    assert r.status_code == (seen if seen != 200 else 200 if actor == "sa" else 403), r.text


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_an_unknown_record(api, world, actor) -> None:
    r = api.get("/api/py/maintenance/987654321", headers=world.h(actor))
    assert r.status_code == (404 if spec.maintenance_list(actor) == 200 else 403)


# ------------------------------------------------------------------- fields

GOOD: list[tuple[str, Any, str, Any]] = [
    # body key, value, what the record then shows (dotted path), expected
    ("address", "  12  Sample   Rise ", "address", "12 Sample Rise"),
    ("postalCode", "018956", "postalCode", "018956"),
    ("postalCode", "", "postalCode", None),
    ("contactNo", "+65 9000 1111", "contactNo", "+65 9000 1111"),
    ("homeownerName", "Mdm Lim", "homeowner.name", "Mdm Lim"),
    ("ppa", {"kind": "ppa", "years": 7}, "ppa", {"kind": "ppa", "years": 7}),
    ("ppa", {"kind": "value_buy", "years": 9}, "ppa", {"kind": "value_buy", "years": None}),
    ("ppa", None, "ppa", None),
    ("plan", {"years": 8, "excludesFirstYear": True}, "plan", {"years": 8, "excludesFirstYear": True}),
    ("plan", {"years": 3}, "plan", {"years": 3, "excludesFirstYear": False}),
    ("plan", None, "plan", None),
    ("panels", [{"count": 23, "wp": 635}, {"count": 3, "wp": 620}], "panelCount", 26),
    ("panels", [{"count": 12}], "panels", [{"count": 12, "wp": None}]),
    ("panels", [], "panelCount", 0),
    ("kwp", 16.465, "kwp", 16.465),
    ("kwp", 12.3456, "kwp", 12.346),
    ("kwp", None, "kwp", None),
    ("phase", 3, "phase", 3),
    ("phase", None, "phase", None),
    ("inverters", ["SUN2000-10K-LC0", "SUN2000-10K-LC0"], "inverters", ["SUN2000-10K-LC0", "SUN2000-10K-LC0"]),
    ("inverters", [" ", ""], "inverters", []),
    ("roofAccess", True, "roofAccess", True),
    ("roofAccess", None, "roofAccess", None),
    ("urgent", True, "urgent", True),
    ("notes", "  ", "notes", None),
    ("turnedOn", "2026-02-28", "checks.0.due", "2026-08-28"),
    ("turnedOn", "2025-08-31", "checks.0.due", "2026-02-28"),
    ("turnedOn", "2025-08-31", "checks.1.due", "2026-08-31"),
]
BAD: list[tuple[str, Any, int]] = [
    ("address", "", 400),
    ("address", "x" * 301, 400),
    ("postalCode", "1234", 400),
    ("postalCode", "ABCDEF", 400),
    ("contactNo", "9" * 33, 400),
    ("ppa", {"kind": "ppa"}, 400),
    ("ppa", {"kind": "ppa", "years": 0}, 422),
    ("ppa", {"kind": "ppa", "years": 41}, 422),
    ("ppa", {"kind": "rent"}, 422),
    ("plan", {"years": 0}, 422),
    ("plan", {"years": 99}, 422),
    ("panels", [{"count": 0, "wp": 620}], 422),
    ("panels", [{"count": 5, "wp": 0}], 422),
    ("panels", [{"count": 5, "wp": 5000}], 422),
    ("kwp", -0.5, 422),
    ("phase", 2, 422),
    ("inverters", ["X"] * 21, 400),
    ("inverters", ["X" * 61], 400),
    ("sixMonthDue", "1999-01-01", 400),
    ("oneYearDue", "1999-01-01", 400),
    ("turnedOn", "not a date", 422),
    ("urgent", None, 400),
    ("notes", "x" * 2001, 400),
    ("runBy", 0, 403),
]
WHO = ["sa", "pm", "pm2"]


def _at(d: Any, path: str) -> Any:
    for part in path.split("."):
        d = d[int(part)] if part.isdigit() else d[part]
    return d


@pytest.mark.parametrize("who", WHO)
@pytest.mark.parametrize(("key", "value", "path", "want"), GOOD, ids=[f"{k}-{i}" for i, (k, *_) in enumerate(GOOD)])
def test_a_good_change_is_kept(api, world, scratch, who, key, value, path, want) -> None:
    # pm changes their own; pm2 an unassigned one; sa anyone's.
    sid = scratch(run_by=None) if who == "pm2" else scratch()
    r = api.patch(f"/api/py/maintenance/{sid}", headers=world.h(who), json={key: value})
    assert r.status_code == 200, r.text
    assert _at(r.json()["system"], path) == want
    again = api.get(f"/api/py/maintenance/{sid}", headers=world.h(who)).json()["system"]
    assert _at(again, path) == want, "and it's still there when the page opens again"


@pytest.mark.parametrize("who", WHO)
@pytest.mark.parametrize(("key", "value", "status"), BAD, ids=[f"{k}-{i}" for i, (k, *_) in enumerate(BAD)])
def test_a_bad_change_is_refused_and_nothing_moves(api, world, scratch, who, key, value, status) -> None:
    sid = scratch(run_by=None) if who == "pm2" else scratch()
    before = api.get(f"/api/py/maintenance/{sid}", headers=world.h(who)).json()["system"]
    r = api.patch(f"/api/py/maintenance/{sid}", headers=world.h(who), json={key: value})
    expect = 400 if (key == "runBy" and who == "sa") else status
    assert r.status_code == expect, r.text
    after = api.get(f"/api/py/maintenance/{sid}", headers=world.h(who)).json()["system"]
    assert {k: v for k, v in after.items() if k != "updatedAt"} == {k: v for k, v in before.items() if k != "updatedAt"}


@pytest.mark.parametrize("who", WHO)
def test_every_change_is_in_the_audit_log_under_who_made_it(api, world, scratch, who) -> None:
    sid = scratch(run_by=None) if who == "pm2" else scratch()
    api.patch(f"/api/py/maintenance/{sid}", headers=world.h(who), json={"notes": "Audit me"})
    a = world.conn.execute(
        "select actor_uid, changes from audit_log where entity_table = 'maintenance_systems' and entity_id = %s and action = 'update'",
        (str(sid),),
    ).fetchall()
    assert [x["actor_uid"] for x in a] == [world.uid(who)] and a[0]["changes"]["notes"]["to"] == "Audit me"


# ------------------------------------------------------------------- checks

DUE = [-400, -31, -1, 0, 1, 15, 30, 31, 90, None]
DONE = [None, 0, 3, 100]
STATES = [(d, x) for d in DUE for x in DONE]


@pytest.mark.parametrize("which", ["six_month", "one_year"])
@pytest.mark.parametrize(("due", "done"), STATES, ids=[f"due{d}-done{x}" for d, x in STATES])
def test_a_check_reads_right(api, world, scratch, which, due, done) -> None:
    t = proj.today()
    when = lambda n: None if n is None else t + timedelta(days=n)  # noqa: E731
    cols = {"turned_on_on": None, "six_month_due": None, "one_year_due": None}
    cols[f"{which}_due"] = when(due)
    cols[f"{which}_done_on"] = when(-done) if done is not None else None
    sid = scratch(**cols)
    s = api.get(f"/api/py/maintenance/{sid}", headers=world.h("pm")).json()["system"]
    c = next(x for x in s["checks"] if x["key"] == which)
    want = spec.check_state(due, done)
    assert c["state"] == want
    assert s["attention"] == (want == "overdue")
    assert (s["next"] or {}).get("key") == (which if want in ("overdue", "due_soon", "scheduled") else None)


DONE_ON = [(-300, 400), (-201, 400), (-200, 200), (-17, 200), (0, 200), (1, 400), (30, 400)]


@pytest.mark.parametrize("which", ["six_month", "one_year"])
@pytest.mark.parametrize(("on", "status"), DONE_ON, ids=[f"{o}" for o, _ in DONE_ON])
def test_marking_a_check_done(api, world, scratch, which, on, status) -> None:
    sid = scratch()  # turned on 200 days ago
    day = (proj.today() + timedelta(days=on)).isoformat()
    r = api.post(f"/api/py/maintenance/{sid}/checks/{which}", headers=world.h("pm"), json={"doneOn": day})
    assert r.status_code == status, r.text
    if status == 200:
        c = next(x for x in r.json()["system"]["checks"] if x["key"] == which)
        assert c["state"] == "done" and c["doneOn"] == day
        r = api.post(f"/api/py/maintenance/{sid}/checks/{which}", headers=world.h("pm"), json={"doneOn": None})
        assert next(x for x in r.json()["system"]["checks"] if x["key"] == which)["doneOn"] is None


@pytest.mark.parametrize("which", ["three_month", "two_year", "six-month", ""])
def test_there_are_two_checks(api, world, recs, which) -> None:
    r = api.post(f"/api/py/maintenance/{recs['pm']}/checks/{which}", headers=world.h("pm"), json={"doneOn": None})
    assert r.status_code in (404, 405)


# ------------------------------------------------------------------- import

PPA = [("5 Years", "ppa", 5), ("7 Years", "ppa", 7), ("8 Years", "ppa", 8), ("Value buy", "value_buy", None), ("10 years", "ppa", 10), ("1 Year", "ppa", 1)]
PLAN = [
    ("Free for 5 years", 5, False),
    ("Free for 3 years", 3, False),
    ("5 years excluding 1st year", 5, True),
    ("7 years excluding 1st year", 7, True),
    ("8 years excluding 1st year", 8, True),
    ("Free for 10 years", 10, False),
]
PHASE = [("Single-phase", 1), ("3-phase", 3)]
PANELS = [
    (22, 620, 13.64, [{"count": 22, "wp": 620}]),
    (26, "23 Nos. x 635 Wp\n3 Nos. X 620 Wp", 16.465, [{"count": 23, "wp": 635}, {"count": 3, "wp": 620}]),
    (18, "5 Nos. x 635 Wp\n13 Nos. X 620 Wp", 11.235, [{"count": 5, "wp": 635}, {"count": 13, "wp": 620}]),
]
ROWS = [(p, pl, ph, pn) for p in PPA for pl in PLAN for ph in PHASE for pn in range(len(PANELS))]


def sheet_row(sn: int = 1, **over: Any) -> tuple:
    r = {
        "S/N": sn, "Address": "1 Example Road", "Postal Code": 358791, "PPA": "5 Years", "No. of Panels": 22,
        "Panel Wp": 620, "kWp DC": 13.64, "1P or 3P": "Single-phase", "Inverter": "SUN2000-12K-MB0",
        "Turn On Date": date(2026, 5, 26), "6 Months": date(2026, 11, 26), "1 Year": date(2027, 5, 26),
        "Maintenance Plan": "Free for 5 years", "Roof Access": "No", "Urgent Maintenance due to Poor Generation": None,
    }  # fmt: skip
    r.update(over)
    return tuple(r[h] for h in imp.HEADER)


@pytest.mark.parametrize(("ppa", "plan", "phase", "pn"), ROWS, ids=[f"{a[0]}|{b[0]}|{c[0]}|{d}" for a, b, c, d in ROWS])
def test_a_listing_row_is_read_exactly(ppa, plan, phase, pn) -> None:
    count, wp, kwp, panels = PANELS[pn]
    row = sheet_row(**{"PPA": ppa[0], "Maintenance Plan": plan[0], "1P or 3P": phase[0], "No. of Panels": count, "Panel Wp": wp, "kWp DC": kwp})
    (r,), notes = imp.parse([tuple(imp.HEADER), row], "uat-listing")
    assert (r["ppa_kind"], r["ppa_years"]) == (ppa[1], ppa[2])
    assert (r["plan_years"], r["plan_excludes_first_year"]) == (plan[1], plan[2])
    assert r["phase"] == phase[1] and r["panels"] == panels and float(r["kwp"]) == kwp
    assert notes == [], "nothing corrected, nothing that doesn't add up"


ODD = [
    ("PPA", "Lease"), ("PPA", ""), ("Maintenance Plan", "Free"), ("Maintenance Plan", "5 years"), ("1P or 3P", "2-phase"),
    ("Roof Access", "Sometimes"), ("Postal Code", "12345678"), ("Address", ""), ("Panel Wp", "big ones"),
    ("No. of Panels", "many"), ("Turn On Date", "next week"), ("6 Months", date(2026, 1, 1)), ("1 Year", date(2026, 6, 1)),
]  # fmt: skip


@pytest.mark.parametrize(("col", "value"), ODD, ids=[f"{c}={v}" for c, v in ODD])
def test_anything_unexpected_stops_the_whole_import(col, value) -> None:
    with pytest.raises(imp.RowError, match=r"S/N 2 \(") as e:
        imp.parse([tuple(imp.HEADER), sheet_row(1), sheet_row(2, **{col: value})], "uat-listing")
    assert "S/N 2" in str(e.value), "the row is named"


# ------------------------------------------------------------------- months

DAYS = [date(2027, 1, 1) + timedelta(days=i) for i in range(731)]  # 2027 and 2028, a leap year


@pytest.mark.parametrize("n", [6, 12])
@pytest.mark.parametrize("d", DAYS, ids=[d.isoformat() for d in DAYS])
def test_the_checks_fall_where_the_listing_puts_them(d, n) -> None:
    assert mt._months(d, n) == date(*spec.plus_months(d.year, d.month, d.day, n))
