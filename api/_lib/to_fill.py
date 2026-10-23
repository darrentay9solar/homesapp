"""What's still empty on a record imported from 9 Solar Home's lists, for its project manager to fill in.

Records that came in from the project listing or the client list (import_ref set) skipped the app's
flow, so much of what the flow would have recorded is missing. Every required field still empty is
flagged: highlighted on the project, counted on its maintenance system and in the lists, and sent to
the project manager as an alert when they're given the record.

  project  every required milestone field (project_fields), from before Milestone 1 to the handover
  system   the maintenance record itself: who and where, the panels and inverters, when it was turned
           on, its PPA and maintenance plan, and roof access

The record project an imported system gets (client_list.record_projects) holds the project's part, so
a system from the lists has the whole flow, project to maintenance, like one handed over in the app.
"""

from __future__ import annotations

from typing import Any

from _lib import notify, project_fields
from _lib.db import fetch_all, fetch_one

# A record project made for an imported system has this in front of the system's import_ref.
RECORD = "record:"

# The maintenance record's own fields, as the Maintenance page names them.
SYSTEM_FIELDS: list[tuple[str, str]] = [
    ("postal_code", "Postal code"),
    ("homeowner", "Homeowner"),
    ("homeowner_contact_no", "Contact number"),
    ("panels", "Panels"),
    ("kwp", "System size (kWp)"),
    ("phase", "Phase"),
    ("inverters", "Inverters"),
    ("turned_on_on", "Turned on"),
    ("ppa", "PPA"),
    ("plan_years", "Maintenance plan"),
    ("roof_access", "Roof access"),
]


def imported(r: dict[str, Any]) -> bool:
    return r.get("import_ref") is not None


def system_gaps(s: dict[str, Any]) -> list[str]:
    """The maintenance record's fields still empty, by label."""
    out = []
    for key, label in SYSTEM_FIELDS:
        if key == "homeowner":
            empty = not s.get("homeowner_id") and not (s.get("homeowner_name") or "").strip()
        elif key == "panels":
            empty = not any(int(p.get("count") or 0) for p in (s.get("panels") or []))
        elif key == "inverters":
            empty = not [x for x in (s.get("inverters") or []) if x]
        elif key == "ppa":
            empty = not s.get("ppa_kind") or (s["ppa_kind"] == "ppa" and not s.get("ppa_years"))
        else:
            v = s.get(key)
            empty = v is None or v == ""
        if empty:
            out.append(label)
    return out


def _projects(pids: list[int]) -> dict[int, tuple[dict[str, Any], dict[str, int]]]:
    """Projects as project_fields reads them, with their file counts: three queries for any number."""
    if not pids:
        return {}
    out: dict[int, tuple[dict[str, Any], dict[str, int]]] = {}
    for p in fetch_all(
        "select p.*, r.name as _retailer_name, h.ic_last4 as h_ic, h.email as h_email from projects p "
        "left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id "
        "left join users h on h.uid = p.homeowner_id where p.project_id = any(%s)",
        (pids,),
    ):
        p["_homeowner"] = {"ic_last4": p["h_ic"], "email": p["h_email"]}
        out[p["project_id"]] = (p, {})
    for r in fetch_all(
        "select project_id, category::text as c, count(*)::int as n from project_files "
        "where project_id = any(%s) group by 1, 2",
        (pids,),
    ):
        out[r["project_id"]][1][r["c"]] = r["n"]
    return out


def project_counts(pids: list[int]) -> dict[int, int]:
    """How many required fields are still empty on each imported project (0 for one from the app)."""
    return {pid: len(fields(p, f)) if imported(p) else 0 for pid, (p, f) in _projects(pids).items()}


def fields(p: dict[str, Any], files: dict[str, int]) -> list[project_fields.Field]:
    """A project's required fields still empty (those its conditions call for), in the flow's order."""
    return [
        f for f in project_fields.FIELDS if project_fields.counted(f, p) and not project_fields.is_filled(f, p, files)
    ]


def project_gaps(pid: int) -> list[str]:
    got = _projects([pid]).get(pid)
    return [f.label for f in fields(*got)] if got else []


def tell_manager(uid: int | None, *, project_id: int | None = None, system_id: int | None = None) -> bool:
    """Alerts the project manager just given an imported record to what's still to fill. Nothing for a
    record that came through the app, or one that's complete."""
    if not uid:
        return False
    s = fetch_one("select * from maintenance_systems where system_id = %s", (system_id,)) if system_id else None
    if s and not project_id:
        project_id = s["project_id"]
    p = (
        fetch_one("select project_id, name, address, import_ref from projects where project_id = %s", (project_id,))
        if project_id
        else None
    )
    if not ((p and imported(p)) or (s and imported(s))):
        return False
    on_project = project_gaps(p["project_id"]) if p else []
    on_system = system_gaps(s) if s else []
    n = len(on_project) + len(on_system)
    if not n:
        return False
    address = (s or p or {}).get("address") or ""
    if s:
        body = (
            "This record came in from 9 Solar Home's lists. Still to fill: "
            f"{len(on_system)} on the maintenance record, {len(on_project)} on the project record. "
            "They're highlighted for you."
        )
    else:
        body = (
            "This project came in from 9 Solar Home's lists. Still to fill: "
            f"{len(on_project)} on the project record. They're highlighted for you."
        )
    link = f"/maintenance/{s['system_id']}" if s else f"/projects/{p['project_id']}?tab=milestones"
    pid = p["project_id"] if p else None
    notify.notify(uid, "assignment", f"Fields to fill · {address}", body, project_id=pid, link=link)
    return True
