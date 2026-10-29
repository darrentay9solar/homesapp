"""Which company's app this is: the server's half of lib/client/edition.ts (docs/editions.md).

    home      9 Solar Home's GetHomeApps (the default)
    fintech   9 Solar Fintech's GetApps: no homeowners, no site check-in or location, no Maintenance;
              "Project Manager" reads "HQ Staff" and "EPC Team" reads "EPC Project Manager"

Set by EDITION in the site's environment. Messages the server sends out itself (email, WhatsApp, SMS,
phone notifications, PDFs) pass through rebrand(); what it returns to the screens is renamed there.
"""

from __future__ import annotations

import os
import re

EDITION = "fintech" if os.environ.get("EDITION", "").strip().lower() == "fintech" else "home"

FEATURES = {
    "homeowners": EDITION == "home",
    "check_in": EDITION == "home",
    "maintenance": EDITION == "home",
}

BRAND = (
    {"app": "GetApps", "company": "9 Solar Fintech"}
    if EDITION == "fintech"
    else {"app": "GetHomeApps", "company": "9 Solar Home"}
)

# The same words, in the same order, as lib/client/edition.ts.
_SWAPS: list[tuple[re.Pattern[str], str]] = (
    [
        (re.compile(r"GetHomeApps"), "GetApps"),
        (re.compile(r"GETHOMEAPPS"), "GETAPPS"),
        (re.compile(r"九太阳家"), "九太阳"),
        (re.compile(r"9 Solar Home"), "9 Solar Fintech"),
        (re.compile(r"9 SOLAR HOME"), "9 SOLAR FINTECH"),
        (re.compile(r"(?<!EPC )Project [Mm]anagers"), "HQ Staff"),
        (re.compile(r"(?<!EPC )project managers"), "HQ staff"),
        (re.compile(r"(?<!EPC )Project [Mm]anager"), "HQ Staff"),
        (re.compile(r"(?<!EPC )project manager"), "HQ staff"),
        (re.compile(r"(?<!EPC )项目经理"), "总部员工"),
        (re.compile(r"EPC [Tt]eams?"), "EPC Project Manager"),
        (re.compile(r"EPC 团队"), "EPC 项目经理"),
        (re.compile(r"\bHomeowners\b"), "Clients"),
        (re.compile(r"\bHomeowner\b"), "Client"),
        (re.compile(r"\bhomeowners\b"), "clients"),
        (re.compile(r"\bhomeowner\b"), "client"),
        (re.compile(r"\bHomes\b"), "Clients"),
        (re.compile(r"屋主"), "客户"),
        (re.compile(r"^住宅$"), "客户"),
        (re.compile(r"\bhomes\b"), "sites"),
        (re.compile(r"\bhome\b"), "site"),
        (re.compile(r"住宅|住家"), "场地"),
        (re.compile(r"家庭用电"), "场地用电"),
        (re.compile(r"^相$"), "期"),
    ]
    if EDITION == "fintech"
    else []
)


def rebrand(text: str | None) -> str | None:
    """``text`` as this edition shows it."""
    if not text:
        return text
    for rx, to in _SWAPS:
        text = rx.sub(to, text)
    return text
