"""Maintenance: the systems 9 Solar Home looks after once they're turned on.

  GET   /maintenance                         every system this person looks after, with what's due
  GET   /maintenance/{sid}                   one system, and the project it came from
  PATCH /maintenance/{sid}                   change its details (a superadmin also assigns the manager)
  POST  /maintenance/{sid}/checks/{check}    record a check done {doneOn}, or undo it {doneOn: null}

A handed-over project becomes a maintenance record by itself (migration
0031); systems from before the app are imported from the project listing
(scripts/import_maintenance.py) and assigned later. A superadmin sees and
changes every record; a project manager the ones they look after and the
ones nobody has been given yet. The database enforces the same (guard_maintenance_write).
"""

from __future__ import annotations

import calendar
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import role
from _routes import projects as proj

router = APIRouter()
pm_only = role("project_manager")

# A check is "due soon" this many days ahead.
SOON = timedelta(days=30)
CHECKS: list[tuple[str, str]] = [("six_month", "6-month check"), ("one_year", "1-year check")]
COLUMN = {"six_month": ("six_month_due", "six_month_done_on"), "one_year": ("one_year_due", "one_year_done_on")}

SELECT = (
    "select m.*, u.full_name as pm_name, u.email as pm_email, h.full_name as h_name, h.email as h_email, "
    "p.name as project_name, p.status::text as project_status "
    "from maintenance_systems m left join users u on u.uid = m.run_by "
    "left join users h on h.uid = m.homeowner_id left join projects p on p.project_id = m.project_id"
)


def _visible(acct: Account) -> tuple[str, dict[str, Any]]:
    if acct.role == "superadmin":
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


def row(r: dict[str, Any], today: date) -> dict[str, Any]:
    checks = []
    for key, label in CHECKS:
        due_col, done_col = COLUMN[key]
        due, done = r[due_col], r[done_col]
        checks.append({
            "key": key,
            "label": label,
            "due": due.isoformat() if due else None,
            "doneOn": done.isoformat() if done else None,
            "state": check_state(due, done, today),
        })  # fmt: skip
    pending = [c for c in checks if c["state"] not in ("done", "unscheduled")]
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
def systems(acct: Account = Depends(pm_only)) -> dict[str, Any]:
    where, params = _visible(acct)
    today = proj.today()
    rows = fetch_all(f"{SELECT} where {where} order by m.address", params)  # type: ignore[arg-type]
    superadmin = acct.role == "superadmin"
    return {
        "systems": [row(r, today) for r in rows],
        "today": today.isoformat(),
        "canAssign": superadmin,
        "managers": _managers() if superadmin else [],
    }


@router.get("/maintenance/{sid}")
def system(sid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    r = _one(acct, sid)
    superadmin = acct.role == "superadmin"
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
    return {
        "system": row(r, proj.today()),
        "project": project,
        "canEdit": can_edit(acct, r),
        "canAssign": superadmin,
        "managers": _managers() if superadmin else [],
    }


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
    sixMonthDue: date | None = None
    oneYearDue: date | None = None
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
    if "sixMonthDue" in given:
        sets["six_month_due"] = body.sixMonthDue
    if "oneYearDue" in given:
        sets["one_year_due"] = body.oneYearDue
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

    # The turn-on date moves the checks with it, unless they were given too.
    if sets.get("turned_on_on"):
        sets.setdefault("six_month_due", _months(sets["turned_on_on"], 6))
        sets.setdefault("one_year_due", _months(sets["turned_on_on"], 12))
    on = sets.get("turned_on_on", r["turned_on_on"])
    six = sets.get("six_month_due", r["six_month_due"])
    year = sets.get("one_year_due", r["one_year_due"])
    if (on and six and six < on) or (six and year and year < six):
        raise HTTPException(400, "The checks come after the turn-on date: the 6-month check, then the 1-year one.")
    if not sets:
        raise HTTPException(400, "Nothing to change.")
    with transaction(acct.uid) as cur:
        cur.execute(
            f"update maintenance_systems set {', '.join(f'{k} = %({k})s' for k in sets)} where system_id = %(sid)s",
            {**sets, "sid": sid},
        )
    return system(sid, acct)


def _months(d: date, n: int) -> date:
    """d plus n months, on the month's last day when it's shorter (31 Dec + 6 months = 30 Jun)."""
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


class Done(BaseModel):
    doneOn: date | None


@router.post("/maintenance/{sid}/checks/{check}")
def check_done(sid: int, check: str, body: Done, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    if check not in COLUMN:
        raise HTTPException(404, "There's no such check.")
    r = _one(acct, sid)
    if not can_edit(acct, r):
        raise HTTPException(403, "This system is looked after by another project manager.")
    if body.doneOn and body.doneOn > proj.today():
        raise HTTPException(400, "A check can't be done in the future.")
    if body.doneOn and r["turned_on_on"] and body.doneOn < r["turned_on_on"]:
        raise HTTPException(400, "A check can't be done before the system was turned on.")
    with transaction(acct.uid) as cur:
        cur.execute(f"update maintenance_systems set {COLUMN[check][1]} = %s where system_id = %s", (body.doneOn, sid))
    return system(sid, acct)
