"""GetApps' project workflow (9 Solar Fintech, docs/getapps-workflow.md): what's on it, what opens when, and
what a project's progress, stage and timing are. One definition drives the project page, the projects list,
the groups and the API's checks, so they always agree.

    Pre-Installation -> Mechanical Installation -> Electrical Installation -> Commissioning
                          (+ Mechanical Works)      (+ Electrical Works)
    SP approvals, alongside: CS1 (after Pre-Installation) -> PV1 letter -> PQ submission (after
                             Electrical) -> PV2 letter -> Connection Agreement (due a week after PV2)
    SP Turn-On: SP Turn-On and the QA/QC checklist, once both of the above are done; then it's complete.

An item is done when its drawing is uploaded (the inverters: one picture, with their serial number and size)
and it's ticked. A stage opens when the one before it is done; nothing in it can be done before. The
Mechanical and Electrical Works checklists come from the Excel sheets a superadmin uploads (ticks only).
A project runs 10 months from its start; past that and not complete, it's late.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from _lib.db import fetch_all

SPAN_MONTHS = 10
CONNECTION_DUE_DAYS = 7


@dataclass(frozen=True)
class Item:
    key: str
    label: str
    endorsed: bool = False  # shown under "With Applicable PE/LEW Endorsements"
    fields: tuple[str, ...] = ()  # entered with it: the inverters' serial number and size
    max_files: int | None = None  # the inverters: one picture


@dataclass(frozen=True)
class Stage:
    key: str
    label: str
    items: tuple[Item, ...]
    checklist: str | None = None  # 'mechanical' or 'electrical': ticks from the uploaded sheet


STAGES: tuple[Stage, ...] = (
    Stage("pre_install", "Pre-Installation", (
        Item("ifc_pv_layout", "IFC PV Layout"),
        Item("pv_system", "PV System"),
        Item("single_line_diagram", "Single Line Diagram"),
        Item("structure_drawing", "Structure Drawing"),
    )),
    Stage("mechanical", "Mechanical Installation", (
        Item("solar_panels", "Solar Panels"),
        Item("as_built_pvl", "As-Built PVL", endorsed=True),
        Item("railings", "Applicable Railings", endorsed=True),
    ), checklist="mechanical"),
    Stage("electrical", "Electrical Installation", (
        Item("pvdb", "PVDB"),
        Item("isolators", "Isolators"),
        Item("inverters", "Inverters", fields=("serial", "size"), max_files=1),
        Item("msb_modules", "Electrical MSB Modules"),
        Item("as_built_pvsl", "As-Built PVSL", endorsed=True),
        Item("as_built_sld", "As-Built Single Line Diagram", endorsed=True),
    ), checklist="electrical"),
    Stage("commissioning", "Commissioning", (
        Item("pre_commissioning_report", "Pre-Commissioning Report"),
        Item("scdf_final_acceptance", "SCDF Final Acceptance"),
    )),
)  # fmt: skip

# The SP approvals: each opens after (a stage done, or the item before it done).
SP_TRACK: tuple[tuple[Item, str], ...] = (
    (Item("cs1_application", "CS1 Application"), "stage:pre_install"),
    (Item("pv1_letter", "PV1 Letter"), "item:cs1_application"),
    (Item("pq_submission", "PQ Submission"), "stage:electrical"),
    (Item("pv2_letter", "PV2 Letter"), "item:pq_submission"),
    (Item("connection_agreement", "Connection Agreement"), "item:pv2_letter"),
)
FINAL = Stage(
    "sp_turn_on", "SP Turn-On", (Item("sp_turn_on", "SP Turn-On"), Item("qa_qc_checklist", "QA/QC Checklist"))
)

ITEMS: dict[str, Item] = {i.key: i for s in (*STAGES, FINAL) for i in s.items} | {i.key: i for i, _ in SP_TRACK}
STAGE_KEYS = [s.key for s in STAGES] + ["sp_turn_on"]
STAGE_LABEL = {s.key: s.label for s in (*STAGES, FINAL)} | {"complete": "Complete"}


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    last = (date(year + (month // 12), month % 12 + 1, 1) - timedelta(days=1)).day
    return date(year, month, min(d.day, last))


def target_end(start: date) -> date:
    """A project's planned completion: 10 months from its start."""
    return add_months(start, SPAN_MONTHS)


@dataclass
class Loaded:
    """What the workflow is worked out from, for many projects at once."""

    steps: dict[int, dict[str, dict[str, Any]]] = field(default_factory=dict)  # project -> step -> row
    files: dict[int, dict[str, list[dict[str, Any]]]] = field(default_factory=dict)  # project -> step -> files
    checklists: dict[str, list[dict[str, Any]]] = field(default_factory=dict)  # stage -> items


def load(project_ids: list[int]) -> Loaded:
    out = Loaded()
    if project_ids:
        for r in fetch_all(
            "select s.project_id, s.step, s.done_at, s.data, s.note, u.full_name as by_name from project_steps s "
            "left join users u on u.uid = s.done_by where s.project_id = any(%s)",
            (project_ids,),
        ):
            out.steps.setdefault(r["project_id"], {})[r["step"]] = r
        for r in fetch_all(
            "select file_id, project_id, step, file_name, content_type, size_bytes, uploaded_at from project_files "
            "where project_id = any(%s) and step is not null order by uploaded_at",
            (project_ids,),
        ):
            out.files.setdefault(r["project_id"], {}).setdefault(r["step"], []).append(r)
    for r in fetch_all(
        "select item_id, stage, label from workflow_checklist_items where active order by stage, sort, item_id"
    ):
        out.checklists.setdefault(r["stage"], []).append(r)
    return out


