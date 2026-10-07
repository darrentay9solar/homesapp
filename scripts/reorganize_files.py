# ruff: noqa: E501
"""Moves project files stored the old way into folders by type, and updates the database to match.

    node scripts/py.mjs scripts/reorganize_files.py --target dev
    node scripts/py.mjs scripts/reorganize_files.py --target prod --confirm

Before:  projects/12/panel_pictures/<uuid>.png
After:   projects/12/images/panel_pictures/<uuid>.png   (documents/ for PDFs)

For each file on a project: copy to the new place, check it arrived, point
project_files.url at it and set project_files.kind (one database change per
file, recorded in the audit log), then delete the old copy. Files that were
removed from a project stay where they are, so restoring one from the audit
log still finds it. Safe to run again: anything already moved is skipped.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import httpx
import psycopg
from psycopg.rows import dict_row

from _lib import storage
from _lib.db import _from_env_file

OLD = re.compile(r"^projects/(\d+)/([a-z_]+)/([0-9a-f-]{36}\.[a-z]+)$")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["dev", "prod"], required=True)
    ap.add_argument("--confirm", action="store_true")
    a = ap.parse_args()
    env = _from_env_file
    if a.target == "prod":
        if not a.confirm:
            sys.exit("Production: add --confirm.")
        url, kid, sec, bucket = (
            env("PROD_MIGRATION_DATABASE_URL"),
            env("PROD_R2_ACCESS_KEY_ID"),
            env("PROD_R2_SECRET_ACCESS_KEY"),
            "gethomeapps-prod",
        )
    else:
        url, kid, sec, bucket = (
            env("MIGRATION_DATABASE_URL"),
            env("R2_ACCESS_KEY_ID"),
            env("R2_SECRET_ACCESS_KEY"),
            env("R2_BUCKET"),
        )
    if not (url and kid and sec and bucket and env("R2_ACCOUNT_ID")):
        sys.exit("Missing settings in .env.local (database URL or that bucket's R2 keys). Nothing was changed.")
    cfg = storage.R2(env("R2_ACCOUNT_ID"), kid, sec, bucket)
    http = httpx.Client(timeout=60)

    moved = skipped = 0
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        c.execute("select set_config('app.actor_uid', '', false)")
        for f in c.execute("select file_id, url, content_type from project_files order by file_id").fetchall():
            m = OLD.match(f["url"])
            if not m:
                skipped += 1
                continue
            pid, cat, name = m.groups()
            new = f"projects/{pid}/{storage.folder(f['content_type'])}/{cat}/{name}"
            got = http.get(storage._sign(cfg, "GET", f["url"], 120, {}, {}))
            if got.status_code != 200:
                print(f"  ! file {f['file_id']}: the stored copy is missing ({got.status_code}); left as it is")
                continue
            ctype = got.headers.get("content-type") or f["content_type"] or "application/octet-stream"
            put = http.put(
                storage._sign(
                    cfg, "PUT", new, 120, {"content-type": ctype, "content-length": str(len(got.content))}, {}
                ),
                content=got.content,
                headers={"content-type": ctype},
            )
            check = http.head(storage._sign(cfg, "HEAD", new, 60, {}, {}))
            if put.status_code != 200 or check.status_code != 200:
                print(f"  ! file {f['file_id']}: couldn't copy it ({put.status_code}); left as it is")
                continue
            c.execute(
                "update project_files set url = %s, kind = %s where file_id = %s",
                (new, storage.kind_of(f["content_type"]), f["file_id"]),
            )
            http.delete(storage._sign(cfg, "DELETE", f["url"], 60, {}, {}))
            moved += 1
    print(f"{bucket}: moved {moved} files into images/ and documents/; {skipped} were already in place.")


if __name__ == "__main__":
    main()
