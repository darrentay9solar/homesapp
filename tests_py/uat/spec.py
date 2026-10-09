"""The acceptance rules, written from the brief and docs/PROCESS_FLOW.md, independent of the code.

Every UAT test asks the real API (or the database) what happens and compares
it with what this file says should happen. When the two disagree, either the
app or this file is wrong, and which one is a question for the brief.

Who (ACTORS), in relation to every project in the test world:
  sa            a superadmin: runs every project
  pm            the project manager running the projects
  pm2           another project manager: runs none of them
  crew_admin    contractor admin in the project's contractor group
  crew_epc      EPC crew member in the project's contractor group
  assigned_epc  EPC crew member assigned to the project by name (no group)
  out_admin     contractor admin of another group
  out_epc       EPC crew member of another group
  ho            the projects' homeowner (not on the draft, which has a typed name only)
  ho2           another homeowner
  inactive      an EPC crew member in the group whose account is switched off

Where (STATES): one project at each point of the flow.
"""

from __future__ import annotations

from dataclasses import dataclass

ACTORS = [
    "sa",
    "pm",
    "pm2",
    "crew_admin",
    "crew_epc",
    "assigned_epc",
    "out_admin",
    "out_epc",
    "ho",
    "ho2",
    "inactive",
]
ROLE = {
    "sa": "superadmin",
    "pm": "project_manager",
    "pm2": "project_manager",
    "crew_admin": "contractor",
    "crew_epc": "epc_team",
    "assigned_epc": "epc_team",
    "out_admin": "contractor",
    "out_epc": "epc_team",
    "ho": "homeowner",
    "ho2": "homeowner",
    "inactive": "epc_team",
}
ADMINS = {"sa", "pm", "pm2"}
CREW = {"crew_admin", "crew_epc", "assigned_epc"}

# (key, status, milestones recorded)
STATES = [
    ("draft", "draft", 0),
    ("awaiting_homeowner", "awaiting_homeowner", 0),
    ("homeowner_declined", "homeowner_declined", 0),
    ("homeowner_approved", "homeowner_approved", 0),
    ("pm_approved", "pm_approved", 0),
    ("in_progress_m0", "in_progress", 0),
    ("in_progress_m1", "in_progress", 1),
    ("in_progress_m2", "in_progress", 2),
    ("awaiting_signature", "awaiting_signature", 3),
    ("signed", "signed", 3),
    ("closed", "closed", 3),
]
STATE_KEYS = [s[0] for s in STATES]
STATUS = {k: st for k, st, _ in STATES}
RECORDED = {k: n for k, _, n in STATES}
STATUSES = [
    "draft",
    "awaiting_homeowner",
    "homeowner_declined",
    "homeowner_approved",
    "pm_approved",
    "in_progress",
    "awaiting_signature",
    "signed",
    "closed",
]
BEFORE_APPROVAL = {"draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"}
AT_HANDOVER = {"awaiting_signature", "signed", "closed"}
WORKING = {"pm_approved", "in_progress"}


def relation(actor: str, state: str) -> str | None:
    """'pm', 'crew', 'homeowner', None (not on the project), or 'inactive'."""
    if actor == "inactive":
        return "inactive"
    if actor in ("sa", "pm"):
        return "pm"
    if actor in CREW:
        return "crew"
    if actor == "ho":
        return None if state == "draft" else "homeowner"
    return None


def sees(actor: str, state: str) -> int:
    """GET /projects/{id} and friends: 200, 404 (not yours), 403 (account off)."""
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    return 200 if rel else 404


def listed(actor: str, state: str) -> bool:
    """In the Projects list. Handed over (closed), a project's development is done: it
    leaves the list for the Maintenance page. Its homeowner still has it as their project."""
    if sees(actor, state) != 200:
        return False
    return STATUS[state] != "closed" or relation(actor, state) == "homeowner"


# ------------------------------------------------------------------ maintenance
#
# Once handed over, a project becomes a maintenance record (and systems from
# before the app are imported from the project listing, unassigned). Project
# managers and superadmins look after them; nobody else sees them.

# Whose a record is, relative to the world's people.
OWNERS = ["pm", "pm2", "none"]


def maintenance_sees(actor: str, owner: str) -> int:
    """GET /maintenance/{id}: a superadmin every record; a project manager theirs and unassigned ones."""
    if actor == "inactive" or ROLE[actor] not in ("project_manager", "superadmin"):
        return 403
    if actor == "sa" or owner == "none" or owner == actor:
        return 200
    return 404


def maintenance_list(actor: str) -> int:
    if actor == "inactive" or ROLE[actor] not in ("project_manager", "superadmin"):
        return 403
    return 200


def check_state(due_in: int | None, done_ago: int | None) -> str:
    """A check, by days until it's due and days since it was done."""
    if done_ago is not None:
        return "done"
    if due_in is None:
        return "unscheduled"
    if due_in < 0:
        return "overdue"
    if due_in <= 30:
        return "due_soon"
    return "scheduled"


