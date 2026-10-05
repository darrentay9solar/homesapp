"""What a revert or restore may change on its own, and what it must not.

A selective rewind changes one value and nothing else. That is only safe when
nothing else depends on the old value — so before any write, these rules look
at what the value feeds (a completed milestone, a project's status, someone's
group memberships) and refuse with a plain reason when rewinding it alone
would leave the record inconsistent. They never "fix up" the dependent data
quietly: if a milestone has to be reopened, a person does that, and it is
logged as its own change.

The database's own guards (0012, 0013, 0015) still apply underneath; these
rules exist so the refusal comes with an explanation before anything is tried.
"""

from __future__ import annotations

from typing import Any

import psycopg

# Which milestone each project field belongs to, from the prototype's field
# schema (pre-1, pre-end-1 and milestone 1 fields close Milestone 1; and so on).
MILESTONE_OF: dict[str, int] = {
    **dict.fromkeys(
        (
            "electricity_retailer_id", "retailer_contract_end_date", "sp_application_status", "sales",
            "waterproofing", "create_group_chat", "panel_quantity_estimate", "panel_quantity_actual",
            "panel_capacity", "inverter_to_order", "inverter_collected", "inverter_date",
            "inverter_serial_number", "installation_end_date", "scaffolding_removal",
            "scaffolding_removal_date", "sp_submission_date",
        ),
        1,
    ),
    **dict.fromkeys(
        (
            "inverter_commission_grid_connection", "commission_date", "rcb_breaker_replacement",
            "rcb_breaker_replacement_date", "pvl_received_date",
        ),
        2,
    ),
    **dict.fromkeys(
        (
            "pre_inspection_date", "sp_appointment_letter_received_date", "meter_replacement_date",
            "sp_turn_on_inspection_date", "fusion_solar_app_access",
        ),
        3,
    ),
}  # fmt: skip

# Moved only by the project's own workflow — approvals, milestones, sign-off.
WORKFLOW_FIELDS = {"status", "current_stage", "confirmed_by_homeowner"}
# Once a project reaches these, its data is the record the homeowner signed.
FROZEN_STATUSES = {"awaiting_signature", "signed", "closed"}
CREW_ROLES = ("contractor", "epc_team")

STATUS_LABEL = {
    "awaiting_signature": "awaiting the homeowner's signature",
    "signed": "signed",
    "closed": "closed",
}


def field_lock(table: str, field: str) -> str | None:
    """A field that is never rewound from the log, whatever its value."""
    if table == "projects" and field in WORKFLOW_FIELDS:
        return (
            "Project status moves only through the project's own steps (approvals, milestones, sign-off), "
            "never by a restore."
        )
    if table == "users" and field == "email":
        return "Email is the person's sign-in identity, so it isn't restored from the log."
    return None


def blockers(
    cur: psycopg.Cursor, table: str, key: dict[str, Any], values: dict[str, Any], actor_uid: int, label: Any
) -> list[str]:
    """Why setting ``values`` on this one row, and nothing else, would be wrong. Empty means it's safe."""
    out: list[str] = []
    for f in values:
        lock = field_lock(table, f)
        if lock:
            out.append(lock)

    if table == "projects":
        pid = key.get("project_id")
        row = cur.execute("select status from projects where project_id = %s", (pid,)).fetchone()
        if row and row["status"] in FROZEN_STATUSES:
            out.append(
                f"The project is {STATUS_LABEL[row['status']]}, so its details are now the signed record "
                "and can't be rewound."
            )
        done = {
            r["milestone_no"]
            for r in cur.execute("select milestone_no from project_milestones where project_id = %s", (pid,))
        }
        for f in values:
            n = MILESTONE_OF.get(f)
            if n and n in done:
                out.append(
                    f"{label(f)} is part of Milestone {n}, which was completed with its current value. Rewinding it on "
                    f"its own would leave a completed milestone with different data and the project's status "
                    f"unchanged. Reopen Milestone {n} on the project first — that is logged as its own change."
                )

    if table == "users":
        uid = key.get("uid")
        if values.get("active") is False and uid == actor_uid:
            out.append("You can't switch off your own account.")
        role = values.get("user_type")
        if role is not None and role not in CREW_ROLES:
            n = cur.execute(
                "select count(*)::int as n from contractor_group_members where user_id = %s", (uid,)
            ).fetchone()["n"]
            if n:
                out.append(
                    f"They're in {n} contractor group{'s' if n != 1 else ''}, which only contractor admins and EPC "
                    f"crew can belong to. Remove them from {'those groups' if n != 1 else 'it'} in People first."
                )

    if table == "site_visits":
        n = cur.execute(
            "select count(*)::int as n from site_check_ins where visit_id = %s", (key.get("visit_id"),)
        ).fetchone()["n"]
        if n:
            out.append("A crew has already checked in to this visit, so its date and time are site evidence now.")

    return out
