"""The fields every account form shares, validated once for all of them."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from _lib import onemap

ROLES = ("homeowner", "project_manager", "contractor", "epc_team")


class ProfileIn(BaseModel):
    fullName: str = ""
    role: str = ""
    contactNo: str | None = None
    icLast4: str | None = None
    address: str | None = None
    postalCode: str | None = None


def bad(message: str) -> HTTPException:
    return HTTPException(400, message)


def clean_profile(p: ProfileIn) -> dict[str, Any]:
    """Validated columns for users / account_requests. Raises a 400 people can read."""
    name = p.fullName.strip()
    if len(name) < 2:
        raise bad("Enter a full name.")
    if p.role not in ROLES:
        raise bad("Choose a role.")

    contact = clean_phone(p.contactNo)

    # Last four only: three digits and the checksum letter. The database
    # enforces the same pattern, so a full NRIC can never be stored.
    ic = (p.icLast4 or "").strip().upper() or None
    if ic and len(ic) > 4:
        raise bad("Enter only the last 4 characters of the NRIC, e.g. 567D.")
    if ic and not re.fullmatch(r"[0-9]{3}[A-Z]", ic):
        raise bad("NRIC last 4 should be three digits and a letter, e.g. 567D.")
    if p.role != "homeowner":
        ic = None

    address = (p.address or "").strip() or None
    postal = (p.postalCode or "").strip() or None
    if postal and not re.fullmatch(r"\d{6}", postal):
        raise bad("A Singapore postal code is 6 digits.")
    if address or postal:
        try:
            loc = onemap.resolve(address, postal)
            address, postal = loc.address, loc.postal_code
        except onemap.GeocodeError as exc:
            # A wrong postal code is worth saying; an OneMap outage is not,
            # so carry on with what was typed.
            if exc.reason in ("not_found", "invalid_query"):
                raise bad(exc.for_people()) from exc

    return {
        "full_name": name,
        "user_type": p.role,
        "contact_no": contact,
        "ic_last4": ic,
        "address": address,
        "postal_code": postal,
    }


def clean_phone(raw: str | None) -> str | None:
    """Always stored with its country code: "+65 9123 4567".

    The form sends the code from its country picker. A bare 8-digit number
    (an older form, an import) is taken as Singapore, which is the only
    country where that is unambiguous for this business.
    """
    contact = (raw or "").strip()
    if not contact:
        return None
    digits = re.sub(r"\D", "", contact)
    if not contact.startswith("+"):
        if re.fullmatch(r"[3689]\d{7}", digits):
            return f"+65 {digits[:4]} {digits[4:]}"
        raise bad("Choose the country code and enter the mobile number, e.g. +65 9123 4567.")
    if not re.fullmatch(r"\+[\d\s-]{8,20}", contact) or not 8 <= len(digits) <= 15:
        raise bad("Enter the mobile number as digits, e.g. +65 9123 4567.")
    # Singapore numbers are 8 digits after the code.
    if digits.startswith("65") and len(digits) != 10:
        raise bad("A Singapore mobile number has 8 digits after +65.")
    return re.sub(r"\s+", " ", contact)


def clean_email(raw: str) -> str:
    email = raw.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise bad("Enter a valid email address.")
    return email
