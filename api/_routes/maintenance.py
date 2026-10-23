"""Maintenance: the systems 9 Solar Home looks after once they're turned on.

  GET   /maintenance                         every system this person looks after, with what's due
  GET   /maintenance/{sid}                   one system, and the project it came from
  PATCH /maintenance/{sid}                   change its details (a superadmin also assigns the manager)
  POST  /maintenance/{sid}/checks/{check}    record a yearly check (year_2...) done {doneOn}, or undo it {doneOn: null}

A handed-over project becomes a maintenance record by itself (migration
0031); systems from before the app are imported from the project listing
(scripts/import_maintenance.py) and assigned later. A superadmin sees and
changes every record; a project manager the ones they look after and the
ones nobody has been given yet. The database enforces the same (guard_maintenance_write).

Checks are yearly from the second year, for the plan's years (_lib/checks.py).
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from _lib import checks as yearly
from _lib import maintenance_jobs as jobs
from _lib import records
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active, role
from _routes import projects as proj

router = APIRouter()
pm_only = role("project_manager")
# Admin (finance) looks at every system, read-only.
looks = role("project_manager", "finance")

# A check is "due soon" this many days ahead.
SOON = timedelta(days=30)

SELECT = (
    "select m.*, u.full_name as pm_name, u.email as pm_email, h.full_name as h_name, h.email as h_email, "
    "p.name as project_name, p.status::text as project_status "
    "from maintenance_systems m left join users u on u.uid = m.run_by "
    "left join users h on h.uid = m.homeowner_id left join projects p on p.project_id = m.project_id"
)


def _visible(acct: Account) -> tuple[str, dict[str, Any]]:
    if acct.role in ("superadmin", "finance"):
        return "true", {}
    return "(m.run_by is null or m.run_by = %(me)s)", {"me": acct.uid}


def can_edit(acct: Account, r: dict[str, Any]) -> bool:
    return acct.role == "superadmin" or (acct.role == "project_manager" and r["run_by"] in (None, acct.uid))


def check_state(due: date | None, done: date | None, today: date) -> str:
    if done:
        return "done"
    if due is None:
        return "unscheduled"
    if due < today:
        return "overdue"
    if due <= today + SOON:
        return "due_soon"
    return "scheduled"


def bookings(sids: list[int]) -> dict[tuple[int, str], dict[str, Any]]:
    """The next visit booked for each check (a maintenance-check meeting not cancelled or over)."""
    out: dict[tuple[int, str], dict[str, Any]] = {}
    for b in fetch_all(
        "select distinct on (m.system_id, m.check_key) m.system_id, m.check_key, m.meeting_id, m.starts_at, m.ends_at, "
        "bool_and(mp.response = 'accepted') over (partition by m.meeting_id) as agreed "
        "from meetings m join meeting_people mp on mp.meeting_id = m.meeting_id "
        "where m.system_id = any(%s) and m.kind = 'maintenance_check' and m.cancelled_at is null and m.ends_at > now() "
        "order by m.system_id, m.check_key, m.starts_at",
        (sids,),
    ):
        out[(b["system_id"], b["check_key"])] = {
            "meetingId": b["meeting_id"],
            "startsAt": b["starts_at"].astimezone(proj.SG).isoformat(),
            "endsAt": b["ends_at"].astimezone(proj.SG).isoformat(),
            "agreed": bool(b["agreed"]),
        }
    return out


def row(
    r: dict[str, Any],
    today: date,
    booked: dict[tuple[int, str], dict[str, Any]] | None = None,
    done: dict[int, dict[int, date]] | None = None,
    *,
    office: bool = True,
) -> dict[str, Any]:
    if done is None:
        done = yearly.done([r["system_id"]])
    checks = [
        {
            "key": c.key,
            "year": c.year,
            "label": yearly.label(c.key),
            "due": c.due.isoformat() if c.due else None,
            "doneOn": c.done_on.isoformat() if c.done_on else None,
            # The 6-month check is a record: it's done or not, never late or due (checks.py).
            "state": ("done" if c.done_on else "record")
            if c.key == yearly.SIX_MONTH
            else check_state(c.due, c.done_on, today),
            "booked": None if c.done_on else (booked or {}).get((r["system_id"], c.key)),
        }
        for c in yearly.for_system(r, done.get(r["system_id"]), office=office)
    ]
    pending = [c for c in checks if c["state"] not in ("done", "unscheduled", "record")]
    overdue = any(c["state"] == "overdue" for c in checks)
    panels = r["panels"] or []
    return {
        "id": r["system_id"],
        "address": r["address"],
        "postalCode": r["postal_code"],
        "imported": r["import_ref"] is not None,
        "project": {"id": r["project_id"], "name": r["project_name"], "status": r["project_status"]}
        if r["project_id"]
        else None,
        "pm": {"uid": r["run_by"], "name": (r["pm_name"] or r["pm_email"]) if r["run_by"] else None},
        "homeowner": {
            "uid": r["homeowner_id"],
            "name": (r["h_name"] or r["h_email"]) if r["homeowner_id"] else r["homeowner_name"],
            "linked": r["homeowner_id"] is not None,
        },
        "contactNo": r["homeowner_contact_no"],
        "ppa": {"kind": r["ppa_kind"], "years": r["ppa_years"]} if r["ppa_kind"] else None,
        "plan": {"years": r["plan_years"], "excludesFirstYear": bool(r["plan_excludes_first_year"])}
        if r["plan_years"]
        else None,
        "panels": panels,
        "panelCount": sum(int(p.get("count") or 0) for p in panels),
        "kwp": float(r["kwp"]) if r["kwp"] is not None else None,
        "phase": r["phase"],
        "inverters": list(r["inverters"] or []),
        "turnedOn": r["turned_on_on"].isoformat() if r["turned_on_on"] else None,
        "checkYears": yearly.term(r),
        "checks": checks,
        "next": pending[0] if pending else None,
        "roofAccess": r["roof_access"],
        "urgent": r["urgent"],
        "urgentNote": r["urgent_note"],
        "notes": r["notes"],
        "attention": bool(r["urgent"] or overdue),
        "updatedAt": r["updated_at"].isoformat(),
    }


def _managers() -> list[dict[str, Any]]:
    return [
        {"uid": m["uid"], "name": m["full_name"] or m["email"]}
        for m in fetch_all(
            "select uid, full_name, email from users where active "
            "and user_type in ('project_manager', 'superadmin') order by full_name nulls last"
        )
    ]


def _one(acct: Account, sid: int) -> dict[str, Any]:
    where, params = _visible(acct)
    r = fetch_one(f"{SELECT} where m.system_id = %(sid)s and {where}", {**params, "sid": sid})  # type: ignore[arg-type]
    if not r:
        raise HTTPException(404, "That system isn't in your maintenance list.")
    return r


@router.get("/maintenance")
def systems(acct: Account = Depends(looks)) -> dict[str, Any]:
    where, params = _visible(acct)
    today = proj.today()
    rows = fetch_all(f"{SELECT} where {where} order by m.address", params)  # type: ignore[arg-type]
    superadmin = acct.role == "superadmin"
    sids = [r["system_id"] for r in rows]
    booked, done = bookings(sids), yearly.done(sids)
    return {
        "systems": [row(r, today, booked, done) for r in rows],
        "today": today.isoformat(),
        "canAssign": superadmin,
        "managers": _managers() if superadmin else [],
    }


@router.get("/maintenance/{sid}")
def system(sid: int, acct: Account = Depends(looks)) -> dict[str, Any]:
    return detail(acct, _one(acct, sid))


@router.get("/projects/{pid}/maintenance")
def for_project(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    """A handed-over project's system, for its homeowner (to read, and to book a check) and its managers."""
    r = fetch_one(f"{SELECT} where m.project_id = %(pid)s", {"pid": pid})  # type: ignore[arg-type]
    p = fetch_one("select homeowner_id, project_manager_id from projects where project_id = %s", (pid,))
    if not r or not p:
        raise HTTPException(404, "This project isn't in maintenance yet.")
    if acct.role in ("project_manager", "superadmin"):
        return detail(acct, _one(acct, r["system_id"]))
    if acct.uid not in (r["homeowner_id"], p["homeowner_id"]):
        raise HTTPException(404, "This project isn't in maintenance yet.")
    return detail(acct, r)


