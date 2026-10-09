# ruff: noqa: RUF001  (en dashes in day ranges are meant)
"""The numbers behind the dashboard, worked out from rows already fetched.

Pure functions, no database: the route (_routes/analytics.py) fetches what
the person may see and hands it here, so every rule below is unit-testable
and the dashboard can never count a project its reader isn't allowed to see.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

SG = ZoneInfo("Asia/Singapore")

PERIODS = {
    "30d": ("Last 30 days", 30),
    "90d": ("Last 90 days", 90),
    "12m": ("Last 12 months", 365),
    "all": ("All time", None),
}

# The flow, in order: the pipeline chart's bars.
PIPELINE = [
    ("draft", "Draft"),
    ("awaiting_homeowner", "Awaiting homeowner"),
    ("homeowner_declined", "Declined"),
    ("homeowner_approved", "PM to approve"),
    ("m0", "Approved, not started"),
    ("m1", "Working on Milestone 1"),
    ("m2", "Working on Milestone 2"),
    ("m3", "Working on Milestone 3"),
    ("awaiting_signature", "Awaiting e-sign"),
    ("signed", "Completed, to hand over"),
    ("closed", "Handed over"),
]
ONGOING = {"pm_approved", "in_progress"}
HANDOVER = {"awaiting_signature", "signed"}
WAITING_HOMEOWNER = {"awaiting_homeowner", "homeowner_declined"}

STAGES = [
    ("homeowner", "Homeowner approval"),
    ("pm", "PM approval"),
    ("m1", "Milestone 1"),
    ("m2", "Milestone 2"),
    ("m3", "Milestone 3"),
    ("sign", "Homeowner signs"),
    ("close", "PM closes"),
]
AGING = [("1–7 days", 1, 7), ("8–14 days", 8, 14), ("15–30 days", 15, 30), ("Over 30 days", 31, 10**6)]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
HOURS = list(range(6, 21))  # 6 am to 8 pm: when crews are on roofs


# ------------------------------------------------------------------ periods


@dataclass(frozen=True)
class Window:
    key: str
    label: str
    start: date | None  # None: all time
    end: date  # today, inclusive
    prev_start: date | None

    def has(self, d: date | None) -> bool:
        return d is not None and (self.start is None or d >= self.start) and d <= self.end

    def had_before(self, d: date | None) -> bool:
        """In the period of the same length just before this one."""
        if d is None or self.prev_start is None or self.start is None:
            return False
        return self.prev_start <= d < self.start


def window(key: str, today: date) -> Window:
    label, days = PERIODS.get(key, PERIODS["90d"])
    key = key if key in PERIODS else "90d"
    if days is None:
        return Window(key, label, None, today, None)
    start = today - timedelta(days=days - 1)
    return Window(key, label, start, today, start - timedelta(days=days))


def delta(now: int, before: int | None) -> float | None:
    """Change against the previous period, as a fraction; None when there's nothing to compare."""
    if before is None or before == 0:
        return None
    return round((now - before) / before, 3)


def buckets(w: Window, today: date) -> list[tuple[str, date, date]]:
    """The trend charts' columns: weeks for the shorter periods, months otherwise (12 at most)."""
    if w.key in ("30d", "90d"):
        n = 5 if w.key == "30d" else 13
        monday = today - timedelta(days=today.weekday())
        out = []
        for i in range(n - 1, -1, -1):
            s = monday - timedelta(weeks=i)
            out.append((s.isoformat(), s, s + timedelta(days=6)))
        return out
    out = []
    y, m = today.year, today.month
    for i in range(11, -1, -1):
        mm, yy = m - i, y
        while mm <= 0:
            mm += 12
            yy -= 1
        s = date(yy, mm, 1)
        e = (date(yy + (mm == 12), mm % 12 + 1, 1)) - timedelta(days=1)
        out.append((s.isoformat()[:7], s, e))
    return out


def sg_day(ts: datetime | None) -> date | None:
    return ts.astimezone(SG).date() if ts else None


# ------------------------------------------------------------------ places and people


