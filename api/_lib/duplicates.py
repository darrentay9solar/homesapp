# ruff: noqa: E501  (each message on one line, as it is in zh.json)
"""Saying so when what someone is adding is already in the system.

Projects   a homeowner already on another project (one each); the same address as
           another project or a system in Maintenance; the
           same postal code (unless they confirm it's another home there, such
           as another unit in the block); a homeowner's number that is already
           another homeowner's.
Accounts   the same email or mobile (profile.mobile_taken), or the same name at
           the same postal code (the same person under another email).

Each refusal is a FieldProblem, so the form says it under the field concerned.
Only what is being changed is checked, so a record that already shares a
postal code (from the project list) can still be edited.
"""

from __future__ import annotations

import re
from typing import Any

from _lib.db import fetch_all, fetch_one
from _lib.profile import FieldProblem

# Off only in the test suite, whose tests reuse one made-up address (tests_py/conftest.py).
CHECK_PROJECTS = True

# Spellings that mean the same place: "Ave" and "Avenue", "Blk 5" and "5".
SAME = [
    (r"\bavenue\b", "ave"), (r"\broad\b", "rd"), (r"\bstreet\b", "st"), (r"\bdrive\b", "dr"),
    (r"\bcrescent\b", "cres"), (r"\bplace\b", "pl"), (r"\bterrace\b", "ter"), (r"\bclose\b", "cl"),
    (r"\blane\b", "ln"), (r"\bgardens?\b", "gdn"), (r"\bheights\b", "hts"), (r"\bpark\b", "pk"),
    (r"\bnorth\b", "nth"), (r"\bsouth\b", "sth"), (r"\bupper\b", "upp"), (r"\blorong\b", "lor"),
    (r"\bjalan\b", "jln"), (r"\bblock\b", ""), (r"\bblk\b", ""), (r"\bsingapore\b", ""), (r"\bsg\b", ""),
]  # fmt: skip


def address_key(address: str | None, postal: str | None = None) -> str:
    """The address with its spelling, spacing and punctuation set aside, to compare two."""
    a = (address or "").lower()
    if postal:
        a = a.replace(postal, " ")
    a = re.sub(r"\b\d{6}\b", " ", a)
    a = re.sub(r"[^a-z0-9#]+", " ", a)
    for rx, to in SAME:
        a = re.sub(rx, to, a)
    return re.sub(r"[^a-z0-9]", "", a)


def digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def _label(r: dict[str, Any]) -> str:
    code = r.get("project_code")
    return f"{r['name']} ({code})" if code else r["name"]


def project_clash(
    v: dict[str, Any], *, pid: int | None = None, before: dict[str, Any] | None = None, same_postal_ok: bool = False
) -> None:
    """Refuses a project that is already in the system. ``v`` is projects._validate's result;
    ``before`` the project as it was, when editing (only what changed is checked)."""
    # One homeowner, one project (migration 0043): this one always holds.
    if v["homeowner_id"]:
        other = fetch_one(
            "select name, project_code from projects where homeowner_id = %(h)s and project_id is distinct from %(pid)s "
            "union all select coalesce(s.address, 'a system'), s.project_code from maintenance_systems s "
            "where s.homeowner_id = %(h)s and (%(pid)s::int is null or s.project_id is distinct from %(pid)s) limit 1",
            {"h": v["homeowner_id"], "pid": pid},
        )
        if other:
            raise FieldProblem(409, f"This homeowner is already on {_label(other)}. Each homeowner is on one project.", "homeowner")
    if not CHECK_PROJECTS:
        return
    postal, address = v["postal"], v["address"]
    moved = before is None or postal != before["postal_code"] or address_key(address, postal) != address_key(
        before["address"], before["postal_code"]
    )
    if moved:
        there = fetch_all(
            "select 'project' as kind, project_id as id, name, project_code, address from projects "
            "where postal_code = %(p)s and project_id is distinct from %(pid)s "
            "union all select 'system', s.system_id, coalesce(s.homeowner_name, s.address), s.project_code, s.address "
            "from maintenance_systems s where s.postal_code = %(p)s and (%(pid)s::int is null or s.project_id is distinct from %(pid)s)",
            {"p": postal, "pid": pid},
        )
        key = address_key(address, postal)
        for r in there:
            if address_key(r["address"], postal) == key:
                if r["kind"] == "system":
                    raise FieldProblem(409, f"This address is already a system in Maintenance: {_label(r)}.", "address")
                raise FieldProblem(409, f"Another project already has this address: {_label(r)}.", "address")
        if there and not same_postal_ok:
            r = there[0]
            where = "a system in Maintenance" if r["kind"] == "system" else "another project"
            raise FieldProblem(
                409, f"Postal code {postal} is already on {where}: {_label(r)}. If this is a different home there, tick the box to confirm.",
                "postal",
            )  # fmt: skip

    phone = digits(v["contact"])
    if not phone or (before is not None and phone == digits(before["homeowner_contact_no"])):
        return
    # The number of a homeowner with an account: link that account instead of typing a name.
    acct = fetch_one(
        "select uid, full_name, user_type::text as role from users "
        "where contact_no is not null and regexp_replace(contact_no, '[^0-9]', '', 'g') = %s",
        (phone,),
    )
    if acct and acct["uid"] != v["homeowner_id"]:
        if acct["role"] == "homeowner":
            raise FieldProblem(
                409, f"That number is {acct['full_name']}'s account. Choose their account as the homeowner instead.", "contact"
            )
        raise FieldProblem(409, "That number belongs to a staff account, not the homeowner. Enter the homeowner's own number.", "contact")
    # Another homeowner's number on another project (the same homeowner can have more than one home).
    for r in fetch_all(
        "select name, project_code, homeowner_id, homeowner_name from projects "
        "where homeowner_contact_no is not null and regexp_replace(homeowner_contact_no, '[^0-9]', '', 'g') = %s "
        "and project_id is distinct from %s",
        (phone, pid),
    ):
        same = (v["homeowner_id"] and r["homeowner_id"] == v["homeowner_id"]) or (
            not v["homeowner_id"] and (r["homeowner_name"] or "").strip().lower() == (v["homeowner_name"] or "").strip().lower()
        )
        if not same:
            raise FieldProblem(
                409, f"That number is already the homeowner's contact on {_label(r)}. Each homeowner needs their own number.", "contact"
            )


def person_clash(full_name: str, postal: str | None, *, uid: int | None = None) -> None:
    """Refuses a second account for the same person: the same name at the same postal code."""
    if not postal:
        return
    r = fetch_one(
        "select email from users where postal_code = %s and lower(btrim(full_name)) = lower(btrim(%s)) "
        "and uid is distinct from %s",
        (postal, full_name, uid),
    )
    if r:
        raise FieldProblem(
            409, f"{full_name.strip()} at postal code {postal} already has an account ({r['email']}). Use that account instead.", "fullName"
        )


def request_clash(email: str, contact: str | None) -> None:
    """A new account whose email or mobile is on a sign-up request still waiting: approve that instead."""
    if fetch_one("select 1 from account_requests where status = 'pending' and lower(email) = %s", (email,)):
        raise FieldProblem(409, "Someone with that email has asked for an account. Approve their request in People instead.", "email")
    if contact and fetch_one(
        "select 1 from account_requests where status = 'pending' and contact_no is not null "
        "and regexp_replace(contact_no, '[^0-9]', '', 'g') = %s",
        (digits(contact),),
    ):
        raise FieldProblem(409, "Someone with that mobile number has asked for an account. Approve their request in People instead.", "mobile")
