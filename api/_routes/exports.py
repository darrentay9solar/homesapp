# ruff: noqa: E501  (column lists read better one per line)
"""Excel exports, for project managers and superadmins.

  GET /export/projects.xlsx   every project the reader runs (a superadmin: all), with every detail a
                              person would want, and a Maintenance sheet laid out like the project listing
  GET /export/people.xlsx     everyone with an account, their role, contact, groups and projects

Only what people read: no internal ids, storage keys or GPS internals, and
never the NRIC digits. Column names follow the reader's language. Each
export is recorded in the audit log (who exported what, and how many rows).
"""

from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, transaction
from _lib.i18n import tr
from _lib.web import role
from _routes import maintenance as mt
from _routes import projects as proj

router = APIRouter()
pm_only = role("project_manager")
SG = ZoneInfo("Asia/Singapore")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
SP_STATUS = {1: "Not submitted", 2: "Submitted", 3: "Approved"}


def yes_no(v: Any) -> str | None:
    return None if v is None else ("Yes" if v else "No")


def local(v: datetime | None) -> datetime | None:
    # Excel has no time zones: Singapore time, as people read it.
    return v.astimezone(SG).replace(tzinfo=None) if v else None


def workbook(sheets: list[tuple[str, list[str], list[list[Any]]]], lang: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    wb.remove(wb.active)
    for title, head, rows in sheets:
        ws = wb.create_sheet(tr(title, lang) or title)
        ws.append([tr(h, lang) or h for h in head])
        for r in rows:
            ws.append([float(v) if isinstance(v, Decimal) else v for v in r])
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="0E7F53")
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.freeze_panes = "B2"
        if rows:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(head))}{len(rows) + 1}"
        for i, h in enumerate(head, start=1):
            col = ws.column_dimensions[get_column_letter(i)]
            longest = max([len(str(tr(h, lang) or h))] + [len(str(r[i - 1])) for r in rows if r[i - 1] is not None])
            col.width = min(max(10, longest + 2), 48)
            for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
                c = row[0]
                if isinstance(c.value, datetime):
                    c.number_format = "yyyy-mm-dd hh:mm"
                elif isinstance(c.value, date):
                    c.number_format = "yyyy-mm-dd"
                elif isinstance(c.value, str) and "\n" in c.value:
                    c.alignment = Alignment(wrap_text=True, vertical="top")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _record(acct: Account, what: str, n: int) -> None:
    """The audit log keeps who exported what: the export is an act on personal data."""
    with transaction(acct.uid) as cur:
        cur.execute("insert into data_exports (what, row_count, exported_by) values (%s, %s, %s)", (what, n, acct.uid))


def _send(data: bytes, name: str) -> Response:
    stamp = datetime.now(SG).strftime("%d %b %Y")
    return Response(
        data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name} {stamp}.xlsx"', "Cache-Control": "no-store"},
    )


# ------------------------------------------------------------------ projects

PROJECT_HEAD = [
    "S/N", "Project", "Status", "Address", "Postal Code", "Homeowner", "Homeowner contact no.", "Homeowner email",
    "Project manager", "Contractor", "Crew", "Created", "Start date", "Target end date", "Days running", "Progress (%)",
    "Current milestone", "Late", "Attention", "Electricity retailer", "Retailer contract end date", "SP application status",
    "Sales", "Waterproofing required", "Group chat created", "No. of Panels (est.)", "No. of Panels (actual)", "Panel Wp",
    "kWp DC", "Inverter", "Inverter serial number", "Inverter collected", "Inverter date", "Panel installation completed",
    "Scaffolding removed", "Scaffolding removal date", "SP submission date", "Grid connection done",
    "Scheduled grid connection date", "RCB replacement required", "RCB replacement date", "PVL received date",
    "Pre-inspection date", "SP appointment letter received", "Meter replacement date", "Turn On Date (SP inspection)",
    "FusionSolar app access", "Documents and photos", "Handover signed by", "Handover signed on", "Handed over on",
    "Handed over by", "PPA", "Maintenance Plan", "1P or 3P", "6 Months", "6-month check done", "1 Year",
    "1-year check done", "Roof Access", "Urgent Maintenance",
]  # fmt: skip