def plus_months(y: int, m: int, d: int, n: int) -> tuple[int, int, int]:
    """The project listing's 6 Months and 1 Year columns: the same day n months on, or that month's last day."""
    total = y * 12 + (m - 1) + n
    year, month = divmod(total, 12)
    month += 1
    days_in = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return year, month, min(d, days_in[month - 1])


# ------------------------------------------------------------------ fields


@dataclass(frozen=True)
class F:
    key: str
    group: str
    kind: str
    sample: object = None  # a valid value to save


FIELDS = [
    F("utility_bill", "pre1", "file"),
    F("electricity_retailer_id", "pre1", "retailer", "SP Group"),
    F("retailer_contract_end_date", "pre1", "date", "2027-01-31"),
    F("moc_change", "pre1", "file"),
    F("gst_proof", "pre1", "file"),
    F("homeowner.ic_last4", "pre1", "homeowner", "567D"),
    F("homeowner.email", "pre1", "homeowner"),
    F("sp_forms_signed", "pre1", "file"),
    F("sp_application_status", "pre1", "select", 1),
    F("sales", "pre1b", "text", "K. Chandra"),
    F("waterproofing", "pre1b", "yesno", True),
    F("create_group_chat", "pre1b", "yesno", True),
    F("panel_quantity_estimate", "pre1b", "number", 20),
    F("panel_capacity", "pre1b", "number", 610),
    F("inverter_to_order", "pre1b", "text", "Huawei SUN2000-10KTL-M1"),
    F("inverter_collected", "pre1b", "yesno", True),
    F("inverter_date", "pre1b", "date", "2026-11-02"),
    F("inverter_serial_number", "pre1b", "text", "HW-UAT-0001"),
    F("panel_pictures", "pre1b", "photos"),
    F("inverter_pictures", "pre1b", "photos"),
    F("current_stage", "pre1b", "number", 2),
    F("installation_end_date", "m1", "date", "2026-10-20"),
    F("scaffolding_removal", "m1", "yesno", True),
    F("scaffolding_removal_date", "m1", "date", "2026-10-21"),
    F("sp_submission_date", "m1", "date", "2026-10-22"),
    F("sp_submission_screenshot", "m1", "photos"),
    F("panel_quantity_actual", "m1", "number", 20),
    F("sp_pending_days", "m1", "auto"),
    F("inverter_commission_grid_connection", "m2", "yesno", True),
    F("commission_date", "m2", "date", "2026-10-30"),
    F("rcb_breaker_replacement", "m2", "yesno", False),
    F("rcb_breaker_replacement_date", "m2", "date", "2026-10-31"),
    F("pvl_letter", "m2", "file"),
    F("pvl_received_date", "m2", "date", "2026-11-01"),
    F("pre_inspection_date", "m3", "date", "2026-11-05"),
    F("sp_appointment_letter", "m3", "file"),
    F("sp_appointment_letter_received_date", "m3", "date", "2026-11-06"),
    F("meter_replacement_date", "m3", "date", "2026-11-07"),
    F("sp_turn_on_inspection_date", "m3", "date", "2026-11-08"),
    F("as_built_pv_layout", "post", "file"),
    F("final_submission_documents", "post", "file"),
    F("handover_docs", "post", "file"),
    F("fusion_solar_app_access", "post", "yesno", True),
    F("fusion_solar_access", "post", "file"),
    F("completion_form_signed", "post", "file"),
]
FILE_KINDS = {"file", "photos"}
SECTION_MILESTONE = {"pre1": 1, "pre1b": 1, "m1": 1, "m2": 2, "m3": 3, "post": 3}
SECTIONS = ["pre1", "pre1b", "m1", "m2", "m3", "post"]

LOCK_BEFORE = "Opens once the homeowner and a project manager have approved the project."
LOCK_HANDOVER = "The project is at handover; its fields are now the signed record."
LOCK_M1 = "Opens once Milestone 1 is complete."
LOCK_M2 = "Opens once Milestone 2 is complete."
LOCK_HOMEOWNER = "Filled in by 9 Solar Home and the contractor."
LOCK_AUTO = "Calculated by the system."
LOCK_EMAIL = "From the homeowner's account."
LOCK_LINK = "Link the homeowner's account first."


def section_lock(state: str, section: str) -> str | None:
    status, reached = STATUS[state], RECORDED[state]
    if status in BEFORE_APPROVAL:
        return LOCK_BEFORE
    if status in AT_HANDOVER:
        return LOCK_HANDOVER
    n = SECTION_MILESTONE[section]
    if n == 2 and reached < 1:
        return LOCK_M1
    if n == 3 and reached < 2:
        return LOCK_M2
    return None


def field_lock(rel: str, state: str, f: F) -> str | None:
    """Why this person can't change this field at this point, or None if they can."""
    if rel == "homeowner":
        return LOCK_HOMEOWNER
    if f.kind == "auto":
        return LOCK_AUTO
    if f.key == "homeowner.email":
        return LOCK_EMAIL
    if f.key.startswith("homeowner.") and state == "draft":
        return LOCK_LINK
    lock = section_lock(state, f.group)
    if lock:
        return lock
    n = SECTION_MILESTONE[f.group]
    if rel == "crew" and n <= RECORDED[state]:
        return f"Milestone {n} is complete. A project manager can correct it or reopen the milestone."
    return None


