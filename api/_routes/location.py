"""Where the EPC crew last were: the GPS fix from their latest check-in or check-out.

  GET /people/locations   (project managers and superadmins)

A crew member's location is taken only when they press Check In or Check Out
(the phone's GPS proves they're at the house); nothing tracks anyone in
between. A superadmin sees everyone's latest fix; a project manager only
fixes taken on the projects they run.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all
from _lib.web import role

from .people import avatar_url

router = APIRouter()


@router.get("/people/locations")
def locations(acct: Account = Depends(role("project_manager"))) -> dict[str, Any]:
    """Every active EPC crew member, with where they last checked in or out (newest first)."""
    scope = "true" if acct.role == "superadmin" else "p.project_manager_id = %(me)s"
    rows = fetch_all(
        f"""
        with fixes as (
            select c.user_id as uid, c.project_id, c.lat, c.lng, c.accuracy_m, c.checked_in_at as at, 'in' as kind
              from site_check_ins c
            union all
            select c.user_id, c.project_id, c.checkout_lat, c.checkout_lng, c.checkout_accuracy_m,
                   c.checked_out_at, 'out'
              from site_check_ins c
             where c.checked_out_at is not null and c.checkout_lat is not null
        ), latest as (
            select distinct on (f.uid) f.*, coalesce(nullif(p.name, ''), p.address) as project
              from fixes f join projects p on p.project_id = f.project_id
             where {scope}
             order by f.uid, f.at desc
        )
        select u.uid, u.full_name, u.email, u.user_type, u.avatar_key, u.avatar_updated_at,
               l.project_id, l.project, l.lat, l.lng, l.accuracy_m, l.at, l.kind
          from users u left join latest l on l.uid = u.uid
         where u.active and u.user_type = 'epc_team'
         order by l.at desc nulls last, u.full_name nulls last, u.email
        """,
        {"me": acct.uid},
        actor_uid=acct.uid,
    )
    return {
        "people": [
            {
                "uid": r["uid"],
                "name": r["full_name"] or r["email"],
                "role": r["user_type"],
                "roleLabel": ROLE_LABEL[r["user_type"]],
                "avatar": avatar_url(r),
                "location": {
                    "lat": r["lat"],
                    "lng": r["lng"],
                    "accuracy": r["accuracy_m"],
                    "at": r["at"].isoformat(),
                    "kind": r["kind"],
                    "projectId": r["project_id"],
                    "project": r["project"],
                }
                if r["at"]
                else None,
            }
            for r in rows
        ]
    }
