"""Site visits, GPS check-in and check-out, and visit reminders.

From the brief:
  * The admin team or a project manager picks the dates (and, optionally, the
    start time) the EPC team must be on site. The crew is told.
  * The EPC team checks in when they arrive — any day of the week — with how
    many people are on site, and checks out when they leave, with how many
    are still there. The phone's GPS must put them at the site.
  * A reminder goes out an hour before a visit starts, and again if nobody
    has checked in an hour after it started. A visit nobody checked in for
    turns the project red (projects.py).

Where and who are decided by the database (0007, 0013, 0020, 0021); this
module turns its answers into plain messages.
"""

from __future__ import annotations

import hmac
import re
from datetime import date, datetime, timedelta
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from _lib import notify
from _lib.account import Account
from _lib.auth import env
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import act_as_allowed, active
from _routes.project_work import _need, _project
from _routes.projects import SG, today

router = APIRouter()

OPEN_FOR_WORK = ("pm_approved", "in_progress")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
GPS_MESSAGE = "You're currently not receiving GPS signal, please move to a spot where you can."


def _crew(pid: int, group_id: int | None, *, epc_only: bool = False) -> list[dict[str, Any]]:
    rows = fetch_all(
        "select u.uid, u.full_name, u.user_type from users u where u.active and u.uid in ("
        "select user_id from contractor_group_members where group_id = %(g)s "
        "union select user_id from project_assignments where project_id = %(p)s)",
        {"g": group_id, "p": pid},
    )
    return [r for r in rows if not epc_only or r["user_type"] == "epc_team"]


def _when(d: date, t: str | None) -> str:
    return d.strftime("%d %b %Y") + (f" at {t}" if t else "")


def _check_in_row(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["check_in_id"],
        "visitId": r["visit_id"],
        "by": {"uid": r["user_id"], "name": r["by_name"]},
        "inAt": r["checked_in_at"].isoformat(),
        "crewIn": r["crew_in"],
        "distance": round(r["distance_m"], 1) if r["distance_m"] is not None else None,
        "outAt": r["checked_out_at"].isoformat() if r["checked_out_at"] else None,
        "crewOut": r["crew_out"],
        "outDistance": round(r["checkout_distance_m"], 1) if r["checkout_distance_m"] is not None else None,
    }


CHECK_INS = (
    "select c.*, u.full_name as by_name, (c.checked_in_at at time zone 'Asia/Singapore')::date as day "
    "from site_check_ins c join users u on u.uid = c.user_id"
)


# ------------------------------------------------------------------ reading


