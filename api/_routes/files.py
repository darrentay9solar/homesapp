"""My Files: everything the signed-in person has uploaded, on any project.

  GET /my-files   files still on their project (openable), and ones later
                  removed from a project (listed with when and by whom; the
                  stored copy is kept and a PM can restore it from the audit log)

Opening a file still goes through GET /files/{id}, which checks access to
the project at that moment.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from _lib.account import Account
from _lib.db import fetch_all
from _lib.project_fields import FIELDS
from _lib.web import active

router = APIRouter()

LABEL = {f.key: f.label for f in FIELDS}


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
