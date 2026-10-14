# ruff: noqa: E501  (SQL and messages read better whole)
"""Support: a homeowner asks; the assistant answers what it can; a person settles the rest.

  GET    /support                         my conversations (a manager: the ones they handle; a superadmin: all)
  POST   /support                         ask {projectId, message}; the assistant answers first (homeowners)
  GET    /support/{tid}                   one conversation: what was said, who's in it, what I may do
  POST   /support/{tid}/messages          say something {body}
  POST   /support/{tid}/read              I've read it all
  POST   /support/{tid}/ask-person        the asker wants a person: their project manager is told
  POST   /support/{tid}/members           bring someone in {uid} (the manager; anyone with an account)
  DELETE /support/{tid}/members/{uid}     take them out again
  POST   /support/{tid}/settle            it's settled (the asker or the manager)
  POST   /support/{tid}/reopen            it isn't after all
  POST   /support/{tid}/assign            hand it to another project manager {uid}
  POST   /support/{tid}/call              start a video call {link}: Google Meet, Teams or Zoom
  GET    /support/people?thread=&q=       who can be brought in
  GET    /support/answers                 the assistant's answers (managers)
  POST   /support/answers                 add one
  PATCH  /support/answers/{fid}           change one, or turn it off
  POST   /support/answers/starter         add the starter answers about the app

Who sees a conversation: the people in it; the project manager handling it
or running its project; every superadmin. Who handles it: the project's
manager, or whoever a superadmin hands it to; with no manager, the
superadmins. The database checks the same (migration 0036).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from _lib import assistant, notify
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active, role
from _routes import projects as proj

router = APIRouter()
pm_only = role("project_manager")
SG = ZoneInfo("Asia/Singapore")
MAX_MESSAGE = 2000
STATUS_LABEL = {
    "assistant": "With the assistant",
    "waiting": "Waiting for a person",
    "open": "In progress",
    "settled": "Settled",
}


def is_staff(acct: Account) -> bool:
    return acct.role in ("project_manager", "superadmin")


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(SG).isoformat() if dt else None


def _name(row: dict[str, Any], prefix: str) -> str | None:
    return row.get(f"{prefix}_name") or row.get(f"{prefix}_email")


def snippet(text: str, n: int = 140) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


# ------------------------------------------------------------------ reading


THREAD_SQL = """
select t.*, p.name as project_name, p.project_manager_id as project_pm,
       o.full_name as opener_name, o.email as opener_email, o.user_type::text as opener_role, o.language as opener_lang,
       h.full_name as handler_name, h.email as handler_email
  from support_threads t
  left join projects p on p.project_id = t.project_id
  join users o on o.uid = t.opened_by
  left join users h on h.uid = t.handled_by
