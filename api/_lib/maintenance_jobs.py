"""Maintenance the project manager starts (migration 0057, docs/maintenance.md).

A homeowner doesn't see their system's check schedule. When its project manager decides it's time, they
start maintenance (for one of the yearly checks, or not tied to one): the homeowner hears then, is
invited to the visit when it's booked, and hears again when it's done. Booking a check's visit starts
its maintenance if nobody has yet. At most one piece of maintenance is open on a system at a time.
"""

from __future__ import annotations

from typing import Any

from _lib import checks, notify
from _lib.db import fetch_one, transaction


def open_job(system_id: int) -> dict[str, Any] | None:
    return fetch_one("select * from maintenance_jobs where system_id = %s and status = 'started'", (system_id,))


def latest(system_id: int) -> dict[str, Any] | None:
    """The most recent finished piece of maintenance (done), for the homeowner's "last maintained"."""
    return fetch_one(
        "select * from maintenance_jobs where system_id = %s and status = 'done' order by finished_at desc limit 1",
        (system_id,),
    )


def _homeowner_link(s: dict[str, Any]) -> str:
    return f"/projects/{s['project_id']}?tab=maintenance" if s.get("project_id") else "/calendar"


def start(s: dict[str, Any], check_key: str | None, by_uid: int, note: str | None = None) -> dict[str, Any]:
    """Starts maintenance on system ``s`` and tells its homeowner. Raises ValueError if one is already open."""
    if open_job(s["system_id"]):
        raise ValueError("Maintenance is already under way on this system: finish or call it off first.")
    with transaction(by_uid) as cur:
        cur.execute(
            "insert into maintenance_jobs (system_id, check_key, note, started_by) values (%s, %s, %s, %s) returning *",
            (s["system_id"], check_key, note, by_uid),
        )
        job = cur.fetchone()
    assert job is not None
    if s.get("homeowner_id"):
        # Not which check: the homeowner doesn't see the schedule.
        notify.notify(
            s["homeowner_id"],
            "maintenance_started",
            f"Maintenance starting · {s['address']}",
            "9 Solar Home is starting maintenance on your solar system. "
            "Your project manager will arrange a visit with you.",
            project_id=s.get("project_id"),
            link=_homeowner_link(s),
        )
    return job


def finish(s: dict[str, Any], job: dict[str, Any], outcome: str, by_uid: int) -> None:
    """Closes maintenance as done or cancelled, and tells the homeowner."""
    with transaction(by_uid) as cur:
        cur.execute(
            "update maintenance_jobs set status = %s, finished_at = now(), finished_by = %s "
            "where job_id = %s and status = 'started'",
            (outcome, by_uid, job["job_id"]),
        )
        if not cur.rowcount:
            return
    if not s.get("homeowner_id"):
        return
    if outcome == "done":
        title, body = (
            f"Maintenance done · {s['address']}",
            "The maintenance on your solar system is done. Thank you for having us.",
        )
    else:
        title, body = (
            f"Maintenance called off · {s['address']}",
            "The maintenance on your solar system won't go ahead for now. Your project manager will be in touch.",
        )
    notify.notify(s["homeowner_id"], "maintenance_done", title, body, project_id=s.get("project_id"),
                  link=_homeowner_link(s))  # fmt: skip


def for_screen(job: dict[str, Any] | None) -> dict[str, Any] | None:
    if not job:
        return None
    return {
        "id": job["job_id"],
        "checkKey": job["check_key"],
        "label": checks.label(job["check_key"]) if job["check_key"] else "Maintenance",
        "status": job["status"],
        "note": job["note"],
        "startedAt": job["started_at"].isoformat(),
        "finishedAt": job["finished_at"].isoformat() if job["finished_at"] else None,
    }
