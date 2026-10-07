"""Uploading pictures and documents: several hundred cases, against the real API and storage.

Groups (each case is one pytest test):
  signing      AWS Signature V4 against Amazon's published example; every input matters
  tokens       local storage links: genuine, tampered, expired, malformed
  paths        keys that try to escape the storage folder
  accept       every allowed file type into every upload slot
  reject       disallowed types, sizes and slots
  roundtrip    link -> upload -> confirm -> download, bytes compared
  tamper       uploads that differ from what was approved
  forged       confirmations for keys that weren't issued, or files that never arrived
  matrix       who may upload, by role x project stage x section
  access       viewing and removing files
  photos       many photos in one slot, and the section's count
"""

from __future__ import annotations

import base64
import json
import shutil
import time
import uuid
from datetime import UTC, datetime
from itertools import product

import pytest
from fastapi.testclient import TestClient

from _lib import storage
from conftest import bearer, owner_conn

TYPES = {
    "image/jpeg": b"\xff\xd8\xff\xe0" + b"J" * 32,
    "image/png": b"\x89PNG\r\n\x1a\n" + b"P" * 32,
    "image/webp": b"RIFF\x00\x00\x00\x00WEBP" + b"W" * 32,
    "image/heic": b"\x00\x00\x00\x18ftypheic" + b"H" * 32,
    "image/heif": b"\x00\x00\x00\x18ftypmif1" + b"F" * 32,
    "application/pdf": b"%PDF-1.4\n" + b"D" * 32,
}
M1_SLOTS = [
    "utility_bill",
    "moc_change",
    "gst_proof",
    "sp_forms_signed",
    "panel_pictures",
    "inverter_pictures",
    "sp_submission_screenshot",
]
BAD_TYPES = [
    "text/html",
    "image/svg+xml",
    "application/zip",
    "application/x-msdownload",
    "text/plain",
    "video/mp4",
    "application/octet-stream",
    "image/gif",
    "application/msword",
    "text/javascript",
    "application/json",
    "image/bmp",
    "image/tiff",
    "application/vnd.ms-excel",
    "",
]
MB = 1024 * 1024


# ------------------------------------------------------------------ the world


