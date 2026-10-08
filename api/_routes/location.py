"""Sharing your location with project managers.

  PUT   /me/location               {lat, lng, accuracy}: your phone's position, while you share
  GET   /people/locations          (PMs) everyone, with the last position of those who share
  POST  /people/{uid}/ask-location (PMs) ask someone to share: they get an alert

Sharing is each person's own choice (Account → Settings → Share my location,
PATCH /me/settings {shareLocation}); the database refuses anyone else
switching it. Turning it off, or the account being disabled, deletes the last
position. Only the latest position is kept, never a trail.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from _lib import notify
from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active, role

from .people import avatar_url

router = APIRouter()

# A position this rough says nothing useful about where someone is.
MAX_ACCURACY_M = 5000
# A PM can ask the same person again after this long.
ASK_AGAIN_AFTER = timedelta(minutes=10)


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)


@router.put("/me/location")
def share(body: LocationIn, acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.acting_pm:
        raise HTTPException(403, "Not while testing as someone else: this phone is yours, not theirs.")
    if not (acct.user or {}).get("share_location"):
        raise HTTPException(409, "Turn on location sharing first.")
    if body.accuracy is not None and body.accuracy > MAX_ACCURACY_M:
        raise HTTPException(400, "That location is too rough to share. Try again with a better GPS signal.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into user_locations (uid, lat, lng, accuracy_m, recorded_at) values (%s, %s, %s, %s, now()) "
            "on conflict (uid) do update set lat = excluded.lat, lng = excluded.lng, "
            "accuracy_m = excluded.accuracy_m, recorded_at = excluded.recorded_at returning recorded_at",
            (acct.uid, body.lat, body.lng, body.accuracy),
        )
        row = cur.fetchone()
    return {"at": row["recorded_at"].isoformat() if row else None}


def _person(r: dict[str, Any]) -> dict[str, Any]:
    has = r["lat"] is not None
    return {
        "uid": r["uid"],
        "name": r["full_name"] or r["email"],
        "role": r["user_type"],
        "roleLabel": ROLE_LABEL[r["user_type"]],
        "avatar": avatar_url(r),
        "sharing": r["share_location"],
        "location": {"lat": r["lat"], "lng": r["lng"], "accuracy": r["accuracy_m"], "at": r["recorded_at"].isoformat()}
        if has
        else None,
    }


@router.get("/people/locations")
def locations(acct: Account = Depends(role("project_manager"))) -> dict[str, Any]:
    """Everyone with an active account, sharing first; the newest positions first."""
    rows = fetch_all(
        "select u.uid, u.full_name, u.email, u.user_type, u.avatar_key, u.avatar_updated_at, u.share_location, "
        "l.lat, l.lng, l.accuracy_m, l.recorded_at "
        "from users u left join user_locations l on l.uid = u.uid "
        "where u.active order by l.recorded_at desc nulls last, u.share_location desc, u.full_name nulls last, u.email",
        actor_uid=acct.uid,
    )
    return {"me": acct.uid, "people": [_person(r) for r in rows]}


@router.post("/people/{uid}/ask-location")
def ask(uid: int, acct: Account = Depends(role("project_manager"))) -> dict[str, Any]:
    u = fetch_one("select uid, full_name, email, active, share_location from users where uid = %s", (uid,))
    if not u or not u["active"]:
        raise HTTPException(404, "No such account.")
    if uid == acct.uid:
        raise HTTPException(400, "That's you. Turn sharing on in Account → Settings.")
    name = u["full_name"] or u["email"]
    if u["share_location"]:
        return {"message": f"{name} is already sharing their location."}
    recent = fetch_one(
        "select created_at from notifications where recipient_uid = %s and kind = 'location_request' "
        "order by created_at desc limit 1",
        (uid,),
        actor_uid=uid,
    )
    if recent and datetime.now(UTC) - recent["created_at"] < ASK_AGAIN_AFTER:
        raise HTTPException(429, f"{name} was asked a few minutes ago. Give them a moment.")
    by = (acct.user or {}).get("full_name") or "A project manager"
    notify.notify(
        uid,
        "location_request",
        "Please share your location",
        f"{by} asked you to share your location. Turn it on in Account → Settings.",
        link="/account?tab=settings",
    )
    return {"message": f"Asked {name} to share their location."}
