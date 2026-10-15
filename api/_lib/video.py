# ruff: noqa: E501  (request bodies read better whole)
"""A video meeting set up for a meeting's time: Microsoft Teams, Google Meet or Zoom.

Each needs the company's own account connected (YOUR_STEPS.md step 12); the
link comes back for the meeting's date and time, never "a meeting now":

  teams  Microsoft Graph, as an app: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET,
         and MS_MEETING_ORGANISER (the account the meetings are made under;
         it needs an application access policy for online meetings)
  meet   Google Calendar, a service account with domain-wide delegation:
         GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_MEETING_ORGANISER (the account
         whose calendar holds the event that carries the Meet link)
  zoom   a Server-to-Server OAuth app: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID,
         ZOOM_CLIENT_SECRET, and ZOOM_MEETING_ORGANISER (an email, or "me")

Without them the screen opens that service's own scheduling page with the
title and time filled in instead (lib/client/calendar.ts), and the link is
pasted back.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from typing import Any

PROVIDERS = ("teams", "meet", "zoom")
NEEDS = {
    "teams": ("MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_MEETING_ORGANISER"),
    "meet": ("GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_MEETING_ORGANISER"),
    "zoom": ("ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "ZOOM_MEETING_ORGANISER"),
}
TIMEOUT = 15


class VideoError(Exception):
    """Said to the person arranging: the link couldn't be made, so paste one."""


def configured() -> list[str]:
    return [p for p in PROVIDERS if all(os.environ.get(k) for k in NEEDS[p])]


def _call(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf8", "replace")[:300]
        print(f"[video] {url.split('?')[0]} said {exc.code}: {detail}")
        raise VideoError("The video service turned the request down. Paste a link instead.") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"[video] {url.split('?')[0]} failed: {exc}")
        raise VideoError("The video service didn't answer. Paste a link instead.") from exc


def _form(d: dict[str, str]) -> bytes:
    return urllib.parse.urlencode(d).encode()


def _json(d: dict[str, Any]) -> bytes:
    return json.dumps(d).encode()


# ------------------------------------------------------------------ each service


def teams(title: str, start: datetime, end: datetime) -> str:
    env = os.environ
    tok = _call(
        f"https://login.microsoftonline.com/{urllib.parse.quote(env['MS_TENANT_ID'])}/oauth2/v2.0/token",
        data=_form({"grant_type": "client_credentials", "client_id": env["MS_CLIENT_ID"],
                    "client_secret": env["MS_CLIENT_SECRET"], "scope": "https://graph.microsoft.com/.default"}),  # fmt: skip
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )["access_token"]
    who = urllib.parse.quote(env["MS_MEETING_ORGANISER"])
    made = _call(
        f"https://graph.microsoft.com/v1.0/users/{who}/onlineMeetings",
        data=_json({"subject": title, "startDateTime": start.isoformat(), "endDateTime": end.isoformat()}),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    return str(made["joinWebUrl"])


def _google_token(scope: str) -> str:
    import jwt  # PyJWT, with cryptography for RS256

    sa = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    now = int(time.time())
    claims = {"iss": sa["client_email"], "sub": os.environ["GOOGLE_MEETING_ORGANISER"], "scope": scope,
              "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 600}  # fmt: skip
    assertion = jwt.encode(claims, sa["private_key"], algorithm="RS256")
    return _call(
        "https://oauth2.googleapis.com/token",
        data=_form({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )["access_token"]


def meet(title: str, start: datetime, end: datetime) -> str:
    tok = _google_token("https://www.googleapis.com/auth/calendar.events")
    made = _call(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
        data=_json({
            "summary": title,
            "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Singapore"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Asia/Singapore"},
            "conferenceData": {"createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}},
        }),  # fmt: skip
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    link = made.get("hangoutLink") or next(
        (e["uri"] for e in made.get("conferenceData", {}).get("entryPoints", []) if e.get("entryPointType") == "video"),
        None,
    )
    if not link:
        raise VideoError("Google Calendar made the event without a Meet link. Paste a link instead.")
    return str(link)


def zoom(title: str, start: datetime, end: datetime) -> str:
    env = os.environ
    basic = base64.b64encode(f"{env['ZOOM_CLIENT_ID']}:{env['ZOOM_CLIENT_SECRET']}".encode()).decode()
    tok = _call(
        "https://zoom.us/oauth/token?" + urllib.parse.urlencode({"grant_type": "account_credentials", "account_id": env["ZOOM_ACCOUNT_ID"]}),
        headers={"Authorization": f"Basic {basic}"},
    )["access_token"]
    who = urllib.parse.quote(env["ZOOM_MEETING_ORGANISER"])
    made = _call(
        f"https://api.zoom.us/v2/users/{who}/meetings",
        data=_json({"topic": title, "type": 2, "start_time": start.strftime("%Y-%m-%dT%H:%M:%S"),
                    "timezone": "Asia/Singapore", "duration": int((end - start).total_seconds() // 60)}),  # fmt: skip
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    return str(made["join_url"])


def create(provider: str, title: str, start: datetime, end: datetime) -> str:
    if provider not in configured():
        raise VideoError("That video service isn't connected yet. Open it, set up the meeting, and paste its link.")
    link = {"teams": teams, "meet": meet, "zoom": zoom}[provider](title, start, end)
    if not link.startswith("https://"):
        raise VideoError("The video service sent back a link that isn't https. Paste a link instead.")
    return link
