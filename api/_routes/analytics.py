"""The dashboard: a high-level view of the projects for quick decisions.

  GET /analytics?period=30d|90d|12m|all&pm=<uid>

Project managers see the projects they run; a superadmin sees every project
and may narrow it to one project manager. The numbers are worked out in
_lib/analytics.py from the same rows the Projects list shows, so the two
always agree (late, no-shows, progress).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from _lib import analytics as an
from _lib.account import Account
from _lib.db import fetch_all
from _lib.web import role
from _routes import projects as proj

router = APIRouter()
pm_only = role("project_manager")


@router.get("/analytics")
def dashboard(period: str = "90d", pm: int | None = None, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    if period not in an.PERIODS:
        raise HTTPException(400, "Choose a period: 30d, 90d, 12m or all.")
    superadmin = acct.role == "superadmin"
    if pm is not None and not superadmin:
        raise HTTPException(403, "Only a superadmin can look at another project manager's projects.")

    rows = proj._load(acct)
    if pm is not None:
        rows = [r for r in rows if r["pm"]["uid"] == pm]
    ids = [r["id"] for r in rows]
    raw = {
        r["project_id"]: r
        for r in fetch_all(
            "select p.*, r.name as retailer_name from projects p "
            "left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id "
            "where p.project_id = any(%(ids)s)",
            {"ids": ids},
        )
    }
    milestones = fetch_all(
        "select project_id, milestone_no, completed_at from project_milestones where project_id = any(%(ids)s)",
        {"ids": ids},
    )
    signatures = {
        s["project_id"]: s["signed_at"]
        for s in fetch_all(
            "select project_id, signed_at from project_signatures where project_id = any(%(ids)s)", {"ids": ids}
        )
    }
    # Status changes, from the audit log, read as this person (so its own access rules apply).
    history = fetch_all(
        "select project_id, occurred_at, changes->'status'->>'to' as status from audit_log "
        "where entity_table = 'projects' and changes ? 'status' and project_id = any(%(ids)s) "
        "order by occurred_at",
        {"ids": ids},
        actor_uid=acct.uid,
    )
    visits = fetch_all(
        "select visit_id, project_id, scheduled_date, scheduled_time from site_visits where project_id = any(%(ids)s)",
        {"ids": ids},
    )
    check_ins = fetch_all(
        "select project_id, visit_id, user_id, checked_in_at, crew_in from site_check_ins "
        "where project_id = any(%(ids)s)",
        {"ids": ids},
    )
    requests = fetch_all("select created_at, requested_type::text as requested_type, status::text as status "
                         "from account_requests")  # fmt: skip
    managers = None
    if superadmin:
        managers = [
            {"uid": m["uid"], "name": m["full_name"] or m["email"]}
            for m in fetch_all(
                "select uid, full_name, email from users where active "
                "and user_type in ('project_manager', 'superadmin') order by full_name nulls last"
            )
        ]
        if pm is not None:
            managers = [m for m in managers if m["uid"] == pm]

    today = proj.today()
    out = an.build(
        today=today,
        w=an.window(period, today),
        rows=rows,
        raw=raw,
        milestones=milestones,
        signatures=signatures,
        history=history,
        visits=visits,
        check_ins=check_ins,
        requests=requests,
        managers=managers,
    )
    out["scope"] = {
        "superadmin": superadmin,
        "pm": pm,
        "managers": [{"uid": m["uid"], "name": m["full_name"] or m["email"]} for m in fetch_all(
            "select uid, full_name, email from users where active and user_type in ('project_manager', 'superadmin') "
            "order by full_name nulls last")] if superadmin else [],
    }  # fmt: skip
    return out
