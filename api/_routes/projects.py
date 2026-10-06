"""Projects: the list each role sees, and creating one (project managers only).

Who sees what (from the brief):
  * Project managers — every project.
  * Homeowners — their own project.
  * Contractor admins and EPC crew — projects their contractor group is on,
    or that name them individually.

A project is red when it is late (past its target end and not finished) or
something went wrong on site (an EPC visit with no check-in). Otherwise it
never turns red.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _lib import notify, onemap, project_fields
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.profile import clean_phone
from _lib.web import active, role

router = APIRouter()
pm_only = role("project_manager")

SG = ZoneInfo("Asia/Singapore")
CREW_ROLES = ("contractor", "epc_team")
# The brief: no end date means three weeks after the start, and no start date
# three weeks before the end.
DEFAULT_SPAN = timedelta(weeks=3)

STATUS_LABEL = {
    "draft": "Draft",
    "awaiting_homeowner": "Awaiting Homeowner",
    "homeowner_declined": "Homeowner Declined",
    "homeowner_approved": "Homeowner Approved",
    "pm_approved": "PM Approved",
    "in_progress": "In Progress",
    "awaiting_signature": "Awaiting E-Sign",
    "signed": "Signed — PM to Close",
    "closed": "Closed",
}


def today() -> date:
    return datetime.now(SG).date()


# ------------------------------------------------------------------ reading


def _visible_clause(acct: Account) -> tuple[str, dict[str, Any]]:
    if acct.role == "project_manager":
        return "true", {}
    if acct.role == "homeowner":
        return "p.homeowner_id = %(me)s", {"me": acct.uid}
    return (
        "(exists (select 1 from contractor_group_members m where m.group_id = p.contractor_group_id "
        "and m.user_id = %(me)s) or exists (select 1 from project_assignments a "
        "where a.project_id = p.project_id and a.user_id = %(me)s))",
        {"me": acct.uid},
    )


def _load(acct: Account, project_id: int | None = None) -> list[dict[str, Any]]:
    where, params = _visible_clause(acct)
    if project_id is not None:
        where += " and p.project_id = %(pid)s"
        params["pid"] = project_id
    rows = fetch_all(
        f"""
        select p.*, r.name as retailer_name,
               h.full_name as h_name, h.email as h_email, h.ic_last4 as h_ic, h.active as h_active,
               pm.full_name as pm_name, g.name as group_name
          from projects p
          left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id
          left join users h on h.uid = p.homeowner_id
          left join users pm on pm.uid = p.project_manager_id
          left join contractor_groups g on g.group_id = p.contractor_group_id
         where {where}
         order by p.created_at desc
        """,
        params,
    )
    if not rows:
        return []
    ids = [r["project_id"] for r in rows]
    files: dict[int, dict[str, int]] = {}
    for f in fetch_all(
        "select project_id, category::text as category, count(*)::int as n from project_files "
        "where project_id = any(%(ids)s) group by 1, 2",
        {"ids": ids},
    ):
        files.setdefault(f["project_id"], {})[f["category"]] = f["n"]

    people: dict[int, list[dict[str, Any]]] = {}
    for m in fetch_all(
        """
        select p.project_id, u.uid, u.full_name, u.email, u.user_type
          from projects p join contractor_group_members m on m.group_id = p.contractor_group_id
          join users u on u.uid = m.user_id where p.project_id = any(%(ids)s)
        union
        select a.project_id, u.uid, u.full_name, u.email, u.user_type
          from project_assignments a join users u on u.uid = a.user_id where a.project_id = any(%(ids)s)
        """,
        {"ids": ids},
    ):
        people.setdefault(m["project_id"], []).append(m)

    # An EPC visit is missed once its day is over with no check-in that day —
    # or, on the day itself, an hour after its start time.
    now = datetime.now(SG)
    missed: dict[int, list[str]] = {}
    for v in fetch_all(
        """
        select v.project_id, v.scheduled_date, v.scheduled_time, v.works_note
          from site_visits v
         where v.project_id = any(%(ids)s) and v.scheduled_date <= %(today)s
           and not exists (select 1 from site_check_ins c where c.project_id = v.project_id
                 and (c.checked_in_at at time zone 'Asia/Singapore')::date = v.scheduled_date)
        """,
        {"ids": ids, "today": now.date()},
    ):
        if v["scheduled_date"] == now.date():
            t = v["scheduled_time"]
            if not t:
                continue
            hh, mm = (int(x) for x in t.split(":"))
            if now < now.replace(hour=hh, minute=mm, second=0, microsecond=0) + timedelta(hours=1):
                continue
        when = v["scheduled_date"].strftime("%d %b %Y") + (f", {v['scheduled_time']}" if v["scheduled_time"] else "")
        missed.setdefault(v["project_id"], []).append(
            f"No check-in for the EPC visit on {when}" + (f" ({v['works_note']})" if v["works_note"] else "")
        )

    return [_row(r, files.get(r["project_id"], {}), people.get(r["project_id"], []), missed.get(r["project_id"], []))
            for r in rows]  # fmt: skip


def _row(r: dict[str, Any], files: dict[str, int], crew: list[dict[str, Any]], missed: list[str]) -> dict[str, Any]:
    p = dict(r)
    p["_retailer_name"] = r["retailer_name"]
    p["_homeowner"] = {"ic_last4": r["h_ic"], "email": r["h_email"]}
    groups = project_fields.group_status(p, files)
    reached = project_fields.milestone_reached(groups)
    pct = project_fields.progress(p, groups)

    start, end = r["installation_start_date"], r["target_end_date"]
    t = today()
    elapsed = max(0, ((r["closed_at"] if r.get("closed_at") else t) - start).days) if start else 0
    flags: list[dict[str, str]] = []
    if end and r["status"] != "closed" and t > end and pct < 100:
        flags.append({"kind": "overdue", "text": f"Target end date passed {(t - end).days} days ago"})
    flags += [{"kind": "no_show", "text": m} for m in missed]

    if r["contractor_group_id"]:
        contractor = {
            "type": "group",
            "label": r["group_name"] or "Contractor group",
            "groupId": r["contractor_group_id"],
        }
    elif crew:
        contractor = {"type": "users", "label": ", ".join(c["full_name"] or c["email"] for c in crew)}
    else:
        contractor = {"type": "text", "label": r["contractor_text"] or "—"}

    team: list[dict[str, Any]] = []
    if r["project_manager_id"]:
        team.append({"uid": r["project_manager_id"], "name": r["pm_name"], "role": "project_manager"})
    if r["homeowner_id"]:
        team.append({"uid": r["homeowner_id"], "name": r["h_name"] or r["h_email"], "role": "homeowner"})
    seen = {m["uid"] for m in team}
    for c in crew:
        if c["uid"] not in seen:
            team.append({"uid": c["uid"], "name": c["full_name"] or c["email"], "role": c["user_type"]})
            seen.add(c["uid"])

    return {
        "id": r["project_id"],
        "name": r["name"],
        "address": r["address"],
        "postalCode": r["postal_code"],
        "siteLocated": r["site_lat"] is not None,
        "status": r["status"],
        "statusLabel": STATUS_LABEL[r["status"]],
        "homeowner": {
            "uid": r["homeowner_id"],
            "name": (r["h_name"] or r["h_email"]) if r["homeowner_id"] else r["homeowner_name"],
            "linked": r["homeowner_id"] is not None,
        },
        "contactNo": r["homeowner_contact_no"],
        "contractor": contractor,
        "team": team,
        "pm": {"uid": r["project_manager_id"], "name": r["pm_name"]},
        "startDate": start.isoformat() if start else None,
        "endDate": end.isoformat() if end else None,
        "daysElapsed": elapsed,
        "progress": pct,
        "milestone": reached,
        "currentMilestone": min(reached + 1, 3),
        "groups": groups,
        "flags": flags,
        "attention": bool(flags),
        "createdAt": r["created_at"].isoformat(),
    }


@router.get("/projects")
def projects(acct: Account = Depends(active)) -> dict[str, Any]:
    return {"projects": _load(acct), "canCreate": acct.role == "project_manager", "today": today().isoformat()}


@router.get("/projects/options")
def options(_acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """What Create Project offers: homeowner accounts, contractor groups, crews."""
    users = fetch_all(
        "select uid, full_name, email, contact_no, user_type from users where active "
        "and user_type in ('homeowner', 'contractor', 'epc_team') order by full_name nulls last, email"
    )
    members = fetch_all("select group_id, user_id from contractor_group_members")
    groups = fetch_all("select group_id, name from contractor_groups order by name")
    by_group: dict[int, list[int]] = {}
    for m in members:
        by_group.setdefault(m["group_id"], []).append(m["user_id"])
    return {
        "homeowners": [
            {"uid": u["uid"], "name": u["full_name"] or u["email"], "email": u["email"], "contactNo": u["contact_no"]}
            for u in users
            if u["user_type"] == "homeowner"
        ],
        "crew": [
            {
                "uid": u["uid"],
                "name": u["full_name"] or u["email"],
                "role": u["user_type"],
                "roleLabel": ROLE_LABEL[u["user_type"]],
            }  # fmt: skip
            for u in users
            if u["user_type"] in CREW_ROLES
        ],
        "groups": [
            {"id": g["group_id"], "name": g["name"], "members": by_group.get(g["group_id"], [])} for g in groups
        ],
    }


@router.get("/projects/geocode")
def geocode(postal: str, _acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Postal code → the address OneMap knows, for Create Project to fill in."""
    try:
        loc = onemap.resolve(None, postal)
    except onemap.GeocodeError as exc:
        raise HTTPException(400, exc.for_people()) from exc
    return {"address": loc.address, "postalCode": loc.postal_code, "lat": loc.lat, "lng": loc.lng}


