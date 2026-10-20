# ruff: noqa: E501  (SQL and messages read better whole)
"""Meetings and calendars: arranging a time that suits everyone.

  GET    /calendar?from=&to=            my meetings and blocked-out time between two dates
  GET    /calendar/busy?people=&from=&to=  when the people I can meet are busy (no details)
  GET    /calendar/contacts             who I can invite, and the projects a meeting can be about
  GET    /calendar/geocode?postal=      a physical meeting's address from its postal code
  POST   /calendar/video-link           a Teams, Meet or Zoom meeting for that time (when connected)
  POST   /meetings                      arrange one, or a repeating series; everyone invited is asked
  GET    /meetings/{mid}                one meeting (its people)
  PATCH  /meetings/{mid}                the organiser changes it (or it and the rest of its series)
  POST   /meetings/{mid}/respond        accept or decline {response} (and the rest of its series)
  POST   /meetings/{mid}/cancel         the organiser calls it off (or the rest of its series)
  POST   /calendar/blocks               block out time: one window on each day of a range, or whole days
  DELETE /calendar/blocks/{bid}         unblock it

Every calendar runs in 30-minute slots, Singapore time. A person is busy
when they've accepted a meeting or blocked the time out; an invitation they
haven't answered doesn't block anything yet. A meeting can't be arranged
over anyone's busy time, and accepting one over your own is refused (the
database checks that too, migration 0032). A meeting can be a maintenance
check (its system and which check), arranged by the system's manager.

Homeowners don't arrange meetings: they block out time they can't do, and
accept or decline the meetings they're invited to.

A meeting is online, physical (an address, found from its postal code) or a
phone call, and can carry a video link whatever its place. Everyone is
reminded at the times the organiser chose (an hour before unless they chose
otherwise; _lib/meeting_reminders.py). A repeating meeting is one meeting per
time (_lib/repeat.py), sharing a series_id.

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

from _lib import checks, notify, onemap, repeat, video
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active
from _routes import projects as proj

router = APIRouter()
SG = ZoneInfo("Asia/Singapore")
SLOT = timedelta(minutes=30)
MAX_RANGE = 62  # days a calendar or a block can span
LINK = re.compile(r"^https://[^\s]+$")
DEFAULT_REMINDERS = (60,)  # minutes before, when the organiser doesn't choose
MAX_REMINDER = 4 * 7 * 24 * 60  # four weeks


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
            "select uid, full_name, email, user_type::text as role, address, postal_code from users "
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
            select uid, full_name, email, user_type::text as role, null as address, null as postal_code from users
             where active and uid <> %(me)s and uid in (select uid from theirs where uid is not null)
             order by full_name nulls last
            """,
            {"me": acct.uid},
        )
    # Only managers see someone's address (to meet them there); everybody else just their names.
    return [{"uid": r["uid"], "name": r["full_name"] or r["email"], "role": r["role"], "roleLabel": ROLE_LABEL.get(r["role"], r["role"]),
             "address": r["address"], "postalCode": r["postal_code"]}
            for r in rows]  # fmt: skip