def region(postal: str | None) -> str:
    """Singapore's region from the first two digits of a postal code (its sector)."""
    if not postal or len(postal) < 2 or not postal[:2].isdigit():
        return "Unknown"
    s = int(postal[:2])
    if s in (53, 54, 55, 56, 57, 79, 80, 82):
        return "North-East"
    if s in (*range(38, 53), 81):
        return "East"
    if s in (72, 73, 75, 76, 77, 78):
        return "North"
    if s in (11, 12, 13, *range(58, 72)):
        return "West"
    return "Central"


def salesperson(sales: str | None) -> str:
    """'K. Chandra · Q3-2026-118' → 'K. Chandra'. The field is free text; the name comes first."""
    name = (sales or "").split("·")[0].strip()
    return name or "Not recorded"


def kwp(p: dict[str, Any]) -> float:
    panels = p.get("panel_quantity_actual") or p.get("panel_quantity_estimate") or 0
    watts = p.get("panel_capacity") or 0
    return round(panels * watts / 1000, 2)


def stage_key(p: dict[str, Any], reached: int) -> str:
    s = p["status"]
    if s in ONGOING:
        return f"m{min(reached + 1, 3)}" if (s == "in_progress" or reached) else "m0"
    return s


def days_between(a: date | datetime | None, b: date | datetime | None) -> float | None:
    if not a or not b:
        return None
    a = a.astimezone(SG) if isinstance(a, datetime) else datetime(a.year, a.month, a.day, tzinfo=SG)
    b = b.astimezone(SG) if isinstance(b, datetime) else datetime(b.year, b.month, b.day, tzinfo=SG)
    d = (b - a).total_seconds() / 86400
    return d if d >= 0 else None


def crew_name(r: dict[str, Any]) -> str:
    """Who does the work on a project, as the scorecard groups it."""
    c = r["contractor"]
    if c["type"] == "group":
        return c["label"]
    return "Named crew members" if c["type"] == "users" else (c["label"] or "—")


def late_arrival(c: dict[str, Any], v: dict[str, Any] | None) -> bool:
    """A check-in an hour or more after its visit's start time."""
    if not v or not v["scheduled_time"]:
        return False
    hh, mm = (int(x) for x in v["scheduled_time"].split(":"))
    d = v["scheduled_date"]
    return c["checked_in_at"] - datetime(d.year, d.month, d.day, hh, mm, tzinfo=SG) >= timedelta(hours=1)


def avg(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 1) if xs else None


# ------------------------------------------------------------------ the whole dashboard