@router.get("/projects/{project_id}")
def project(project_id: int, acct: Account = Depends(active)) -> dict[str, Any]:
    rows = _load(acct, project_id)
    if not rows:
        raise HTTPException(404, "No such project, or it isn't one of yours.")
    return rows[0]


# ------------------------------------------------------------------ creating


class ContractorIn(BaseModel):
    type: Literal["group", "users", "text"] = "group"
    groupId: int | None = None
    userIds: list[int] = []
    text: str = ""


class ProjectIn(BaseModel):
    name: str = ""
    postalCode: str = ""
    address: str = ""
    homeownerId: int | None = None
    homeownerName: str = ""
    contactNo: str = ""
    contractor: ContractorIn = ContractorIn()
    startDate: date | None = None
    endDate: date | None = None


def plan_dates(start: date | None, end: date | None) -> tuple[date, date]:
    """Either date is enough; the other is three weeks away."""
    if start is None and end is None:
        raise HTTPException(400, "Give a start date or an end date (or both).")
    start = start or end - DEFAULT_SPAN  # type: ignore[operator]
    end = end or start + DEFAULT_SPAN
    if end < start:
        raise HTTPException(400, "The end date can't be before the start date.")
    return start, end


def _validate(body: ProjectIn) -> dict[str, Any]:
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(400, "Enter the project's name.")
    postal = body.postalCode.strip()
    if not onemap.SG_POSTAL.match(postal):
        raise HTTPException(400, "Enter the site's 6-digit postal code.")
    address = body.address.strip()
    if len(address) < 5:
        raise HTTPException(400, "Enter the project's address.")

    homeowner_id, homeowner_name = None, None
    if body.homeownerId:
        h = fetch_one("select uid, user_type, active from users where uid = %s", (body.homeownerId,))
        if not h or h["user_type"] != "homeowner" or not h["active"]:
            raise HTTPException(400, "Choose an active homeowner account, or type the homeowner's name.")
        homeowner_id = h["uid"]
    else:
        homeowner_name = body.homeownerName.strip()
        if len(homeowner_name) < 2:
            raise HTTPException(400, "Choose the homeowner's account, or type their name if they don't have one.")
    contact = clean_phone(body.contactNo)
    if not contact:
        raise HTTPException(400, "Enter the homeowner's contact number.")

    c = body.contractor
    group_id, user_ids, contractor_text = None, [], None
    if c.type == "group":
        if not c.groupId or not fetch_one("select 1 from contractor_groups where group_id = %s", (c.groupId,)):
            raise HTTPException(400, "Choose the contractor group.")
        group_id = c.groupId
    elif c.type == "users":
        user_ids = sorted(set(c.userIds))
        found = fetch_all(
            "select uid from users where uid = any(%(ids)s) and active and user_type in ('contractor', 'epc_team')",
            {"ids": user_ids},
        )
        if not user_ids or len(found) != len(user_ids):
            raise HTTPException(400, "Choose one or more contractor admins or EPC crew.")
    else:
        contractor_text = c.text.strip()
        if len(contractor_text) < 2:
            raise HTTPException(400, "Enter the contractor's name.")

    start, end = plan_dates(body.startDate, body.endDate)
    return {
        "name": name, "postal": postal, "address": address, "homeowner_id": homeowner_id,
        "homeowner_name": homeowner_name, "contact": contact, "group_id": group_id, "user_ids": user_ids,
        "contractor_text": contractor_text, "start": start, "end": end,
    }  # fmt: skip


