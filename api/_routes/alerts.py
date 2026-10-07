"""Alerts: everything the app has told you, and your phones.

  GET    /alerts                  newest first, 50 at a time (?before=<id> for older)
  POST   /alerts/read             {ids: [...]} or {all: true}
  GET    /push/key                the public key a phone subscribes with (null if push isn't set up)
  POST   /push/subscriptions      this phone or browser wants notifications
  DELETE /push/subscriptions      not any more ({endpoint})
  POST   /push/test               send yourself one

The phone and the Alerts screen show the same alert: the phone's carries the
alert's id and link, opening it marks it read, and the unread count travels
with each push so the app icon's badge matches the screen.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from _lib import notify, push
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active

router = APIRouter()

KIND_LABEL = {
    "approval_request": "Approval",
    "approval_granted": "Approval",
    "approval_declined": "Approval",
    "assignment": "Project",
    "visit_assigned": "Site visit",
    "visit_reminder": "Site visit",
    "visit_missed": "Running late",
    "crew_arrived_late": "Running late",
    "milestone_complete": "Milestone",
    "signature_request": "Handover",
    "signed": "Handover",
    "project_closed": "Handover",
    "account_created": "Account",
    "account_request": "People",
    "account_approved": "Account",
    "account_rejected": "Account",
    "audit_restore": "Audit",
    "role_request": "People",
    "role_approved": "Account",
    "role_rejected": "Account",
}


def unread_count(uid: int) -> int:
    row = fetch_one(
        "select count(*)::int as n from notifications where recipient_uid = %s and read_at is null",
        (uid,),
        actor_uid=uid,
    )
    return row["n"] if row else 0


@router.get("/alerts")
def alerts(
    acct: Account = Depends(active), before: int | None = None, limit: int = Query(50, ge=1, le=200)
) -> dict[str, Any]:
    rows = fetch_all(
        "select n.*, coalesce(nullif(p.name, ''), p.address) as project from notifications n "
        "left join projects p on p.project_id = n.project_id "
        "where n.recipient_uid = %s and (%s::bigint is null or n.notification_id < %s) "
        "order by n.notification_id desc limit %s",
        (acct.uid, before, before, limit + 1),
        actor_uid=acct.uid,
    )
    more = len(rows) > limit
    return {
        "alerts": [
            {
                "id": r["notification_id"],
                "kind": r["kind"],
                "kindLabel": KIND_LABEL.get(r["kind"], "Update"),
                "title": r["title"],
                "body": r["body"],
                "link": r["link"] or notify.default_link(r["kind"], r["project_id"]),
                "projectId": r["project_id"],
                "projectName": r["project"],
                "createdAt": r["created_at"].isoformat(),
                "read": r["read_at"] is not None,
                "urgent": r["kind"] in ("visit_missed", "crew_arrived_late"),
            }
            for r in rows[:limit]
        ],
        "more": more,
        "unread": unread_count(acct.uid),
    }


class ReadIn(BaseModel):
    ids: list[int] = []
    all: bool = False


@router.post("/alerts/read")
def mark_read(body: ReadIn, acct: Account = Depends(active)) -> dict[str, Any]:
    if not body.all and not body.ids:
        raise HTTPException(400, "Nothing to mark.")
    with transaction(acct.uid) as cur:
        if body.all:
            cur.execute(
                "update notifications set read_at = now() where recipient_uid = %s and read_at is null", (acct.uid,)
            )
        else:
            cur.execute(
                "update notifications set read_at = now() where recipient_uid = %s and read_at is null "
                "and notification_id = any(%s)",
                (acct.uid, body.ids),
            )
    return {"unread": unread_count(acct.uid)}


# --------------------------------------------------------------------- push


class SubIn(BaseModel):
    endpoint: str = ""
    keys: dict[str, str] = {}


@router.get("/push/key")
def push_key(acct: Account = Depends(active)) -> dict[str, Any]:
    v = push.vapid()
    devices = fetch_one("select count(*)::int as n from push_subscriptions where uid = %s", (acct.uid,))
    return {"publicKey": v.public_key if v else None, "devices": devices["n"] if devices else 0}


@router.post("/push/subscriptions")
def subscribe(body: SubIn, request: Request, acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.acting_pm:
        raise HTTPException(403, "Not while testing as someone else: this phone is yours, not theirs.")
    endpoint, p256dh, auth = body.endpoint.strip(), body.keys.get("p256dh", ""), body.keys.get("auth", "")
    if not endpoint.startswith("https://") or len(endpoint) > 2000:
        raise HTTPException(400, "That isn't a push subscription.")
    try:
        if len(push.b64u_decode(p256dh)) != 65 or len(push.b64u_decode(auth)) != 16:
            raise ValueError
    except ValueError as exc:
        raise HTTPException(400, "That subscription's keys aren't valid.") from exc
    agent = (request.headers.get("user-agent") or "")[:300] or None
    with transaction(acct.uid) as cur:
        # The same phone re-subscribing (or another person signing in on it) replaces the old entry.
        cur.execute("delete from push_subscriptions where endpoint = %s", (endpoint,))
        cur.execute(
            "insert into push_subscriptions (uid, endpoint, p256dh, auth, user_agent) values (%s, %s, %s, %s, %s)",
            (acct.uid, endpoint, p256dh, auth, agent),
        )
    return {"message": "Notifications are on for this device."}


@router.delete("/push/subscriptions")
def unsubscribe(body: SubIn, acct: Account = Depends(active)) -> dict[str, Any]:
    with transaction(acct.uid) as cur:
        cur.execute(
            "delete from push_subscriptions where endpoint = %s and uid = %s", (body.endpoint.strip(), acct.uid)
        )
    return {"message": "Notifications are off for this device."}


@router.post("/push/test")
def test_push(acct: Account = Depends(active)) -> dict[str, Any]:
    if not push.vapid():
        raise HTTPException(503, "Phone notifications aren't set up on the server yet (VAPID keys).")
    if not fetch_one("select 1 from push_subscriptions where uid = %s", (acct.uid,)):
        raise HTTPException(400, "Turn on notifications on this device first.")
    report = notify.notify(
        acct.uid,
        "assignment",
        "Test notification",
        "If you can see this on your phone, alerts will reach you here.",
        link="/alerts",
    )
    r = report.get("push")
    if not r or r.status != "sent":
        raise HTTPException(502, f"The test didn't reach your device: {r.detail if r else 'no device'}")
    return {"message": "Sent. It should appear on your device in a few seconds."}