MAINT_HEAD = [
    "S/N", "Address", "Postal Code", "PPA", "No. of Panels", "Panel Wp", "kWp DC", "1P or 3P", "Inverter",
    "Turn On Date", "6 Months", "6-month check done", "1 Year", "1-year check done", "Maintenance Plan", "Roof Access",
    "Urgent Maintenance due to Poor Generation", "Project manager", "Homeowner", "Homeowner contact no.", "Project",
    "Source", "Notes",
]  # fmt: skip


def ppa_text(s: dict[str, Any] | None) -> str | None:
    if not s or not s.get("ppa_kind"):
        return None
    return "Value buy" if s["ppa_kind"] == "value_buy" else f"{s['ppa_years']} Years"


def plan_text(s: dict[str, Any] | None) -> str | None:
    if not s or not s.get("plan_years"):
        return None
    n = s["plan_years"]
    return f"{n} years excluding 1st year" if s["plan_excludes_first_year"] else f"Free for {n} years"


def phase_text(s: dict[str, Any] | None) -> str | None:
    return {1: "Single-phase", 3: "3-phase"}.get((s or {}).get("phase"))


def panel_wp(s: dict[str, Any]) -> Any:
    panels = s.get("panels") or []
    if len(panels) == 1:
        return panels[0].get("wp")
    return "\n".join(f"{p['count']} Nos. x {p.get('wp') or '?'} Wp" for p in panels) or None


def maintenance_rows(acct: Account) -> list[list[Any]]:
    where, params = mt._visible(acct)
    rows = fetch_all(f"{mt.SELECT} where {where} order by m.turned_on_on nulls last, m.address", params)  # type: ignore[arg-type]
    out = []
    for n, s in enumerate(rows, start=1):
        panels = s["panels"] or []
        out.append([
            n, s["address"], s["postal_code"], ppa_text(s), sum(int(p.get("count") or 0) for p in panels) or None,
            panel_wp(s), s["kwp"], phase_text(s), "\n".join(s["inverters"] or []) or None, s["turned_on_on"],
            s["six_month_due"], s["six_month_done_on"], s["one_year_due"], s["one_year_done_on"], plan_text(s),
            yes_no(s["roof_access"]), s["urgent_note"] or ("Yes" if s["urgent"] else None),
            s["pm_name"] or s["pm_email"], s["h_name"] or s["h_email"] or s["homeowner_name"], s["homeowner_contact_no"],
            s["project_name"], "Project listing" if s["import_ref"] else ("Project" if s["project_id"] else "Added"),
            s["notes"],
        ])  # fmt: skip
    return out