"""


def load(tid: int) -> dict[str, Any]:
    t = fetch_one(THREAD_SQL + " where t.thread_id = %s", (tid,))
    if not t:
        raise HTTPException(404, "No such conversation.")
    return t


def members(tid: int) -> list[dict[str, Any]]:
    return fetch_all(
        "select m.user_id, m.last_read_id, m.added_at, u.full_name, u.email, u.user_type::text as role, u.active "
        "from support_members m join users u on u.uid = m.user_id where m.thread_id = %s order by m.added_at",
        (tid,),
    )


def handles(acct: Account, t: dict[str, Any]) -> bool:
    """Looks after this conversation: a superadmin, or the manager handling it or running its project."""
    if acct.role == "superadmin":
        return True
    return acct.role == "project_manager" and acct.uid in (t["handled_by"], t["project_pm"])


def can_see(acct: Account, t: dict[str, Any], ms: list[dict[str, Any]]) -> bool:
    return handles(acct, t) or any(m["user_id"] == acct.uid for m in ms)


def visible(acct: Account, tid: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    t = load(tid)
    ms = members(tid)
    if not can_see(acct, t, ms):
        raise HTTPException(404, "No such conversation.")
    return t, ms


def summary(t: dict[str, Any], me: int) -> dict[str, Any]:
    return {
        "id": t["thread_id"],
        "subject": t["subject"],
        "status": t["status"],
        "statusLabel": STATUS_LABEL[t["status"]],
        "project": {"id": t["project_id"], "name": t["project_name"]} if t["project_id"] else None,
        "openedBy": {"uid": t["opened_by"], "name": _name(t, "opener"), "role": t["opener_role"]},
        "handledBy": {"uid": t["handled_by"], "name": _name(t, "handler")} if t["handled_by"] else None,
        "askedAt": iso(t["asked_at"]),
        "answeredAt": iso(t["answered_at"]),
        "settledAt": iso(t["settled_at"]),
        "createdAt": iso(t["created_at"]),
        "mine": t["opened_by"] == me,
    }


@router.get("/support")
def inbox(acct: Account = Depends(active)) -> dict[str, Any]:
    me = acct.uid
    if acct.role == "superadmin":
        where, params = "true", {"me": me}
    elif acct.role == "project_manager":
        where = "(t.handled_by = %(me)s or p.project_manager_id = %(me)s or exists (select 1 from support_members m where m.thread_id = t.thread_id and m.user_id = %(me)s))"
        params = {"me": me}
    else:
        where = "exists (select 1 from support_members m where m.thread_id = t.thread_id and m.user_id = %(me)s)"
        params = {"me": me}
    rows = fetch_all(
        f"""
        select t.*, p.name as project_name, p.project_manager_id as project_pm,
               o.full_name as opener_name, o.email as opener_email, o.user_type::text as opener_role,
               h.full_name as handler_name, h.email as handler_email,
               last.body, last.kind, last.created_at as last_at, last.by_name
          from support_threads t
          left join projects p on p.project_id = t.project_id
          join users o on o.uid = t.opened_by
          left join users h on h.uid = t.handled_by
          left join lateral (
                select m.body, m.kind, m.created_at, s.full_name as by_name from support_messages m
                  left join users s on s.uid = m.sender_uid
                 where m.thread_id = t.thread_id order by m.message_id desc limit 1) last on true
         where {where}
         order by coalesce(last.created_at, t.created_at) desc
         limit 300
        """,
        params,
    )
    ids = [r["thread_id"] for r in rows]
    unread = {
        r["thread_id"]: r["n"]
        for r in fetch_all(
            "select m.thread_id, count(*)::int as n from support_messages m join support_members x "
            "on x.thread_id = m.thread_id and x.user_id = %(me)s "
            "where m.thread_id = any(%(ids)s) and m.message_id > x.last_read_id "
            "and m.sender_uid is distinct from %(me)s and m.kind <> 'event' group by 1",
            {"me": me, "ids": ids},
        )
    }
    threads = []
    for r in rows:
        s = summary(r, me)
        s["last"] = (
            {"body": snippet(r["body"]), "kind": r["kind"], "at": iso(r["last_at"]), "by": r["by_name"]}
            if r["body"]
            else None
        )
        s["unread"] = unread.get(r["thread_id"], 0)
        threads.append(s)
    projects = [] if is_staff(acct) else [{"id": p["id"], "name": p["name"]} for p in proj._load(acct)]
    return {
        "threads": threads,
        "staff": is_staff(acct),
        "superadmin": acct.role == "superadmin",
        "canAsk": not is_staff(acct),
        # Homeowners talk with the assistant first; anyone else goes straight to a person.
        "assistant": acct.role == "homeowner",
        "ai": assistant.configured(),
        "projects": projects,
    }


def message_out(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": m["message_id"],
        "kind": m["kind"],
        "body": m["body"],
        "at": iso(m["created_at"]),
        "by": {"uid": m["sender_uid"], "name": m["sender_name"] or m["sender_email"], "role": m["sender_role"]}
        if m["sender_uid"]
        else None,
    }


def messages(tid: int) -> list[dict[str, Any]]:
    return fetch_all(
        "select m.*, u.full_name as sender_name, u.email as sender_email, u.user_type::text as sender_role "
        "from support_messages m left join users u on u.uid = m.sender_uid where m.thread_id = %s order by m.message_id",
        (tid,),
    )


@router.get("/support/{tid:int}")
def thread(tid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    # The manager handling it joins on first look, so their unread count and alerts follow it.
    if t["handled_by"] == acct.uid and not any(m["user_id"] == acct.uid for m in ms):
        with transaction(acct.uid) as cur:
            cur.execute(
                "insert into support_members (thread_id, user_id) values (%s, %s) on conflict do nothing",
                (tid, acct.uid),
            )
        ms = members(tid)
    mine = t["opened_by"] == acct.uid
    staff_here = handles(acct, t)
    member = any(m["user_id"] == acct.uid for m in ms)
    settled = t["status"] == "settled"
    out = summary(t, acct.uid)
    out["messages"] = [message_out(m) for m in messages(tid)]
    out["members"] = [
        {"uid": m["user_id"], "name": m["full_name"] or m["email"], "role": m["role"], "roleLabel": ROLE_LABEL.get(m["role"], m["role"]),
         "asker": m["user_id"] == t["opened_by"], "handler": m["user_id"] == t["handled_by"]}
        for m in ms
    ]  # fmt: skip
    out["can"] = {
        "write": (member or staff_here) and (not settled or mine),
        "askPerson": mine and t["status"] == "assistant",
        "add": staff_here and not settled,
        "remove": staff_here and not settled,
        "settle": (mine or staff_here) and not settled,
        "reopen": (mine or staff_here) and settled,
        "assign": staff_here and not settled,
        "call": staff_here and not settled,
    }
    return out


@router.post("/support/{tid:int}/read")
def read(tid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    if any(m["user_id"] == acct.uid for m in ms):
        with transaction(acct.uid) as cur:
            cur.execute(
                "update support_members set last_read_id = coalesce((select max(message_id) from support_messages where thread_id = %s), 0) "
                "where thread_id = %s and user_id = %s",
                (tid, tid, acct.uid),
            )
    return {"ok": True}


# ------------------------------------------------------------------ telling people


def _admins() -> list[dict[str, Any]]:
    return fetch_all("select uid, email, language from users where active and user_type = 'superadmin'")


def _person(uid: int) -> dict[str, Any] | None:
    return fetch_one("select uid, full_name, email, language from users where uid = %s and active", (uid,))


def _tell(
    u: dict[str, Any], kind: str, title: str, body: str, tid: int, *, email: bool, project_id: int | None
) -> None:
    link = f"/support/{tid}"
    mail = None
    if email and u.get("email"):
        lang = u.get("language") or "en"
        html, text = notify.email_shell(title, [body], ("Open the conversation", f"{notify.app_url()}{link}"), lang)
        mail = (u["email"], notify.tr(f"{notify.BRAND}: {title}", lang) or title, html, text)
    try:
        notify.notify(u["uid"], kind, title, body, project_id=project_id, link=link, email=mail)
    except Exception as exc:  # one person's alert must never lose the message itself
        print(f"[support] notify {u['uid']} failed: {exc}")


def _handler_for(t: dict[str, Any]) -> int | None:
    """Who handles it when a person is asked for: the project's manager, if they're active."""
    if t["project_pm"] and fetch_one("select 1 from users where uid = %s and active", (t["project_pm"],)):
        return t["project_pm"]
    return None


def _ask_person(t: dict[str, Any], acct: Account, question: str) -> None:
    """Moves the conversation to a person and tells them (the superadmins when there's no manager)."""
    handler = _handler_for(t)
    with transaction(acct.uid) as cur:
        cur.execute(
            "update support_threads set status = 'waiting', asked_at = now(), answered_at = null, handled_by = coalesce(handled_by, %s) "
            "where thread_id = %s",
            (handler, t["thread_id"]),
        )
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (t["thread_id"], acct.uid, "Asked for a person."),
        )
    who = t["opener_name"] or t["opener_email"]
    about = f" about {t['project_name']}" if t["project_name"] else ""
    title = f"Support request · {t['subject']}"
    body = f"{who} asked for help{about}: “{snippet(question, 160)}”"
    target = t["handled_by"] or handler
    people = [_person(target)] if target else _admins()
    for u in people:
        if u:
            _tell(u, "support_request", title, body, t["thread_id"], email=True, project_id=t["project_id"])