class World:
    """People and projects for every case, made once for the module."""

    def __init__(self) -> None:
        self.c = owner_conn()
        tag = uuid.uuid4().hex[:6]
        mk = lambda role, name: self.c.execute(  # noqa: E731
            "insert into users (email, user_type, full_name, clerk_user_id) values (%s, %s, %s, %s) returning *",
            (f"pytest-up-{role}-{uuid.uuid4().hex[:6]}@example.com", role, name, f"user_up_{uuid.uuid4().hex[:10]}"),
        ).fetchone()
        self.u = {
            "pm": mk("project_manager", "Up PM"),
            "admin": mk("contractor", "Up Admin"),
            "epc": mk("epc_team", "Up EPC"),
            "outsider_c": mk("contractor", "Up Outsider C"),
            "outsider_e": mk("epc_team", "Up Outsider E"),
            "own_ho": mk("homeowner", "Up Homeowner"),
            "other_ho": mk("homeowner", "Up Other Homeowner"),
        }
        self.c.execute("update users set ic_last4 = '567D' where uid = %s", (self.u["own_ho"]["uid"],))
        self.group = self.c.execute(
            "insert into contractor_groups (name) values (%s) returning group_id", (f"pytest up {tag}",)
        ).fetchone()["group_id"]
        for r in ("admin", "epc"):
            self.c.execute(
                "insert into contractor_group_members (group_id, user_id) values (%s, %s)",
                (self.group, self.u[r]["uid"]),
            )
        self.sp = self.c.execute("select retailer_id from electricity_retailers where name = 'SP Group'").fetchone()[
            "retailer_id"
        ]
        self.p: dict[str, int] = {}
        for state in (
            "draft",
            "awaiting_homeowner",
            "homeowner_declined",
            "homeowner_approved",
            "pm_approved",
            "m1",
            "m2",
            "work",
        ):
            self.p[state] = self._project(state)

    def _project(self, state: str) -> int:
        status = {"m1": "in_progress", "m2": "in_progress", "work": "pm_approved"}.get(state, state)
        draft = state == "draft"
        pid = self.c.execute(
            "insert into projects (name, address, postal_code, site_lat, site_lng, homeowner_id, homeowner_name, "
            "homeowner_contact_no, contractor_group_id, project_manager_id, installation_start_date, target_end_date, "
            "status) values (%s, '1 Test Road', '569933', 1.3691, 103.8486, %s, %s, '+65 9000 0000', %s, %s, "
            "current_date, current_date + 21, %s) returning project_id",
            (
                f"pytest up {state}",
                None if draft else self.u["own_ho"]["uid"],
                "Typed Name" if draft else None,
                self.group,
                self.u["pm"]["uid"],
                status,
            ),
        ).fetchone()["project_id"]
        if state in ("m1", "m2"):
            self.c.execute(
                "update projects set electricity_retailer_id = %s, sp_application_status = 1, sales = 'S', "
                "waterproofing = true, create_group_chat = true, panel_quantity_estimate = 20, panel_capacity = 610, "
                "inverter_to_order = 'Inv', inverter_collected = true, inverter_serial_number = 'SN', "
                "current_stage = 2, installation_end_date = current_date, scaffolding_removal = true, "
                "scaffolding_removal_date = current_date, "
                "sp_submission_date = current_date where project_id = %s",
                (self.sp, pid),
            )
            cats = [
                "utility_bill",
                "gst_proof",
                "sp_forms_signed",
                "panel_pictures",
                "inverter_pictures",
                "sp_submission_screenshot",
            ]
            if state == "m2":
                self.c.execute(
                    "update projects set inverter_commission_grid_connection = true, rcb_breaker_replacement = false, "
                    "pvl_received_date = current_date where project_id = %s",
                    (pid,),
                )
                cats.append("pvl_letter")
            for cat in cats:
                self.c.execute(
                    "insert into project_files (project_id, category, url, file_name) values (%s, %s, %s, %s)",
                    (pid, cat, f"projects/{pid}/{cat}/seed.pdf", f"{cat}.pdf"),
                )
            for n in (1,) if state == "m1" else (1, 2):
                self.c.execute("insert into project_milestones (project_id, milestone_no) values (%s, %s)", (pid, n))
        return pid

    def close(self) -> None:
        ids = list(self.p.values())
        for pid in ids:
            shutil.rmtree(storage.LOCAL_DIR / "projects" / str(pid), ignore_errors=True)
        self.c.execute("delete from projects where project_id = any(%s)", (ids,))
        self.c.execute("delete from contractor_group_members where group_id = %s", (self.group,))
        self.c.execute("delete from contractor_groups where group_id = %s", (self.group,))
        uids = [u["uid"] for u in self.u.values()]
        self.c.execute(
            "delete from users u where uid = any(%s) and not exists "
            "(select 1 from audit_log a where a.actor_uid = u.uid)",
            (uids,),
        )
        self.c.execute("update users set active = false, clerk_user_id = null where uid = any(%s)", (uids,))
        self.c.close()


@pytest.fixture(scope="module")
def world():
    w = World()
    yield w
    w.close()


@pytest.fixture(scope="module")
def api():
    import index

    with TestClient(index.app) as c:
        yield c


def H(w: World, role: str) -> dict[str, str]:  # noqa: N802
    return bearer(w.u[role]["clerk_user_id"])


def link(api, w, role, pid, category, ctype="image/png", size=40, name="photo.png"):
    return api.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=H(w, role),
        json={"category": category, "fileName": name, "contentType": ctype, "size": size},
    )


def upload(api, w, role, pid, category, data, ctype, name="file"):
    lk = link(api, w, role, pid, category, ctype, len(data), name)
    assert lk.status_code == 200, lk.text
    put = api.put(lk.json()["uploadUrl"], content=data, headers={"Content-Type": ctype})
    assert put.status_code == 200, put.text
    done = api.post(
        f"/api/py/projects/{pid}/files",
        headers=H(w, role),
        json={"category": category, "key": lk.json()["key"], "fileName": name},
    )
    return lk.json()["key"], done


# ----------------------------------------------------------------- signing

AWS = {
    "method": "GET",
    "host": "examplebucket.s3.amazonaws.com",
    "path": "/test.txt",
    "region": "us-east-1",
    "key_id": "AKIAIOSFODNN7EXAMPLE",
    "secret": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "seconds": 86400,
    "headers": {},
    "query": {},
    "now": datetime(2013, 5, 24, tzinfo=UTC),
}