def detail(acct: Account, r: dict[str, Any]) -> dict[str, Any]:
    superadmin = acct.role == "superadmin"
    homeowner = acct.role == "homeowner"
    project = None
    if r["project_id"]:
        sig = fetch_one(
            "select signed_at, certificate_url from project_signatures where project_id = %s", (r["project_id"],)
        )
        p = fetch_one("select closed_at from projects where project_id = %s", (r["project_id"],))
        project = {
            "id": r["project_id"],
            "name": r["project_name"],
            "signedAt": sig["signed_at"].isoformat() if sig else None,
            "closedAt": p["closed_at"].isoformat() if p and p["closed_at"] else None,
            "certificate": f"/api/py/projects/{r['project_id']}/handover/certificate.pdf"
            if sig and sig["certificate_url"]
            else None,
        }
    booked = bookings([r["system_id"]])
    system = row(r, proj.today(), booked, office=not homeowner)
    job = jobs.open_job(r["system_id"])
    current = jobs.for_screen(job)
    if current:
        # Its visit, once booked: the meeting for its check.
        current["visit"] = booked.get((r["system_id"], job["check_key"])) if job and job["check_key"] else None
    if homeowner:
        # The homeowner doesn't see the check schedule, when anything's due, or the office's notes: only
        # maintenance their project manager has started, its visit, and when it was last done.
        system.update(checks=[], next=None, attention=False, notes=None, urgent=False, urgentNote=None)
        last = jobs.latest(r["system_id"])
        return {
            "system": system,
            "project": project,
            "maintenance": current,
            "lastMaintained": last["finished_at"].isoformat() if last else None,
            "canEdit": False,
            "canAssign": False,
            "canBook": False,
            "canStart": False,
            "bookWith": [],
            "managers": [],
        }
    # A check is booked by the office, with the homeowner when they have an account. The homeowner
    # doesn't book: they're invited, and block out the times they can't do.
    with_whom = [r["homeowner_id"]] if r["homeowner_id"] and not homeowner else []
    out = {
        "system": system,
        "project": project,
        "canEdit": can_edit(acct, r),
        "canAssign": superadmin,
        "canBook": can_edit(acct, r),
        "canStart": can_edit(acct, r),
        "maintenance": current,
        "bookWith": [u for u in with_whom if u != acct.uid],
        "managers": _managers() if superadmin else [],
    }
    if acct.role in ("project_manager", "superadmin"):
        # The client record from the project list, output, billing, feedback and warranties: the office's only.
        out.update(records.for_system(r))
    return out