# ------------------------------------------------------------------ asking


class AskIn(BaseModel):
    message: str = ""
    projectId: int | None = None
    subject: str | None = None


def clean_body(raw: str) -> str:
    body = (raw or "").strip()
    if not body:
        raise HTTPException(400, "Write your message first.")
    if len(body) > MAX_MESSAGE:
        raise HTTPException(400, f"Keep a message under {MAX_MESSAGE} characters.")
    return body


def _assistant_turn(t: dict[str, Any], acct: Account) -> dict[str, Any]:
    """The assistant answers the latest question; returns what it said."""
    history = messages(t["thread_id"])
    lang = acct.user.get("language") or "en"
    r = assistant.reply(acct.uid, t["project_id"], history, lang)
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, null, 'assistant', %s) returning message_id",
            (t["thread_id"], r.text[:4000]),
        )
    return {"text": r.text, "suggestPerson": r.handoff, "source": r.source}


@router.post("/support")
def ask(body: AskIn, acct: Account = Depends(active)) -> dict[str, Any]:
    if is_staff(acct):
        raise HTTPException(403, "Support is for homeowners and crews; project managers answer it.")
    text = clean_body(body.message)
    mine = {p["id"]: p for p in proj._load(acct)}
    if body.projectId is not None and body.projectId not in mine:
        raise HTTPException(404, "No such project.")
    pid = body.projectId if body.projectId is not None else (next(iter(mine)) if len(mine) == 1 else None)
    subject = snippet((body.subject or text.split("\n")[0]).strip(), 80)
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into support_threads (subject, opened_by, project_id) values (%s, %s, %s) returning thread_id",
            (subject, acct.uid, pid),
        )
        tid = cur.fetchone()["thread_id"]
        cur.execute("insert into support_members (thread_id, user_id) values (%s, %s)", (tid, acct.uid))
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'text', %s)",
            (tid, acct.uid, text),
        )
    t = load(tid)
    out: dict[str, Any] = {"id": tid}
    if acct.role == "homeowner":
        out["assistant"] = _assistant_turn(t, acct)
    else:
        # Crews and contractors go straight to a person: the assistant's answers are a homeowner's.
        _ask_person(t, acct, text)
    return out


