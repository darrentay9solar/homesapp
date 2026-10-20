"""Projects → Import from Excel: 9 Solar Home's project list (the client workbook), uploaded in the app.

  POST /import/client-list?apply=0   check it: what it would add and change, and anything that stops it
  POST /import/client-list?apply=1   write it (the same checks first)

The body is the .xlsx file itself. A superadmin's alone: it adds projects and
maintenance systems for anyone. It runs the import the command line runs
(_lib/client_list.py): the duplicate check first (postal codes above all,
then addresses and project codes, in the file and against what's in the
app), and nothing is written if anything stops it. A check (apply=0) writes
inside a transaction and rolls it back, so it shows exactly what an import
would do. Every row written is in the audit log under the person importing.
"""

from __future__ import annotations

import re
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from _lib import client_list as cl
from _lib.account import Account
from _lib.db import transaction
from _lib.web import role

router = APIRouter()
superadmin_only = role("superadmin")
MAX_BYTES = 4 * 1024 * 1024  # under the hosting's request limit; the list is a few hundred KB


class _CheckOnlyError(Exception):
    """Raised after a check's writes, so the transaction rolls them back."""


@router.post("/import/client-list")
async def import_client_list(
    request: Request,
    acct: Account = Depends(superadmin_only),
    apply: bool = False,
    list_date: str | None = Query(None, alias="listDate"),
    file_name: str = Query("", alias="fileName"),
    allow_shared_postal: bool = Query(False, alias="allowSharedPostal"),
) -> dict[str, Any]:
    data = await request.body()
    if not data:
        raise HTTPException(400, "Choose the project list (.xlsx) to import.")
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "That file is over 4 MB. Is it the project list?")
    if not data.startswith(b"PK"):
        raise HTTPException(400, "That isn't an Excel workbook (.xlsx).")
    # The list's date: given, or in its name ("…-2026-10-14.xlsx"); else today.
    # Months written without a year are read in it.
    m = re.search(r"(\d{4}-\d{2}-\d{2})", list_date or file_name or "")
    try:
        ref = date.fromisoformat(m.group(1)) if m else date.today()
    except ValueError as exc:
        raise HTTPException(400, "The list's date isn't a date.") from exc
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "list.xlsx"
        path.write_bytes(data)
        try:
            wb = cl.read(path, ref)
        except cl.RowError as exc:
            raise HTTPException(400, f"Nothing imported. {exc}") from exc
        except Exception as exc:  # not a workbook openpyxl can read
            raise HTTPException(400, "That file couldn't be read as the project list.") from exc
    counts: cl.Counts | None = None
    try:
        with transaction(acct.uid) as cur:
            counts = cl.write(cur, wb, date.today(), geocode=apply, allow_shared_postal=allow_shared_postal)
            if not apply:
                raise _CheckOnlyError
    except _CheckOnlyError:
        pass
    except cl.RowError as exc:
        raise HTTPException(400, f"Nothing imported. {exc}") from exc
    assert counts is not None
    on = sum(1 for c in wb.clients if c.turned_on)
    return {
        "applied": apply,
        "listDate": ref.isoformat(),
        "clients": len(wb.clients),
        "turnedOn": on,
        "notTurnedOn": len(wb.clients) - on,
        "counts": {
            "projectsAdded": counts.projects_added,
            "projectsUpdated": counts.projects_updated,
            "systemsAdded": counts.systems_added,
            "systemsUpdated": counts.systems_updated,
            "outputMonths": counts.output_months,
            "billingMonths": counts.billing_months,
            "feedback": counts.feedback,
            "warranties": counts.warranties,
        },
        "notes": wb.notes + counts.notes,
    }
