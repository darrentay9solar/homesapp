"""Warnings for managers: a word the day something goes wrong, and a morning summary.

Run by the 15-minute job (POST /cron/visit-reminders). Each warning goes
once to each person (watch_alerts):

  project_late   the day a project passes its target end date, to its
                 project manager (the superadmins while it has none).
  escalation     to the superadmins: a project 14 days late, or a
                 maintenance check 30 days overdue on a system that has a
                 manager (one without already reminds the superadmins).
  daily_summary  from 08:00 Singapore time, Monday to Saturday, to every
                 active project manager and superadmin with something to act
                 on: late projects, approvals and handovers waiting, projects
                 due soon, maintenance checks overdue or due this week,
                 urgent systems, account requests waiting and (superadmins)
                 systems without a manager. Nothing to act on, nothing sent.

The numbers are the dashboard's own (_routes/analytics), worked out as each
reader, so the summary and the dashboard always agree.

The one-off warnings only fire inside a window (a project 1 to 7 days late,
14 to 21 days, a check 30 to 37 days overdue), so turning this on, or an
item that was already old, never sends a burst: those are in the summary.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from _lib import analytics as an
from _lib import notify
from _lib.account import Account
from _lib.auth import ClerkIdentity
from _lib.db import fetch_all, transaction

SG = ZoneInfo("Asia/Singapore")
SUMMARY_HOUR = 8  # Singapore time
LATE_WINDOW = (1, 7)  # days late: the manager is told
ESCALATE_LATE = (14, 21)  # days late: the superadmins are told
ESCALATE_CHECK = (30, 37)  # days a check is overdue: the superadmins are told
CHECK_NAME = {"six_month": "6-month check", "one_year": "1-year check"}


def _claim(kind: str, subject: str, uid: int) -> bool:
    """Records the warning; False if it already went (so two runs at once can't both send it)."""
    with transaction(None) as cur:
        cur.execute(
            "insert into watch_alerts (kind, subject, recipient_uid) values (%s, %s, %s) "
            "on conflict do nothing returning recipient_uid",
            (kind, subject, uid),
        )
        return cur.fetchone() is not None


def _as(user: dict[str, Any]) -> Account:
    """The job, looking as this person: the same projects and numbers they see."""
    return Account("active", ClerkIdentity(user.get("clerk_user_id") or f"watch:{user['uid']}", None), user=user)


def _managers(uids: list[int] | None = None) -> list[dict[str, Any]]:
    """Active project managers and superadmins (``uids``: only these, for tests)."""
    return fetch_all(
        "select * from users where active and user_type in ('project_manager', 'superadmin') "
        "and (%(uids)s::int[] is null or uid = any(%(uids)s)) order by uid",
        {"uids": uids},
    )


def _send(u: dict[str, Any], kind: str, title: str, body: str, link: str, cta: str, *,
          lines: list[str] | None = None, project_id: int | None = None) -> None:  # fmt: skip
    """In-app (and the phone), and by email, in their language and as their settings allow."""
    lang = u.get("language") or "en"
    html, text = notify.email_shell(title, lines or [body], (cta, f"{notify.app_url()}{link}"), lang)
    subject = notify.tr(f"{notify.BRAND}: {title}", lang) or title
    email = (u["email"], subject, html, text) if u.get("email") else None
    notify.notify(u["uid"], kind, title, body, project_id=project_id, link=link, email=email)


# ------------------------------------------------------------ one-off warnings


def late_projects(today: date, *, uids: list[int] | None = None, project_ids: list[int] | None = None) -> int:
    """A project gone late: its manager, once; two weeks on, the superadmins, once."""
    from _routes import projects as proj  # the Projects list's own rows and flags

    people = _managers(uids)
    admins = [u for u in people if u["user_type"] == "superadmin"]
    if not admins:
        return 0
    by_uid = {u["uid"]: u for u in people}
    sent = 0
    for r in proj._load(_as(admins[0])):
        if project_ids is not None and r["id"] not in project_ids:
            continue
        if not r["endDate"] or not any(f["kind"] == "overdue" for f in r["flags"]):
            continue
        days = (today - date.fromisoformat(r["endDate"])).days
        pm = by_uid.get((r.get("pm") or {}).get("uid"))
        subject = f"{r['id']}:{r['endDate']}"
        if LATE_WINDOW[0] <= days <= LATE_WINDOW[1]:
            for u in [pm] if pm else admins:
                if _claim("project_late", subject, u["uid"]):
                    title = f"Project late · {r['name']}"
                    body = f"{r['name']} has passed its target end date ({r['endDate']}) and isn't finished."
                    link = f"/projects/{r['id']}"
                    _send(u, "project_late", title, body, link, "Open the project", project_id=r["id"])
                    sent += 1
        if ESCALATE_LATE[0] <= days <= ESCALATE_LATE[1]:
            who = (r.get("pm") or {}).get("name") or "no project manager"
            for u in admins:
                if _claim("escalation", f"late:{subject}", u["uid"]):
                    title = f"Two weeks late · {r['name']}"
                    body = f"{r['name']} is {days} days past its target end date ({who})."
                    _send(u, "escalation", title, body, f"/projects/{r['id']}", "Open the project", project_id=r["id"])
                    sent += 1
    return sent


def overdue_checks(today: date, *, uids: list[int] | None = None, system_ids: list[int] | None = None) -> int:
    """A check a month overdue on a system that has a manager: the superadmins, once."""
    admins = [u for u in _managers(uids) if u["user_type"] == "superadmin"]
    sent = 0
    rows = fetch_all(
        "select m.system_id, m.address, m.six_month_due, m.six_month_done_on, m.one_year_due, m.one_year_done_on, "
        "u.full_name as pm_name from maintenance_systems m join users u on u.uid = m.run_by "
        "where %(ids)s::int[] is null or m.system_id = any(%(ids)s)",
        {"ids": system_ids},
    )
    for s in rows:
        for key, name in CHECK_NAME.items():
            due, done = s[f"{key}_due"], s[f"{key}_done_on"]
            if not due or done or not ESCALATE_CHECK[0] <= (today - due).days <= ESCALATE_CHECK[1]:
                continue
            for u in admins:
                if _claim("escalation", f"check:{s['system_id']}:{key}:{due.isoformat()}", u["uid"]):
                    days = (today - due).days
                    title = f"{name} a month overdue · {s['address']}"
                    body = f"The {name} at {s['address']} is {days} days overdue ({s['pm_name']})."
                    _send(u, "escalation", title, body, f"/maintenance/{s['system_id']}", "Open the system")
                    sent += 1
    return sent


# ------------------------------------------------------------ the morning summary


def summary_lines(d: dict[str, Any], upkeep: dict[str, Any], requests: int, *, superadmin: bool,
                  today: date, support: int = 0) -> list[str]:  # fmt: skip
    """What needs this person, most pressing first; empty when nothing does."""
    t, u = d["tiles"], upkeep["tiles"]
    lines = []
    if support:
        lines.append(f"People waiting for a support answer: {support}")
    if t["late"]["count"]:
        # Keyed by id: numbers here, strings once sent as JSON.
        late = [d["projects"].get(i) or d["projects"].get(str(i)) for i in t["late"]["ids"]]
        worst = max((p["daysLate"] for p in late if p), default=0)
        lines.append(f"Late projects: {t['late']['count']}, the latest {worst} days over")
    if u["urgent"]["count"]:
        lines.append(f"Systems marked urgent: {u['urgent']['count']}")
    if u["overdue"]["count"]:
        lines.append(f"Systems with a check overdue: {u['overdue']['count']}")
    if t["awaitingPm"]["ids"]:
        lines.append(f"Waiting for your approval: {len(t['awaitingPm']['ids'])}")
    if t["handover"]["ids"]:
        lines.append(f"At handover, to sign or close: {len(t['handover']['ids'])}")
    if requests:
        lines.append(f"Account requests waiting: {requests}")
    week = sum(
        1
        for s in upkeep["systems"].values()
        if s["next"] and not s["next"]["overdue"] and (date.fromisoformat(s["next"]["due"]) - today).days < 7
    )
    if week:
        lines.append(f"Checks due this week: {week}")
    if d["delivery"]["dueSoon"]:
        lines.append(f"Projects due in the next 14 days: {len(d['delivery']['dueSoon'])}")
    if superadmin and u["unassigned"]["count"]:
        lines.append(f"Systems without a project manager: {u['unassigned']['count']}")
    return lines


def support_waiting(uid: int, superadmin: bool) -> int:
    """Support conversations waiting for a first answer from this person (a superadmin: from anyone)."""
    return fetch_all(
        "select count(*)::int as n from support_threads t left join projects p on p.project_id = t.project_id "
        "where t.status = 'waiting' and (%(sa)s or t.handled_by = %(me)s "
        "or (t.handled_by is null and p.project_manager_id = %(me)s))",
        {"sa": superadmin, "me": uid},
    )[0]["n"]


def unanswered_support(now: datetime, *, uids: list[int] | None = None, thread_ids: list[int] | None = None) -> int:
    """Someone waiting a day for an answer: the superadmins, once (until it's 3 days old: then it's in the summary)."""
    admins = [u for u in _managers(uids) if u["user_type"] == "superadmin"]
    rows = fetch_all(
        "select t.thread_id, t.subject, t.asked_at, o.full_name as opener, h.full_name as handler "
        "from support_threads t join users o on o.uid = t.opened_by left join users h on h.uid = t.handled_by "
        "where t.status = 'waiting' and t.asked_at <= %(now)s - interval '1 day' "
        "and t.asked_at > %(now)s - interval '3 days' and (%(ids)s::int[] is null or t.thread_id = any(%(ids)s))",
        {"now": now, "ids": thread_ids},
    )
    sent = 0
    for r in rows:
        for u in admins:
            if _claim("escalation", f"support:{r['thread_id']}:{r['asked_at'].isoformat()}", u["uid"]):
                title = f"No answer for a day · {r['subject']}"
                body = f"{r['opener']} has been waiting a day for an answer ({r['handler'] or 'no project manager'})."
                _send(u, "escalation", title, body, f"/support/{r['thread_id']}", "Open the conversation")
                sent += 1
    return sent


def requests_waiting() -> int:
    """Account and role requests no one has decided yet."""
    return fetch_all(
        "select (select count(*) from account_requests where status = 'pending')::int "
        "+ (select count(*) from role_change_requests where status = 'pending')::int as n"
    )[0]["n"]


def summaries(now: datetime, *, uids: list[int] | None = None) -> int:
    """The morning summary, once a day from 08:00, Monday to Saturday."""
    from _routes import analytics as dash

    local = now.astimezone(SG)
    if local.hour < SUMMARY_HOUR or local.weekday() == 6:
        return 0
    today = local.date()
    requests = requests_waiting()
    sent = 0
    for u in _managers(uids):
        superadmin = u["user_type"] == "superadmin"
        # Already sent today? Checked before the work of adding it all up.
        if fetch_all(
            "select 1 from watch_alerts where kind = 'daily_summary' and subject = %s and recipient_uid = %s",
            (today.isoformat(), u["uid"]),
        ):
            continue
        d = dash.dashboard(period="30d", pm=None, acct=_as(u))
        # A manager's own systems; a superadmin's, all of them.
        rows = fetch_all(
            "select m.*, p.full_name as pm_name from maintenance_systems m left join users p on p.uid = m.run_by "
            "where %(all)s or m.run_by = %(me)s",
            {"all": superadmin, "me": u["uid"]},
        )
        lines = summary_lines(d, an.maintenance(rows, today), requests, superadmin=superadmin, today=today,
                              support=support_waiting(u["uid"], superadmin))  # fmt: skip
        if not lines or not _claim("daily_summary", today.isoformat(), u["uid"]):
            continue
        title = "Your morning summary"
        _send(u, "daily_summary", title, " · ".join(lines), "/dashboard", "Open the dashboard", lines=lines)
        sent += 1
    return sent


def run(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(SG)
    today = now.astimezone(SG).date()
    return {
        "late": late_projects(today),
        "checks": overdue_checks(today),
        "support": unanswered_support(now),
        "summaries": summaries(now),
    }
