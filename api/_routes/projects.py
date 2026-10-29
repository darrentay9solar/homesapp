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

from _lib import address as addr
from _lib import duplicates, notify, onemap, project_fields, records, to_fill
from _lib import workflow as wf
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.edition import EDITION
from _lib.profile import clean_phone
from _lib.web import active, role

router = APIRouter()
pm_only = role("project_manager")

SG = ZoneInfo("Asia/Singapore")
CREW_ROLES = ("contractor", "epc_team")
# The brief: no end date means three weeks after the start, and no start date
# three weeks before the end.
DEFAULT_SPAN = timedelta(weeks=3)
# GetApps (9 Solar Fintech): a project's group and phase. Not read in 9 Solar Home's app.
GETAPPS_COLS = ", pg.name as pgroup_name, ph.name as phase_name"
GETAPPS_JOINS = """
          left join project_groups pg on pg.group_id = p.group_id
          left join project_phases ph on ph.phase_id = p.phase_id"""

STATUS_LABEL = {
    "draft": "Draft",
    "awaiting_homeowner": "Awaiting Homeowner",
    "homeowner_declined": "Homeowner Declined",
    "homeowner_approved": "Homeowner Approved",
    "pm_approved": "PM Approved",
    "in_progress": "In Progress",
    "awaiting_signature": "Awaiting E-Sign",
    "signed": "Completed",
    "maintenance": "In Maintenance",
}


def today() -> date:
    return datetime.now(SG).date()


# ------------------------------------------------------------------ reading