@router.post("/projects")
def create(body: ProjectIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    v = _validate(body)

    # The site's GPS point, for check-in. A postal code OneMap doesn't know is
    # a mistake to fix now; OneMap being down shouldn't block the project.
    lat = lng = None
    located, geo_note = False, ""
    try:
        loc = onemap.resolve(None, v["postal"])
        lat, lng, located = loc.lat, loc.lng, True
    except onemap.GeocodeError as exc:
        if exc.reason in ("not_found", "invalid_query"):
            raise HTTPException(400, exc.for_people()) from exc
        geo_note = " The site's GPS location couldn't be looked up yet, so check-in is off until it is."

    status = "awaiting_homeowner" if v["homeowner_id"] else "draft"
    with transaction(acct.uid) as cur:
        cur.execute(
            """
            insert into projects (name, address, postal_code, site_lat, site_lng, geocoded_address, geocode_source,
                                  geocoded_at, homeowner_id, homeowner_name, homeowner_contact_no,
                                  contractor_group_id, contractor_text, project_manager_id, created_by,
                                  installation_start_date, target_end_date, status)
            values (%(name)s, %(address)s, %(postal)s, %(lat)s, %(lng)s, %(geo_addr)s, %(geo_src)s,
                    case when %(located)s then now() end, %(homeowner_id)s, %(homeowner_name)s, %(contact)s,
                    %(group_id)s, %(contractor_text)s, %(me)s, %(me)s, %(start)s, %(end)s, %(status)s)
            returning project_id
            """,
            {
                **v,
                "lat": lat,
                "lng": lng,
                "located": located,
                "geo_addr": v["address"] if located else None,
                "geo_src": "onemap" if located else None,
                "me": acct.uid,
                "status": status,
            },  # fmt: skip
        )
        pid = cur.fetchone()["project_id"]
        for uid in v["user_ids"]:
            cur.execute(
                "insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s)",
                (pid, uid, acct.uid),
            )

    _announce(pid, v, acct)
    if v["homeowner_id"]:
        msg = f"Created {v['name']}. The homeowner has been asked to approve it."
    else:
        msg = f"Created {v['name']} as a draft. Link the homeowner's account so they can approve it."
    return {"id": pid, "message": msg + geo_note}


def _announce(pid: int, v: dict[str, Any], acct: Account) -> None:
    """The homeowner is asked to approve; the crews are told they're on it."""
    if v["homeowner_id"]:
        h = fetch_one("select full_name, email from users where uid = %s", (v["homeowner_id"],))
        assert h is not None
        url = f"{notify.app_url()}/projects/{pid}"
        title = "Approve your solar installation project"
        text = f"9 Solar Home has created “{v['name']}”. Review the details and approve to begin scheduling."
        html_body, plain = notify.email_shell(
            title, [f"Hi {h['full_name'] or 'there'},", text, v["address"]], ("Review and approve", url)
        )
        notify.notify(
            v["homeowner_id"], "approval_request", title, text, project_id=pid,
            email=(h["email"], f"9 Solar Home: approve {v['name']}", html_body, plain),
        )  # fmt: skip

    crew = set(v["user_ids"])
    if v["group_id"]:
        crew |= {m["user_id"] for m in fetch_all(
            "select user_id from contractor_group_members where group_id = %s", (v["group_id"],))}  # fmt: skip
    for uid in crew - {acct.uid}:
        notify.notify(uid, "assignment", "New project assigned", f"{v['name']} — {v['address']}", project_id=pid)
