"""Clerk's Backend API — the two calls the app needs.

Plain urllib: each is one HTTPS request, not worth an SDK. CLERK_SECRET_KEY
never leaves the server.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from _lib.auth import env

API = "https://api.clerk.com/v1"


class ClerkApiError(RuntimeError):
    def __init__(self, status: int, message: str, code: str | None = None) -> None:
        super().__init__(f"Clerk {status}: {message}")
        self.status = status
        self.code = code


def _request(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    secret = env("CLERK_SECRET_KEY")
    if not secret:
        raise ClerkApiError(500, "CLERK_SECRET_KEY is not set")
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "User-Agent": "gethomeapps-py",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            err = json.loads(exc.read() or b"{}").get("errors", [{}])[0]
        except ValueError:
            err = {}
        raise ClerkApiError(exc.code, err.get("long_message") or err.get("message") or exc.reason,
                            err.get("code")) from exc


@dataclass(frozen=True)
class ClerkUser:
    id: str
    verified_emails: list[str]
    primary_email: str | None
    full_name: str | None
    phone: str | None


def get_user(clerk_user_id: str) -> ClerkUser:
    data = _request("GET", f"/users/{clerk_user_id}")
    emails = data.get("email_addresses") or []
    verified = [
        e["email_address"].lower()
        for e in emails
        if (e.get("verification") or {}).get("status") == "verified"
    ]
    primary = next(
        (e["email_address"].lower() for e in emails if e.get("id") == data.get("primary_email_address_id")),
        None,
    )
    phones = data.get("phone_numbers") or []
    phone = next(
        (p["phone_number"] for p in phones if p.get("id") == data.get("primary_phone_number_id")),
        None,
    )
    name = " ".join(x for x in (data.get("first_name"), data.get("last_name")) if x) or None
    return ClerkUser(data["id"], verified, primary, name, phone)


def create_invitation(email: str, redirect_url: str) -> dict[str, Any]:
    """A sign-up link for ``email``. notify=False: our own branded email sends it."""
    return _request(
        "POST",
        "/invitations",
        {
            "email_address": email,
            "redirect_url": redirect_url,
            "notify": False,
            "ignore_existing": True,
            "expires_in_days": 30,
        },
    )