def build(
    *,
    today: date,
    w: Window,
    rows: list[dict[str, Any]],  # projects._row() output, already scoped
    raw: dict[int, dict[str, Any]],  # projects.* plus retailer_name, for the same ids
    milestones: list[dict[str, Any]],  # project_id, milestone_no, completed_at
    signatures: dict[int, datetime],  # project_id → signed_at
    history: list[dict[str, Any]],  # project_id, occurred_at, status (each status change, oldest first)
    visits: list[dict[str, Any]],  # visit_id, project_id, scheduled_date, scheduled_time
    check_ins: list[dict[str, Any]],  # project_id, visit_id, user_id, checked_in_at, crew_in
    requests: list[dict[str, Any]],  # account requests: created_at, requested_type, status
    managers: list[dict[str, Any]] | None,  # uid, name (a superadmin's view only)
) -> dict[str, Any]:
    by_id = {r["id"]: r for r in rows}
    ids = list(by_id)
    late_days = {r["id"]: max(0, (today - date.fromisoformat(r["endDate"])).days) if r["endDate"] else 0
                 for r in rows}  # fmt: skip
    late = [r["id"] for r in rows if any(f["kind"] == "overdue" for f in r["flags"])]
    no_show = [r["id"] for r in rows if any(f["kind"] == "no_show" for f in r["flags"])]

    created = {i: sg_day(raw[i]["created_at"]) for i in ids}
    closed_on = {i: sg_day(raw[i]["closed_at"]) for i in ids if raw[i].get("closed_at")}

    # When each project first reached each status (from the audit log).
    reached_at: dict[int, dict[str, datetime]] = defaultdict(dict)
    for h in history:
        reached_at[h["project_id"]].setdefault(h["status"], h["occurred_at"])
    done_at: dict[int, dict[int, datetime]] = defaultdict(dict)
    for m in milestones:
        done_at[m["project_id"]][m["milestone_no"]] = m["completed_at"]

    # ---- tiles: what needs a decision now, and what moved in the period
    def ids_where(pred: Any) -> list[int]:
        return [r["id"] for r in rows if pred(r)]

    new_ids = [i for i in ids if w.has(created[i])]
    new_prev = sum(1 for i in ids if w.had_before(created[i])) if w.start else None
    closed_ids = [i for i in ids if w.has(closed_on.get(i))]
    closed_prev = sum(1 for i in ids if w.had_before(closed_on.get(i))) if w.start else None
    ongoing = ids_where(lambda r: r["status"] in ONGOING)
    tiles = {
        "ongoing": {"count": len(ongoing), "ids": ongoing},
        "late": {"count": len(late), "ids": sorted(late, key=lambda i: -late_days[i])},
        "noShow": {"count": len(no_show), "ids": no_show},
        "awaitingHomeowner": {"count": 0, "ids": ids_where(lambda r: r["status"] in WAITING_HOMEOWNER)},
        "awaitingPm": {"count": 0, "ids": ids_where(lambda r: r["status"] == "homeowner_approved")},
        "handover": {"count": 0, "ids": ids_where(lambda r: r["status"] in HANDOVER)},
        "closed": {"count": len(closed_ids), "ids": closed_ids, "delta": delta(len(closed_ids), closed_prev)},
        "new": {"count": len(new_ids), "ids": new_ids, "delta": delta(len(new_ids), new_prev)},
    }
    for t in tiles.values():
        t["count"] = len(t["ids"])

    # ---- pipeline
    stage_of = {r["id"]: stage_key(raw[r["id"]], r["milestone"]) for r in rows}
    pipeline = [{"key": k, "label": label, "ids": [i for i in ids if stage_of[i] == k]} for k, label in PIPELINE]
    for p in pipeline:
        p["count"] = len(p["ids"])

    # ---- trend: started and finished per week/month
    trend = []
    for label, s, e in buckets(w, today):
        trend.append({
            "label": label,
            "started": sum(1 for i in ids if created[i] and s <= created[i] <= e),
            "closed": sum(1 for i in ids if closed_on.get(i) and s <= closed_on[i] <= e),
        })  # fmt: skip

    # ---- on time: closed projects finished by their target date
    finished = [i for i in ids if i in closed_on and (w.start is None or w.has(closed_on[i]))]
    on_time = [i for i in finished if raw[i].get("target_end_date") and closed_on[i] <= raw[i]["target_end_date"]]
    on_time_block = {
        "closed": len(finished),
        "onTime": len(on_time),
        "rate": round(len(on_time) / len(finished), 3) if finished else None,
    }

    # ---- delivery: how long each stage takes (stages finished in the period)
    durations: dict[str, list[float]] = defaultdict(list)
    cycle: list[float] = []
    for i in ids:
        r_at, d_at = reached_at.get(i, {}), done_at.get(i, {})
        steps = {
            "homeowner": (raw[i]["created_at"], r_at.get("homeowner_approved")),
            "pm": (r_at.get("homeowner_approved"), r_at.get("pm_approved")),
            "m1": (r_at.get("pm_approved"), d_at.get(1)),
            "m2": (d_at.get(1), d_at.get(2)),
            "m3": (d_at.get(2), d_at.get(3)),
            "sign": (d_at.get(3), signatures.get(i)),
            "close": (signatures.get(i), raw[i].get("closed_at")),
        }
        for k, (a, b) in steps.items():
            d = days_between(a, b)
            if d is not None and (w.start is None or w.has(sg_day(b) if isinstance(b, datetime) else b)):
                durations[k].append(d)
        if i in closed_on and (w.start is None or w.has(closed_on[i])):
            d = days_between(raw[i]["created_at"], raw[i]["closed_at"])
            if d is not None:
                cycle.append(d)
    stages = [{"key": k, "label": label, "avgDays": avg(durations[k]), "n": len(durations[k])} for k, label in STAGES]

    aging = [{"label": label, "ids": [i for i in late if lo <= late_days[i] <= hi]} for label, lo, hi in AGING]
    for a in aging:
        a["count"] = len(a["ids"])
    due_soon = sorted(
        (r["id"] for r in rows
         if r["status"] in ONGOING and r["endDate"] and 0 <= (date.fromisoformat(r["endDate"]) - today).days <= 14),
        key=lambda i: by_id[i]["endDate"],
    )  # fmt: skip

    # ---- site work
    mine = [v for v in visits if v["project_id"] in by_id]
    vis = [v for v in mine if w.has(v["scheduled_date"]) and v["scheduled_date"] <= today]
    checked_days = {(c["project_id"], sg_day(c["checked_in_at"])) for c in check_ins}
    visit_by_id = {v["visit_id"]: v for v in visits}
    attended = [v for v in vis if (v["project_id"], v["scheduled_date"]) in checked_days]
    missed = [
        v for v in vis if v["scheduled_date"] < today and (v["project_id"], v["scheduled_date"]) not in checked_days
    ]
    period_checks = [c for c in check_ins if c["project_id"] in by_id and w.has(sg_day(c["checked_in_at"]))]
    late_arrivals = sum(1 for c in period_checks if late_arrival(c, visit_by_id.get(c["visit_id"])))
    heat = [[0] * len(HOURS) for _ in WEEKDAYS]
    for c in period_checks:
        t = c["checked_in_at"].astimezone(SG)
        if t.hour in HOURS:
            heat[t.weekday()][HOURS.index(t.hour)] += 1
    upcoming = sum(1 for v in mine if today < v["scheduled_date"] <= today + timedelta(days=7))

    crews: dict[str, dict[str, Any]] = {}
    for r in rows:
        name = crew_name(r)
        c = crews.setdefault(name, {"name": name, "projects": 0, "ongoing": 0, "late": 0, "visits": 0, "attended": 0,
                                    "missed": 0, "lateArrivals": 0})  # fmt: skip
        c["projects"] += 1
        c["ongoing"] += r["status"] in ONGOING
        c["late"] += r["id"] in late
        c["visits"] += sum(1 for v in vis if v["project_id"] == r["id"])
        c["attended"] += sum(1 for v in attended if v["project_id"] == r["id"])
        c["missed"] += sum(1 for v in missed if v["project_id"] == r["id"])
    for c in period_checks:
        if late_arrival(c, visit_by_id.get(c["visit_id"])):
            crews[crew_name(by_id[c["project_id"]])]["lateArrivals"] += 1
    for c in crews.values():
        due = c["attended"] + c["missed"]
        c["attendance"] = round(c["attended"] / due, 3) if due else None
    site = {
        "visits": len(vis),
        "attended": len(attended),
        "missed": len(missed),
        "attendance": round(len(attended) / (len(attended) + len(missed)), 3) if (attended or missed) else None,
        "lateArrivals": late_arrivals,
        "checkIns": len(period_checks),
        "avgCrew": avg([float(c["crew_in"]) for c in period_checks if c["crew_in"]]),
        "upcoming": upcoming,
        "heatmap": {"days": WEEKDAYS, "hours": HOURS, "counts": heat},
        "crews": sorted(crews.values(), key=lambda c: (-c["ongoing"], -c["projects"], c["name"])),
    }

    # ---- sales and marketing
    closed_all = [i for i in ids if raw[i]["status"] == "closed"]
    installed = [i for i in closed_all if w.start is None or w.has(closed_on.get(i))]
    pipeline_kwp = round(sum(kwp(raw[i]) for i in ids if raw[i]["status"] != "closed"), 2)
    sized = [kwp(raw[i]) for i in ids if kwp(raw[i]) > 0]
    approved = [i for i in ids if "homeowner_approved" in reached_at.get(i, {})
                and w.has(sg_day(reached_at[i]["homeowner_approved"]))]  # fmt: skip
    declined = [i for i in ids if "homeowner_declined" in reached_at.get(i, {})
                and w.has(sg_day(reached_at[i]["homeowner_declined"]))]  # fmt: skip
    to_approve = [d for i in approved if (d := days_between(raw[i]["created_at"], reached_at[i]["homeowner_approved"]))
                  is not None]  # fmt: skip

    def group(key: Any) -> list[dict[str, Any]]:
        g: dict[str, dict[str, Any]] = {}
        for i in new_ids if w.start else ids:
            k = key(raw[i])
            e = g.setdefault(k, {"label": k, "count": 0, "kwp": 0.0, "closed": 0})
            e["count"] += 1
            e["kwp"] = round(e["kwp"] + kwp(raw[i]), 2)
            e["closed"] += raw[i]["status"] == "closed"
        return sorted(g.values(), key=lambda e: (-e["count"], -e["kwp"], e["label"]))

    new_trend = [{"label": label, "count": sum(1 for i in ids if created[i] and s <= created[i] <= e)}
                 for label, s, e in buckets(w, today)]  # fmt: skip
    reqs = [r for r in requests if w.has(sg_day(r["created_at"]))]
    reqs_prev = sum(1 for r in requests if w.had_before(sg_day(r["created_at"]))) if w.start else None
    sales = {
        "newProjects": {"count": len(new_ids), "delta": delta(len(new_ids), new_prev)},
        "installedKwp": round(sum(kwp(raw[i]) for i in installed), 2),
        "installedCount": len(installed),
        "pipelineKwp": pipeline_kwp,
        "avgKwp": avg(sized),
        "approval": {
            "approved": len(approved),
            "declined": len(declined),
            "rate": round(len(approved) / (len(approved) + len(declined)), 3) if (approved or declined) else None,
            "avgDays": avg(to_approve),
        },
        "trend": new_trend,
        "byRegion": group(lambda p: region(p.get("postal_code"))),
        "byRetailer": group(lambda p: p.get("retailer_name") or "Not recorded"),
        "bySales": group(lambda p: salesperson(p.get("sales"))),
        "signups": {
            "count": len(reqs),
            "delta": delta(len(reqs), reqs_prev),
            "approved": sum(1 for r in reqs if r["status"] == "approved"),
            "pending": sum(1 for r in reqs if r["status"] == "pending"),
            "byRole": [{"label": k, "count": v} for k, v in Counter(r["requested_type"] for r in reqs).most_common()],
        },
    }

    # ---- by project manager (a superadmin's view)
    team = None
    if managers is not None:
        team = []
        for m in managers:
            mine = [i for i in ids if by_id[i]["pm"]["uid"] == m["uid"]]
            fin = [i for i in finished if i in mine]
            team.append({
                "uid": m["uid"],
                "name": m["name"],
                "projects": len(mine),
                "ongoing": sum(1 for i in mine if by_id[i]["status"] in ONGOING),
                "late": sum(1 for i in mine if i in late),
                "closed": sum(1 for i in closed_ids if i in mine),
                "onTime": round(sum(1 for i in fin if i in on_time) / len(fin), 3) if fin else None,
            })  # fmt: skip
        # Managers with no projects in view (a superadmin who runs none) would only be zeros.
        team = [t for t in team if t["projects"]]
        team.sort(key=lambda t: (-t["ongoing"], -t["projects"], t["name"] or ""))

    projects = {
        i: {
            "id": i,
            "name": r["name"],
            "status": r["status"],
            "statusLabel": r["statusLabel"],
            "pm": r["pm"]["name"],
            "homeowner": r["homeowner"]["name"],
            "progress": r["progress"],
            "endDate": r["endDate"],
            "daysLate": late_days[i] if i in late else 0,
            "flags": [f["text"] for f in r["flags"]],
        }
        for i, r in by_id.items()
    }
    return {
        "period": {
            "key": w.key,
            "label": w.label,
            "from": w.start.isoformat() if w.start else None,
            "to": w.end.isoformat(),
        },  # fmt: skip
        "tiles": tiles,
        "pipeline": pipeline,
        "trend": trend,
        "onTime": on_time_block,
        "delivery": {
            "stages": stages,
            "cycleDays": avg(cycle),
            "cycleN": len(cycle),
            "aging": aging,
            "dueSoon": due_soon,
            "late": tiles["late"]["ids"],
        },
        "site": site,
        "sales": sales,
        "team": team,
        "projects": projects,
    }