class MessageIn(BaseModel):
    body: str = ""


@router.post("/support/{tid:int}/messages")
def say(tid: int, body: MessageIn, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    text = clean_body(body.body)
    mine = t["opened_by"] == acct.uid
    staff_here = handles(acct, t)
    member = any(m["user_id"] == acct.uid for m in ms)
    if t["status"] == "settled" and not mine:
        raise HTTPException(409, "This conversation is settled. Reopen it to write.")
    with transaction(acct.uid) as cur:
        if t["status"] == "settled":
            # The asker writing again reopens it, back to whoever was helping.
            cur.execute(
                "update support_threads set status = 'waiting', asked_at = now(), answered_at = null, settled_at = null, settled_by = null where thread_id = %s",
                (tid,),
            )
            cur.execute(
                "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', 'Reopened the conversation.')",
                (tid, acct.uid),
            )
        if staff_here and not member:
            cur.execute(
                "insert into support_members (thread_id, user_id) values (%s, %s) on conflict do nothing",
                (tid, acct.uid),
            )
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'text', %s) returning message_id",
            (tid, acct.uid, text),
        )
        if staff_here and t["status"] in ("assistant", "waiting"):
            # A person from 9 Solar Home answering: it's theirs now.
            cur.execute(
                "update support_threads set status = 'open', answered_at = coalesce(answered_at, now()), handled_by = coalesce(handled_by, %s) where thread_id = %s",
                (acct.uid, tid),
            )
    out: dict[str, Any] = {"ok": True}
    t2 = load(tid)
    if mine and t2["status"] == "assistant":
        out["assistant"] = _assistant_turn(t2, acct)
        return out
    # Everyone else in it hears about it (the asker by email too when 9 Solar Home answers).
    who = (acct.user.get("full_name") or acct.user.get("email")) if acct.user else "Someone"
    title = f"New message · {t['subject']}"
    note = f"{who}: {snippet(text)}"
    told = set()
    for m in members(tid):
        if m["user_id"] == acct.uid or not m["active"]:
            continue
        u = _person(m["user_id"])
        if u:
            _tell(
                u,
                "support_message",
                title,
                note,
                tid,
                email=staff_here and m["user_id"] == t["opened_by"],
                project_id=t["project_id"],
            )
            told.add(m["user_id"])
    if t2["status"] == "waiting" and t2["handled_by"] and t2["handled_by"] not in told and t2["handled_by"] != acct.uid:
        u = _person(t2["handled_by"])
        if u:
            _tell(u, "support_message", title, note, tid, email=False, project_id=t["project_id"])
    return out


@router.post("/support/{tid:int}/ask-person")
def ask_person(tid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    t, _ = visible(acct, tid)
    if t["opened_by"] != acct.uid:
        raise HTTPException(403, "Only the person who asked can ask for a person.")
    if t["status"] != "assistant":
        raise HTTPException(409, "A person already has this conversation.")
    question = next(
        (m["body"] for m in reversed(messages(tid)) if m["kind"] == "text" and m["sender_uid"] == acct.uid),
        t["subject"],
    )
    _ask_person(t, acct, question)
    who = load(tid)
    name = _name(who, "handler")
    return {
        "message": f"{name} has been asked to help. You'll get an alert when they answer."
        if name
        else "9 Solar Home has been asked to help. You'll get an alert when they answer."
    }


# ------------------------------------------------------------------ people


class MemberIn(BaseModel):
    uid: int


def _event(tid: int, actor: int, text: str) -> None:
    with transaction(actor) as cur:
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (tid, actor, text),
        )