# Which sections the world has filled in, by state: everything up to the milestone recorded,
# and in_progress_m0 has a start on "Before Milestone 1".
def section_complete(state: str, section: str) -> bool:
    return SECTION_MILESTONE[section] <= RECORDED[state]


# ------------------------------------------------------------------ actions
# Each returns the status code the API should answer. "mutates" marks a
# success that changes the project, run on a fresh project of its own.


def approve(actor: str, state: str) -> int:
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    s = STATUS[state]
    if rel == "homeowner" and s in ("awaiting_homeowner", "homeowner_declined"):
        return 200
    if rel == "pm" and s == "homeowner_approved":
        return 200
    return 409


def decline(actor: str, state: str) -> int:
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    return 200 if rel == "homeowner" and STATUS[state] == "awaiting_homeowner" else 409


def _pm_route(actor: str, state: str) -> int | None:
    """Routes only a project manager can call: the role first, then whether they run it."""
    if actor == "inactive":
        return 403
    if ROLE[actor] not in ("project_manager", "superadmin"):
        return 403
    if relation(actor, state) != "pm":
        return 404
    return None


def remind(actor: str, state: str) -> int:
    first = _pm_route(actor, state)
    if first:
        return first
    return 200 if STATUS[state] in ("awaiting_homeowner", "homeowner_declined") else 409


def reopen(actor: str, state: str, n: int) -> int:
    first = _pm_route(actor, state)
    if first:
        return first
    if STATUS[state] in ("signed", "closed"):
        return 409
    return 200 if n <= RECORDED[state] else 409


def handover_request(actor: str, state: str) -> int:
    first = _pm_route(actor, state)
    if first:
        return first
    # Only a project with Milestone 3 recorded and still working; none in the world is.
    return 200 if STATUS[state] in WORKING and RECORDED[state] >= 3 else 409


def handover_remind(actor: str, state: str) -> int:
    first = _pm_route(actor, state)
    if first:
        return first
    return 200 if STATUS[state] == "awaiting_signature" else 409


def sign_with_stale_fingerprint(actor: str, state: str) -> int:
    """POST /handover/sign with everything right except a fingerprint from another version."""
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    if rel != "homeowner":
        return 403
    return 409  # either not waiting for a signature, or the certificate "changed"


def close(actor: str, state: str) -> int:
    first = _pm_route(actor, state)
    if first:
        return first
    return 200 if STATUS[state] == "signed" else 409


def edit_details(actor: str, state: str) -> int:
    first = _pm_route(actor, state)
    return first or 200


def schedule_visit(actor: str, state: str) -> int:
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    if rel not in ("pm", "crew"):
        return 403
    return 200 if STATUS[state] in WORKING else 400


def check_in(actor: str, state: str) -> int:
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    if ROLE[actor] != "epc_team":
        return 403
    return 200 if STATUS[state] in WORKING else 400


def upload_link(actor: str, state: str, f: F) -> int:
    rel = relation(actor, state)
    if rel == "inactive":
        return 403
    if rel is None:
        return 404
    return 403 if field_lock(rel, state, f) else 200


def certificate_pdf(actor: str, state: str) -> int:
    code = sees(actor, state)
    if code != 200:
        return code
    return 302 if STATUS[state] in ("signed", "closed") else 404


def handover_actions(actor: str, state: str) -> dict[str, bool]:
    rel, s = relation(actor, state), STATUS[state]
    return {
        "sign": rel == "homeowner" and s == "awaiting_signature",
        "request": False,
        "remind": rel == "pm" and s == "awaiting_signature",
        "close": rel == "pm" and s == "signed",
    }


# -------------------------------------------------------- the database's rules


def db_status_change(actor: str, state: str, to: str, *, homeowner_signed: bool) -> bool:
    """May this person move this project from its status to ``to`` straight in the database?"""
    s = STATUS[state]
    if actor == "sa":
        return True
    if actor == "pm":
        if s == to:
            return True
        if to == "signed":
            return False
        if to == "closed" and s != "signed":
            return False
        return not (s in ("signed", "closed") and not (s == "signed" and to == "closed"))
    if actor == "ho" and state != "draft":
        if s == to:
            return True
        if s in ("awaiting_homeowner", "homeowner_declined") and to in ("homeowner_approved", "homeowner_declined"):
            return True
        return s == "awaiting_signature" and to == "signed" and homeowner_signed
    if actor in CREW:
        if s in AT_HANDOVER:
            return False
        return s == to or (s == "pm_approved" and to == "in_progress")
    return False


def db_signature_insert(actor: str, state: str) -> bool:
    """May this person put their signature on this project's certificate in the database?"""
    return actor == "ho" and STATUS[state] == "awaiting_signature"
