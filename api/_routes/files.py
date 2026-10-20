"""Files: My Files, like a shared drive, and files with no project yet.

  GET /library     every file on every project this person can see, for folders by project and
                   milestone section (and, for staff, the files not on a project yet)
  GET /my-files    files still on their project (openable), and ones later
                   removed from a project (listed with when and by whom; the
                   stored copy is kept and a PM can restore it from the audit log)
  GET /all-files   project managers: every project's files, searchable, 100 at a time

  POST /unassigned-files/upload-link, POST /unassigned-files   upload a file with no project yet (staff)
  GET /unassigned-files/{id}           open it (?download=1 to save it)
  POST /unassigned-files/{id}/assign   put it on a project, in a slot {projectId, category}
  DELETE /unassigned-files/{id}        take it out of Unassigned (restorable from the audit log)

Opening a file still goes through GET /files/{id} (?download=1 to save it),
which checks access to the project at that moment. Zips are made and opened
in the browser, file by file through these same routes.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from _lib import storage, sweep
from _lib.account import Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.project_fields import FIELDS, GROUPS
from _lib.web import active, role

router = APIRouter()

LABEL = {f.key: f.label for f in FIELDS}
pm_only = role("project_manager")


def kind(content_type: str | None) -> str:
    return "photo" if (content_type or "").startswith("image/") else "document"


@router.get("/my-files")
def my_files(acct: Account = Depends(active)) -> dict[str, Any]:
    on = fetch_all(
        "select f.file_id, f.project_id, f.category::text as category, f.file_name, f.content_type, f.size_bytes, "
        "f.uploaded_at, coalesce(nullif(p.name, ''), p.address) as project from project_files f "
        "join projects p on p.project_id = f.project_id where f.uploaded_by = %s order by f.uploaded_at desc",
        (acct.uid,),
    )
    # Removal entries of this person's own uploads (migration 0023 lets them read just these).
    gone = fetch_all(
        "select a.entity_id, a.occurred_at, coalesce(a.actor_name, a.actor_email) as by, a.changes "
        "from audit_log a where a.entity_table = 'project_files' and a.action = 'delete' "
        "and (a.changes -> 'uploaded_by' ->> 'from') = %s "
        "and not exists (select 1 from project_files f where f.file_id::text = a.entity_id) "
        "order by a.audit_id desc",
        (str(acct.uid),),
        actor_uid=acct.uid,
    )
    pids = {int((g["changes"].get("project_id") or {}).get("from") or 0) for g in gone}
    names = (
        {
            r["project_id"]: r["name"]
            for r in fetch_all(
                "select project_id, coalesce(nullif(name, ''), address) as name from projects "
                "where project_id = any(%s)",
                (list(pids),),
            )
        }
        if pids
        else {}
    )

    files: list[dict[str, Any]] = [
        {
            "id": f["file_id"],
            "name": f["file_name"],
            "category": f["category"],
            "categoryLabel": LABEL.get(f["category"], f["category"]),
            "projectId": f["project_id"],
            "projectName": f["project"],
            "contentType": f["content_type"],
            "kind": kind(f["content_type"]),
            "size": f["size_bytes"],
            "uploadedAt": f["uploaded_at"].isoformat(),
            "removed": None,
        }
        for f in on
    ]
    seen: set[str] = set()
    for g in gone:
        if g["entity_id"] in seen:  # removed, restored and removed again: show it once
            continue
        seen.add(g["entity_id"])
        was = {k: (v or {}).get("from") for k, v in (g["changes"] or {}).items()}
        pid = int(was.get("project_id") or 0)
        files.append(
            {
                "id": int(g["entity_id"]),
                "name": was.get("file_name") or "file",
                "category": was.get("category"),
                "categoryLabel": LABEL.get(was.get("category") or "", was.get("category") or ""),
                "projectId": pid,
                "projectName": names.get(pid) or f"Project #{pid}",
                "contentType": was.get("content_type"),
                "kind": kind(was.get("content_type")),
                "size": was.get("size_bytes"),
                "uploadedAt": was.get("uploaded_at"),
                "removed": {"at": g["occurred_at"].isoformat(), "by": g["by"]},
            }
        )
    return {"files": files}


# ------------------------------------------------------------ everyone's (PMs)

PHOTO_WORDS = {"photo", "photos", "picture", "pictures", "image", "images", "照片", "图片"}
DOC_WORDS = {"document", "documents", "doc", "docs", "pdf", "文件", "文档"}


def _category_matches(word: str) -> list[str]:
    """Slots whose name (in English or Chinese) contains this word."""
    from _lib.i18n import tr

    w = word.lower()
    return [k for k, label in LABEL.items() if w in label.lower() or w in (tr(label, "zh") or "") or w in k]


@router.get("/all-files")
def all_files(
    acct: Account = Depends(pm_only),
    q: str = "",
    kind: str = "all",
    before: int | None = None,
    limit: int = Query(100, ge=1, le=300),
) -> dict[str, Any]:
    """Every project's files, newest first, for project managers. Every word of q must match the
    file name, project, address, uploader, slot or type ("jalan panels", "priya pdf")."""
    where = ["(%(before)s::int is null or f.file_id < %(before)s)"]
    params: dict[str, Any] = {"before": before, "limit": limit + 1, "me": acct.uid}
    # A superadmin sees every project's files; a project manager the projects they run.
    mine = "" if acct.role == "superadmin" else "p.project_manager_id = %(me)s"
    if mine:
        where.append(mine)
    if kind in ("image", "document"):
        where.append("f.kind = %(kind)s")
        params["kind"] = kind
    for i, w in enumerate(q.lower().split()[:8]):
        hay = (
            "concat_ws(' ', f.file_name, p.name, p.address, p.postal_code, u.full_name, u.email, "
            "replace(f.category::text, '_', ' '), f.content_type)"
        )
        cond = f"{hay} ilike %(w{i})s or f.category::text = any(%(c{i})s)"
        if w in PHOTO_WORDS:
            cond += " or f.kind = 'image'"
        if w in DOC_WORDS:
            cond += " or f.kind = 'document'"
        where.append(f"({cond})")
        params[f"w{i}"] = f"%{w}%"
        params[f"c{i}"] = _category_matches(w)
    rows = fetch_all(
        "select f.file_id, f.project_id, f.category::text as category, f.file_name, f.content_type, f.size_bytes, "
        "f.uploaded_at, f.kind, coalesce(nullif(p.name, ''), p.address) as project, "
        "u.uid, u.full_name, u.email, u.user_type, u.avatar_key, u.avatar_updated_at "
        "from project_files f join projects p on p.project_id = f.project_id "
        "left join users u on u.uid = f.uploaded_by "
        f"where {' and '.join(where)} order by f.file_id desc limit %(limit)s",
        params,
    )
    counts = fetch_all(
        "select f.kind, count(*)::int as n from project_files f join projects p on p.project_id = f.project_id "
        f"where {mine or 'true'} group by f.kind",
        {"me": acct.uid},
    )
    from _routes.people import avatar_url

    return {
        "files": [
            {
                "id": r["file_id"],
                "name": r["file_name"],
                "category": r["category"],
                "categoryLabel": LABEL.get(r["category"], r["category"]),
                "projectId": r["project_id"],
                "projectName": r["project"],
                "contentType": r["content_type"],
                "kind": "photo" if r["kind"] == "image" else "document",
                "size": r["size_bytes"],
                "uploadedAt": r["uploaded_at"].isoformat(),
                "removed": None,
                "uploader": {
                    "uid": r["uid"],
                    "name": r["full_name"] or r["email"],
                    "role": r["user_type"],
                    "avatar": avatar_url(r),
                }
                if r["uid"]
                else None,
            }
            for r in rows[:limit]
        ],
        "more": len(rows) > limit,
        "counts": {c["kind"]: c["n"] for c in counts},
    }


# ------------------------------------------------------------ the library (My Files)

GROUP_OF = {f.key: f.group for f in FIELDS}
GROUP_LABEL = {g: label for g, label, _ in GROUPS}


def _person(r: dict[str, Any]) -> dict[str, Any] | None:
    from _routes.people import avatar_url

    if not r["uid"]:
        return None
    return {"uid": r["uid"], "name": r["full_name"] or r["email"], "role": r["user_type"], "avatar": avatar_url(r)}


@router.get("/library")
def library(acct: Account = Depends(active)) -> dict[str, Any]:
    """Every file on every project this person can see, as folders: project, then milestone section,
    then slot. Like a shared drive: everyone on a project sees its files, not only their own uploads.
    Staff (project managers, superadmins) also get the files not on a project yet."""
    from _routes import projects as proj

    projects = proj._load(acct)
    names = {p["id"]: p["name"] for p in projects}
    rows = (
        fetch_all(
            "select f.file_id, f.project_id, f.category::text as category, f.file_name, f.content_type, f.size_bytes, "
            "f.uploaded_at, f.kind, u.uid, u.full_name, u.email, u.user_type, u.avatar_key, u.avatar_updated_at "
            "from project_files f left join users u on u.uid = f.uploaded_by "
            "where f.project_id = any(%s) order by f.uploaded_at desc",
            (list(names),),
        )
        if names
        else []
    )
    files = [
        {
            "id": r["file_id"],
            "name": r["file_name"],
            "category": r["category"],
            "categoryLabel": LABEL.get(r["category"], r["category"]),
            "section": GROUP_OF.get(r["category"]),
            "sectionLabel": GROUP_LABEL.get(GROUP_OF.get(r["category"], ""), ""),
            "projectId": r["project_id"],
            "projectName": names.get(r["project_id"]),
            "contentType": r["content_type"],
            "kind": "photo" if r["kind"] == "image" else "document",
            "size": r["size_bytes"],
            "uploadedAt": r["uploaded_at"].isoformat(),
            "mine": r["uid"] == acct.uid,
            "uploader": _person(r),
        }
        for r in rows
    ]
    staff = acct.role in ("project_manager", "superadmin")
    return {
        "files": files,
        "projects": [{"id": p["id"], "name": p["name"], "status": p["status"]} for p in projects],
        "sections": [{"key": g, "label": label} for g, label, _ in GROUPS],
        "slots": [
            {"key": f.key, "label": f.label, "section": f.group, "kind": f.kind}
            for f in FIELDS
            if f.kind in ("file", "photos")
        ],
        "unassigned": _unassigned() if staff else None,
    }


# ------------------------------------------------------------ files not on a project yet (staff)


def _unassigned() -> list[dict[str, Any]]:
    return [
        {
            "id": r["file_id"],
            "name": r["file_name"],
            "contentType": r["content_type"],
            "kind": "photo" if r["kind"] == "image" else "document",
            "size": r["size_bytes"],
            "note": r["note"],
            "uploadedAt": r["uploaded_at"].isoformat(),
            "uploader": _person(r),
        }
        for r in fetch_all(
            "select f.*, u.uid, u.full_name, u.email, u.user_type, u.avatar_key, u.avatar_updated_at "
            "from unassigned_files f left join users u on u.uid = f.uploaded_by order by f.uploaded_at desc"
        )
    ]


class UnassignedLinkIn(BaseModel):
    contentType: str
    size: int
    fileName: str = ""


class UnassignedIn(BaseModel):
    key: str
    fileName: str = ""
    note: str | None = None


class AssignIn(BaseModel):
    projectId: int
    category: str


@router.post("/unassigned-files/upload-link")
def unassigned_link(body: UnassignedLinkIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Step 1 of an upload with no project yet: a five-minute link locked to the file's type and size."""
    if body.contentType not in storage.ALLOWED_TYPES:
        raise HTTPException(400, "Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be uploaded.")
    if not 0 < body.size <= storage.MAX_BYTES:
        raise HTTPException(400, f"Files must be under {storage.MAX_BYTES // 1024 // 1024} MB.")
    key = storage.unassigned_key(body.contentType)
    try:
        url = storage.upload_link(key, body.contentType, body.size)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc
    sweep.record(key, acct.uid)
    return {"key": key, "uploadUrl": url, "headers": {"Content-Type": body.contentType}}


