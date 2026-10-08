"""Files: what you've uploaded, and (for project managers) everyone's.

  GET /my-files    files still on their project (openable), and ones later
                   removed from a project (listed with when and by whom; the
                   stored copy is kept and a PM can restore it from the audit log)
  GET /all-files   project managers: every project's files, searchable, 100 at a time

Opening a file still goes through GET /files/{id}, which checks access to
the project at that moment.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from _lib.account import Account
from _lib.db import fetch_all
from _lib.project_fields import FIELDS
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
