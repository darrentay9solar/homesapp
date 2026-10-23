"""Installed photos from 9 Solar Home's shared folders, into each project's panel and inverter pictures.

The folders are named by project code and address ("9SH0001-23 Lorong Biawak", sometimes with
" - Completed" after it). Each is matched to its project by the code: the record project of the
maintenance system with that code (client_list.record_projects), else the project with it. The address
must agree too (the same house number and street), or nothing goes into that project. A photo goes into
Installed Inverter Pictures when its name or subfolder says inverter, else Installed Panel Pictures. One
already on the project (the same name and size) isn't uploaded twice.

The browser uploads each photo itself (straight to storage, as for any project file); this only decides
where each one goes.
"""

from __future__ import annotations

import re
from typing import Any

from _lib import storage
from _lib.db import fetch_all

FOLDER = re.compile(r"^(9SH\d{4,})\s*-\s*(.*?)(?:\s*-\s*completed)?\s*$", re.IGNORECASE)
# The spellings the folders and the lists use for the same words.
WORDS = {
    "lor": "lorong", "rd": "road", "ave": "avenue", "cres": "crescent", "dr": "drive", "st": "street",
    "jln": "jalan", "height": "heights", "llmu": "ilmu", "terr": "terrace", "pl": "place", "cl": "close",
    "gr": "grove",
}  # fmt: skip


def parse_folder(name: str) -> tuple[str, str] | None:
    """("9SH0001", "23 Lorong Biawak") from "9SH0001-23 Lorong Biawak - Completed"."""
    m = FOLDER.match(name.strip())
    return (m.group(1).upper(), m.group(2).strip()) if m else None


def _words(address: str) -> list[str]:
    a = re.sub(r"#\S*|singapore\s*\d{6}|\(?s\)?\s*\d{6}", " ", address.lower())
    return [WORDS.get(w, w) for w in re.findall(r"[a-z0-9]+", a)]


def same_place(folder_address: str, address: str) -> bool:
    """The same house number and street, however each writes it ("Lor 101 Changi" is "Lorong 101 Changi")."""
    a, b = _words(folder_address), _words(address)
    return len(a) >= 2 and a == b[: len(a)]


def category(path: str) -> str:
    return "inverter_pictures" if "inverter" in path.lower() else "panel_pictures"


def plan(folders: list[dict[str, Any]]) -> dict[str, Any]:
    """What happens to each folder and photo: the project it goes to, or why not."""
    parsed = {f["folder"]: parse_folder(f["folder"]) for f in folders}
    codes = [p[0] for p in parsed.values() if p]
    found: dict[str, dict[str, Any]] = {}
    if codes:
        # A system's record project first: that's where a system from the lists keeps its project record.
        for r in fetch_all(
            "select m.project_code as code, p.project_id, p.name, p.address, p.status::text as status "
            "from maintenance_systems m join projects p on p.project_id = m.project_id where m.project_code = any(%s)",
            (codes,),
        ):
            found[r["code"]] = r
        for r in fetch_all(
            "select project_code as code, project_id, name, address, status::text as status from projects "
            "where project_code = any(%s)",
            (codes,),
        ):
            found.setdefault(r["code"], r)
    pids = [r["project_id"] for r in found.values()]
    have = {
        (r["project_id"], r["file_name"], r["size_bytes"])
        for r in fetch_all(
            "select project_id, file_name, size_bytes from project_files where project_id = any(%s)", (pids or [0],)
        )
    }
    out, seen_codes = [], set()
    for f in folders:
        p = parsed[f["folder"]]
        row: dict[str, Any] = {"folder": f["folder"], "code": p[0] if p else None, "project": None, "problem": None}
        row["files"] = []
        r = found.get(p[0]) if p else None
        if not p:
            row["problem"] = "The folder's name doesn't start with a project code (9SH…)."
        elif p[0] in seen_codes:
            row["problem"] = "Another folder has the same project code."
        elif not r:
            row["problem"] = "No project or maintenance system has this project code."
        elif not same_place(p[1], r["address"]):
            row["problem"] = "The project with this code is at another address."
        if p:
            seen_codes.add(p[0])
        if r and not row["problem"]:
            row["project"] = {"id": r["project_id"], "name": r["name"], "status": r["status"]}
        twice: set[tuple[str, int]] = set()
        for x in f["files"]:
            item = {"path": x["path"], "category": category(x["path"]), "skip": None}
            same = (x["name"], int(x.get("size") or 0))
            if x.get("type") not in storage.ALLOWED_TYPES or not str(x.get("type", "")).startswith("image/"):
                item["skip"] = "Not a photo"
            elif not 0 < int(x.get("size") or 0) <= storage.MAX_BYTES:
                item["skip"] = "Too large"
            elif r and (r["project_id"], *same) in have:
                item["skip"] = "Already uploaded"
            elif same in twice:
                item["skip"] = "The same photo twice in the folder"
            twice.add(same)
            row["files"].append(item)
        out.append(row)
    ready = [x for row in out if row["project"] for x in row["files"] if not x["skip"]]
    return {
        "folders": out,
        "matched": sum(1 for row in out if row["project"]),
        "photos": len(ready),
        "panels": sum(1 for x in ready if x["category"] == "panel_pictures"),
        "inverters": sum(1 for x in ready if x["category"] == "inverter_pictures"),
    }