def _iso(v: Any) -> str | None:
    return v.isoformat() if isinstance(v, date | datetime) else None


def state(p: dict[str, Any], loaded: Loaded, today: date) -> dict[str, Any]:
    """Everything about one project's workflow: each stage and item, what's open, its progress and timing."""
    pid = p["project_id"]
    steps = loaded.steps.get(pid, {})
    files = loaded.files.get(pid, {})
    done = set(steps)

    def item_out(i: Item, open_: bool) -> dict[str, Any]:
        row = steps.get(i.key)
        fs = files.get(i.key, [])
        return {
            "key": i.key,
            "label": i.label,
            "endorsed": i.endorsed,
            "fields": list(i.fields),
            "maxFiles": i.max_files,
            "open": open_,
            "done": row is not None,
            "doneAt": _iso(row["done_at"]) if row else None,
            "doneBy": row["by_name"] if row else None,
            "data": (row["data"] or {}) if row else {},
            "note": row["note"] if row else None,
            "files": [
                {"id": f["file_id"], "name": f["file_name"], "type": f["content_type"], "at": _iso(f["uploaded_at"])}
                for f in fs
            ],
        }

    stages: list[dict[str, Any]] = []
    stage_done: dict[str, bool] = {}
    prev_done = True
    total = finished = 0
    for s in STAGES:
        open_ = prev_done
        items = [item_out(i, open_) for i in s.items]
        checks = [
            {
                "key": f"check:{c['item_id']}",
                "label": c["label"],
                "done": f"check:{c['item_id']}" in done,
                "open": open_,
            }
            for c in loaded.checklists.get(s.checklist or "", [])
        ]
        all_done = all(i["done"] for i in items) and all(c["done"] for c in checks)
        stage_done[s.key] = all_done
        total += len(items) + len(checks)
        finished += sum(i["done"] for i in items) + sum(c["done"] for c in checks)
        stages.append(
            {
                "key": s.key,
                "label": s.label,
                "open": open_,
                "done": all_done,
                "items": items,
                "checklist": checks,
                "checklistKind": s.checklist,
                "checklistLoaded": bool(s.checklist and loaded.checklists.get(s.checklist)),
            }
        )
        prev_done = all_done

    sp: list[dict[str, Any]] = []
    for i, after in SP_TRACK:
        kind, key = after.split(":")
        open_ = stage_done.get(key, False) if kind == "stage" else key in done
        out = item_out(i, open_)
        # The Connection Agreement falls due a week after the PV2 letter.
        if i.key == "connection_agreement" and "pv2_letter" in steps:
            due = steps["pv2_letter"]["done_at"].date() + timedelta(days=CONNECTION_DUE_DAYS)
            out["dueOn"] = due.isoformat()
            out["overdue"] = not out["done"] and today > due
        sp.append(out)
        total += 1
        finished += out["done"]
    sp_done = all(x["done"] for x in sp)

    final_open = all(stage_done.values()) and sp_done
    final_items = [item_out(i, final_open) for i in FINAL.items]
    total += len(final_items)
    finished += sum(i["done"] for i in final_items)
    complete = final_open and all(i["done"] for i in final_items)

    current = next((s["key"] for s in stages if not s["done"]), "sp_turn_on" if not complete else "complete")
    start = p.get("installation_start_date")
    end = p.get("target_end_date") or (target_end(start) if start else None)
    late_days = (today - end).days if end and not complete and today > end else 0
    return {
        "stages": stages,
        "sp": {"items": sp, "done": sp_done},
        "final": {"key": FINAL.key, "label": FINAL.label, "open": final_open, "done": complete, "items": final_items},
        "complete": complete,
        "current": current,
        "currentLabel": STAGE_LABEL[current],
        "progress": round(finished * 100 / total) if total else 0,
        "startDate": _iso(start),
        "endDate": _iso(end),
        "lateDays": late_days,
    }


def opens(st: dict[str, Any], key: str) -> tuple[bool, str | None]:
    """Whether item ``key`` can be done now, and where it sits (a stage key, 'sp' or 'sp_turn_on')."""
    for s in st["stages"]:
        if any(i["key"] == key for i in s["items"]) or any(c["key"] == key for c in s["checklist"]):
            return s["open"], s["key"]
    if any(i["key"] == key for i in st["sp"]["items"]):
        return next(i["open"] for i in st["sp"]["items"] if i["key"] == key), "sp"
    if any(i["key"] == key for i in st["final"]["items"]):
        return st["final"]["open"], "sp_turn_on"
    return False, None


def later_done(st: dict[str, Any], key: str) -> bool:
    """Whether anything that depends on ``key`` is already done (so it can't be taken back first)."""
    _, where = opens(st, key)
    order = [s["key"] for s in st["stages"]]
    if where in order:
        later = st["stages"][order.index(where) + 1 :]
        if any(i["done"] for s in later for i in s["items"]) or any(c["done"] for s in later for c in s["checklist"]):
            return True
        # Pre-Installation opens CS1; Electrical opens the PQ submission.
        sp_after = {"pre_install": "cs1_application", "electrical": "pq_submission"}.get(where)
        if sp_after and any(i["key"] == sp_after and i["done"] for i in st["sp"]["items"]):
            return True
        return any(i["done"] for i in st["final"]["items"])
    if where == "sp":
        keys = [i["key"] for i in st["sp"]["items"]]
        nxt = keys[keys.index(key) + 1 :]
        return any(i["key"] in nxt and i["done"] for i in st["sp"]["items"]) or any(
            i["done"] for i in st["final"]["items"]
        )
    return False
