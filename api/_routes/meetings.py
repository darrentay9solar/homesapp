# ruff: noqa: E501  (SQL and messages read better whole)
"""Meetings and calendars: arranging a time that suits everyone.

  GET    /calendar?from=&to=            my meetings and blocked-out time between two dates
  GET    /calendar/busy?people=&from=&to=  when the people I can meet are busy (no details)
  GET    /calendar/contacts             who I can invite, and the projects a meeting can be about
  POST   /meetings                      arrange one; everyone invited is asked
  GET    /meetings/{mid}                one meeting (its people)
  PATCH  /meetings/{mid}                the organiser changes it; a new time asks everyone again
  POST   /meetings/{mid}/respond        accept or decline {response}
  POST   /meetings/{mid}/cancel         the organiser calls it off; everyone is told
  POST   /calendar/blocks               block out time: one window on each day of a range, or whole days
  DELETE /calendar/blocks/{bid}         unblock it

Every calendar runs in 30-minute slots, Singapore time. A person is busy
when they've accepted a meeting or blocked the time out; an invitation they
haven't answered doesn't block anything yet. A meeting can't be arranged
over anyone's busy time, and accepting one over your own is refused (the
database checks that too, migration 0032). A meeting can be a maintenance
check (its system and which check), arranged by the system's manager or its
homeowner.

Who can meet whom: project managers and superadmins anyone; everybody else
the people on their projects (the manager, the homeowner, the crew) and the
manager looking after their system.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from _lib import notify
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active
from _routes import projects as proj

router = APIRouter()
SG = ZoneInfo("Asia/Singapore")
SLOT = timedelta(minutes=30)
MAX_RANGE = 62  # days a calendar or a block can span
LINK = re.compile(r"^https://[^\s]+$")
CHECK_LABEL = {"six_month": "6-month check", "one_year": "1-year check"}


def is_admin(acct: Account) -> bool:
    return acct.role in ("project_manager", "superadmin")


# ------------------------------------------------------------------ time


def parse_when(v: str, what: str) -> datetime:
    """'2026-10-12T09:30' (Singapore) or with an offset; on a 30-minute mark."""
    try:
        dt = datetime.fromisoformat(v)
    except (TypeError, ValueError):
        raise HTTPException(400, f"The {what} isn't a date and time.") from None
    dt = dt.replace(tzinfo=SG) if dt.tzinfo is None else dt.astimezone(SG)
    if dt.minute not in (0, 30) or dt.second or dt.microsecond:
        raise HTTPException(400, "Meetings start and end on the hour or half past.")
    return dt


def parse_day(v: str, what: str) -> date:
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        raise HTTPException(400, f"The {what} isn't a date.") from None


def day_range(frm: str, to: str) -> tuple[datetime, datetime]:
    a, b = parse_day(frm, "start date"), parse_day(to, "end date")
    if b < a:
        raise HTTPException(400, "The end date is before the start date.")
    if (b - a).days > MAX_RANGE:
        raise HTTPException(400, f"Look at {MAX_RANGE} days at most at a time.")
    return datetime.combine(a, time(0), SG), datetime.combine(b + timedelta(days=1), time(0), SG)


def iso(dt: datetime) -> str:
    return dt.astimezone(SG).isoformat()


def when_text(start: datetime, end: datetime) -> str:
    s, e = start.astimezone(SG), end.astimezone(SG)
    return f"{s.strftime('%a %d %b %Y')}, {s.strftime('%H:%M')} to {e.strftime('%H:%M')}"


# ------------------------------------------------------------------ who


def contacts(acct: Account) -> list[dict[str, Any]]:
    """The people this person may invite."""
    if is_admin(acct):
        rows = fetch_all(
            "select uid, full_name, email, user_type::text as role from users "
            "where active and uid <> %s order by full_name nulls last",
            (acct.uid,),
        )
    else:
        rows = fetch_all(
            """
            with mine as (
              select project_id from projects where homeowner_id = %(me)s
              union select project_id from project_assignments where user_id = %(me)s
              union select p.project_id from projects p
                      join contractor_group_members m on m.group_id = p.contractor_group_id where m.user_id = %(me)s
            ), theirs as (
              select project_manager_id as uid from projects where project_id in (select project_id from mine)
              union select homeowner_id from projects where project_id in (select project_id from mine)
              union select user_id from project_assignments where project_id in (select project_id from mine)
              union select m.user_id from projects p join contractor_group_members m on m.group_id = p.contractor_group_id
                     where p.project_id in (select project_id from mine)
              union select run_by from maintenance_systems where homeowner_id = %(me)s
              -- A homeowner whose system has no manager yet can reach the superadmins.
              union select u.uid from users u where u.user_type = 'superadmin' and exists (
                      select 1 from maintenance_systems s where s.homeowner_id = %(me)s and s.run_by is null)
            )
            select uid, full_name, email, user_type::text as role from users
             where active and uid <> %(me)s and uid in (select uid from theirs where uid is not null)
             order by full_name nulls last
            """,
            {"me": acct.uid},
        )
    return [{"uid": r["uid"], "name": r["full_name"] or r["email"], "role": r["role"], "roleLabel": ROLE_LABEL.get(r["role"], r["role"])}
            for r in rows]  # fmt: skip


def busy(
    uids: list[int], start: datetime, end: datetime, *, except_meeting: int | None = None
) -> dict[int, list[tuple[datetime, datetime]]]:
    """Each person's busy stretches between two times: meetings they've accepted, and blocked-out time."""
    out: dict[int, list[tuple[datetime, datetime]]] = {u: [] for u in uids}
    if not uids:
        return out
    for r in fetch_all(
        """
        select mp.user_id as uid, m.starts_at as s, m.ends_at as e from meeting_people mp
          join meetings m on m.meeting_id = mp.meeting_id
         where mp.user_id = any(%(u)s) and mp.response = 'accepted' and m.cancelled_at is null
           and m.meeting_id is distinct from %(x)s and m.starts_at < %(to)s and m.ends_at > %(from)s
        union all
        select user_id, starts_at, ends_at from calendar_blocks
         where user_id = any(%(u)s) and starts_at < %(to)s and ends_at > %(from)s
        order by 2
        """,
        {"u": uids, "from": start, "to": end, "x": except_meeting},
    ):
        out[r["uid"]].append((r["s"], r["e"]))
    return out


def who_is_busy(uids: list[int], start: datetime, end: datetime, *, except_meeting: int | None = None) -> list[str]:
    taken = [u for u, spans in busy(uids, start, end, except_meeting=except_meeting).items() if spans]
    if not taken:
        return []
    return [r["name"] for r in fetch_all(
        "select coalesce(full_name, email) as name from users where uid = any(%s) order by 1", (taken,))]  # fmt: skip


# ------------------------------------------------------------------ reading


def _meetings(where: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    rows = fetch_all(
        f"""
        select m.*, o.full_name as o_name, o.email as o_email, p.name as project_name,
               s.address as system_address
          from meetings m join users o on o.uid = m.organiser_id
          left join projects p on p.project_id = m.project_id
          left join maintenance_systems s on s.system_id = m.system_id
         where {where} order by m.starts_at
        """,
        params,
    )
    ids = [r["meeting_id"] for r in rows]
    people: dict[int, list[dict[str, Any]]] = {}
    for r in fetch_all(
        "select mp.meeting_id, mp.user_id, mp.response, u.full_name, u.email, u.user_type::text as role "
        "from meeting_people mp join users u on u.uid = mp.user_id where mp.meeting_id = any(%s) "
        "order by (mp.user_id = (select organiser_id from meetings where meeting_id = mp.meeting_id)) desc, u.full_name",
        (ids,),
    ):
        people.setdefault(r["meeting_id"], []).append(
            {"uid": r["user_id"], "name": r["full_name"] or r["email"], "role": r["role"], "response": r["response"]}
        )
    return [_row(r, people.get(r["meeting_id"], [])) for r in rows]


def _row(r: dict[str, Any], people: list[dict[str, Any]]) -> dict[str, Any]:
    answers = [p["response"] for p in people]
    if r["cancelled_at"]:
        status = "cancelled"
    elif "declined" in answers:
        status = "declined"
    elif all(a == "accepted" for a in answers):
        status = "confirmed"
    else:
        status = "waiting"
    return {
        "id": r["meeting_id"],
        "title": r["title"],
        "kind": r["kind"],
        "startsAt": iso(r["starts_at"]),
        "endsAt": iso(r["ends_at"]),
        "place": r["place"],
        "location": r["location"],
        "onlineLink": r["online_link"],
        "notes": r["notes"],
        "organiser": {"uid": r["organiser_id"], "name": r["o_name"] or r["o_email"]},
        "project": {"id": r["project_id"], "name": r["project_name"]} if r["project_id"] else None,
        "system": {"id": r["system_id"], "address": r["system_address"]} if r["system_id"] else None,
        "checkKey": r["check_key"],
        "status": status,
        "people": people,
    }


def _for(acct: Account, m: dict[str, Any]) -> dict[str, Any]:
    me = next((p for p in m["people"] if p["uid"] == acct.uid), None)
    organiser = m["organiser"]["uid"] == acct.uid or acct.role == "superadmin"
    open_ = m["status"] != "cancelled"
    return {
        **m,
        "myResponse": me["response"] if me else None,
        "canEdit": organiser and open_,
        "canRespond": bool(me) and open_ and m["organiser"]["uid"] != acct.uid,
    }


def _one(acct: Account, mid: int) -> dict[str, Any]:
    found = _meetings("m.meeting_id = %(id)s", {"id": mid})
    if not found:
        raise HTTPException(404, "No such meeting.")
    m = found[0]
    if acct.role != "superadmin" and acct.uid not in {p["uid"] for p in m["people"]}:
        raise HTTPException(404, "No such meeting.")
    return m


@router.get("/calendar")
def calendar(
    frm: str | None = Query(None, alias="from"), to: str | None = None, acct: Account = Depends(active)
) -> dict[str, Any]:
    today = datetime.now(SG).date()
    start, end = day_range(frm or (today - timedelta(days=today.weekday())).isoformat(),
                           to or (today + timedelta(days=13)).isoformat())  # fmt: skip
    mine = _meetings(
        "m.starts_at < %(to)s and m.ends_at > %(from)s and m.cancelled_at is null "
        "and exists (select 1 from meeting_people mp where mp.meeting_id = m.meeting_id and mp.user_id = %(me)s)",
        {"from": start, "to": end, "me": acct.uid},
    )
    blocks = fetch_all(
        "select block_id, starts_at, ends_at, note from calendar_blocks where user_id = %s "
        "and starts_at < %s and ends_at > %s order by starts_at",
        (acct.uid, end, start),
    )
    waiting = fetch_one(
        "select count(*) as n from meeting_people mp join meetings m on m.meeting_id = mp.meeting_id "
        "where mp.user_id = %s and mp.response = 'pending' and m.cancelled_at is null and m.ends_at > now()",
        (acct.uid,),
    )
    return {
        "me": acct.uid,
        "from": iso(start),
        "to": iso(end),
        "meetings": [_for(acct, m) for m in mine],
        "blocks": [
            {"id": b["block_id"], "startsAt": iso(b["starts_at"]), "endsAt": iso(b["ends_at"]), "note": b["note"]}
            for b in blocks
        ],  # fmt: skip
        "toAnswer": int(waiting["n"]) if waiting else 0,
    }


@router.get("/calendar/upcoming")
def upcoming(acct: Account = Depends(active)) -> dict[str, Any]:
    """The next meetings, and invitations still to answer, soonest first."""
    rows = _meetings(
        "m.ends_at > now() and m.cancelled_at is null "
        "and exists (select 1 from meeting_people mp where mp.meeting_id = m.meeting_id and mp.user_id = %(me)s "
        "and mp.response <> 'declined')",
        {"me": acct.uid},
    )
    return {"meetings": [_for(acct, m) for m in rows[:60]]}


@router.get("/calendar/busy")
def busy_times(
    people: str, frm: str = Query(alias="from"), to: str = "", acct: Account = Depends(active)
) -> dict[str, Any]:
    try:
        uids = sorted({int(x) for x in people.split(",") if x.strip()})
    except ValueError:
        raise HTTPException(400, "Choose people to compare.") from None
    if len(uids) > 20:
        raise HTTPException(400, "Compare 20 people at most.")
    allowed = {c["uid"] for c in contacts(acct)} | {acct.uid}
    if any(u not in allowed for u in uids):
        raise HTTPException(403, "You can only see when the people you work with are busy.")
    start, end = day_range(frm, to)
    spans = busy(uids, start, end)
    names = {c["uid"]: c["name"] for c in contacts(acct)}
    names[acct.uid] = acct.user["full_name"] if acct.user else ""
    return {"people": [{"uid": u, "name": names.get(u), "busy": [{"startsAt": iso(s), "endsAt": iso(e)} for s, e in spans[u]]}
                       for u in uids]}  # fmt: skip


@router.get("/calendar/contacts")
def contact_list(acct: Account = Depends(active)) -> dict[str, Any]:
    projects = [{"id": p["id"], "name": p["name"], "address": p["address"]}
                for p in proj._load(acct) if p["status"] != "draft"]  # fmt: skip
    return {"people": contacts(acct), "projects": projects}


@router.get("/meetings/{mid}")
def meeting(mid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    return _for(acct, _one(acct, mid))


# ------------------------------------------------------------------ arranging


class MeetingIn(BaseModel):
    title: str = ""
    people: list[int] = []
    startsAt: str = ""
    endsAt: str = ""
    place: Literal["online", "site", "office", "phone"] = "online"
    location: str | None = None
    onlineLink: str | None = None
    notes: str | None = None
    projectId: int | None = None
    systemId: int | None = None
    checkKey: Literal["six_month", "one_year"] | None = None


def _text(v: str | None, most: int, what: str) -> str | None:
    t = " ".join((v or "").split())
    if len(t) > most:
        raise HTTPException(400, f"The {what} is too long; keep it under {most} characters.")
    return t or None


def _times(body: MeetingIn) -> tuple[datetime, datetime]:
    start, end = parse_when(body.startsAt, "start"), parse_when(body.endsAt, "end")
    if end <= start:
        raise HTTPException(400, "A meeting ends after it starts.")
    if end - start > timedelta(hours=12):
        raise HTTPException(400, "A meeting can be 12 hours at most.")
    if start < datetime.now(SG) - timedelta(minutes=30):
        raise HTTPException(400, "That time has passed. Choose a time from now on.")
    return start, end


def _link(body: MeetingIn) -> str | None:
    link = (body.onlineLink or "").strip() or None
    if link and (len(link) > 500 or not LINK.match(link)):
        raise HTTPException(400, "Paste the meeting link as it starts: https://")
    return link


def _system_check(acct: Account, body: MeetingIn) -> dict[str, Any] | None:
    if body.systemId is None and body.checkKey is None:
        return None
    if body.systemId is None or body.checkKey is None:
        raise HTTPException(400, "Say which system and which check.")
    s = fetch_one("select * from maintenance_systems where system_id = %s", (body.systemId,))
    ok = s is not None and (
        acct.role == "superadmin"
        or (acct.role == "project_manager" and s["run_by"] in (None, acct.uid))
        or s["homeowner_id"] == acct.uid
    )
    if not ok:
        raise HTTPException(404, "That system isn't one of yours.")
    return s


@router.post("/meetings")
def arrange(body: MeetingIn, acct: Account = Depends(active)) -> dict[str, Any]:
    title = _text(body.title, 120, "title")
    if not title:
        raise HTTPException(400, "Give the meeting a title.")
    start, end = _times(body)
    invited = sorted(set(body.people) - {acct.uid})
    if not invited:
        raise HTTPException(400, "Invite at least one person.")
    if len(invited) > 20:
        raise HTTPException(400, "Invite 20 people at most.")
    allowed = {c["uid"] for c in contacts(acct)}
    if any(u not in allowed for u in invited):
        raise HTTPException(403, "You can only invite the people you work with.")
    if body.projectId is not None and body.projectId not in {p["id"] for p in proj._load(acct)}:
        raise HTTPException(404, "No such project, or it isn't one of yours.")
    system = _system_check(acct, body)
    link = _link(body)
    if acct.uid in {u for u, s in busy([acct.uid], start, end).items() if s}:
        raise HTTPException(409, "You're already busy then. Choose another time.")
    taken = who_is_busy(invited, start, end)
    if taken:
        raise HTTPException(409, f"Busy then: {', '.join(taken)}. Choose another time.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into meetings (title, kind, starts_at, ends_at, place, location, online_link, notes, organiser_id, "
            "project_id, system_id, check_key) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning meeting_id",
            (
                title, "maintenance_check" if system else "meeting", start, end, body.place,
                _text(body.location, 300, "location"), link, _text(body.notes, 1000, "note"), acct.uid,
                body.projectId if body.projectId is not None else (system["project_id"] if system else None),
                system["system_id"] if system else None, body.checkKey if system else None,
            ),
        )  # fmt: skip
        row = cur.fetchone()
        assert row is not None
        mid = row["meeting_id"]
        cur.execute(
            "insert into meeting_people (meeting_id, user_id, response) values (%s, %s, 'accepted')", (mid, acct.uid)
        )
        for u in invited:
            cur.execute("insert into meeting_people (meeting_id, user_id) values (%s, %s)", (mid, u))
    name = acct.user["full_name"] if acct.user else "Someone"
    for u in invited:
        notify.notify(u, "meeting_request", f"Meeting request · {title}",
                      f"{name} asked to meet: {when_text(start, end)}. Accept or decline in your calendar.",
                      project_id=body.projectId, link=f"/calendar?meeting={mid}")  # fmt: skip
    return {
        "message": "Invitations sent. The time is held once everyone accepts.",
        "meeting": _for(acct, _one(acct, mid)),
    }


class MeetingChange(BaseModel):
    title: str | None = None
    startsAt: str | None = None
    endsAt: str | None = None
    place: Literal["online", "site", "office", "phone"] | None = None
    location: str | None = None
    onlineLink: str | None = None
    notes: str | None = None
    people: list[int] | None = None


@router.patch("/meetings/{mid}")
def change(mid: int, body: MeetingChange, acct: Account = Depends(active)) -> dict[str, Any]:
    m = _one(acct, mid)
    if not _for(acct, m)["canEdit"]:
        raise HTTPException(403, "Only the person who arranged this meeting can change it.")
    given = body.model_fields_set
    sets: dict[str, Any] = {}
    if "title" in given:
        title = _text(body.title, 120, "title")
        if not title:
            raise HTTPException(400, "Give the meeting a title.")
        sets["title"] = title
    if "place" in given and body.place:
        sets["place"] = body.place
    if "location" in given:
        sets["location"] = _text(body.location, 300, "location")
    if "onlineLink" in given:
        sets["online_link"] = _link(MeetingIn(onlineLink=body.onlineLink))
    if "notes" in given:
        sets["notes"] = _text(body.notes, 1000, "note")
    moved = False
    old_start = datetime.fromisoformat(m["startsAt"])
    old_end = datetime.fromisoformat(m["endsAt"])
    start, end = old_start, old_end
    if "startsAt" in given or "endsAt" in given:
        start, end = _times(MeetingIn(startsAt=body.startsAt or m["startsAt"], endsAt=body.endsAt or m["endsAt"]))
        moved = (start, end) != (old_start, old_end)
        if moved:
            sets["starts_at"], sets["ends_at"] = start, end
    current = {p["uid"] for p in m["people"]}
    organiser = m["organiser"]["uid"]
    wanted = current
    if body.people is not None:
        wanted = set(body.people) | {organiser}
        if len(wanted) < 2:
            raise HTTPException(400, "Invite at least one person.")
        allowed = {c["uid"] for c in contacts(acct)} | current
        if any(u not in allowed for u in wanted):
            raise HTTPException(403, "You can only invite the people you work with.")
    added, removed = wanted - current, current - wanted
    if moved or added:
        check = sorted(wanted if moved else added)
        taken = who_is_busy(check, start, end, except_meeting=mid)
        if taken:
            raise HTTPException(409, f"Busy then: {', '.join(taken)}. Choose another time.")
    if not sets and not added and not removed:
        raise HTTPException(400, "Nothing to change.")
    with transaction(acct.uid) as cur:
        if sets:
            cur.execute(
                f"update meetings set {', '.join(f'{k} = %({k})s' for k in sets)} where meeting_id = %(mid)s",
                {**sets, "mid": mid},
            )
        if moved:
            # A new time is a new question: everyone but the organiser answers again.
            cur.execute(
                "update meeting_people set response = 'pending' where meeting_id = %s and user_id <> %s",
                (mid, organiser),
            )
        for u in removed:
            cur.execute("delete from meeting_people where meeting_id = %s and user_id = %s", (mid, u))
        for u in added:
            cur.execute("insert into meeting_people (meeting_id, user_id) values (%s, %s)", (mid, u))
    title = sets.get("title", m["title"])
    for u in (wanted - {acct.uid}) if moved else added:
        notify.notify(u, "meeting_changed" if moved and u not in added else "meeting_request",
                      f"Meeting moved · {title}" if moved and u not in added else f"Meeting request · {title}",
                      f"Now {when_text(start, end)}. Accept or decline in your calendar.",
                      link=f"/calendar?meeting={mid}")  # fmt: skip
    for u in removed:
        notify.notify(u, "meeting_changed", f"Meeting cancelled · {title}", "You're no longer invited to this meeting.",
                      link="/calendar")  # fmt: skip
    return {
        "message": "Saved. Everyone has been asked again." if moved else "Saved.",
        "meeting": _for(acct, _one(acct, mid)),
    }


class Answer(BaseModel):
    response: Literal["accepted", "declined"]


@router.post("/meetings/{mid}/respond")
def respond(mid: int, body: Answer, acct: Account = Depends(active)) -> dict[str, Any]:
    m = _one(acct, mid)
    me = _for(acct, m)
    if not me["canRespond"]:
        raise HTTPException(409, "There's nothing for you to answer on this meeting.")
    if m["status"] == "cancelled":
        raise HTTPException(409, "This meeting was cancelled.")
    if datetime.fromisoformat(m["endsAt"]) < datetime.now(SG):
        raise HTTPException(409, "This meeting is over.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update meeting_people set response = %s where meeting_id = %s and user_id = %s",
            (body.response, mid, acct.uid),
        )
    name = acct.user["full_name"] if acct.user else "Someone"
    word = "accepted" if body.response == "accepted" else "declined"
    notify.notify(m["organiser"]["uid"], "meeting_response", f"Meeting {word} · {m['title']}",
                  f"{name} {word} the meeting on {when_text(datetime.fromisoformat(m['startsAt']), datetime.fromisoformat(m['endsAt']))}.",
                  link=f"/calendar?meeting={mid}")  # fmt: skip
    return {
        "message": "Accepted. The time is now held in your calendar."
        if body.response == "accepted"
        else "Declined. The organiser has been told.",
        "meeting": _for(acct, _one(acct, mid)),
    }


@router.post("/meetings/{mid}/cancel")
def cancel(mid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    m = _one(acct, mid)
    if not _for(acct, m)["canEdit"]:
        raise HTTPException(403, "Only the person who arranged this meeting can cancel it.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update meetings set cancelled_at = now(), cancelled_by = %s where meeting_id = %s", (acct.uid, mid)
        )
    for p in m["people"]:
        if p["uid"] != acct.uid:
            notify.notify(p["uid"], "meeting_changed", f"Meeting cancelled · {m['title']}",
                          f"The meeting on {when_text(datetime.fromisoformat(m['startsAt']), datetime.fromisoformat(m['endsAt']))} is off.",
                          link="/calendar")  # fmt: skip
    return {"message": "Cancelled. Everyone invited has been told."}


# ------------------------------------------------------------------ blocking out time


class BlockIn(BaseModel):
    fromDate: str
    toDate: str | None = None
    startTime: str | None = None  # "HH:MM"; both empty means whole days
    endTime: str | None = None
    note: str | None = None


def _hhmm(v: str, what: str) -> time:
    m = re.fullmatch(r"([01]\d|2[0-3]):(00|30)", v or "")
    if not m:
        raise HTTPException(400, f"The {what} is a time on the hour or half past, like 09:30.")
    return time(int(m.group(1)), int(m.group(2)))


@router.post("/calendar/blocks")
def block(body: BlockIn, acct: Account = Depends(active)) -> dict[str, Any]:
    a = parse_day(body.fromDate, "start date")
    b = parse_day(body.toDate, "end date") if body.toDate else a
    if b < a:
        raise HTTPException(400, "The end date is before the start date.")
    if (b - a).days >= MAX_RANGE:
        raise HTTPException(400, f"Block {MAX_RANGE} days at most at a time.")
    if b < datetime.now(SG).date():
        raise HTTPException(400, "Those days have passed.")
    note = _text(body.note, 200, "note")
    spans: list[tuple[datetime, datetime]] = []
    if body.startTime or body.endTime:
        st = _hhmm(body.startTime or "", "start time")
        # "24:00" is the end of the day.
        till = None if body.endTime == "24:00" else _hhmm(body.endTime or "", "end time")
        if till is not None and till <= st:
            raise HTTPException(400, "The block ends after it starts.")
        d = a
        while d <= b:
            end = (
                datetime.combine(d + timedelta(days=1), time(0), SG) if till is None else datetime.combine(d, till, SG)
            )
            spans.append((datetime.combine(d, st, SG), end))
            d += timedelta(days=1)
    else:
        spans.append((datetime.combine(a, time(0), SG), datetime.combine(b + timedelta(days=1), time(0), SG)))
    with transaction(acct.uid) as cur:
        for s, e in spans:
            cur.execute(
                "insert into calendar_blocks (user_id, starts_at, ends_at, note) values (%s, %s, %s, %s)",
                (acct.uid, s, e, note),
            )
    days = (b - a).days + 1
    return {"message": "Blocked out." if days == 1 else f"Blocked out {days} days."}


@router.delete("/calendar/blocks/{bid}")
def unblock(bid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    b = fetch_one("select user_id from calendar_blocks where block_id = %s", (bid,))
    if not b or b["user_id"] != acct.uid:
        raise HTTPException(404, "No such blocked time.")
    with transaction(acct.uid) as cur:
        cur.execute("delete from calendar_blocks where block_id = %s", (bid,))
    return {"message": "Unblocked. That time is free again."}