def _require_handler(acct: Account, t: dict[str, Any]) -> None:
    if not handles(acct, t):
        raise HTTPException(403, "Only the project manager looking after this conversation can do that.")
    if t["status"] == "settled":
        raise HTTPException(409, "This conversation is settled. Reopen it first.")


@router.post("/support/{tid:int}/members")
def add_member(tid: int, body: MemberIn, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    _require_handler(acct, t)
    if any(m["user_id"] == body.uid for m in ms):
        raise HTTPException(409, "They're already in this conversation.")
    u = fetch_one(
        "select uid, full_name, email, language, user_type::text as role from users where uid = %s and active",
        (body.uid,),
    )
    if not u:
        raise HTTPException(404, "No one with an active account by that name.")
    me_name = acct.user.get("full_name") or acct.user.get("email")
    name = u["full_name"] or u["email"]
    with transaction(acct.uid) as cur:
        if not any(m["user_id"] == acct.uid for m in ms):
            cur.execute(
                "insert into support_members (thread_id, user_id) values (%s, %s) on conflict do nothing",
                (tid, acct.uid),
            )
        cur.execute("insert into support_members (thread_id, user_id) values (%s, %s)", (tid, body.uid))
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (tid, acct.uid, f"{me_name} added {name}."),
        )
    _tell(
        u,
        "support_added",
        f"You've been asked to help · {t['subject']}",
        f"{me_name} added you to a support conversation{' about ' + t['project_name'] if t['project_name'] else ''}.",
        tid,
        email=True,
        project_id=t["project_id"],
    )
    return {"message": f"{name} is in the conversation and has been told."}


@router.delete("/support/{tid:int}/members/{uid}")
def remove_member(tid: int, uid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    _require_handler(acct, t)
    m = next((m for m in ms if m["user_id"] == uid), None)
    if not m:
        raise HTTPException(404, "They're not in this conversation.")
    if uid == t["opened_by"]:
        raise HTTPException(409, "The person who asked stays in their conversation.")
    name = m["full_name"] or m["email"]
    me_name = acct.user.get("full_name") or acct.user.get("email")
    with transaction(acct.uid) as cur:
        cur.execute("delete from support_members where thread_id = %s and user_id = %s", (tid, uid))
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (tid, acct.uid, f"{me_name} took {name} out of the conversation."),
        )
    return {"message": f"{name} is no longer in the conversation."}


@router.get("/support/people")
def people(thread: int = Query(...), q: str = "", acct: Account = Depends(pm_only)) -> dict[str, Any]:
    t, ms = visible(acct, thread)
    inside = {m["user_id"] for m in ms}
    team: set[int] = set()
    if t["project_id"]:
        rows = proj._load(acct, t["project_id"])
        if rows:
            team = {x["uid"] for x in rows[0]["team"] if x.get("uid")}
    rows = fetch_all(
        "select uid, full_name, email, user_type::text as role from users where active and uid <> all(%(inside)s) "
        "and (%(q)s = '' or lower(coalesce(full_name, '')) like '%%' || %(q)s || '%%' or lower(email) like '%%' || %(q)s || '%%') "
        "order by full_name nulls last limit 200",
        {"inside": list(inside) or [0], "q": q.strip().lower()},
    )
    out = [
        {
            "uid": r["uid"],
            "name": r["full_name"] or r["email"],
            "email": r["email"],
            "role": r["role"],
            "roleLabel": ROLE_LABEL.get(r["role"], r["role"]),
            "onProject": r["uid"] in team,
        }
        for r in rows
    ]
    out.sort(key=lambda r: (not r["onProject"], (r["name"] or "").lower()))
    return {"people": out[:40]}


# ------------------------------------------------------------------ settling