@router.get("/export/projects.xlsx")
def export_projects(acct: Account = Depends(pm_only)) -> Response:
    listed = {p["id"]: p for p in proj._load(acct)}
    ids = list(listed)
    raw = {
        r["project_id"]: r
        for r in fetch_all(
            "select p.*, r.name as retailer_name, h.email as h_email, cb.full_name as closer, "
            "s.signed_at, coalesce(s.signer_name, su.full_name) as signer, "
            "(select count(*) from project_files f where f.project_id = p.project_id) as files "
            "from projects p left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id "
            "left join users h on h.uid = p.homeowner_id left join users cb on cb.uid = p.closed_by "
            "left join project_signatures s on s.project_id = p.project_id left join users su on su.uid = s.signed_by "
            "where p.project_id = any(%(ids)s)",
            {"ids": ids},
        )
    }
    systems = {
        s["project_id"]: s for s in fetch_all("select * from maintenance_systems where project_id = any(%s)", (ids,))
    }
    rows = []
    for n, pid in enumerate(sorted(ids, key=lambda i: listed[i]["createdAt"]), start=1):
        p, r, s = listed[pid], raw[pid], systems.get(pid)
        crew = ", ".join(t["name"] or "" for t in p["team"] if t["role"] in ("contractor", "epc_team"))
        count = r["panel_quantity_actual"] or r["panel_quantity_estimate"]
        kwp = round(count * r["panel_capacity"] / 1000, 3) if count and r["panel_capacity"] else None
        rows.append([
            n, r["name"], p["statusLabel"], r["address"], r["postal_code"], p["homeowner"]["name"],
            r["homeowner_contact_no"], r["h_email"], p["pm"]["name"], p["contractor"]["label"], crew or None,
            local(r["created_at"]), r["installation_start_date"], r["target_end_date"], p["daysElapsed"], p["progress"],
            "All milestones" if p["milestone"] == 3 else f"Milestone {p['currentMilestone']}",
            "Yes" if any(f["kind"] == "overdue" for f in p["flags"]) else "No",
            "\n".join(f["text"] for f in p["flags"]) or None, r["retailer_name"], r["retailer_contract_end_date"],
            SP_STATUS.get(r["sp_application_status"]), r["sales"], yes_no(r["waterproofing"]),
            yes_no(r["create_group_chat"]), r["panel_quantity_estimate"], r["panel_quantity_actual"], r["panel_capacity"],
            kwp, r["inverter_to_order"], r["inverter_serial_number"], yes_no(r["inverter_collected"]), r["inverter_date"],
            r["installation_end_date"], yes_no(r["scaffolding_removal"]), r["scaffolding_removal_date"],
            r["sp_submission_date"], yes_no(r["inverter_commission_grid_connection"]), r["commission_date"],
            yes_no(r["rcb_breaker_replacement"]), r["rcb_breaker_replacement_date"], r["pvl_received_date"],
            r["pre_inspection_date"], r["sp_appointment_letter_received_date"], r["meter_replacement_date"],
            r["sp_turn_on_inspection_date"], yes_no(r["fusion_solar_app_access"]), r["files"], r["signer"],
            local(r["signed_at"]), local(r["closed_at"]), r["closer"], ppa_text(s), plan_text(s), phase_text(s),
            s and s["six_month_due"], s and s["six_month_done_on"], s and s["one_year_due"], s and s["one_year_done_on"],
            yes_no(s["roof_access"]) if s else None, (s["urgent_note"] or ("Yes" if s["urgent"] else None)) if s else None,
        ])  # fmt: skip
    upkeep = maintenance_rows(acct)
    lang = (acct.user or {}).get("language") or "en"
    data = workbook([("Projects", PROJECT_HEAD, rows), ("Maintenance", MAINT_HEAD, upkeep)], lang)
    _record(acct, "projects", len(rows) + len(upkeep))
    return _send(data, "GetHomeApps projects")


# ------------------------------------------------------------------ people

PEOPLE_HEAD = [
    "S/N", "Name", "Role", "Email", "Mobile", "Mobile verified", "Account", "Signed in before", "Contractor groups",
    "Projects", "Address", "Postal Code", "Messages in", "Disables on", "Enables on", "Why disabled", "Invited",
    "Created",
]  # fmt: skip


@router.get("/export/people.xlsx")
def export_people(acct: Account = Depends(pm_only)) -> Response:
    users = fetch_all("select * from users order by active desc, user_type, full_name nulls last, email")
    groups: dict[int, list[str]] = {}
    for g in fetch_all(
        "select m.user_id, g.name from contractor_group_members m join contractor_groups g on g.group_id = m.group_id order by g.name"
    ):
        groups.setdefault(g["user_id"], []).append(g["name"])
    projects: dict[int, set[str]] = {}
    for p in fetch_all(
        """
        select p.project_manager_id as uid, p.name from projects p where p.project_manager_id is not null
        union select p.homeowner_id, p.name from projects p where p.homeowner_id is not null
        union select a.user_id, p.name from project_assignments a join projects p using (project_id)
        union select m.user_id, p.name from projects p join contractor_group_members m on m.group_id = p.contractor_group_id
        """
    ):
        projects.setdefault(p["uid"], set()).add(p["name"])
    rows = []
    for n, u in enumerate(users, start=1):
        rows.append([
            n, u["full_name"], ROLE_LABEL.get(u["user_type"], u["user_type"]), u["email"], u["contact_no"],
            "Yes" if u["mobile_verified_at"] else "No", "Active" if u["active"] else "Disabled",
            "Yes" if u["clerk_user_id"] else "No", ", ".join(groups.get(u["uid"], [])) or None,
            ", ".join(sorted(projects.get(u["uid"], set()))) or None, u["address"], u["postal_code"],
            "Chinese (Simplified)" if u["language"] == "zh" else "English", u["disable_on"], u["enable_on"],
            u["disabled_reason"], local(u["invited_at"]), local(u["created_at"]),
        ])  # fmt: skip
    lang = (acct.user or {}).get("language") or "en"
    data = workbook([("People", PEOPLE_HEAD, rows)], lang)
    _record(acct, "people", len(rows))
    return _send(data, "GetHomeApps people")