def sig(url: str) -> str:
    return url.split("X-Amz-Signature=")[1]


def test_signing_matches_amazons_published_example() -> None:
    assert sig(storage.presign(**AWS)) == "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"


def test_signing_is_deterministic() -> None:
    assert storage.presign(**AWS) == storage.presign(**AWS)


@pytest.mark.parametrize(
    "change",
    [
        {"method": "PUT"},
        {"path": "/other.txt"},
        {"seconds": 300},
        {"secret": "x" + AWS["secret"]},
        {"key_id": "AKIAOTHER"},
        {"now": datetime(2013, 5, 25, tzinfo=UTC)},
        {"region": "auto"},
        {"headers": {"content-type": "image/png"}},
        {"headers": {"content-length": "10"}},
        {"query": {"response-content-disposition": "inline"}},
        {"host": "other.r2.cloudflarestorage.com"},
    ],
)
def test_every_input_changes_the_signature(change) -> None:
    assert sig(storage.presign(**{**AWS, **change})) != sig(storage.presign(**AWS))


def test_upload_link_signs_type_and_size() -> None:
    url = storage.presign(**{**AWS, "method": "PUT", "headers": {"Content-Type": "image/png", "Content-Length": "9"}})
    assert "X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost" in url


@pytest.mark.real_r2
def test_r2_links_use_the_bucket_path_and_expire_in_five_minutes(monkeypatch) -> None:
    for k, v in {
        "R2_ACCOUNT_ID": "acct",
        "R2_ACCESS_KEY_ID": "id",
        "R2_SECRET_ACCESS_KEY": "s",
        "R2_BUCKET": "b",
    }.items():
        monkeypatch.setenv(k, v)
    assert storage.mode() == "r2"
    up = storage.upload_link("projects/1/gst_proof/a.pdf", "application/pdf", 10)
    view = storage.view_link("projects/1/gst_proof/a.pdf", "GST proof.pdf")
    assert up.startswith("https://acct.r2.cloudflarestorage.com/b/projects/1/gst_proof/a.pdf?")
    assert "X-Amz-Expires=300" in up and "X-Amz-Expires=300" in view
    assert "response-content-disposition=inline" in view and "GST%2520proof.pdf" in view


def test_storage_mode_follows_the_environment(monkeypatch) -> None:
    monkeypatch.setattr(storage, "_r2", lambda: None)
    monkeypatch.delenv("VERCEL", raising=False)
    assert storage.mode() == "local"
    monkeypatch.setenv("VERCEL", "1")
    assert storage.mode() is None
    with pytest.raises(storage.StorageNotConfiguredError):
        storage.upload_link("projects/1/x/a.png", "image/png", 1)


# ------------------------------------------------------------------ tokens


def _tok(op="put", exp=60.0, **extra) -> str:
    return storage._token({"op": op, "key": "projects/1/gst_proof/a.pdf", "exp": time.time() + exp, **extra})


@pytest.mark.parametrize("op", ["put", "get"])
def test_genuine_token_reads_back(op) -> None:
    assert storage.read_token(_tok(op))["op"] == op


@pytest.mark.parametrize("pos", range(10))
def test_tampered_token_body_is_refused(pos) -> None:
    body, s = _tok().rsplit(".", 1)
    i = (pos * 7) % len(body)
    flipped = body[:i] + ("A" if body[i] != "A" else "B") + body[i + 1 :]
    assert storage.read_token(f"{flipped}.{s}") is None


@pytest.mark.parametrize("pos", range(10))
def test_tampered_token_signature_is_refused(pos) -> None:
    body, s = _tok().rsplit(".", 1)
    i = (pos * 3) % len(s)
    assert storage.read_token(f"{body}.{s[:i]}{'0' if s[i] != '0' else '1'}{s[i + 1:]}") is None


@pytest.mark.parametrize("ago", [1, 60, 3600, 86400])
def test_expired_token_is_refused(ago) -> None:
    assert storage.read_token(_tok(exp=-ago)) is None


def test_forged_token_with_a_made_up_signature_is_refused() -> None:
    body = base64.urlsafe_b64encode(json.dumps({"op": "put", "key": "x", "exp": time.time() + 60}).encode()).decode()
    assert storage.read_token(f"{body.rstrip('=')}.{'0' * 32}") is None