@router.get("/projects/{pid}/visits")
def visits(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    rel = _need(acct, p)
    t = today()
    checks = fetch_all(CHECK_INS + " where c.project_id = %s order by c.checked_in_at desc", (pid,))
    out = []
    linked: set[int] = set()
    for v in fetch_all(
        "select v.*, u.full_name as by_name from site_visits v left join users u on u.uid = v.created_by "
        "where v.project_id = %s order by v.scheduled_date, v.scheduled_time nulls first",
        (pid,),
    ):
        mine = [
            c
            for c in checks
            if c["visit_id"] == v["visit_id"] or (c["visit_id"] is None and c["day"] == v["scheduled_date"])
        ]
        linked |= {c["check_in_id"] for c in mine}
        d = v["scheduled_date"]
        state = "attended" if mine else "upcoming" if d > t else "today" if d == t else "missed"
        out.append(
            {
                "id": v["visit_id"],
                "date": d.isoformat(),
                "time": v["scheduled_time"],
                "note": v["works_note"],
                "by": v["by_name"],
                "state": state,
                "checkIns": [_check_in_row(c) for c in mine],
            }
        )
    open_work = p["status"] in OPEN_FOR_WORK
    epc_on_crew = rel == "crew" and acct.role == "epc_team"
    mine_open = next((c for c in checks if c["user_id"] == acct.uid and c["checked_out_at"] is None), None)
    return {
        "visits": out,
        "unscheduled": [_check_in_row(c) for c in checks if c["check_in_id"] not in linked],
        "canSchedule": rel in ("pm", "crew") and open_work,
        "canCheckIn": epc_on_crew and open_work and p["site_lat"] is not None,
        "myOpenCheckIn": _check_in_row(mine_open) if mine_open else None,
        "site": {
            "located": p["site_lat"] is not None,
            "radius": p["check_in_radius_m"],
            # On a laptop only: lets "Use the site's location" stand in for a phone's GPS when testing.
            "lat": p["site_lat"] if act_as_allowed() else None,
            "lng": p["site_lng"] if act_as_allowed() else None,
        },
        "status": p["status"],
    }


@router.get("/sites")
def sites(acct: Account = Depends(active)) -> dict[str, Any]:
    """The EPC team's day: where they're on site now, today's visits, and every site they can check in at."""
    if acct.role not in ("epc_team", "contractor"):
        raise HTTPException(403, "Sites are for the contractor's crew.")
    t = today()
    rows = fetch_all(
        """
        select p.project_id, p.name, p.address, p.postal_code, p.status, p.site_lat is not null as located,
               p.check_in_radius_m, p.site_lat, p.site_lng
          from projects p
         where p.status in ('pm_approved', 'in_progress')
           and (exists (select 1 from contractor_group_members m where m.group_id = p.contractor_group_id
                        and m.user_id = %(me)s)
                or exists (select 1 from project_assignments a
                           where a.project_id = p.project_id and a.user_id = %(me)s))
         order by p.name
        """,
        {"me": acct.uid},
    )
    ids = [r["project_id"] for r in rows]
    visits_by: dict[int, list[dict[str, Any]]] = {}
    for v in fetch_all(
        "select * from site_visits where project_id = any(%(ids)s) and scheduled_date >= %(t)s "
        "order by scheduled_date, scheduled_time nulls first",
        {"ids": ids, "t": t},
    ):
        visits_by.setdefault(v["project_id"], []).append(v)
    open_by = {
        c["project_id"]: c
        for c in fetch_all(CHECK_INS + " where c.user_id = %(me)s and c.checked_out_at is null", {"me": acct.uid})
    }
    epc = acct.role == "epc_team"
    out = []
    for r in rows:
        vs = visits_by.get(r["project_id"], [])
        today_v = [v for v in vs if v["scheduled_date"] == t]
        nxt = next((v for v in vs if v["scheduled_date"] > t), None)
        o = open_by.get(r["project_id"])
        out.append(
            {
                "id": r["project_id"],
                "name": r["name"],
                "address": r["address"],
                "postalCode": r["postal_code"],
                "located": r["located"],
                "radius": r["check_in_radius_m"],
                # Only for the development "use the site's location" option; the server decides regardless.
                "site": {"lat": r["site_lat"], "lng": r["site_lng"]} if act_as_allowed() else None,
                "today": [{"id": v["visit_id"], "time": v["scheduled_time"], "note": v["works_note"]} for v in today_v],
                "next": {
                    "date": nxt["scheduled_date"].isoformat(),
                    "time": nxt["scheduled_time"],
                    "note": nxt["works_note"],
                }
                if nxt
                else None,
                "open": _check_in_row(o) if o else None,
                "canCheckIn": epc and r["located"],
            }
        )
    out.sort(key=lambda s: (s["open"] is None, not s["today"], s["name"]))
    return {"sites": out, "canCheckIn": epc}


# ------------------------------------------------------------------ scheduling


class VisitIn(BaseModel):
    date: date
    time: str | None = None
    note: str = ""


@router.post("/projects/{pid}/visits")
def schedule(pid: int, body: VisitIn, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    rel = _need(acct, p)
    if rel not in ("pm", "crew"):
        raise HTTPException(403, "Only a project manager or the project's crew can schedule site visits.")
    if body.date < today():
        raise HTTPException(400, "Choose today or a later date.")
    t = (body.time or "").strip() or None
    if t and not TIME.match(t):
        raise HTTPException(400, "Enter the start time as HH:MM, e.g. 09:00.")
    note = body.note.strip()[:200] or None
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note, created_by) "
            "values (%s, %s, %s, %s, %s) returning visit_id",
            (pid, body.date, t, note, acct.uid),
        )
        vid = cur.fetchone()["visit_id"]
    when = _when(body.date, t)
    for u in _crew(pid, p["contractor_group_id"]):
        if u["uid"] != acct.uid:
            notify.notify(
                u["uid"],
                "visit_assigned",
                "Site visit assigned",
                f"{p['name']} — {when}." + (f" {note}" if note else ""),
                project_id=pid,
            )
    return {"id": vid, "message": f"Visit on {when} scheduled. The crew has been told."}