def _visible_clause(acct: Account) -> tuple[str, dict[str, Any]]:
    # A superadmin and Admin (read-only) see every project; a project manager the ones they run,
    # and the ones nobody runs yet (from the project list), to take one on.
    if acct.role in ("superadmin", "finance"):
        return "true", {}
    if acct.role == "project_manager":
        return "(p.project_manager_id = %(me)s or p.project_manager_id is null)", {"me": acct.uid}
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
    cols, joins = (GETAPPS_COLS, GETAPPS_JOINS) if EDITION == "fintech" else ("", "")
    rows = fetch_all(
        f"""
        select p.*, r.name as retailer_name,
               (select s.signed_at from project_signatures s where s.project_id = p.project_id) as signed_at,
               h.full_name as h_name, h.email as h_email, h.ic_last4 as h_ic, h.active as h_active,
               pm.full_name as pm_name, g.name as group_name{cols}
          from projects p
          left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id
          left join users h on h.uid = p.homeowner_id
          left join users pm on pm.uid = p.project_manager_id
          left join contractor_groups g on g.group_id = p.contractor_group_id{joins}
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

    # GetApps: progress, stage and timing come from its workflow (api/_lib/workflow.py).
    wfl = wf.load(ids) if EDITION == "fintech" else None
    out = [
        _row(r, files.get(r["project_id"], {}), people.get(r["project_id"], []), missed.get(r["project_id"], []), wfl)
        for r in rows
    ]
    # Whether a project is on time, late or had an EPC no-show is the crew's and 9 Solar Home's
    # business: the homeowner sees its progress and status, never a timing verdict.
    if acct.role == "homeowner":
        for p in out:
            p["flags"], p["attention"], p["toFill"] = [], False, 0
    return out


def _row(
    r: dict[str, Any],
    files: dict[str, int],
    crew: list[dict[str, Any]],
    missed: list[str],
    loaded: wf.Loaded | None = None,
) -> dict[str, Any]:
    p = dict(r)
    p["_retailer_name"] = r["retailer_name"]
    p["_homeowner"] = {"ic_last4": r["h_ic"], "email": r["h_email"]}
    groups = project_fields.group_status(p, files)
    reached = project_fields.milestone_reached(groups)
    pct = project_fields.progress(p, groups)

    start, end = r["installation_start_date"], r["target_end_date"]
    t = today()
    # Days running stop counting on the day the project was closed.
    until = r["closed_at"].astimezone(SG).date() if r.get("closed_at") else t
    elapsed = max(0, (until - start).days) if start else 0
    flags: list[dict[str, str]] = []
    if end and r["status"] != "maintenance" and t > end and pct < 100:
        flags.append({"kind": "overdue", "text": f"Target end date passed {(t - end).days} days ago"})
    flags += [{"kind": "no_show", "text": m} for m in missed]
    # Imported from the lists: what the flow would have recorded and still hasn't, for its manager to fill.
    gaps = len(to_fill.fields(p, files)) if to_fill.imported(r) else 0
    if gaps:
        text = (
            "Imported from the lists: 1 required field to fill in"
            if gaps == 1
            else f"Imported from the lists: {gaps} required fields to fill in"
        )
        flags.append({"kind": "to_fill", "text": text})

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

    out = {
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
        "imported": to_fill.imported(r),
        "toFill": gaps,
        "createdAt": r["created_at"].isoformat(),
        # For the table's date filters ("handed over between..."): when it was signed, and handed over.
        "projectCode": r.get("project_code"),
        "signedAt": r["signed_at"].isoformat() if r.get("signed_at") else None,
        "closedAt": r["closed_at"].isoformat() if r.get("closed_at") else None,
    }
    if loaded is not None:
        out["group"] = {"id": r["group_id"], "name": r["pgroup_name"]} if r.get("group_id") else None
        out["phase"] = {"id": r["phase_id"], "name": r["phase_name"]} if r.get("phase_id") else None
        st = wf.state(r, loaded, t)
        done = sum(1 for s in st["stages"] if s["done"]) + (1 if st["complete"] else 0)
        wflags: list[dict[str, str]] = []
        if st["lateDays"]:
            wflags.append({"kind": "overdue", "text": f"Past its 10 months by {st['lateDays']} days"})
        ca = next(i for i in st["sp"]["items"] if i["key"] == "connection_agreement")
        if ca.get("overdue"):
            wflags.append({"kind": "sp", "text": "Connection Agreement overdue (due a week after the PV2 letter)"})
        out |= {
            "progress": st["progress"],
            "milestone": done,
            "currentMilestone": min(done + 1, len(wf.STAGE_KEYS)),
            "stage": st["current"],
            "stageLabel": st["currentLabel"],
            "complete": st["complete"],
            "flags": wflags,
            "attention": bool(wflags),
            "toFill": 0,
            "imported": False,
        }
    return out


@router.get("/projects")
def projects(acct: Account = Depends(active), handed: bool = False) -> dict[str, Any]:
    can_create = acct.role in ("project_manager", "superadmin")
    rows = _load(acct)
    # Handed over, a project's development is done: it's kept as a maintenance
    # record (the Maintenance page), not in the list. A homeowner still sees theirs,
    # and the table view asks for them too (?handed=1), to find what was handed over when.
    handed_over = 0
    if acct.role != "homeowner" and not handed:
        handed_over = sum(1 for r in rows if r["status"] == "maintenance")
        rows = [r for r in rows if r["status"] != "maintenance"]
    return {"projects": rows, "canCreate": can_create, "handedOver": handed_over, "today": today().isoformat()}


@router.get("/projects/options")
def options(_acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """What Create Project offers: homeowner accounts, contractor groups, crews and managers."""
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
        # Who can run a project: whoever creates one chooses.
        "managers": [
            {"uid": u["uid"], "name": u["full_name"] or u["email"], "role": u["user_type"]}
            for u in fetch_all(
                "select uid, full_name, email, user_type from users where active "
                "and user_type in ('project_manager', 'superadmin') order by user_type, full_name nulls last"
            )
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
    # Who runs the project: chosen when it's created (or taken on while it has no manager);
    # after that only a superadmin hands it to someone else.
    projectManagerId: int | None = None
    # They've confirmed it's a different home at a postal code already in the system.
    samePostalOk: bool = False
    # GetApps: the group (contract) and phase it comes under.
    groupId: int | None = None
    phaseId: int | None = None


def manager_for(body: ProjectIn, acct: Account, current: int | None = None) -> int:
    """Who runs the project. Whoever creates it chooses (themselves or another project manager);
    one with no manager yet can be taken on; handing over a running project is a superadmin's."""
    want = body.projectManagerId
    if acct.role != "superadmin" and current is not None:
        if want is not None and want != current:
            raise HTTPException(403, "Only a superadmin can hand a project to another project manager.")
        return current
    if want is None:
        return current or acct.uid
    runs = "select 1 from users where uid = %s and active and user_type in ('project_manager', 'superadmin')"
    if not fetch_one(runs, (want,)):
        raise HTTPException(400, "Choose an active project manager to run the project.")
    return want


def plan_dates(start: date | None, end: date | None) -> tuple[date, date]:
    """Either date is enough; the other is three weeks away (GetApps: a project runs 10 months)."""
    if start is None and end is None:
        raise HTTPException(400, "Give a start date or an end date (or both).")
    if EDITION == "fintech":
        start = start or wf.add_months(end, -wf.SPAN_MONTHS)  # type: ignore[arg-type]
        end = end or wf.target_end(start)
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
    # The street only: the postal code is its own field, so a screen never shows it twice.
    address = addr.street(body.address)
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
    pgroup = pphase = None
    if EDITION != "fintech":
        body.groupId = body.phaseId = None
    if body.groupId is not None:
        if not fetch_one("select 1 from project_groups where group_id = %s", (body.groupId,)):
            raise HTTPException(400, "Choose the project's group.")
        pgroup = body.groupId
    if body.phaseId is not None:
        ph = fetch_one("select group_id from project_phases where phase_id = %s", (body.phaseId,))
        if not ph or ph["group_id"] != pgroup:
            raise HTTPException(400, "Choose a phase of the project's group.")
        pphase = body.phaseId
    return {
        "name": name, "postal": postal, "address": address, "homeowner_id": homeowner_id,
        "homeowner_name": homeowner_name, "contact": contact, "group_id": group_id, "user_ids": user_ids,
        "contractor_text": contractor_text, "start": start, "end": end, "pgroup": pgroup, "pphase": pphase,
    }  # fmt: skip


@router.post("/projects")
def create(body: ProjectIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    v = _validate(body)
    duplicates.project_clash(v, same_postal_ok=body.samePostalOk)

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

    # GetApps has no homeowner approval: a project starts as soon as it's created.
    status = "in_progress" if EDITION == "fintech" else "awaiting_homeowner" if v["homeowner_id"] else "draft"
    manager = manager_for(body, acct)
    with transaction(acct.uid) as cur:
        cur.execute(
            """
            insert into projects (name, address, postal_code, site_lat, site_lng, geocoded_address, geocode_source,
                                  geocoded_at, homeowner_id, homeowner_name, homeowner_contact_no,
                                  contractor_group_id, contractor_text, project_manager_id, created_by,
                                  installation_start_date, target_end_date, status)
            values (%(name)s, %(address)s, %(postal)s, %(lat)s, %(lng)s, %(geo_addr)s, %(geo_src)s,
                    case when %(located)s then now() end, %(homeowner_id)s, %(homeowner_name)s, %(contact)s,
                    %(group_id)s, %(contractor_text)s, %(manager)s, %(me)s, %(start)s, %(end)s, %(status)s)
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
                "manager": manager,
                "status": status,
            },  # fmt: skip
        )
        pid = cur.fetchone()["project_id"]
        if v["pgroup"] is not None:
            cur.execute(
                "update projects set group_id = %s, phase_id = %s where project_id = %s",
                (v["pgroup"], v["pphase"], pid),
            )
        for uid in v["user_ids"]:
            cur.execute(
                "insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s)",
                (pid, uid, acct.uid),
            )

    _announce(pid, v, acct)
    if manager != acct.uid:
        notify.notify(manager, "assignment", "New project to run", f"{v['name']} — {v['address']}", project_id=pid)
    if EDITION == "fintech":
        msg = f"Created {v['name']}."
    elif v["homeowner_id"]:
        msg = f"Created {v['name']}. The homeowner has been asked to approve it."
    else:
        msg = f"Created {v['name']} as a draft. Link the homeowner's account so they can approve it."
    return {"id": pid, "message": msg + geo_note}


def _announce(pid: int, v: dict[str, Any], acct: Account) -> None:
    """The homeowner is asked to approve; the crews are told they're on it."""
    if v["homeowner_id"]:
        h = fetch_one("select full_name, email, language from users where uid = %s", (v["homeowner_id"],))
        assert h is not None
        url = f"{notify.app_url()}/projects/{pid}"
        m = notify.msg_approve_project(h["full_name"], v["name"], v["address"], url, h["language"])
        notify.notify(
            v["homeowner_id"], "approval_request", m["title"], m["body"], project_id=pid,
            email=(h["email"], *m["email"]),
        )  # fmt: skip

    crew = set(v["user_ids"])
    if v["group_id"]:
        crew |= {m["user_id"] for m in fetch_all(
            "select user_id from contractor_group_members where group_id = %s", (v["group_id"],))}  # fmt: skip
    for uid in crew - {acct.uid}:
        notify.notify(uid, "assignment", "New project assigned", f"{v['name']} — {v['address']}", project_id=pid)


@router.get("/projects/{pid}/record")
def client_record(pid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """The client record from the project list, what the homeowner said, and the inverter's warranty (managers only)."""
    if not _load(acct, pid):
        raise HTTPException(404, "No such project.")
    out = records.for_project(pid)
    if out is None:
        raise HTTPException(404, "No such project.")
    return out