@pytest.mark.parametrize("bad", ["", ".", "abc", "a.b.c", "!!!.???", "e30.", ".deadbeef", "x" * 500])
def test_malformed_token_is_refused(bad) -> None:
    assert storage.read_token(bad) is None


# ------------------------------------------------------------------- paths


@pytest.mark.parametrize(
    "key",
    [
        "../secret.txt",
        "projects/../../x",
        "projects/1/../../../etc/passwd",
        "/etc/passwd",
        "..",
        "../.uploads2/x",
        "projects/1/gst_proof/../../../../x",
        "C:/Windows/win.ini",
        "\\\\server\\share\\x",
        "projects/..\\..\\x",
    ],
)
def test_keys_cannot_escape_the_storage_folder(key) -> None:
    with pytest.raises(ValueError):
        storage.local_path(key)


@pytest.mark.parametrize(
    "key",
    [
        "projects/1/gst_proof/a.pdf",
        "projects/99/panel_pictures/b.png",
        "a",
        "x/y/z.jpg",
        "projects/1/handover_docs/" + "n" * 50 + ".pdf",
    ],
)
def test_ordinary_keys_stay_inside_it(key) -> None:
    assert storage.LOCAL_DIR.resolve() in storage.local_path(key).parents


# ------------------------------------------------------------------ accept


@pytest.mark.parametrize(("ctype", "slot"), list(product(TYPES, M1_SLOTS)))
def test_every_allowed_type_is_accepted_in_every_open_slot(api, world, ctype, slot) -> None:
    r = link(api, world, "epc", world.p["work"], slot, ctype, 1000)
    assert r.status_code == 200, r.text
    key = r.json()["key"]
    assert key.startswith(f"projects/{world.p['work']}/{slot}/") and key.endswith("." + storage.ALLOWED_TYPES[ctype])
    assert r.json()["headers"] == {"Content-Type": ctype}


# ------------------------------------------------------------------ reject


@pytest.mark.parametrize(("ctype", "slot"), list(product(BAD_TYPES, ["gst_proof", "panel_pictures"])))
def test_disallowed_types_are_refused(api, world, ctype, slot) -> None:
    r = link(api, world, "epc", world.p["work"], slot, ctype, 1000)
    assert r.status_code == 400 and "Only photos" in r.json()["error"]


@pytest.mark.parametrize(
    ("size", "ok"),
    [(0, False), (-1, False), (1, True), (1024, True), (25 * MB, True), (25 * MB + 1, False), (100 * MB, False)],
)
@pytest.mark.parametrize("ctype", ["image/jpeg", "application/pdf"])
def test_size_limit_is_25_mb(api, world, size, ok, ctype) -> None:
    r = link(api, world, "epc", world.p["work"], "gst_proof", ctype, size)
    assert r.status_code == (200 if ok else 400), r.text


@pytest.mark.parametrize(
    "slot", ["photos", "", "PANEL_PICTURES", "../gst_proof", "pvl letter", "sales", "signature", "sp_pending_days"]
)
def test_unknown_slots_are_refused(api, world, slot) -> None:
    assert link(api, world, "epc", world.p["work"], slot).status_code == 400


# --------------------------------------------------------------- roundtrip