@router.delete("/projects/{pid}/visits/{vid}")
def cancel(pid: int, vid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    if _need(acct, p) not in ("pm", "crew"):
        raise HTTPException(403, "Only a project manager or the project's crew can cancel site visits.")
    v = fetch_one("select * from site_visits where visit_id = %s and project_id = %s", (vid, pid))
    if not v:
        raise HTTPException(404, "No such visit.")
    with transaction(acct.uid) as cur:
        cur.execute("delete from site_visits where visit_id = %s", (vid,))
    when = _when(v["scheduled_date"], v["scheduled_time"])
    for u in _crew(pid, p["contractor_group_id"]):
        if u["uid"] != acct.uid:
            notify.notify(
                u["uid"],
                "visit_assigned",
                "Site visit cancelled",
                f"{p['name']} — {when} is cancelled.",
                project_id=pid,
            )
    return {"message": f"Visit on {when} cancelled. The crew has been told."}


# ------------------------------------------------------------- check in / out


class FixIn(BaseModel):
    lat: float | None = None
    lng: float | None = None
    accuracy: float | None = None
    crew: int | None = None


def _gps_error(exc: psycopg.Error) -> HTTPException:
    state = getattr(exc, "sqlstate", "") or ""
    msg = (exc.diag.message_primary if exc.diag else None) or "That didn't go through."
    if state == "23505":
        return HTTPException(409, "You're already checked in here. Check out first.")
    if state == "42501":
        return HTTPException(403, msg)
    return HTTPException(400, msg)


@router.post("/projects/{pid}/check-ins")
def check_in(pid: int, body: FixIn, acct: Account = Depends(active)) -> dict[str, Any]:
    p = _project(pid)
    _need(acct, p)
    if acct.role != "epc_team":
        raise HTTPException(403, "Check-in is for the EPC team.")
    visit = fetch_one(
        "select visit_id from site_visits where project_id = %s and scheduled_date = %s "
        "order by scheduled_time nulls last limit 1",
        (pid, today()),
    )
    try:
        with transaction(acct.uid) as cur:
            cur.execute(
                "insert into site_check_ins (project_id, visit_id, user_id, crew_in, lat, lng, accuracy_m) "
                "values (%s, %s, %s, %s, %s, %s, %s) returning checked_in_at, distance_m",
                (pid, visit["visit_id"] if visit else None, acct.uid, body.crew, body.lat, body.lng, body.accuracy),
            )
            row = cur.fetchone()
    except psycopg.Error as exc:
        raise _gps_error(exc) from exc
    at = row["checked_in_at"].astimezone(SG).strftime("%H:%M")
    n = body.crew
    return {"message": f"Checked in at {at} with {n} crew on site.", "at": row["checked_in_at"].isoformat()}


@router.post("/check-ins/{cid}/check-out")
def check_out(cid: int, body: FixIn, acct: Account = Depends(active)) -> dict[str, Any]:
    c = fetch_one("select * from site_check_ins where check_in_id = %s", (cid,))
    if not c or c["user_id"] != acct.uid:
        raise HTTPException(404, "That check-in isn't yours.")
    if c["checked_out_at"]:
        raise HTTPException(409, "You've already checked out.")
    try:
        with transaction(acct.uid) as cur:
            cur.execute(
                "update site_check_ins set checked_out_at = now(), crew_out = %s, checkout_lat = %s, "
                "checkout_lng = %s, checkout_accuracy_m = %s where check_in_id = %s returning checked_out_at",
                (body.crew, body.lat, body.lng, body.accuracy, cid),
            )
            row = cur.fetchone()
    except psycopg.Error as exc:
        raise _gps_error(exc) from exc
    at = row["checked_out_at"].astimezone(SG).strftime("%H:%M")
    return {"message": f"Checked out at {at}. {body.crew} crew still on site.", "at": row["checked_out_at"].isoformat()}


# ------------------------------------------------------------------ reminders


def run_reminders(now: datetime) -> dict[str, int]:
    """Sends any visit reminder that's due, once. Safe to run as often as you like.

    before  an hour before a timed visit starts, to the EPC crew
    missed  an hour after a timed visit started (or the day after an untimed
            one) with no check-in that day, to the EPC crew and the PM
    """
    now = now.astimezone(SG)
    t = now.date()
    rows = fetch_all(
        """
        select v.*, p.name, p.contractor_group_id, p.project_manager_id,
               exists (select 1 from visit_reminders r
                       where r.visit_id = v.visit_id and r.kind = 'before') as sent_before,
               exists (select 1 from visit_reminders r
                       where r.visit_id = v.visit_id and r.kind = 'missed') as sent_missed,
               exists (select 1 from site_check_ins c where c.project_id = v.project_id
                       and (c.checked_in_at at time zone 'Asia/Singapore')::date = v.scheduled_date) as attended
          from site_visits v join projects p on p.project_id = v.project_id
         where p.status in ('pm_approved', 'in_progress')
           and v.scheduled_date between %(from)s and %(to)s
        """,
        {"from": t - timedelta(days=2), "to": t},
    )
    sent = {"before": 0, "missed": 0}
    for v in rows:
        start = None
        if v["scheduled_time"]:
            hh, mm = (int(x) for x in v["scheduled_time"].split(":"))
            start = datetime(
                v["scheduled_date"].year, v["scheduled_date"].month, v["scheduled_date"].day, hh, mm, tzinfo=SG
            )
        when = _when(v["scheduled_date"], v["scheduled_time"])
        epc = [u["uid"] for u in _crew(v["project_id"], v["contractor_group_id"], epc_only=True)]
        if start and not v["sent_before"] and not v["attended"] and start - timedelta(hours=1) <= now < start:
            for uid in epc:
                notify.notify(
                    uid,
                    "visit_reminder",
                    "Site visit in 1 hour",
                    f"{v['name']} — {when}." + (f" {v['works_note']}" if v["works_note"] else ""),
                    project_id=v["project_id"],
                )
            _mark(v["visit_id"], "before")
            sent["before"] += 1
        late = (start and now >= start + timedelta(hours=1)) or (not start and t > v["scheduled_date"])
        if late and not v["sent_missed"] and not v["attended"]:
            for uid in {*epc, v["project_manager_id"]} - {None}:
                notify.notify(
                    uid,
                    "visit_missed",
                    "EPC team did not check in",
                    f"{v['name']} — the crew was scheduled for {when}. No check-in recorded.",
                    project_id=v["project_id"],
                )
            _mark(v["visit_id"], "missed")
            sent["missed"] += 1
    return sent


def _mark(vid: int, kind: str) -> None:
    with transaction(None) as cur:
        cur.execute("insert into visit_reminders (visit_id, kind) values (%s, %s) on conflict do nothing", (vid, kind))


@router.post("/cron/visit-reminders")
def reminders(authorization: str = Header(default="")) -> dict[str, Any]:
    """Called on a schedule (every 15 minutes). Needs CRON_SECRET, so only the scheduler can run it."""
    secret = env("CRON_SECRET")
    if not secret:
        raise HTTPException(503, "CRON_SECRET isn't set, so reminders can't run.")
    if not hmac.compare_digest(authorization, f"Bearer {secret}"):
        raise HTTPException(401, "Not allowed.")
    return {"sent": run_reminders(datetime.now(SG))}