def busy(
    uids: list[int], start: datetime, end: datetime, *, except_meeting: int | None = None,
    except_meetings: list[int] | None = None,
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
           and m.meeting_id is distinct from %(x)s and not (m.meeting_id = any(%(xs)s))
           and m.starts_at < %(to)s and m.ends_at > %(from)s
        union all
        select user_id, starts_at, ends_at from calendar_blocks
         where user_id = any(%(u)s) and starts_at < %(to)s and ends_at > %(from)s
        order by 2
        """,
        {"u": uids, "from": start, "to": end, "x": except_meeting, "xs": except_meetings or []},
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
               s.address as system_address,
               (select count(*) from meetings f where f.series_id = m.series_id and f.starts_at > m.starts_at
                  and f.cancelled_at is null)::int as later
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
        "place": "physical" if r["place"] in ("site", "office") else r["place"],
        "location": r["location"],
        "postalCode": r["postal_code"],
        "reminders": list(r["reminders"] if r["reminders"] is not None else DEFAULT_REMINDERS),
        "repeat": r["repeat"],
        "seriesId": r["series_id"],
        # How many meetings come after this one in its series (not cancelled).
        "laterInSeries": r["later"] if r["series_id"] else 0,
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
    projects = [{"id": p["id"], "name": p["name"], "address": p["address"], "postalCode": p.get("postalCode")}
                for p in proj._load(acct) if p["status"] != "draft"]  # fmt: skip
    me = acct.user or {}
    return {
        "people": contacts(acct),
        "projects": projects,
        # Your own address, to meet at it.
        "me": {"address": me.get("address"), "postalCode": me.get("postal_code")},
        # The video services connected, which make a link for the meeting's time.
        "video": video.configured(),
    }


@router.get("/meetings/{mid}")
def meeting(mid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    return _for(acct, _one(acct, mid))


# ------------------------------------------------------------------ arranging

Place = Literal["online", "physical", "phone", "site", "office"]


class MeetingIn(BaseModel):
    title: str = ""
    people: list[int] = []
    startsAt: str = ""
    endsAt: str = ""
    # "site" and "office" are the older names for "physical".
    place: Place = "online"
    location: str | None = None
    postalCode: str | None = None
    onlineLink: str | None = None
    notes: str | None = None
    projectId: int | None = None
    systemId: int | None = None
    checkKey: str | None = None  # a yearly check, "year_2"... (_lib/checks.py)
    # Minutes before the start; none given is an hour before, an empty list is none.
    reminders: list[int] | None = None
    repeat: Literal["daily", "weekdays", "weekly", "fortnightly", "monthly_day", "monthly_weekday", "yearly"] | None = None
    repeatUntil: str | None = None
    repeatCount: int | None = None


def _text(v: str | None, most: int, what: str) -> str | None:
    t = " ".join((v or "").split())
    if len(t) > most:
        raise HTTPException(400, f"The {what} is too long; keep it under {most} characters.")
    return t or None


def _place(v: str) -> str:
    return "physical" if v in ("site", "office") else v


def _postal(v: str | None) -> str | None:
    p = (v or "").strip() or None
    if p and not re.fullmatch(r"\d{6}", p):
        raise HTTPException(400, "A Singapore postal code is 6 digits.")
    return p


def _reminders(v: list[int] | None) -> list[int]:
    if v is None:
        return list(DEFAULT_REMINDERS)
    out = sorted(set(v), reverse=True)
    if len(out) > 5:
        raise HTTPException(400, "Five notifications at most.")
    if any(x < 0 or x > MAX_REMINDER for x in out):
        raise HTTPException(400, "A notification goes at most 4 weeks before the meeting.")
    return out


def _times(body: MeetingIn) -> tuple[datetime, datetime]:
    start, end = parse_when(body.startsAt, "start"), parse_when(body.endsAt, "end")
    if end <= start:
        raise HTTPException(400, "A meeting ends after it starts.")
    if end - start > timedelta(hours=12):
        raise HTTPException(400, "A meeting can be 12 hours at most.")
    if start < datetime.now(SG) - timedelta(minutes=30):
        raise HTTPException(400, "That time has passed. Choose a time from now on.")
    return start, end


def _occurrences(body: MeetingIn, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """Every time the meeting happens: once, or each time its repeat gives."""
    if not body.repeat:
        return [(start, end)]
    until = parse_day(body.repeatUntil, "repeat's end date") if body.repeatUntil else None
    if until and until < start.date():
        raise HTTPException(400, "The repeat ends before the first meeting.")
    if body.repeatCount is not None and not 2 <= body.repeatCount <= repeat.MOST:
        raise HTTPException(400, f"Repeat it 2 to {repeat.MOST} times.")
    days = repeat.dates(start.date(), body.repeat, until=until, count=body.repeatCount)
    if len(days) < 2:
        raise HTTPException(400, "That repeat gives only one meeting. Choose a later end, or don't repeat it.")
    length = end - start
    return [(s, s + length) for s in (datetime.combine(d, start.time(), SG) for d in days)]


def _clashes(
    uids: list[int], times: list[tuple[datetime, datetime]], *, skip: set[int] | None = None
) -> list[tuple[datetime, list[int]]]:
    """For each time someone is busy at: when, and who."""
    if not uids or not times:
        return []
    spans = busy(uids, min(s for s, _e in times), max(e for _s, e in times), except_meetings=sorted(skip or set()))
    out = []
    for s, e in times:
        who = [u for u, ss in spans.items() if any(a < e and b > s for a, b in ss)]
        if who:
            out.append((s, who))
    return out


def _names(uids: list[int]) -> str:
    return ", ".join(r["name"] for r in fetch_all(
        "select coalesce(full_name, email) as name from users where uid = any(%s) order by 1", (uids,)))  # fmt: skip


def _days(times: list[datetime]) -> str:
    shown = [t.astimezone(SG).strftime("%a %d %b") for t in times[:3]]
    return ", ".join(shown) + (f" and {len(times) - 3} more" if len(times) > 3 else "")


def _busy_refusal(clashes: list[tuple[datetime, list[int]]], me: int, series: bool) -> HTTPException:
    mine = [s for s, who in clashes if me in who]
    if mine:
        return HTTPException(409, f"You're already busy on {_days(mine)}. Choose another time." if series
                             else "You're already busy then. Choose another time.")  # fmt: skip
    who = sorted({u for _s, us in clashes for u in us})
    if series:
        return HTTPException(409, f"Busy on {_days([s for s, _w in clashes])}: {_names(who)}. Choose another time, or change the repeat.")
    return HTTPException(409, f"Busy then: {_names(who)}. Choose another time.")


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
    if checks.year_of(body.checkKey) is None:
        raise HTTPException(400, "That isn't one of the system's yearly checks.")
    s = fetch_one("select * from maintenance_systems where system_id = %s", (body.systemId,))
    ok = s is not None and (
        acct.role == "superadmin" or (acct.role == "project_manager" and s["run_by"] in (None, acct.uid))
    )
    if not ok:
        raise HTTPException(404, "That system isn't one of yours.")
    if checks.year_of(body.checkKey) not in checks.years(checks.term(s)):
        raise HTTPException(400, "That isn't one of the system's yearly checks.")
    return s


@router.post("/meetings")
def arrange(body: MeetingIn, acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.role == "homeowner":
        raise HTTPException(403, "Your project manager arranges meetings with you. Block out the times you can't do in your calendar.")
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
    if system and body.repeat:
        raise HTTPException(400, "A maintenance check happens once; it doesn't repeat.")
    link = _link(body)
    place = _place(body.place)
    reminders = _reminders(body.reminders)
    times = _occurrences(body, start, end)
    series = len(times) > 1
    clashes = _clashes([acct.uid, *invited], times)
    if clashes:
        raise _busy_refusal(clashes, acct.uid, series)
    location = _text(body.location, 300, "location") if place != "online" else None
    postal = _postal(body.postalCode) if place == "physical" else None
    notes = _text(body.notes, 1000, "note")
    project_id = body.projectId if body.projectId is not None else (system["project_id"] if system else None)
    with transaction(acct.uid) as cur:
        sid = None
        if series:
            # A series is known by its first meeting's number.
            cur.execute("select nextval(pg_get_serial_sequence('meetings', 'meeting_id')) as id")
            got = cur.fetchone()
            assert got is not None
            sid = got["id"]
        ids: list[int] = []
        for i, (s, e) in enumerate(times):
            cur.execute(
                "insert into meetings (meeting_id, title, kind, starts_at, ends_at, place, location, postal_code, online_link, "
                "notes, organiser_id, project_id, system_id, check_key, reminders, series_id, repeat) "
                "values (coalesce(%s, nextval(pg_get_serial_sequence('meetings', 'meeting_id'))), %s, %s, %s, %s, %s, %s, %s, "
                "%s, %s, %s, %s, %s, %s, %s, %s, %s) returning meeting_id",
                (
                    sid if i == 0 else None, title, "maintenance_check" if system else "meeting", s, e, place,
                    location, postal, link, notes, acct.uid, project_id,
                    system["system_id"] if system else None, body.checkKey if system else None, reminders,
                    sid, body.repeat if series else None,
                ),
            )  # fmt: skip
            row = cur.fetchone()
            assert row is not None
            mid = row["meeting_id"]
            ids.append(mid)
            cur.execute(
                "insert into meeting_people (meeting_id, user_id, response) values (%s, %s, 'accepted')", (mid, acct.uid)
            )
            for u in invited:
                cur.execute("insert into meeting_people (meeting_id, user_id) values (%s, %s)", (mid, u))
    name = acct.user["full_name"] if acct.user else "Someone"
    when = when_text(start, end)
    for u in invited:
        if series and body.repeat:
            text = (f"{name} asked to meet: {when}. Repeats: {repeat.describe(body.repeat, start.date())} "
                    f"({len(times)} meetings). Accept or decline in your calendar.")  # fmt: skip
        else:
            text = f"{name} asked to meet: {when}. Accept or decline in your calendar."
        notify.notify(u, "meeting_request", f"Meeting request · {title}", text,
                      project_id=body.projectId, link=f"/calendar?meeting={ids[0]}")  # fmt: skip
    return {
        "message": f"Invitations sent for {len(times)} meetings. Each time is held once everyone accepts."
        if series
        else "Invitations sent. The time is held once everyone accepts.",
        "meeting": _for(acct, _one(acct, ids[0])),
    }


class MeetingChange(BaseModel):
    title: str | None = None
    startsAt: str | None = None
    endsAt: str | None = None
    place: Place | None = None
    location: str | None = None
    postalCode: str | None = None
    onlineLink: str | None = None
    notes: str | None = None
    people: list[int] | None = None
    reminders: list[int] | None = None
    # A repeating meeting: just this one, or this one and the ones after it.
    scope: Literal["one", "following"] = "one"


def _series_from(m: dict[str, Any]) -> list[dict[str, Any]]:
    """This meeting and the ones after it in its series that aren't cancelled."""
    if not m["seriesId"]:
        return [m]
    return _meetings("m.series_id = %(s)s and m.starts_at >= %(t)s and m.cancelled_at is null",
                     {"s": m["seriesId"], "t": datetime.fromisoformat(m["startsAt"])})  # fmt: skip


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
        sets["place"] = _place(body.place)
    if "location" in given:
        sets["location"] = _text(body.location, 300, "location")
    if "postalCode" in given:
        sets["postal_code"] = _postal(body.postalCode)
    if sets.get("place") == "online":
        sets["location"], sets["postal_code"] = None, None
    elif sets.get("place") == "phone":
        sets["postal_code"] = None
    if "onlineLink" in given:
        sets["online_link"] = _link(MeetingIn(onlineLink=body.onlineLink))
    if "notes" in given:
        sets["notes"] = _text(body.notes, 1000, "note")
    if "reminders" in given:
        sets["reminders"] = _reminders(body.reminders if body.reminders is not None else [])
    old_start = datetime.fromisoformat(m["startsAt"])
    old_end = datetime.fromisoformat(m["endsAt"])
    start, end = old_start, old_end
    if "startsAt" in given or "endsAt" in given:
        start, end = _times(MeetingIn(startsAt=body.startsAt or m["startsAt"], endsAt=body.endsAt or m["endsAt"]))
    moved = (start, end) != (old_start, old_end)
    shift, length = start - old_start, end - start

    targets = _series_from(m) if body.scope == "following" else [m]
    organiser = m["organiser"]["uid"]
    wanted_all: set[int] | None = None
    if body.people is not None:
        wanted_all = set(body.people) | {organiser}
        if len(wanted_all) < 2:
            raise HTTPException(400, "Invite at least one person.")
        allowed = {c["uid"] for c in contacts(acct)} | {p["uid"] for t in targets for p in t["people"]}
        if any(u not in allowed for u in wanted_all):
            raise HTTPException(403, "You can only invite the people you work with.")

    # What each meeting becomes: its time, and who's added or removed.
    plan: list[tuple[dict[str, Any], datetime, datetime, set[int], set[int], set[int]]] = []
    for t in targets:
        t_start = datetime.fromisoformat(t["startsAt"]) + (shift if moved else timedelta(0))
        t_end = t_start + length if moved else datetime.fromisoformat(t["endsAt"])
        current = {p["uid"] for p in t["people"]}
        wanted = wanted_all if wanted_all is not None else current
        plan.append((t, t_start, t_end, wanted, wanted - current, current - wanted))
    skip = {t["id"] for t, *_rest in plan}
    many = len(plan) > 1
    for _t, s, e, wanted, added, _removed in plan:
        uids = sorted(wanted if moved else added)
        hit = _clashes(uids, [(s, e)], skip=skip) if uids else []
        if hit:
            raise _busy_refusal(hit, -1, many)
    if not sets and not moved and not any(a or r for *_x, a, r in plan):
        raise HTTPException(400, "Nothing to change.")

    with transaction(acct.uid) as cur:
        for t, s, e, _w, added, removed in plan:
            row = dict(sets)
            if moved:
                row["starts_at"], row["ends_at"] = s, e
            if row:
                cur.execute(
                    f"update meetings set {', '.join(f'{k} = %({k})s' for k in row)} where meeting_id = %(mid)s",
                    {**row, "mid": t["id"]},
                )
            if moved:
                # A new time is a new question: everyone but the organiser answers again.
                cur.execute(
                    "update meeting_people set response = 'pending' where meeting_id = %s and user_id <> %s",
                    (t["id"], organiser),
                )
            for u in removed:
                cur.execute("delete from meeting_people where meeting_id = %s and user_id = %s", (t["id"], u))
            for u in added:
                cur.execute("insert into meeting_people (meeting_id, user_id) values (%s, %s)", (t["id"], u))

    title = sets.get("title", m["title"])
    after = " and the meetings after it" if many else ""
    everyone: set[int] = set().union(*(p[3] for p in plan))
    added_any: set[int] = set().union(*(p[4] for p in plan))
    removed_any: set[int] = set().union(*(p[5] for p in plan)) - everyone
    for u in (everyone - {acct.uid}) if moved else added_any:
        notify.notify(u, "meeting_changed" if moved and u not in added_any else "meeting_request",
                      f"Meeting moved · {title}" if moved and u not in added_any else f"Meeting request · {title}",
                      f"Now {when_text(start, end)}{after}. Accept or decline in your calendar.",
                      link=f"/calendar?meeting={mid}")  # fmt: skip
    for u in removed_any:
        notify.notify(u, "meeting_changed", f"Meeting cancelled · {title}",
                      "You're no longer invited to these meetings." if many else "You're no longer invited to this meeting.",
                      link="/calendar")  # fmt: skip
    if many:
        msg = f"Saved for {len(plan)} meetings." + (" Everyone has been asked again." if moved else "")
    else:
        msg = "Saved. Everyone has been asked again." if moved else "Saved."
    return {"message": msg, "meeting": _for(acct, _one(acct, mid))}


class Answer(BaseModel):
    response: Literal["accepted", "declined"]
    # A repeating meeting: answer this one and the ones after it too.
    series: bool = False


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
    targets = [m]
    if body.series:
        later = [t for t in _series_from(m) if t["id"] != m["id"]]
        for t in later:
            mine = next((p for p in t["people"] if p["uid"] == acct.uid), None)
            if mine and mine["response"] != body.response:
                targets.append(t)
    skipped: list[datetime] = []
    if body.response == "accepted" and len(targets) > 1:
        times = [(datetime.fromisoformat(t["startsAt"]), datetime.fromisoformat(t["endsAt"])) for t in targets]
        busy_at = {s for s, _who in _clashes([acct.uid], times, skip={t["id"] for t in targets})}
        skipped = sorted(busy_at)
        targets = [t for t in targets if datetime.fromisoformat(t["startsAt"]) not in busy_at]
        if not targets:
            raise HTTPException(409, f"You're busy at every one of these times ({_days(skipped)}).")
    with transaction(acct.uid) as cur:
        for t in targets:
            cur.execute(
                "update meeting_people set response = %s where meeting_id = %s and user_id = %s",
                (body.response, t["id"], acct.uid),
            )
    name = acct.user["full_name"] if acct.user else "Someone"
    word = "accepted" if body.response == "accepted" else "declined"
    when = when_text(datetime.fromisoformat(m["startsAt"]), datetime.fromisoformat(m["endsAt"]))
    many = len(targets) > 1
    notify.notify(m["organiser"]["uid"], "meeting_response", f"Meeting {word} · {m['title']}",
                  f"{name} {word} {len(targets)} meetings, from {when}." if many
                  else f"{name} {word} the meeting on {when}.",
                  link=f"/calendar?meeting={mid}")  # fmt: skip
    if body.response == "accepted":
        msg = (f"Accepted {len(targets)} meetings. The times are now held in your calendar." if many
               else "Accepted. The time is now held in your calendar.")  # fmt: skip
        if skipped:
            msg += f" You're busy on {_days(skipped)}, so those are still to answer."
    else:
        msg = f"Declined {len(targets)} meetings. The organiser has been told." if many else "Declined. The organiser has been told."
    return {"message": msg, "meeting": _for(acct, _one(acct, mid))}


class CancelIn(BaseModel):
    scope: Literal["one", "following"] = "one"


@router.post("/meetings/{mid}/cancel")
def cancel(mid: int, body: CancelIn | None = None, acct: Account = Depends(active)) -> dict[str, Any]:
    m = _one(acct, mid)
    if not _for(acct, m)["canEdit"]:
        raise HTTPException(403, "Only the person who arranged this meeting can cancel it.")
    targets = _series_from(m) if body and body.scope == "following" else [m]
    with transaction(acct.uid) as cur:
        for t in targets:
            cur.execute(
                "update meetings set cancelled_at = now(), cancelled_by = %s where meeting_id = %s", (acct.uid, t["id"])
            )
    told = {p["uid"] for t in targets for p in t["people"]} - {acct.uid}
    when = when_text(datetime.fromisoformat(m["startsAt"]), datetime.fromisoformat(m["endsAt"]))
    for u in told:
        notify.notify(u, "meeting_changed", f"Meeting cancelled · {m['title']}",
                      f"The meeting on {when} and the ones after it are off." if len(targets) > 1
                      else f"The meeting on {when} is off.",
                      link="/calendar")  # fmt: skip
    if len(targets) > 1:
        return {"message": f"Cancelled {len(targets)} meetings. Everyone invited has been told."}
    return {"message": "Cancelled. Everyone invited has been told."}


# ------------------------------------------------------------------ a place, and a video link


@router.get("/calendar/geocode")
def geocode(postal: str, _acct: Account = Depends(active)) -> dict[str, Any]:
    """Postal code → the address OneMap knows, for a physical meeting's address."""
    p = _postal(postal)
    if not p:
        raise HTTPException(400, "A Singapore postal code is 6 digits.")
    try:
        loc = onemap.resolve(None, p)
    except onemap.GeocodeError as exc:
        raise HTTPException(400, exc.for_people()) from exc
    return {"address": loc.address, "postalCode": loc.postal_code}


class VideoIn(BaseModel):
    provider: Literal["teams", "meet", "zoom"]
    title: str = ""
    startsAt: str = ""
    endsAt: str = ""


@router.post("/calendar/video-link")
def video_link(body: VideoIn, _acct: Account = Depends(active)) -> dict[str, Any]:
    """A Teams, Google Meet or Zoom meeting set up for this time, when the company's account is connected."""
    start, end = _times(MeetingIn(startsAt=body.startsAt, endsAt=body.endsAt))
    title = _text(body.title, 120, "title") or "Meeting"
    try:
        link = video.create(body.provider, title, start, end)
    except video.VideoError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"link": link}


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