@pytest.mark.parametrize(("ctype", "size"), list(product(TYPES, [1, 100, 4096, 65536, 1_000_000])))
def test_upload_then_download_returns_the_same_bytes(api, world, ctype, size) -> None:
    data = (TYPES[ctype] * (size // len(TYPES[ctype]) + 1))[:size]
    pid = world.p["work"]
    key, done = upload(api, world, "epc", pid, "panel_pictures", data, ctype, f"t{size}.bin")
    assert done.status_code == 200, done.text
    view = api.get(f"/api/py/files/{done.json()['id']}", headers=H(world, "own_ho"), follow_redirects=False)
    assert view.status_code == 302
    got = api.get(view.headers["location"])
    assert got.status_code == 200 and got.content == data and got.headers["content-type"].startswith(ctype)
    row = world.c.execute(
        "select size_bytes, content_type, url from project_files where file_id = %s", (done.json()["id"],)
    ).fetchone()
    assert (row["size_bytes"], row["content_type"], row["url"]) == (size, ctype, key)


@pytest.mark.parametrize(
    ("name", "stored"),
    [
        ("Utility Bill June.pdf", "Utility Bill June.pdf"),
        ("单据.pdf", "单据.pdf"),
        ("Résumé façade.pdf", "Résumé façade.pdf"),
        ("☀️ panels.pdf", "☀️ panels.pdf"),
        ("a" * 300 + ".pdf", "a" * 200),
        ("   spaced.pdf   ", "spaced.pdf"),
        ("", "file"),
        ('quote"s.pdf', 'quote"s.pdf'),
        ("slash/back\\slash.pdf", "slash/back\\slash.pdf"),
        ("<script>.pdf", "<script>.pdf"),
    ],
)
def test_file_names_are_kept_safely(api, world, name, stored) -> None:
    _, done = upload(
        api, world, "admin", world.p["work"], "gst_proof", TYPES["application/pdf"], "application/pdf", name
    )
    assert done.status_code == 200, done.text
    got = world.c.execute("select file_name from project_files where file_id = %s", (done.json()["id"],)).fetchone()
    assert got["file_name"] == stored
    # Opening it serves the bytes inline whatever the name.
    view = api.get(f"/api/py/files/{done.json()['id']}", headers=H(world, "pm"), follow_redirects=False)
    assert api.get(view.headers["location"]).status_code == 200


# ------------------------------------------------------------------ tamper


@pytest.mark.parametrize("ctype", ["image/png", "application/pdf"])
@pytest.mark.parametrize("delta", ["+1", "-1", "x2"])
def test_upload_bigger_or_smaller_than_approved_is_refused(api, world, ctype, delta) -> None:
    data = TYPES[ctype]
    lk = link(api, world, "epc", world.p["work"], "gst_proof", ctype, len(data)).json()
    sent = {"+1": data + b"!", "-1": data[:-1], "x2": data * 2}[delta]
    assert api.put(lk["uploadUrl"], content=sent, headers={"Content-Type": ctype}).status_code == 400


@pytest.mark.parametrize("sent_as", ["image/jpeg", "application/pdf", "text/html", None])
def test_upload_of_a_different_type_than_approved_is_refused(api, world, sent_as) -> None:
    data = TYPES["image/png"]
    lk = link(api, world, "epc", world.p["work"], "panel_pictures", "image/png", len(data)).json()
    headers = {"Content-Type": sent_as} if sent_as else {}
    assert api.put(lk["uploadUrl"], content=data, headers=headers).status_code == 400


def test_a_download_link_cant_be_used_to_upload(api, world) -> None:
    tok = storage._token({"op": "get", "key": f"projects/{world.p['work']}/gst_proof/x.pdf", "exp": time.time() + 60})
    assert (
        api.put(f"/api/py/dev-storage/{tok}", content=b"x", headers={"Content-Type": "application/pdf"}).status_code
        == 403
    )


def test_an_expired_upload_link_is_refused(api, world, monkeypatch) -> None:
    lk = link(api, world, "epc", world.p["work"], "gst_proof", "application/pdf", 10).json()
    real = time.time
    monkeypatch.setattr(storage.time, "time", lambda: real() + storage.LINK_SECONDS + 1)
    assert (
        api.put(lk["uploadUrl"], content=b"0123456789", headers={"Content-Type": "application/pdf"}).status_code == 403
    )


@pytest.mark.parametrize("tok", ["x.y", "not-a-token", "eyJvcCI6InB1dCJ9.0000"])
def test_made_up_upload_links_are_refused(api, tok) -> None:
    assert api.put(f"/api/py/dev-storage/{tok}", content=b"x", headers={"Content-Type": "image/png"}).status_code == 403


def test_the_same_link_can_be_retried_after_a_dropped_connection(api, world) -> None:
    data = TYPES["image/png"]
    lk = link(api, world, "epc", world.p["work"], "panel_pictures", "image/png", len(data)).json()
    for _ in range(2):
        assert api.put(lk["uploadUrl"], content=data, headers={"Content-Type": "image/png"}).status_code == 200


# ------------------------------------------------------------------ forged


@pytest.mark.parametrize(
    "key",
    [
        "projects/{other}/gst_proof/{u}.pdf",
        "projects/{pid}/panel_pictures/{u}.pdf",
        "projects/{pid}/gst_proof/{u}.exe",
        "projects/{pid}/gst_proof/../../{u}.pdf",
        "projects/{pid}/gst_proof/{U}.pdf",
        "projects/{pid}/gst_proof/notauuid.pdf",
        "projects/{pid}/gst_proof/x/{u}.pdf",
        "/projects/{pid}/gst_proof/{u}.pdf",
        "",
        "projects/{pid}/gst_proof/{u}",
    ],
)
def test_confirmations_for_keys_that_werent_issued_are_refused(api, world, key) -> None:
    pid = world.p["work"]
    k = key.format(pid=pid, other=pid + 1, u=str(uuid.uuid4()), U=str(uuid.uuid4()).upper())
    r = api.post(
        f"/api/py/projects/{pid}/files",
        headers=H(world, "epc"),
        json={"category": "gst_proof", "key": k, "fileName": "x.pdf"},
    )
    assert r.status_code == 400


def test_confirming_a_file_that_never_arrived_is_refused(api, world) -> None:
    lk = link(api, world, "epc", world.p["work"], "gst_proof", "application/pdf", 10).json()
    r = api.post(
        f"/api/py/projects/{world.p['work']}/files",
        headers=H(world, "epc"),
        json={"category": "gst_proof", "key": lk["key"], "fileName": "x.pdf"},
    )
    assert r.status_code == 400 and "never arrived" in r.json()["error"]


@pytest.mark.parametrize("real_type", ["text/html", "image/gif"])
def test_a_stored_file_of_the_wrong_type_is_refused_and_deleted(api, world, real_type) -> None:
    lk = link(api, world, "epc", world.p["work"], "gst_proof", "application/pdf", 10).json()
    path = storage.local_path(lk["key"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"<html></html>")
    path.with_suffix(path.suffix + ".type").write_text(real_type)
    r = api.post(
        f"/api/py/projects/{world.p['work']}/files",
        headers=H(world, "epc"),
        json={"category": "gst_proof", "key": lk["key"], "fileName": "x.pdf"},
    )
    assert r.status_code == 400 and not path.exists()


def test_a_stored_file_over_the_limit_is_refused(api, world, monkeypatch) -> None:
    data = TYPES["application/pdf"]
    lk = link(api, world, "epc", world.p["work"], "gst_proof", "application/pdf", len(data)).json()
    api.put(lk["uploadUrl"], content=data, headers={"Content-Type": "application/pdf"})
    monkeypatch.setattr(storage, "MAX_BYTES", 10)
    r = api.post(
        f"/api/py/projects/{world.p['work']}/files",
        headers=H(world, "epc"),
        json={"category": "gst_proof", "key": lk["key"], "fileName": "x.pdf"},
    )
    assert r.status_code == 400


# ------------------------------------------------------------------ matrix

ROLES = ["pm", "admin", "epc", "outsider_c", "outsider_e", "own_ho", "other_ho"]
STATES = ["draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved", "pm_approved", "m1", "m2"]
SLOT_OF = {
    "pre1": ("utility_bill", 1),
    "m1": ("panel_pictures", 1),
    "m2": ("pvl_letter", 2),
    "post": ("handover_docs", 3),
}


def expected(role: str, state: str, section: str) -> int:
    if role in ("outsider_c", "outsider_e", "other_ho") or (role == "own_ho" and state == "draft"):
        return 404
    if role == "own_ho":
        return 403
    if state in ("draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"):
        return 403
    reached = {"pm_approved": 0, "m1": 1, "m2": 2}[state]
    n = SLOT_OF[section][1]
    if (n == 2 and reached < 1) or (n == 3 and reached < 2):
        return 403
    if role in ("admin", "epc") and n <= reached:
        return 403  # a completed milestone is fixed for the crew
    return 200


@pytest.mark.parametrize(("role", "state", "section"), list(product(ROLES, STATES, SLOT_OF)))
def test_who_may_upload(api, world, role, state, section) -> None:
    r = link(api, world, role, world.p[state], SLOT_OF[section][0])
    assert r.status_code == expected(role, state, section), r.text


# ------------------------------------------------------------------ access


def _stored_file(w: World, pid: int, category: str = "inverter_pictures") -> int:
    key = f"projects/{pid}/{category}/{uuid.uuid4()}.png"
    p = storage.local_path(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(TYPES["image/png"])
    p.with_suffix(".png.type").write_text("image/png")
    return w.c.execute(
        "insert into project_files (project_id, category, url, file_name, content_type, size_bytes) "
        "values (%s, %s, %s, 'seed.png', 'image/png', 40) returning file_id",
        (pid, category, key),
    ).fetchone()["file_id"]


@pytest.mark.parametrize(
    ("role", "code"),
    [
        ("pm", 302),
        ("admin", 302),
        ("epc", 302),
        ("own_ho", 302),
        ("outsider_c", 404),
        ("outsider_e", 404),
        ("other_ho", 404),
    ],
)
def test_who_may_open_a_file(api, world, role, code) -> None:
    fid = _stored_file(world, world.p["work"])
    assert api.get(f"/api/py/files/{fid}", headers=H(world, role), follow_redirects=False).status_code == code


@pytest.mark.parametrize(
    ("role", "code"),
    [
        ("pm", 200),
        ("admin", 200),
        ("epc", 200),
        ("own_ho", 403),
        ("outsider_c", 404),
        ("outsider_e", 404),
        ("other_ho", 404),
    ],
)
def test_who_may_remove_a_file(api, world, role, code) -> None:
    fid = _stored_file(world, world.p["work"])
    r = api.delete(f"/api/py/projects/{world.p['work']}/files/{fid}", headers=H(world, role))
    assert r.status_code == code, r.text
    gone = world.c.execute("select 1 from project_files where file_id = %s", (fid,)).fetchone() is None
    assert gone == (code == 200)


def test_crew_cant_remove_a_file_from_a_completed_milestone(api, world) -> None:
    fid = _stored_file(world, world.p["m1"], "panel_pictures")
    assert api.delete(f"/api/py/projects/{world.p['m1']}/files/{fid}", headers=H(world, "epc")).status_code == 403
    assert api.delete(f"/api/py/projects/{world.p['m1']}/files/{fid}", headers=H(world, "pm")).status_code == 200


def test_opening_a_file_that_doesnt_exist(api, world) -> None:
    assert api.get("/api/py/files/999999999", headers=H(world, "pm")).status_code == 404


def test_removing_a_file_through_another_project_is_refused(api, world) -> None:
    fid = _stored_file(world, world.p["work"])
    assert api.delete(f"/api/py/projects/{world.p['m1']}/files/{fid}", headers=H(world, "pm")).status_code == 404


def test_an_expired_download_link_is_refused(api, world, monkeypatch) -> None:
    fid = _stored_file(world, world.p["work"])
    url = api.get(f"/api/py/files/{fid}", headers=H(world, "pm"), follow_redirects=False).headers["location"]
    real = time.time
    monkeypatch.setattr(storage.time, "time", lambda: real() + storage.LINK_SECONDS + 1)
    assert api.get(url).status_code == 403


# ------------------------------------------------------------------ photos


@pytest.mark.parametrize("n", [1, 2, 3, 5, 8])
def test_many_photos_fill_one_slot(api, world, n) -> None:
    pid = world.p["work"]
    slot = "sp_submission_screenshot" if n % 2 else "inverter_pictures"
    before = world.c.execute(
        "select count(*)::int as n from project_files where project_id = %s and category = %s", (pid, slot)
    ).fetchone()["n"]
    for i in range(n):
        _, done = upload(api, world, "admin", pid, slot, TYPES["image/jpeg"], "image/jpeg", f"p{i}.jpg")
        assert done.status_code == 200
    data = api.get(f"/api/py/projects/{pid}/fields", headers=H(world, "pm")).json()
    f = next(x for s in data["sections"] for x in s["fields"] if x["key"] == slot)
    assert len(f["files"]) == before + n and f["filled"]


def test_removing_every_photo_empties_the_slot(api, world) -> None:
    pid = world.p["work"]
    for fid in [
        r["file_id"]
        for r in world.c.execute(
            "select file_id from project_files where project_id = %s and category = 'sp_submission_screenshot'", (pid,)
        ).fetchall()
    ]:
        assert api.delete(f"/api/py/projects/{pid}/files/{fid}", headers=H(world, "pm")).status_code == 200
    data = api.get(f"/api/py/projects/{pid}/fields", headers=H(world, "pm")).json()
    f = next(x for s in data["sections"] for x in s["fields"] if x["key"] == "sp_submission_screenshot")
    assert f["files"] == [] and not f["filled"]
