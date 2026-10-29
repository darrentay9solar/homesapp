"""GetApps (9 Solar Fintech): a project's workflow, the Works checklists, and groups of projects with their
phases (api/_lib/workflow.py, docs/getapps-workflow.md). Not served in 9 Solar Home's app.

  GET    /projects/{pid}/workflow                          every stage and item: what's done, open, uploaded
  POST   /projects/{pid}/workflow/{key}/upload-link        a link to upload a drawing for an item
  POST   /projects/{pid}/workflow/{key}/files              the drawing arrived: attach it
  DELETE /projects/{pid}/workflow/{key}/files/{fid}        take a drawing off (only while the item isn't ticked)
  POST   /projects/{pid}/workflow/{key}/done               tick it {data?, note?}: needs its drawing (and fields)
  DELETE /projects/{pid}/workflow/{key}/done               untick it, if nothing after it is done yet
  GET    /workflow/checklists                              the Mechanical and Electrical Works checklists
  POST   /workflow/checklists/{stage}                      replace one from an uploaded Excel sheet (office)
  GET    /project-groups                                   every group: phases and consolidated progress
  POST   /project-groups                                   a new group {name, contractRef?, client?, notes?}
  GET    /project-groups/{gid}                             one group: its phases, projects and figures
  PATCH  /project-groups/{gid}                             change its details
  DELETE /project-groups/{gid}                             remove it, once it has no projects
  POST   /project-groups/{gid}/phases                      add a phase {name}
  PATCH  /project-phases/{phid}                            rename or reorder {name?, sort?}
  DELETE /project-phases/{phid}                            remove it (its projects stay in the group)
  PUT    /projects/{pid}/group                             put a project in a group and phase {groupId?, phaseId?}

Who: a project's own manager (or a superadmin) and its crew work its workflow; Admin and other managers
see it. Groups, phases and checklists are the office's (a superadmin or "HQ Staff").
"""

from __future__ import annotations

import base64
import io
import json
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from _lib import storage, sweep
from _lib import workflow as wf
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.edition import EDITION
from _lib.solar_sync import SG
from _lib.web import active
from _routes.project_work import _need, _project
from _routes.projects import _visible_clause

router = APIRouter()

WORKS = {"mechanical": "Mechanical Works", "electrical": "Electrical Works"}


def _getapps() -> None:
    if EDITION != "fintech":
        raise HTTPException(404, "Not found.")


def _office(acct: Account) -> None:
    if acct.role not in ("superadmin", "project_manager"):
        raise HTTPException(403, "Only the office manages groups, phases and checklists.")


def _today() -> Any:
    return datetime.now(SG).date()


def _state(pid: int) -> tuple[dict[str, Any], dict[str, Any]]:
    p = _project(pid)
    return p, wf.state(p, wf.load([pid]), _today())


def _may_work(acct: Account, p: dict[str, Any]) -> None:
    if _need(acct, p) not in ("pm", "crew"):
        raise HTTPException(403, "Only the project's manager and its crew record its workflow.")


def _label(key: str) -> str:
    if key.startswith("check:"):
        row = fetch_one("select label from workflow_checklist_items where item_id = %s", (int(key[6:]),))
        return row["label"] if row else "Checklist item"
    return wf.ITEMS[key].label if key in wf.ITEMS else key


def _known(key: str) -> None:
    if key not in wf.ITEMS and not re.fullmatch(r"check:\d{1,9}", key):
        raise HTTPException(404, "No such item on the workflow.")


# ------------------------------------------------------------------ a project's workflow


