"""Every field in the brief's milestone lists, and what "complete" means.

One table drives progress %, which milestone a project has reached, and
(later) which sections are locked — so the three always agree. Order and
grouping follow the brief:

    Before start of Milestone 1   pre1    (Admin / EPC)
    Pre-end of Milestone 1        pre1b   (Admin)
    Milestone 1 to complete       m1
    Milestone 2 to complete       m2
    Milestone 3 to complete       m3
    Post Milestone 3              post    (Admin / EPC)

Milestone 1 is pre1 + pre1b + m1; Milestone 2 is m2; Milestone 3 is m3 + post.
"Everything is mandatory unless otherwise stated": the stated exceptions are
MOC Change and Meter Replacement Date. Conditional fields ("if No, specify
the date") count only when their condition holds.

Values come from three places: a projects column, uploaded files by
category (Yes/No document fields are answered by the upload existing), or
the homeowner's account (IC last 4, email).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

Kind = Literal["text", "number", "date", "yesno", "select", "file", "photos", "retailer", "homeowner", "auto"]

GROUPS: list[tuple[str, str, str]] = [
    ("pre1", "Before Milestone 1", "Admin / EPC · utilities & SP application"),
    ("pre1b", "Pre-end of Milestone 1", "Admin · survey, panels & inverter"),
    ("m1", "Milestone 1", "Installation & scaffolding removal"),
    ("m2", "Milestone 2", "Inverter commissioning & grid"),
    ("m3", "Milestone 3", "Inspection & appointment letter"),
    ("post", "Post Milestone 3", "Closing documents & handover"),
]
MILESTONES: dict[int, tuple[str, ...]] = {1: ("pre1", "pre1b", "m1"), 2: ("m2",), 3: ("m3", "post")}


@dataclass(frozen=True)
class Field:
    key: str  # a projects column, a file category, or homeowner.<column>
    label: str
    group: str
    kind: Kind
    required: bool = True
    when: Callable[[dict[str, Any]], bool] | None = None  # shown (and required) only when true
    note: str | None = None


def _not_sp(p: dict[str, Any]) -> bool:
    name = (p.get("_retailer_name") or "").lower()
    return bool(p.get("electricity_retailer_id")) and not (name.startswith("sp") or "sp group" in name)


FIELDS: list[Field] = [
    # ---- Before start of Milestone 1
    Field("utility_bill", "Utility Bill", "pre1", "file"),
    Field("electricity_retailer_id", "Current Electricity Retailer", "pre1", "retailer"),
    Field(
        "retailer_contract_end_date",
        "Retailer Contract End Date",
        "pre1",
        "date",
        when=_not_sp,
        note="Required because the retailer is not SP.",
    ),  # fmt: skip
    Field("moc_change", "MOC Change (if applicable)", "pre1", "file", required=False),
    Field("gst_proof", "GST Proof", "pre1", "file"),
    Field("homeowner.ic_last4", "Homeowner's IC — Last 4", "pre1", "homeowner"),
    Field("homeowner.email", "Homeowner's Email Address", "pre1", "homeowner"),
    Field("sp_forms_signed", "SP Forms Signed by Homeowner", "pre1", "file"),
    Field("sp_application_status", "SP Application Status", "pre1", "select"),
    # ---- Pre-end of Milestone 1
    Field("sales", "Sales", "pre1b", "text"),
    Field("waterproofing", "Roof Assessment — Waterproofing Required?", "pre1b", "yesno"),
    Field("create_group_chat", "Create Group Chat", "pre1b", "yesno"),
    Field("panel_quantity_estimate", "Panel Quantity (Est.)", "pre1b", "number"),
    Field("panel_capacity", "Panel Capacity (W)", "pre1b", "number"),
    Field("inverter_to_order", "Inverter to be Ordered", "pre1b", "text"),
    Field("inverter_collected", "Inverter Collection Status", "pre1b", "yesno"),
    Field(
        "inverter_date",
        "Expected Collection Date",
        "pre1b",
        "date",
        when=lambda p: p.get("inverter_collected") is False,
        note="Required because the inverter has not been collected.",
    ),  # fmt: skip
    Field("inverter_serial_number", "Inverter Serial Number", "pre1b", "text"),
    Field("panel_pictures", "Installed Panel Pictures", "pre1b", "photos"),
    Field("inverter_pictures", "Installed Inverter Pictures", "pre1b", "photos"),
    Field("current_stage", "Current Stage", "pre1b", "number"),
    # ---- Milestone 1 to complete
    Field("installation_end_date", "Panel Installation Completion Date", "m1", "date"),
    Field("scaffolding_removal", "Scaffolding Removal", "m1", "yesno"),
    Field("scaffolding_removal_date", "Removal of Scaffolding Date", "m1", "date"),
    Field("sp_submission_date", "SP Submission Date", "m1", "date"),
    Field("sp_submission_screenshot", "Screenshot of SP Submission", "m1", "photos"),
    Field("panel_quantity_actual", "Panel Quantity (Actual)", "m1", "number", required=False),
    Field("sp_pending_days", "SP Application Pending", "m1", "auto"),
    # ---- Milestone 2 to complete
    Field("inverter_commission_grid_connection", "Inverter Commission & Grid Connection", "m2", "yesno"),
    Field(
        "commission_date",
        "Scheduled Grid Connection Date",
        "m2",
        "date",
        when=lambda p: p.get("inverter_commission_grid_connection") is False,
        note="Required because grid connection is not yet done.",
    ),  # fmt: skip
    Field("rcb_breaker_replacement", "RCB Breaker Replacement Required", "m2", "yesno"),
    Field(
        "rcb_breaker_replacement_date",
        "RCB Replacement Date",
        "m2",
        "date",
        when=lambda p: p.get("rcb_breaker_replacement") is True,
        note="Required because a replacement is needed.",
    ),  # fmt: skip
    Field("pvl_letter", "PVL Letter", "m2", "file"),
    Field("pvl_received_date", "PVL Received Date", "m2", "date"),
    # ---- Milestone 3 to complete
    Field("pre_inspection_date", "Pre-Inspection Date", "m3", "date"),
    Field("sp_appointment_letter", "SP Appointment Letter", "m3", "file"),
    Field("sp_appointment_letter_received_date", "Appointment Letter Received", "m3", "date"),
    Field("meter_replacement_date", "Meter Replacement Date", "m3", "date", required=False),
    Field("sp_turn_on_inspection_date", "SP Turn-On Inspection Date", "m3", "date"),
    # ---- Post Milestone 3
    Field("as_built_pv_layout", "As-Built PV Layout", "post", "file"),
    Field("final_submission_documents", "Final Submission Documents", "post", "file"),
    Field("handover_docs", "Handover Docs to Homeowner", "post", "file"),
    Field("fusion_solar_app_access", "FusionSolar App Access", "post", "yesno"),
    Field(
        "fusion_solar_access",
        "FusionSolar Access Document",
        "post",
        "file",
        when=lambda p: p.get("fusion_solar_app_access") is True,
    ),  # fmt: skip
    Field("completion_form_signed", "Completion Form Signed", "post", "file"),
]

FILE_KINDS = ("file", "photos")


def value(f: Field, p: dict[str, Any], files: dict[str, int]) -> Any:
    """The field's value: a column, a file count, or the homeowner's detail."""
    if f.kind in FILE_KINDS:
        return files.get(f.key, 0)
    if f.kind == "homeowner":
        return p.get("_homeowner", {}).get(f.key.split(".", 1)[1]) if p.get("homeowner_id") else None
    return p.get(f.key)


def is_filled(f: Field, p: dict[str, Any], files: dict[str, int]) -> bool:
    v = value(f, p, files)
    if f.kind in FILE_KINDS:
        return bool(v)
    if f.key == "sp_application_status":
        return v in (1, 2)  # 3 means not yet
    return v is not None and v != ""


def counted(f: Field, p: dict[str, Any]) -> bool:
    """Whether this field must be filled for its section to be complete."""
    return f.required and f.kind != "auto" and (f.when is None or f.when(p))


def group_status(p: dict[str, Any], files: dict[str, int]) -> dict[str, dict[str, int | bool]]:
    out: dict[str, dict[str, int | bool]] = {}
    for g, _, _ in GROUPS:
        need = [f for f in FIELDS if f.group == g and counted(f, p)]
        done = sum(1 for f in need if is_filled(f, p, files))
        out[g] = {"done": done, "total": len(need), "complete": done == len(need)}
    return out


def milestone_reached(groups: dict[str, dict[str, int | bool]]) -> int:
    """The highest milestone whose sections are all complete, in order."""
    reached = 0
    for n in (1, 2, 3):
        if all(groups[g]["complete"] for g in MILESTONES[n]):
            reached = n
        else:
            break
    return reached


def progress(p: dict[str, Any], groups: dict[str, dict[str, int | bool]]) -> int:
    """Share of required fields filled, across every milestone section. 100 once closed."""
    if p.get("status") == "closed":
        return 100
    total = sum(int(g["total"]) for g in groups.values())
    done = sum(int(g["done"]) for g in groups.values())
    return round(done / total * 100) if total else 0