@router.post("/support/{tid:int}/settle")
def settle(tid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    if t["opened_by"] != acct.uid and not handles(acct, t):
        raise HTTPException(403, "Only the person who asked, or their project manager, can settle this.")
    if t["status"] == "settled":
        raise HTTPException(409, "It's already settled.")
    name = acct.user.get("full_name") or acct.user.get("email")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update support_threads set status = 'settled', settled_at = now(), settled_by = %s where thread_id = %s",
            (acct.uid, tid),
        )
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (tid, acct.uid, f"{name} marked this settled."),
        )
    if t["status"] != "assistant":
        for m in ms:
            if m["user_id"] != acct.uid and m["active"]:
                u = _person(m["user_id"])
                if u:
                    _tell(
                        u,
                        "support_settled",
                        f"Settled · {t['subject']}",
                        f"{name} marked the conversation settled.",
                        tid,
                        email=False,
                        project_id=t["project_id"],
                    )
    return {"message": "Marked settled. Either of you can reopen it."}


@router.post("/support/{tid:int}/reopen")
def reopen(tid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    t, _ = visible(acct, tid)
    if t["opened_by"] != acct.uid and not handles(acct, t):
        raise HTTPException(403, "Only the person who asked, or their project manager, can reopen this.")
    if t["status"] != "settled":
        raise HTTPException(409, "It isn't settled.")
    back = "open" if handles(acct, t) or t["answered_at"] else "waiting"
    name = acct.user.get("full_name") or acct.user.get("email")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update support_threads set status = %s, settled_at = null, settled_by = null, asked_at = case when %s = 'waiting' then now() else asked_at end where thread_id = %s",
            (back, back, tid),
        )
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (tid, acct.uid, f"{name} reopened the conversation."),
        )
    if back == "waiting" and not t["handled_by"]:
        _ask_person(load(tid), acct, t["subject"])
    return {"message": "Reopened."}


class AssignIn(BaseModel):
    uid: int


@router.post("/support/{tid:int}/assign")
def assign(tid: int, body: AssignIn, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    _require_handler(acct, t)
    u = fetch_one(
        "select uid, full_name, email, language from users where uid = %s and active and user_type in ('project_manager', 'superadmin')",
        (body.uid,),
    )
    if not u:
        raise HTTPException(404, "Choose an active project manager.")
    name = u["full_name"] or u["email"]
    me_name = acct.user.get("full_name") or acct.user.get("email")
    with transaction(acct.uid) as cur:
        cur.execute("update support_threads set handled_by = %s where thread_id = %s", (u["uid"], tid))
        if not any(m["user_id"] == u["uid"] for m in ms):
            cur.execute("insert into support_members (thread_id, user_id) values (%s, %s)", (tid, u["uid"]))
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'event', %s)",
            (tid, acct.uid, f"{me_name} handed this to {name}."),
        )
    if u["uid"] != acct.uid:
        _tell(
            u,
            "support_request",
            f"Support request · {t['subject']}",
            f"{me_name} handed you a support conversation{' about ' + t['project_name'] if t['project_name'] else ''}.",
            tid,
            email=True,
            project_id=t["project_id"],
        )
    return {"message": f"{name} is handling it now."}


# ------------------------------------------------------------------ a video call

# The services a call link may point at, so a Join button never leads anywhere else.
CALL_LINK = re.compile(
    r"^https://(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)/[^\s<>\"']{1,500}$",
    re.IGNORECASE,
)


class CallIn(BaseModel):
    link: str = ""


@router.post("/support/{tid:int}/call")
def call(tid: int, body: CallIn, acct: Account = Depends(active)) -> dict[str, Any]:
    t, ms = visible(acct, tid)
    _require_handler(acct, t)
    link = (body.link or "").strip()
    if not CALL_LINK.match(link):
        raise HTTPException(400, "Paste a Google Meet, Microsoft Teams or Zoom link, starting with https://.")
    name = acct.user.get("full_name") or acct.user.get("email")
    with transaction(acct.uid) as cur:
        if not any(m["user_id"] == acct.uid for m in ms):
            cur.execute(
                "insert into support_members (thread_id, user_id) values (%s, %s) on conflict do nothing",
                (tid, acct.uid),
            )
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'call', %s)",
            (tid, acct.uid, link),
        )
        if t["status"] in ("assistant", "waiting"):
            cur.execute(
                "update support_threads set status = 'open', answered_at = coalesce(answered_at, now()), handled_by = coalesce(handled_by, %s) where thread_id = %s",
                (acct.uid, tid),
            )
    for m in members(tid):
        if m["user_id"] != acct.uid and m["active"]:
            u = _person(m["user_id"])
            if u:
                _tell(
                    u,
                    "support_message",
                    f"Video call · {t['subject']}",
                    f"{name} started a video call. Open the conversation to join.",
                    tid,
                    email=True,
                    project_id=t["project_id"],
                )
    return {"message": "Call link sent. Everyone in the conversation has been told."}


