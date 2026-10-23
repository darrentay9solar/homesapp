# ruff: noqa: E501  (SQL reads better whole)
"""Files installed photos uploaded to Unassigned (My Files) into their projects, using the zip they came from.

    node scripts/py.mjs scripts/sort_unassigned_photos.py "<photos.zip>" --target prod --dry-run
    node scripts/py.mjs scripts/sort_unassigned_photos.py "<photos.zip>" --target prod --confirm

Uploading the zip's photos to Unassigned keeps each file's name but not its folder
("9SH0001-23 Lorong Biawak/1.jpeg" arrives as "1.jpeg"). The zip still has the folders: each
uploaded photo is found in it by its name and exact size, and must be found once, in one folder.
That folder's project code gives the project (a maintenance system's record project first, as
api/_lib/photo_import.py does) and the address must agree; "inverter" in its path makes it an
Installed Inverter Picture, else an Installed Panel Picture. Each is moved as Projects' own
"assign" does: the same stored file, now on the project, under the person who uploaded it (so
the audit log shows them). Anything that doesn't match once is left in Unassigned and listed.
Prints only counts, file numbers and project codes.
"""

from __future__ import annotations

import argparse
import os
import sys
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import psycopg
from psycopg.rows import dict_row

from _lib.db import _from_env_file
from _lib.photo_import import category, parse_folder, same_place

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("zip", type=Path)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--confirm", action="store_true", help="required for production")
    a = ap.parse_args()
    if a.target == "prod" and not (a.confirm or a.dry_run):
        sys.exit("Refusing to change production without --confirm. Try --dry-run first.")

    where: dict[tuple[str, int], list[tuple[str, str, str]]] = {}
    for i in zipfile.ZipFile(a.zip).infolist():
        if i.is_dir():
            continue
        parts = i.filename.split("/")
        k = next((j for j, p in enumerate(parts) if parse_folder(p)), None)
        if k is None:
            continue
        code, addr = parse_folder(parts[k])  # type: ignore[misc]
        where.setdefault((parts[-1], i.file_size), []).append((code, addr, "/".join(parts[k + 1 :])))

    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't set in .env.local.")
    with psycopg.connect(url, row_factory=dict_row) as c:
        files = c.execute("select * from unassigned_files where kind = 'image' order by file_id").fetchall()
        codes = {code for v in where.values() for code, _, _ in v}
        target: dict[str, dict] = {}
        for r in c.execute(
            "select m.project_code as code, p.project_id, p.address from maintenance_systems m join projects p on p.project_id = m.project_id where m.project_code = any(%s)",
            (list(codes),),
        ):
            target[r["code"]] = r
        for r in c.execute(
            "select project_code as code, project_id, address from projects where project_code = any(%s)",
            (list(codes),),
        ):
            target.setdefault(r["code"], r)
        have = {
            (r["project_id"], r["file_name"], r["size_bytes"])
            for r in c.execute("select project_id, file_name, size_bytes from project_files")
        }

        moved: Counter[str] = Counter()
        left: list[str] = []
        for f in files:
            found = where.get((f["file_name"], f["size_bytes"]), [])
            if len({code for code, _, _ in found}) != 1:
                left.append(f"file#{f['file_id']} ({'not in the zip' if not found else 'in several folders'})")
                continue
            code, addr, path = found[0]
            t = target.get(code)
            if not t:
                left.append(f"file#{f['file_id']} ({code}: no project or system)")
                continue
            if not same_place(addr, t["address"]):
                left.append(f"file#{f['file_id']} ({code}: another address)")
                continue
            if (t["project_id"], f["file_name"], f["size_bytes"]) in have:
                left.append(f"file#{f['file_id']} ({code}: already on the project)")
                continue
            cat = category(path)
            # As the person who uploaded it, so the audit log says who.
            c.execute("select set_config('app.actor_uid', %s, true)", (str(f["uploaded_by"] or ""),))
            c.execute(
                "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by, kind, uploaded_at) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    t["project_id"],
                    cat,
                    f["url"],
                    f["file_name"],
                    f["content_type"],
                    f["size_bytes"],
                    f["uploaded_by"],
                    f["kind"],
                    f["uploaded_at"],
                ),
            )
            c.execute("delete from unassigned_files where file_id = %s", (f["file_id"],))
            have.add((t["project_id"], f["file_name"], f["size_bytes"]))
            moved[cat] += 1
            moved[f"code:{code}"] += 1
        if a.dry_run:
            c.rollback()
        else:
            c.commit()
    n = moved["panel_pictures"] + moved["inverter_pictures"]
    print(
        f"{a.target}: {len(files)} photos in Unassigned; {n} {'would be' if a.dry_run else ''} filed into {sum(1 for k in moved if k.startswith('code:'))} projects "
        f"({moved['panel_pictures']} panel, {moved['inverter_pictures']} inverter); {len(left)} left in Unassigned."
    )
    for x in left[:30]:
        print("  left:", x)
    if a.dry_run:
        print("Dry run: rolled back, nothing changed.")


if __name__ == "__main__":
    main()
