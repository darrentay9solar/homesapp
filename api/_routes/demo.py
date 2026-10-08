"""The demonstration site's "who do you want to be?" list (see _lib/demo.py).

  GET /demo/people   the sample people a visitor can try the app as

Only on the demo site; everywhere else it doesn't exist (404).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from _lib import demo
from _lib.account import ROLE_LABEL
from _lib.db import fetch_all

from .people import avatar_url

router = APIRouter()

ORDER = {"project_manager": 0, "contractor": 1, "epc_team": 2, "homeowner": 3}


@router.get("/demo/people")
def people() -> dict[str, Any]:
    if not demo.enabled():
        raise HTTPException(404, "Not found.")
    rows = fetch_all(
        "select u.uid, u.full_name, u.email, u.user_type, u.avatar_key, u.avatar_updated_at, "
        "coalesce((select string_agg(g.name, ', ' order by g.name) from contractor_group_members m "
        "join contractor_groups g on g.group_id = m.group_id where m.user_id = u.uid), '') as groups, "
        "coalesce((select string_agg(coalesce(nullif(p.name, ''), p.address), ', ' order by p.project_id) "
        "from projects p where p.homeowner_id = u.uid), '') as homes "
        "from users u where u.is_demo and u.active"
    )
    rows.sort(key=lambda r: (ORDER.get(r["user_type"], 9), r["full_name"] or ""))
    return {
        "people": [
            {
                "uid": r["uid"],
                "name": r["full_name"] or r["email"],
                "role": r["user_type"],
                "roleLabel": ROLE_LABEL[r["user_type"]],
                "avatar": avatar_url(r),
                "about": r["groups"] or r["homes"] or None,
            }
            for r in rows
        ]
    }
