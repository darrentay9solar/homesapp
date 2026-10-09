"""UAT · uploads: who may add a photo or document to which slot, at every stage.

An upload starts by asking for a five-minute link. The app hands one out only
to someone who may change that slot right now (the same rules as typing into
a field), and refuses anything that isn't a photo or a PDF, or is too big.
Each link handed out is written down so an upload that never finishes can be
cleared away later (uat/test_uat_sweep.py).
"""

from __future__ import annotations

import pytest

from _lib import storage
from uat import spec

pytestmark = pytest.mark.uat

SLOTS = [f for f in spec.FIELDS if f.kind in spec.FILE_KINDS]
GRID = [(a, s, f) for a in spec.ACTORS for s in spec.STATE_KEYS for f in SLOTS]


def _body(f: spec.F, ctype: str | None = None, size: int = 1200) -> dict:
    ctype = ctype or ("image/jpeg" if f.kind == "photos" else "application/pdf")
    return {"category": f.key, "fileName": f"{f.key}.{storage.ALLOWED_TYPES.get(ctype, 'bin')}", "contentType": ctype,
            "size": size}  # fmt: skip


@pytest.mark.parametrize(("actor", "state", "f"), GRID, ids=[f"{a}-{s}-{f.key}" for a, s, f in GRID])
def test_upload_link(api, world, actor, state, f) -> None:
    pid = world.pid[state]
    r = api.post(f"/api/py/projects/{pid}/files/upload-link", headers=world.h(actor), json=_body(f))
    expect = spec.upload_link(actor, state, f)
    assert r.status_code == expect, r.text
    if expect == 200:
        key = r.json()["key"]
        assert key.startswith(f"projects/{pid}/") and f"/{f.key}/" in key, "the server picks where it goes"
        noted = world.conn.execute("select uid from upload_intents where key = %s", (key,)).fetchone()
        assert noted and noted["uid"] == world.uid(actor), "the link is written down until the upload finishes"


BAD = [
    ("text/html", 1200, 400),
    ("application/x-msdownload", 1200, 400),
    ("image/svg+xml", 1200, 400),
    ("application/zip", 1200, 400),
    ("application/pdf", 0, 400),
    ("application/pdf", -5, 400),
    ("application/pdf", storage.MAX_BYTES + 1, 400),
    ("image/jpeg", storage.MAX_BYTES + 1, 400),
    ("application/pdf", storage.MAX_BYTES, 200),
    ("image/heic", 4_000_000, 200),
    ("image/webp", 300_000, 200),
    ("image/png", 1, 200),
]


@pytest.mark.parametrize("actor", ["pm", "sa", "crew_admin", "crew_epc", "assigned_epc"])
@pytest.mark.parametrize(("ctype", "size", "expect"), BAD, ids=[f"{c}-{s}" for c, s, _ in BAD])
def test_only_photos_and_pdfs_under_the_limit(api, world, actor, ctype, size, expect) -> None:
    f = next(x for x in SLOTS if x.key == "utility_bill")
    # Milestone 1 is recorded on in_progress_m1, so the crew uses the project where it's still open.
    state = "in_progress_m0" if actor in spec.CREW else "in_progress_m1"
    r = api.post(
        f"/api/py/projects/{world.pid[state]}/files/upload-link", headers=world.h(actor), json=_body(f, ctype, size)
    )
    assert r.status_code == expect, r.text


@pytest.mark.parametrize("category", ["", "nonsense", "projects", "../utility_bill", "sales", "homeowner.email"])
def test_unknown_slots_are_refused(api, world, category) -> None:
    r = api.post(
        f"/api/py/projects/{world.pid['in_progress_m0']}/files/upload-link",
        headers=world.h("pm"),
        json={"category": category, "fileName": "x.pdf", "contentType": "application/pdf", "size": 100},
    )
    assert r.status_code == 400, r.text


@pytest.mark.parametrize(
    "key",
    [
        "projects/1/documents/utility_bill/00000000-0000-0000-0000-000000000000.pdf",
        "profiles/1/images/00000000-0000-0000-0000-000000000000.jpg",
        "projects/{pid}/documents/gst_proof/00000000-0000-0000-0000-000000000000.pdf",
        "projects/{pid}/documents/utility_bill/../../x.pdf",
        "projects/{pid}/documents/utility_bill/not-a-uuid.pdf",
        "projects/{pid}/documents/utility_bill/00000000-0000-0000-0000-000000000000.exe",
    ],
)
def test_a_finished_upload_must_be_this_projects_own_slot(api, world, key) -> None:
    pid = world.pid["in_progress_m0"]
    r = api.post(
        f"/api/py/projects/{pid}/files",
        headers=world.h("pm"),
        json={"category": "utility_bill", "key": key.format(pid=pid), "fileName": "x.pdf"},
    )
    assert r.status_code == 400, r.text


def test_a_file_that_never_arrived_is_not_recorded(api, world) -> None:
    pid = world.pid["in_progress_m0"]
    link = api.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=world.h("crew_epc"),
        json=_body(next(x for x in SLOTS if x.key == "gst_proof")),
    ).json()
    r = api.post(
        f"/api/py/projects/{pid}/files",
        headers=world.h("crew_epc"),
        json={"category": "gst_proof", "key": link["key"], "fileName": "gst.pdf"},
    )
    assert r.status_code == 400 and "never arrived" in r.json()["error"]
