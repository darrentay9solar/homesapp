"""UAT · uploads started and never finished are cleared away, and nothing else is.

A link handed out is written down; when the file is registered the note goes.
After a day, whatever an unfinished upload left in storage is deleted by the
15-minute job. Registered files, profile pictures, signed certificates and
files taken off a project (restorable from the audit log) are never touched.
"""

from __future__ import annotations

import uuid

import pytest

from _lib import storage, sweep
from uat import flowkit

pytestmark = pytest.mark.uat


def _old(world, key: str, hours: int = 30) -> None:
    world.conn.execute(
        "insert into upload_intents (key, uid, created_at) values (%s, %s, now() - make_interval(hours => %s)) "
        "on conflict (key) do update set created_at = excluded.created_at",
        (key, world.uid("crew_epc"), hours),
    )


def _stored(key: str) -> bool:
    return (storage.LOCAL_DIR / key).exists()


def _put(key: str) -> None:
    world_store = storage.LOCAL_DIR / key
    world_store.parent.mkdir(parents=True, exist_ok=True)
    world_store.write_bytes(b"%PDF-1.4 abandoned")


@pytest.mark.parametrize("hours", [25, 48, 24 * 30])
def test_an_abandoned_upload_is_deleted_after_a_day(world, hours) -> None:
    key = f"projects/{world.pid['in_progress_m0']}/documents/gst_proof/{uuid.uuid4()}.pdf"
    _put(key)
    _old(world, key, hours)
    sweep.sweep()
    assert not _stored(key)
    assert not world.conn.execute("select 1 from upload_intents where key = %s", (key,)).fetchone()


@pytest.mark.parametrize("hours", [0, 1, 12, 23])
def test_a_recent_upload_is_left_alone(world, hours) -> None:
    key = f"projects/{world.pid['in_progress_m0']}/documents/gst_proof/{uuid.uuid4()}.pdf"
    _put(key)
    _old(world, key, hours)
    sweep.sweep()
    assert _stored(key), "it may still be on its way"
    world.conn.execute("delete from upload_intents where key = %s", (key,))


def test_an_abandoned_link_that_never_uploaded_anything_is_just_forgotten(world) -> None:
    key = f"projects/{world.pid['in_progress_m0']}/documents/gst_proof/{uuid.uuid4()}.pdf"
    _old(world, key)
    out = sweep.sweep()
    assert out["failed"] == 0
    assert not world.conn.execute("select 1 from upload_intents where key = %s", (key,)).fetchone()


@pytest.mark.parametrize("state", ["in_progress_m1", "awaiting_signature", "signed", "closed"])
def test_registered_files_are_never_deleted(world, state) -> None:
    rows = world.conn.execute("select url from project_files where project_id = %s", (world.pid[state],)).fetchall()
    sigs = world.conn.execute(
        "select signature_url, certificate_url from project_signatures where project_id = %s", (world.pid[state],)
    ).fetchall()
    keys = [r["url"] for r in rows] + [k for s in sigs for k in (s["signature_url"], s["certificate_url"])]
    for k in keys:
        _old(world, k, 72)  # as if a note were left behind for each
    sweep.sweep()
    for k in keys:
        assert _stored(k), k
        assert not world.conn.execute("select 1 from upload_intents where key = %s", (k,)).fetchone()


def test_a_file_taken_off_a_project_stays_restorable(api, world) -> None:
    f = flowkit.Flow(api, world)
    assert f.create().status_code == 200
    f.approve_both()
    r = f.upload("crew_epc", "utility_bill")
    assert r.status_code == 200
    fid = r.json()["id"]
    key = world.conn.execute("select url from project_files where file_id = %s", (fid,)).fetchone()["url"]
    assert not world.conn.execute("select 1 from upload_intents where key = %s", (key,)).fetchone(), "crossed off"
    assert api.delete(f"/api/py/projects/{f.pid}/files/{fid}", headers=world.h("crew_epc")).status_code == 200
    sweep.sweep()
    assert _stored(key), "removed from the project, not from storage"


def test_a_finished_upload_crosses_its_note_off(api, world) -> None:
    f = flowkit.Flow(api, world)
    assert f.create().status_code == 200
    f.approve_both()
    link = api.post(
        f"/api/py/projects/{f.pid}/files/upload-link",
        headers=world.h("crew_admin"),
        json={"category": "gst_proof", "fileName": "g.pdf", "contentType": "application/pdf", "size": len(flowkit.PDF)},
    ).json()
    assert world.conn.execute("select 1 from upload_intents where key = %s", (link["key"],)).fetchone()
    assert api.put(link["uploadUrl"], content=flowkit.PDF, headers=link["headers"]).status_code == 200
    done = api.post(
        f"/api/py/projects/{f.pid}/files",
        headers=world.h("crew_admin"),
        json={"category": "gst_proof", "key": link["key"], "fileName": "g.pdf"},
    )
    assert done.status_code == 200
    assert not world.conn.execute("select 1 from upload_intents where key = %s", (link["key"],)).fetchone()


def test_the_scheduled_job_runs_the_sweep(api, world, monkeypatch) -> None:
    from _routes import sites

    monkeypatch.setattr(sites, "env", lambda k: "uat-secret" if k == "CRON_SECRET" else None)
    key = f"projects/{world.pid['in_progress_m0']}/documents/gst_proof/{uuid.uuid4()}.pdf"
    _put(key)
    _old(world, key)
    assert api.post("/api/py/cron/visit-reminders", headers={"Authorization": "Bearer wrong"}).status_code == 401
    r = api.post("/api/py/cron/visit-reminders", headers={"Authorization": "Bearer uat-secret"})
    assert r.status_code == 200 and r.json()["uploads"]["deleted"] >= 1
    assert not _stored(key)


def test_without_storage_the_sweep_does_nothing(monkeypatch) -> None:
    monkeypatch.setattr(storage, "mode", lambda: None)
    assert sweep.sweep()["checked"] == 0