# ------------------------------------------------------------------ the assistant's answers


class AnswerIn(BaseModel):
    question: str | None = None
    answer: str | None = None
    questionZh: str | None = None
    answerZh: str | None = None
    position: int | None = None
    active: bool | None = None


def answer_out(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["faq_id"], "question": r["question"], "answer": r["answer"], "questionZh": r["question_zh"],
        "answerZh": r["answer_zh"], "position": r["position"], "active": r["active"], "updatedAt": iso(r["updated_at"]),
    }  # fmt: skip


@router.get("/support/answers")
def answers(acct: Account = Depends(pm_only)) -> dict[str, Any]:
    rows = fetch_all("select * from support_faq order by active desc, position, faq_id")
    return {"answers": [answer_out(r) for r in rows], "ai": assistant.configured(), "starterLeft": _starter_left()}


def _text(v: str | None, what: str, n: int, required: bool) -> str | None:
    v = (v or "").strip()
    if not v:
        if required:
            raise HTTPException(400, f"Write the {what}.")
        return None
    if len(v) > n:
        raise HTTPException(400, f"Keep the {what} under {n} characters.")
    return v


@router.post("/support/answers")
def add_answer(body: AnswerIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    q = _text(body.question, "question", 300, True)
    a = _text(body.answer, "answer", 3000, True)
    pos = (
        body.position
        if body.position is not None
        else (fetch_one("select coalesce(max(position), 0) + 1 as n from support_faq") or {"n": 1})["n"]
    )
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into support_faq (question, answer, question_zh, answer_zh, position) values (%s, %s, %s, %s, %s) returning faq_id",
            (
                q,
                a,
                _text(body.questionZh, "Chinese question", 300, False),
                _text(body.answerZh, "Chinese answer", 3000, False),
                pos,
            ),
        )
        fid = cur.fetchone()["faq_id"]
    return {"id": fid, "message": "Answer added. The assistant uses it from now on."}


@router.patch("/support/answers/{fid}")
def change_answer(fid: int, body: AnswerIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    if not fetch_one("select 1 from support_faq where faq_id = %s", (fid,)):
        raise HTTPException(404, "No such answer.")
    sets: dict[str, Any] = {}
    if body.question is not None:
        sets["question"] = _text(body.question, "question", 300, True)
    if body.answer is not None:
        sets["answer"] = _text(body.answer, "answer", 3000, True)
    if body.questionZh is not None:
        sets["question_zh"] = _text(body.questionZh, "Chinese question", 300, False)
    if body.answerZh is not None:
        sets["answer_zh"] = _text(body.answerZh, "Chinese answer", 3000, False)
    if body.position is not None:
        sets["position"] = body.position
    if body.active is not None:
        sets["active"] = body.active
    if not sets:
        return {"message": "Nothing changed."}
    with transaction(acct.uid) as cur:
        cur.execute(
            "update support_faq set " + ", ".join(f"{k} = %({k})s" for k in sets) + " where faq_id = %(fid)s",
            {**sets, "fid": fid},
        )
    if body.active is False:
        return {"message": "Turned off. The assistant no longer uses it."}
    return {"message": "Saved."}


def _starter_left() -> int:
    have = {r["question"] for r in fetch_all("select question from support_faq")}
    return sum(1 for s in assistant.STARTER if s[0] not in have)


@router.post("/support/answers/starter")
def add_starter(acct: Account = Depends(pm_only)) -> dict[str, Any]:
    have = {r["question"] for r in fetch_all("select question from support_faq")}
    n = (fetch_one("select coalesce(max(position), 0) as n from support_faq") or {"n": 0})["n"]
    added = 0
    with transaction(acct.uid) as cur:
        for q, a, qz, az in assistant.STARTER:
            if q in have:
                continue
            n += 1
            cur.execute(
                "insert into support_faq (question, answer, question_zh, answer_zh, position) values (%s, %s, %s, %s, %s)",
                (q, a, qz, az, n),
            )
            added += 1
    return {
        "message": f"Added {added} starter answers about using the app."
        if added
        else "The starter answers are already there."
    }