# ------------------------------------------------------------------ changes


class Panel(BaseModel):
    count: int = Field(ge=1, le=2000)
    wp: int | None = Field(default=None, ge=1, le=2000)


class Ppa(BaseModel):
    kind: Literal["ppa", "value_buy"]
    years: int | None = Field(default=None, ge=1, le=40)


class Plan(BaseModel):
    years: int = Field(ge=1, le=40)
    excludesFirstYear: bool = False


class Change(BaseModel):
    address: str | None = None
    postalCode: str | None = None
    homeownerName: str | None = None
    contactNo: str | None = None
    ppa: Ppa | None = None
    plan: Plan | None = None
    panels: list[Panel] | None = None
    kwp: float | None = Field(default=None, ge=0, le=100000)
    phase: Literal[1, 3] | None = None
    inverters: list[str] | None = None
    turnedOn: date | None = None
    roofAccess: bool | None = None
    urgent: bool | None = None
    urgentNote: str | None = None
    notes: str | None = None
    runBy: int | None = None


def _clean(v: str | None, most: int) -> str | None:
    t = " ".join((v or "").split())
    if len(t) > most:
        raise HTTPException(400, f"That's too long; keep it under {most} characters.")
    return t or None


@router.patch("/maintenance/{sid}")
def change(sid: int, body: Change, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    r = _one(acct, sid)
    if not can_edit(acct, r):
        raise HTTPException(403, "This system is looked after by another project manager.")
    given = body.model_fields_set
    sets: dict[str, Any] = {}
    if "address" in given:
        address = _clean(body.address, 300)
        if not address:
            raise HTTPException(400, "The address can't be empty.")
        sets["address"] = address
    if "postalCode" in given:
        code = _clean(body.postalCode, 6)
        if code and not (len(code) == 6 and code.isdigit()):
            raise HTTPException(400, "A postal code is six digits.")
        sets["postal_code"] = code
    if "homeownerName" in given:
        if r["homeowner_id"]:
            raise HTTPException(409, "The homeowner has an account; their name comes from it.")
        sets["homeowner_name"] = _clean(body.homeownerName, 120)
    if "contactNo" in given:
        sets["homeowner_contact_no"] = _clean(body.contactNo, 32)
    if "ppa" in given:
        if body.ppa and body.ppa.kind == "ppa" and not body.ppa.years:
            raise HTTPException(400, "Say how many years the PPA runs.")
        sets["ppa_kind"] = body.ppa.kind if body.ppa else None
        sets["ppa_years"] = body.ppa.years if body.ppa and body.ppa.kind == "ppa" else None
    if "plan" in given:
        sets["plan_years"] = body.plan.years if body.plan else None
        sets["plan_excludes_first_year"] = body.plan.excludesFirstYear if body.plan else None
    if "panels" in given:
        sets["panels"] = json.dumps([p.model_dump() for p in body.panels or []])
    if "kwp" in given:
        sets["kwp"] = Decimal(str(body.kwp)).quantize(Decimal("0.001")) if body.kwp is not None else None
    if "phase" in given:
        sets["phase"] = body.phase
    if "inverters" in given:
        models = [m for m in (_clean(x, 60) for x in body.inverters or []) if m]
        if len(models) > 20:
            raise HTTPException(400, "That's more inverters than a home has.")
        sets["inverters"] = models
    if "turnedOn" in given:
        sets["turned_on_on"] = body.turnedOn
    if "roofAccess" in given:
        sets["roof_access"] = body.roofAccess
    if "urgent" in given:
        if body.urgent is None:
            raise HTTPException(400, "Say whether it's urgent.")
        sets["urgent"] = body.urgent
        if not body.urgent:
            sets["urgent_note"] = None
    if "urgentNote" in given and (body.urgent or (body.urgent is None and r["urgent"])):
        sets["urgent_note"] = _clean(body.urgentNote, 500)
    if "notes" in given:
        sets["notes"] = _clean(body.notes, 2000)
    if "runBy" in given:
        if acct.role != "superadmin":
            raise HTTPException(403, "Only a superadmin can hand a system to a project manager.")
        if body.runBy is not None and not fetch_one(
            "select 1 from users where uid = %s and active and user_type in ('project_manager', 'superadmin')",
            (body.runBy,),
        ):
            raise HTTPException(400, "Choose an active project manager.")
        sets["run_by"] = body.runBy

    # The checks' dates follow from the turn-on date (_lib/checks.py): changing it moves them all.
    if not sets:
        raise HTTPException(400, "Nothing to change.")
    with transaction(acct.uid) as cur:
        cur.execute(
            f"update maintenance_systems set {', '.join(f'{k} = %({k})s' for k in sets)} where system_id = %(sid)s",
            {**sets, "sid": sid},
        )
    return system(sid, acct)


class Done(BaseModel):
    doneOn: date | None


class StartIn(BaseModel):
    checkKey: str | None = None
    note: str | None = None


@router.post("/maintenance/{sid}/jobs")
def start_maintenance(sid: int, body: StartIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """The project manager starts maintenance (for a yearly check, or not tied to one): the homeowner hears."""
    r = _one(acct, sid)
    if not can_edit(acct, r):
        raise HTTPException(403, "This system is looked after by another project manager.")
    if body.checkKey is not None:
        year = yearly.year_of(body.checkKey)
        if year is None or year not in yearly.years(yearly.term(r)):
            raise HTTPException(400, "That isn't one of the system's yearly checks.")
    try:
        jobs.start(r, body.checkKey, acct.uid, _clean(body.note, 1000))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return system(sid, acct)


class FinishIn(BaseModel):
    outcome: Literal["done", "cancelled"]


@router.post("/maintenance/{sid}/jobs/{jid}/finish")
def finish_maintenance(sid: int, jid: int, body: FinishIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Done (its check recorded as done today) or called off; the homeowner hears either way."""
    r = _one(acct, sid)
    if not can_edit(acct, r):
        raise HTTPException(403, "This system is looked after by another project manager.")
    job = jobs.open_job(sid)
    if not job or job["job_id"] != jid:
        raise HTTPException(404, "There's no maintenance under way with that number.")
    jobs.finish(r, job, body.outcome, acct.uid)
    year = yearly.year_of(job["check_key"] or "")
    if body.outcome == "done" and year is not None:
        with transaction(acct.uid) as cur:
            cur.execute(
                "insert into maintenance_checks (system_id, year, done_on) values (%s, %s, %s) on conflict do nothing",
                (sid, year, proj.today()),
            )
    return system(sid, acct)


@router.post("/maintenance/{sid}/checks/{check}")
def check_done(sid: int, check: str, body: Done, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    r = _one(acct, sid)
    if not can_edit(acct, r):
        raise HTTPException(403, "This system is looked after by another project manager.")
    six = check == yearly.SIX_MONTH
    year = yearly.year_of(check)
    if not six and (year is None or year not in yearly.years(yearly.term(r))):
        raise HTTPException(404, "There's no such check.")
    if body.doneOn and body.doneOn > proj.today():
        raise HTTPException(400, "A check can't be done in the future.")
    if body.doneOn and r["turned_on_on"] and body.doneOn < r["turned_on_on"]:
        raise HTTPException(400, "A check can't be done before the system was turned on.")
    if six:
        # The office's record of the 6-month check (migration 0057).
        with transaction(acct.uid) as cur:
            cur.execute(
                "update maintenance_systems set six_month_done_on = %s where system_id = %s", (body.doneOn, sid)
            )
        return system(sid, acct)
    job = jobs.open_job(sid)
    if body.doneOn and job and job["check_key"] == check:
        jobs.finish(r, job, "done", acct.uid)
    with transaction(acct.uid) as cur:
        if body.doneOn:
            cur.execute(
                "insert into maintenance_checks (system_id, year, done_on) values (%s, %s, %s) "
                "on conflict (system_id, year) do update set done_on = excluded.done_on",
                (sid, year, body.doneOn),
            )
        else:
            cur.execute("delete from maintenance_checks where system_id = %s and year = %s", (sid, year))
    return system(sid, acct)