@router.get("/projects/{pid}/workflow")
def get_workflow(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    p, st = _state(pid)
    rel = _need(acct, p)
    return {**st, "canWork": rel in ("pm", "crew")}


class LinkIn(BaseModel):
    fileName: str = ""
    contentType: str = ""
    size: int = 0


class FileIn(BaseModel):
    key: str
    fileName: str = ""


def _may_upload(acct: Account, pid: int, key: str) -> dict[str, Any]:
    _getapps()
    _known(key)
    if key.startswith("check:"):
        raise HTTPException(400, "Checklist items are ticked, without a drawing.")
    p, st = _state(pid)
    _may_work(acct, p)
    open_, _ = wf.opens(st, key)
    if not open_:
        raise HTTPException(409, "This isn't open yet: the stage before it isn't done.")
    item = _item(st, key)
    if item["done"]:
        raise HTTPException(409, "It's ticked already. Untick it to change its drawings.")
    limit = wf.ITEMS[key].max_files
    if limit and len(item["files"]) >= limit:
        raise HTTPException(409, f"{wf.ITEMS[key].label} takes {limit} picture. Remove it to upload another.")
    return p


@router.post("/projects/{pid}/workflow/{key}/upload-link")
def upload_link(pid: int, key: str, body: LinkIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _may_upload(acct, pid, key)
    if not storage.ALLOWED_TYPES.get(body.contentType):
        raise HTTPException(400, "Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be uploaded.")
    if not 0 < body.size <= storage.MAX_BYTES:
        raise HTTPException(400, f"Files must be under {storage.MAX_BYTES // 1024 // 1024} MB.")
    path = storage.project_key(pid, "workflow", body.contentType)
    try:
        url = storage.upload_link(path, body.contentType, body.size)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc
    sweep.record(path, acct.uid)
    return {"key": path, "uploadUrl": url, "headers": {"Content-Type": body.contentType}}


@router.post("/projects/{pid}/workflow/{key}/files")
def file_done(pid: int, key: str, body: FileIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _may_upload(acct, pid, key)
    exts = "|".join(storage.ALLOWED_TYPES.values())
    if not re.fullmatch(rf"projects/{pid}/(images|documents)/workflow/[0-9a-f-]{{36}}\.({exts})", body.key):
        raise HTTPException(400, "That upload doesn't belong to this project.")
    got = storage.head(body.key)
    if not got:
        raise HTTPException(400, "The file never arrived. Please upload it again.")
    size, ctype = got
    if size > storage.MAX_BYTES or ctype not in storage.ALLOWED_TYPES or f"/{storage.folder(ctype)}/" not in body.key:
        storage.delete(body.key)
        sweep.done(body.key, acct.uid)
        raise HTTPException(400, "That file is too large or not an allowed type.")
    name = (body.fileName or "file").strip()[:200]
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by, "
            "kind, step) values (%s, 'workflow', %s, %s, %s, %s, %s, %s, %s) returning file_id",
            (pid, body.key, name, ctype, size, acct.uid, storage.kind_of(ctype), key),
        )
        fid = cur.fetchone()["file_id"]
    sweep.done(body.key, acct.uid)
    return {"id": fid, "message": f"{name} added to {wf.ITEMS[key].label}."}


@router.delete("/projects/{pid}/workflow/{key}/files/{fid}")
def remove_file(pid: int, key: str, fid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _known(key)
    p, st = _state(pid)
    _may_work(acct, p)
    if key in st_done(st):
        raise HTTPException(409, "It's ticked. Untick it before changing its drawings.")
    row = fetch_one(
        "select file_name from project_files where file_id = %s and project_id = %s and step = %s", (fid, pid, key)
    )
    if not row:
        raise HTTPException(404, "No such drawing on this item.")
    with transaction(acct.uid) as cur:
        cur.execute("delete from project_files where file_id = %s", (fid,))
    return {"message": f"{row['file_name']} taken off. The audit log keeps a record."}


def _item(st: dict[str, Any], key: str) -> dict[str, Any]:
    """One item's line in the workflow, wherever it sits (a stage, the SP approvals, SP Turn-On)."""
    lines = [i for s in [*st["stages"], st["final"]] for i in s["items"]] + st["sp"]["items"]
    return next(i for i in lines if i["key"] == key)


def st_done(st: dict[str, Any]) -> set[str]:
    out = {i["key"] for s in [*st["stages"], st["final"]] for i in s["items"] if i["done"]}
    out |= {c["key"] for s in st["stages"] for c in s["checklist"] if c["done"]}
    return out | {i["key"] for i in st["sp"]["items"] if i["done"]}


class DoneIn(BaseModel):
    data: dict[str, str] = Field(default_factory=dict)
    note: str | None = None


@router.post("/projects/{pid}/workflow/{key}/done")
def tick(pid: int, key: str, body: DoneIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _known(key)
    p, st = _state(pid)
    _may_work(acct, p)
    open_, where = wf.opens(st, key)
    if where is None:
        raise HTTPException(404, "That checklist item isn't on this project's list.")
    if not open_:
        raise HTTPException(409, "This isn't open yet: the stage before it isn't done.")
    if key in st_done(st):
        raise HTTPException(409, "It's ticked already.")
    data: dict[str, str] = {}
    if not key.startswith("check:"):
        item = wf.ITEMS[key]
        files = wf.load([pid]).files.get(pid, {}).get(key, [])
        if not files:
            raise HTTPException(400, f"Upload the {item.label} drawing first.")
        for f in item.fields:
            v = " ".join((body.data.get(f) or "").split())[:60]
            if not v:
                raise HTTPException(
                    400, {"serial": "Enter the inverters' serial number.", "size": "Enter the inverters' size."}[f]
                )
            data[f] = v
    note = " ".join((body.note or "").split())[:1000] or None
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_steps (project_id, step, done_by, data, note) values (%s, %s, %s, %s::jsonb, %s)",
            (pid, key, acct.uid, json.dumps(data), note),
        )
    after = wf.state(p, wf.load([pid]), _today())
    msg = f"{_label(key)} done."
    if after["complete"]:
        msg = f"{p['name']} is complete."
    return {"message": msg, "workflow": after}


@router.delete("/projects/{pid}/workflow/{key}/done")
def untick(pid: int, key: str, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _known(key)
    p, st = _state(pid)
    _may_work(acct, p)
    if key not in st_done(st):
        raise HTTPException(409, "It isn't ticked.")
    if wf.later_done(st, key):
        raise HTTPException(409, "Something after it is done already. Untick that first.")
    with transaction(acct.uid) as cur:
        cur.execute("delete from project_steps where project_id = %s and step = %s", (pid, key))
    return {"message": f"{_label(key)} unticked.", "workflow": wf.state(p, wf.load([pid]), _today())}


# ------------------------------------------------------------------ the Works checklists


@router.get("/workflow/checklists")
def checklists(acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    rows = fetch_all(
        "select item_id, stage, label, source_file, created_at from workflow_checklist_items where active "
        "order by stage, sort, item_id"
    )
    return {
        stage: {
            "label": label,
            "items": [{"id": r["item_id"], "label": r["label"]} for r in rows if r["stage"] == stage],
            "file": next((r["source_file"] for r in rows if r["stage"] == stage), None),
        }
        for stage, label in WORKS.items()
    }


class SheetIn(BaseModel):
    fileName: str
    contentBase64: str


def read_sheet(raw: bytes) -> list[str]:
    """The checklist from an Excel sheet: every filled cell of the first column with text in it, top to bottom,
    leaving out a heading row (Item, Description, Works, No., S/N) and pure numbers."""
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:  # not an Excel file
        raise HTTPException(400, "That isn't an Excel file (.xlsx).") from exc
    ws = wb.worksheets[0]
    out: list[str] = []
    for row in ws.iter_rows(values_only=True):
        cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
        # The item is the first cell with words; a leading number (1, 1.1, a)) is its numbering.
        words = next((c for c in cells if re.search(r"[A-Za-z]{2,}", c)), None)
        if not words:
            continue
        if not out and re.fullmatch(r"(?i)(item|items|description|works?|no\.?|s/n|s/no|checklist|task)s?", words):
            continue
        label = " ".join(words.split())[:300]
        if label not in out:
            out.append(label)
    if not out:
        raise HTTPException(400, "No checklist items found in the sheet's first column.")
    if len(out) > 500:
        raise HTTPException(400, "That's more than 500 items: is it the right sheet?")
    return out


@router.post("/workflow/checklists/{stage}")
def upload_checklist(stage: str, body: SheetIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    if stage not in WORKS:
        raise HTTPException(404, "Choose Mechanical or Electrical Works.")
    try:
        raw = base64.b64decode(body.contentBase64, validate=True)
    except ValueError as exc:
        raise HTTPException(400, "The file didn't come through. Please choose it again.") from exc
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "The sheet must be under 5 MB.")
    labels = read_sheet(raw)
    name = body.fileName.strip()[:200] or "sheet.xlsx"
    existing = {r["label"]: r["item_id"] for r in fetch_all(
        "select item_id, label from workflow_checklist_items where stage = %s", (stage,))}  # fmt: skip
    with transaction(acct.uid) as cur:
        cur.execute("update workflow_checklist_items set active = false where stage = %s and active", (stage,))
        for n, label in enumerate(labels):
            # The same wording keeps its item, so ticks already made on projects still count.
            if label in existing:
                cur.execute(
                    "update workflow_checklist_items set active = true, sort = %s, source_file = %s where item_id = %s",
                    (n, name, existing[label]),
                )
            else:
                cur.execute(
                    "insert into workflow_checklist_items (stage, sort, label, source_file) values (%s, %s, %s, %s)",
                    (stage, n, label, name),
                )
    return {"message": f"{WORKS[stage]}: {len(labels)} items from {name}.", "count": len(labels)}


# ------------------------------------------------------------------ groups and phases


class GroupIn(BaseModel):
    name: str | None = None
    contractRef: str | None = None
    client: str | None = None
    notes: str | None = None


def _clean(v: str | None, n: int) -> str | None:
    return " ".join((v or "").split())[:n] or None


def _summary(rows: list[dict[str, Any]], loaded: wf.Loaded) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Each project's line, and the figures across them all."""
    today = _today()
    lines = []
    for r in rows:
        st = wf.state(r, loaded, today)
        lines.append(
            {
                "id": r["project_id"],
                "name": r["name"],
                "address": r["address"],
                "postalCode": r["postal_code"],
                "phaseId": r["phase_id"],
                "pm": r.get("pm_name"),
                "stage": st["current"],
                "stageLabel": st["currentLabel"],
                "progress": st["progress"],
                "complete": st["complete"],
                "lateDays": st["lateDays"],
                "startDate": st["startDate"],
                "endDate": st["endDate"],
                "sp": {i["key"]: i["done"] for i in st["sp"]["items"]},
            }
        )
    by_stage = {k: sum(1 for x in lines if x["stage"] == k) for k in [*wf.STAGE_KEYS, "complete"]}
    sp = {i.key: sum(1 for x in lines if x["sp"].get(i.key)) for i, _ in wf.SP_TRACK}
    figures = {
        "projects": len(lines),
        "complete": sum(x["complete"] for x in lines),
        "late": sum(1 for x in lines if x["lateDays"] > 0),
        "progress": round(sum(x["progress"] for x in lines) / len(lines)) if lines else 0,
        "byStage": by_stage,
        "sp": sp,
    }
    return lines, figures


def _group_projects(acct: Account, gid: int | None) -> list[dict[str, Any]]:
    where, params = _visible_clause(acct)
    return fetch_all(
        f"select p.*, pm.full_name as pm_name from projects p left join users pm on pm.uid = p.project_manager_id "
        f"where {where} and "
        + ("p.group_id = %(gid)s" if gid is not None else "p.group_id is not null")
        + " order by p.name",
        {**params, "gid": gid},
    )


def _group_out(g: dict[str, Any], phases: list[dict[str, Any]], figures: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": g["group_id"],
        "name": g["name"],
        "contractRef": g["contract_ref"],
        "client": g["client"],
        "notes": g["notes"],
        "phases": [{"id": ph["phase_id"], "name": ph["name"], "sort": ph["sort"]} for ph in phases],
        "figures": figures,
    }


@router.get("/project-groups")
def groups(acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    gs = fetch_all("select * from project_groups order by name")
    phases = fetch_all("select * from project_phases order by group_id, sort, phase_id")
    rows = _group_projects(acct, None)
    loaded = wf.load([r["project_id"] for r in rows])
    out = []
    for g in gs:
        mine = [r for r in rows if r["group_id"] == g["group_id"]]
        lines, figures = _summary(mine, loaded)
        figures["byPhase"] = {
            ph["phase_id"]: sum(1 for x in lines if x["phaseId"] == ph["phase_id"])
            for ph in phases
            if ph["group_id"] == g["group_id"]
        }
        out.append(_group_out(g, [ph for ph in phases if ph["group_id"] == g["group_id"]], figures))
    return {"groups": out, "canManage": acct.role in ("superadmin", "project_manager")}


@router.post("/project-groups")
def create_group(body: GroupIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    name = _clean(body.name, 200)
    if not name or len(name) < 2:
        raise HTTPException(400, "Give the group a name, e.g. the contract's.")
    if fetch_one("select 1 from project_groups where lower(name) = lower(%s)", (name,)):
        raise HTTPException(409, "There's a group with that name already.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_groups (name, contract_ref, client, notes, created_by) values (%s, %s, %s, %s, %s) "
            "returning group_id",
            (name, _clean(body.contractRef, 100), _clean(body.client, 200), _clean(body.notes, 2000), acct.uid),
        )
        gid = cur.fetchone()["group_id"]
    return {"id": gid, "message": f"{name} created."}


def _group(gid: int) -> dict[str, Any]:
    g = fetch_one("select * from project_groups where group_id = %s", (gid,))
    if not g:
        raise HTTPException(404, "No such group.")
    return g


@router.get("/project-groups/{gid}")
def group(gid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    g = _group(gid)
    phases = fetch_all("select * from project_phases where group_id = %s order by sort, phase_id", (gid,))
    rows = _group_projects(acct, gid)
    lines, figures = _summary(rows, wf.load([r["project_id"] for r in rows]))
    figures["byPhase"] = {ph["phase_id"]: sum(1 for x in lines if x["phaseId"] == ph["phase_id"]) for ph in phases}
    return {
        **_group_out(g, phases, figures),
        "projects": lines,
        "stages": [{"key": k, "label": wf.STAGE_LABEL[k]} for k in [*wf.STAGE_KEYS, "complete"]],
        "spItems": [{"key": i.key, "label": i.label} for i, _ in wf.SP_TRACK],
        "canManage": acct.role in ("superadmin", "project_manager"),
    }


@router.patch("/project-groups/{gid}")
def update_group(gid: int, body: GroupIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    g = _group(gid)
    sent = body.model_fields_set
    name = _clean(body.name, 200) if "name" in sent else g["name"]
    if not name or len(name) < 2:
        raise HTTPException(400, "Give the group a name.")
    if name.lower() != g["name"].lower() and fetch_one(
        "select 1 from project_groups where lower(name) = lower(%s)", (name,)
    ):
        raise HTTPException(409, "There's a group with that name already.")
    vals = {
        "name": name,
        "contract_ref": _clean(body.contractRef, 100) if "contractRef" in sent else g["contract_ref"],
        "client": _clean(body.client, 200) if "client" in sent else g["client"],
        "notes": _clean(body.notes, 2000) if "notes" in sent else g["notes"],
    }
    with transaction(acct.uid) as cur:
        cur.execute(
            "update project_groups set name = %(name)s, contract_ref = %(contract_ref)s, client = %(client)s, "
            "notes = %(notes)s where group_id = %(gid)s",
            {**vals, "gid": gid},
        )
    return {"message": f"{name} saved."}


@router.delete("/project-groups/{gid}")
def delete_group(gid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    g = _group(gid)
    if fetch_one("select 1 from projects where group_id = %s", (gid,)):
        raise HTTPException(409, "Move its projects out of the group first.")
    with transaction(acct.uid) as cur:
        cur.execute("delete from project_groups where group_id = %s", (gid,))
    return {"message": f"{g['name']} removed."}


class PhaseIn(BaseModel):
    name: str | None = None
    sort: int | None = None


@router.post("/project-groups/{gid}/phases")
def add_phase(gid: int, body: PhaseIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    _group(gid)
    name = _clean(body.name, 100)
    if not name:
        raise HTTPException(400, "Give the phase a name, e.g. Phase 1.")
    if fetch_one("select 1 from project_phases where group_id = %s and lower(name) = lower(%s)", (gid, name)):
        raise HTTPException(409, "This group has a phase with that name already.")
    last = fetch_one("select coalesce(max(sort), -1) + 1 as n from project_phases where group_id = %s", (gid,))
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_phases (group_id, name, sort) values (%s, %s, %s) returning phase_id",
            (gid, name, body.sort if body.sort is not None else last["n"]),
        )
        phid = cur.fetchone()["phase_id"]
    return {"id": phid, "message": f"{name} added."}


def _phase(phid: int) -> dict[str, Any]:
    ph = fetch_one("select * from project_phases where phase_id = %s", (phid,))
    if not ph:
        raise HTTPException(404, "No such phase.")
    return ph


@router.patch("/project-phases/{phid}")
def update_phase(phid: int, body: PhaseIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    ph = _phase(phid)
    name = _clean(body.name, 100) if body.name is not None else ph["name"]
    if not name:
        raise HTTPException(400, "Give the phase a name.")
    if name.lower() != ph["name"].lower() and fetch_one(
        "select 1 from project_phases where group_id = %s and lower(name) = lower(%s)", (ph["group_id"], name)
    ):
        raise HTTPException(409, "This group has a phase with that name already.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update project_phases set name = %s, sort = %s where phase_id = %s",
            (name, body.sort if body.sort is not None else ph["sort"], phid),
        )
    return {"message": f"{name} saved."}


@router.delete("/project-phases/{phid}")
def delete_phase(phid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    ph = _phase(phid)
    with transaction(acct.uid) as cur:
        # Its projects stay in the group, without a phase (the database does this: on delete set null).
        cur.execute("delete from project_phases where phase_id = %s", (phid,))
    return {"message": f"{ph['name']} removed. Its projects stay in the group."}


class PlaceIn(BaseModel):
    groupId: int | None = None
    phaseId: int | None = None


@router.put("/projects/{pid}/group")
def place(pid: int, body: PlaceIn, acct: Account = Depends(active)) -> dict[str, Any]:
    _getapps()
    _office(acct)
    p = _project(pid)
    if _need(acct, p) != "pm":
        raise HTTPException(403, "Only the project's manager (or a superadmin) moves it between groups.")
    if body.groupId is not None:
        _group(body.groupId)
    if body.phaseId is not None:
        ph = _phase(body.phaseId)
        if ph["group_id"] != body.groupId:
            raise HTTPException(400, "That phase belongs to another group.")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update projects set group_id = %s, phase_id = %s where project_id = %s", (body.groupId, body.phaseId, pid)
        )
    return {"message": "Group saved." if body.groupId else "Taken out of its group."}