@router.post("/unassigned-files")
def unassigned_done(body: UnassignedIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Step 2: the upload finished. Only what actually arrived in storage is kept."""
    exts = "|".join(storage.ALLOWED_TYPES.values())
    if not re.fullmatch(rf"unassigned/(images|documents)/[0-9a-f-]{{36}}\.({exts})", body.key):
        raise HTTPException(400, "That upload isn't one of the unassigned files.")
    got = storage.head(body.key)
    if not got:
        raise HTTPException(400, "The file never arrived. Please upload it again.")
    size, ctype = got
    if size > storage.MAX_BYTES or ctype not in storage.ALLOWED_TYPES or f"/{storage.folder(ctype)}/" not in body.key:
        storage.delete(body.key)
        sweep.done(body.key, acct.uid)
        raise HTTPException(400, "That file is too large or not an allowed type.")
    name = (body.fileName or "file").strip()[:200] or "file"
    note = (body.note or "").strip()[:500] or None
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into unassigned_files (url, file_name, content_type, size_bytes, kind, note, uploaded_by) "
            "values (%s, %s, %s, %s, %s, %s, %s) returning file_id",
            (body.key, name, ctype, size, storage.kind_of(ctype), note, acct.uid),
        )
        fid = cur.fetchone()["file_id"]
    sweep.done(body.key, acct.uid)
    return {"id": fid, "message": f"{name} added to Unassigned."}


def _one_unassigned(fid: int) -> dict[str, Any]:
    row = fetch_one("select * from unassigned_files where file_id = %s", (fid,))
    if not row:
        raise HTTPException(404, "No such file. It may have been put on a project already.")
    return row


@router.get("/unassigned-files/{fid}")
def unassigned_view(fid: int, acct: Account = Depends(pm_only), download: bool = False) -> Response:
    row = _one_unassigned(fid)
    try:
        return RedirectResponse(storage.view_link(row["url"], row["file_name"], download), status_code=302)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/unassigned-files/{fid}/assign")
def assign(fid: int, body: AssignIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Puts a file on a project, in the slot (and so the milestone section) it belongs in. The slot must be
    open to this person exactly as for an upload there (the approval stage, milestone locks, handover)."""
    from _routes import project_work as pw

    row = _one_unassigned(fid)
    p = pw._project(body.projectId)
    rel = pw._need(acct, p)
    f = pw._file_field(body.category)
    if f.kind == "photos" and row["kind"] != "image":
        raise HTTPException(400, f"{f.label} takes photos; this file is a document.")
    _, _, reached, recorded = pw._state(p)
    why = pw.why_not_editable(rel, p, f, reached, recorded)
    if why:
        raise HTTPException(403, why)
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, "
            "uploaded_by, kind) values (%s, %s, %s, %s, %s, %s, %s, %s) returning file_id",
            (body.projectId, body.category, row["url"], row["file_name"], row["content_type"], row["size_bytes"],
             row["uploaded_by"] or acct.uid, row["kind"]),
        )  # fmt: skip
        new_id = cur.fetchone()["file_id"]
        cur.execute("delete from unassigned_files where file_id = %s", (fid,))
        pw._start(cur, p)
    done = pw._after_change(body.projectId, acct)
    return {"id": new_id, "message": done or f"{row['file_name']} added to {p['name']}: {f.label}."}


@router.delete("/unassigned-files/{fid}")
def unassigned_remove(fid: int, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Takes a file out of Unassigned. The stored copy is kept, so the audit log can restore it."""
    row = _one_unassigned(fid)
    with transaction(acct.uid) as cur:
        cur.execute("delete from unassigned_files where file_id = %s", (fid,))
    return {"message": f"{row['file_name']} removed. It can be restored from the audit log."}
