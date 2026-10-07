"""Notification preferences: when and what to be told about.

Stored per person in users.notification_prefs (migration 0025):

    {
      "pausedUntil": "2026-10-08T08:00:00+08:00" | null,   silence everything until then
      "quiet": {"on": true, "from": "22:00", "to": "07:00"},  every night, Singapore time
      "urgent": true,                 a crew running late still gets through a pause or quiet hours
      "mute": ["visits", ...],        categories never sent to the phone, email or WhatsApp
      "channels": {"push": true, "email": true, "mobile": true}
    }

Silencing never loses anything: every alert still lands on the Alerts screen.
It only stops the phone notification, email and WhatsApp/SMS for it.
"""

from __future__ import annotations

import re
from datetime import datetime, time, timedelta, timezone
from typing import Any

SG = timezone(timedelta(hours=8))

CATEGORIES: dict[str, tuple[str, ...]] = {
    "approvals": ("approval_request", "approval_granted", "approval_declined", "assignment"),
    "visits": ("visit_assigned", "visit_reminder"),
    "late": ("visit_missed", "crew_arrived_late"),
    "milestones": ("milestone_complete", "signature_request", "signed", "project_closed"),
    "people": ("account_request", "role_request"),
    "account": (
        "account_created",
        "account_approved",
        "account_rejected",
        "role_approved",
        "role_rejected",
        "audit_restore",
    ),
}
CATEGORY_OF = {kind: cat for cat, kinds in CATEGORIES.items() for kind in kinds}
CHANNELS = ("push", "email", "mobile")

DEFAULT: dict[str, Any] = {
    "pausedUntil": None,
    "quiet": {"on": False, "from": "22:00", "to": "07:00"},
    "urgent": True,
    "mute": [],
    "channels": {"push": True, "email": True, "mobile": True},
}

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def normalise(raw: Any) -> dict[str, Any]:
    """A complete, valid preferences object from whatever is stored (or sent); raises ValueError on nonsense."""
    raw = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {
        "pausedUntil": DEFAULT["pausedUntil"],
        "quiet": dict(DEFAULT["quiet"]),
        "urgent": DEFAULT["urgent"],
        "mute": [],
        "channels": dict(DEFAULT["channels"]),
    }
    if raw.get("pausedUntil"):
        try:
            out["pausedUntil"] = datetime.fromisoformat(str(raw["pausedUntil"])).astimezone(SG).isoformat()
        except ValueError as exc:
            raise ValueError("That pause time isn't a date and time.") from exc
    q = raw.get("quiet") or {}
    if q:
        for k in ("from", "to"):
            if k in q and not HHMM.match(str(q[k])):
                raise ValueError("Quiet hours need times like 22:00.")
        out["quiet"] = {"on": bool(q.get("on")), "from": q.get("from", "22:00"), "to": q.get("to", "07:00")}
        if out["quiet"]["from"] == out["quiet"]["to"] and out["quiet"]["on"]:
            raise ValueError("Quiet hours must start and end at different times.")
    if "urgent" in raw:
        out["urgent"] = bool(raw["urgent"])
    mute = raw.get("mute") or []
    if not isinstance(mute, list) or any(m not in CATEGORIES for m in mute):
        raise ValueError("Unknown kind of alert.")
    out["mute"] = sorted(set(mute))
    ch = raw.get("channels") or {}
    for c in CHANNELS:
        if c in ch:
            out["channels"][c] = bool(ch[c])
    return out


def in_quiet_hours(q: dict[str, Any], now: datetime) -> bool:
    if not q.get("on"):
        return False
    t = now.astimezone(SG).time()
    start, end = (time.fromisoformat(q["from"]), time.fromisoformat(q["to"]))
    return start <= t < end if start < end else (t >= start or t < end)  # overnight, e.g. 22:00 → 07:00


def silenced(prefs: Any, kind: str, now: datetime | None = None) -> str | None:
    """Why this alert shouldn't reach the phone, email or WhatsApp right now; None if it should."""
    p = normalise(prefs) if not (isinstance(prefs, dict) and "channels" in prefs) else prefs
    now = now or datetime.now(SG)
    cat = CATEGORY_OF.get(kind)
    urgent = cat == "late" and p.get("urgent", True)
    if cat and cat in p.get("mute", []):
        return "muted in their settings"
    paused = p.get("pausedUntil")
    if paused and datetime.fromisoformat(paused) > now and not urgent:
        return "paused in their settings"
    if in_quiet_hours(p.get("quiet") or {}, now) and not urgent:
        return "during their quiet hours"
    return None


def channel_on(prefs: Any, channel: str) -> bool:
    p = prefs if isinstance(prefs, dict) and "channels" in prefs else normalise(prefs)
    return bool(p["channels"].get(channel, True))
