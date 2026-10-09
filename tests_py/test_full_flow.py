# ruff: noqa: RUF001  (the multiplication sign is meant)
"""One project, from creation to closing, the way docs/PROCESS_FLOW.md describes it.

Every step is one test, run in order, twice:
  laptop   files in web/.uploads/ (free; part of every run)
  r2       files in the real Cloudflare R2 dev bucket (marked r2_live)

The r2 run uploads 15 files of about 70 bytes, plus the signed certificate
(a PDF and the signature, about 20 KB), and deletes them at the end: roughly
60 R2 requests in all, against a free allowance of millions a month.
Everything else (approvals, fields, milestones, check-ins, the audit log)
runs against the real API and database rules on the Neon test branch.
"""

from __future__ import annotations

import base64
import re
import shutil
import uuid
import zlib
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from _lib import certificate, onemap, storage
from _routes import projects as projects_mod
from _routes.projects import SG
from conftest import bearer, owner_conn

SITE = onemap.Location(
    address="53 ANG MO KIO AVENUE 3 SINGAPORE 569933", postal_code="569933", lat=1.3691, lng=103.8486
)
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 60
PDF = b"%PDF-1.4\n" + b"0" * 60
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 60
REASON = "Restoring a photo removed by mistake during testing"
SIGNATURE = (Path(__file__).parent / "fixtures" / "signature.jpg").read_bytes()

BACKENDS = [pytest.param("laptop", id="laptop"), pytest.param("r2", id="r2", marks=pytest.mark.r2_live)]
need_r2 = storage._r2() is not None
STATE: dict[str, dict] = {"laptop": {}, "r2": {}}


def today() -> date:
    return datetime.now(SG).date()


# ------------------------------------------------------------------ the people


@pytest.fixture(scope="module")
def team():
    c = owner_conn()
    tag = uuid.uuid4().hex[:6]

    def user(role: str, name: str) -> dict:
        return c.execute(
            "insert into users (email, user_type, full_name, clerk_user_id) values (%s, %s, %s, %s) returning *",
            (
                f"pytest-flow-{role}-{uuid.uuid4().hex[:6]}@example.com",
                role,
                name,
                f"user_flow_{uuid.uuid4().hex[:10]}",
            ),
        ).fetchone()

    t = {
        "pm": user("project_manager", "Flow PM"),
        "ho": user("homeowner", "Flow Homeowner"),
        "admin": user("contractor", "Flow Admin"),
        "epc": user("epc_team", "Flow EPC"),
        "outsider": user("epc_team", "Flow Outsider"),
    }
    t["group"] = c.execute(
        "insert into contractor_groups (name) values (%s) returning group_id", (f"pytest flow {tag}",)
    ).fetchone()["group_id"]
    for r in ("admin", "epc"):
        c.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (t["group"], t[r]["uid"]))
    t["conn"] = c
    yield t
    pids = [s["pid"] for s in STATE.values() if "pid" in s]
    for pid in pids:
        shutil.rmtree(storage.LOCAL_DIR / "projects" / str(pid), ignore_errors=True)
    c.execute("delete from projects where project_id = any(%s)", (pids,))
    c.execute("delete from contractor_group_members where group_id = %s", (t["group"],))
    c.execute("delete from contractor_groups where group_id = %s", (t["group"],))
    uids = [t[r]["uid"] for r in ("pm", "ho", "admin", "epc", "outsider")]
    c.execute(
        "delete from users u where uid = any(%s) and not exists (select 1 from audit_log a where a.actor_uid = u.uid)",
        (uids,),
    )
    c.execute("update users set active = false, clerk_user_id = null where uid = any(%s)", (uids,))
    c.close()


@pytest.fixture(scope="module")
def client():
    import index

    with TestClient(index.app) as c, httpx.Client(timeout=30) as r2:
        c.r2 = r2  # type: ignore[attr-defined]
        yield c


@pytest.fixture(autouse=True)
def _onemap(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(projects_mod.onemap, "resolve", lambda _a, _p: SITE)


@pytest.fixture
def s(backend):
    if backend == "r2" and not need_r2:
        pytest.skip("R2 settings aren't in .env.local")
    return STATE[backend]


def h(t, who):
    return bearer(t[who]["clerk_user_id"])


def status(t, pid) -> str:
    return t["conn"].execute("select status from projects where project_id = %s", (pid,)).fetchone()["status"]


def fields(client, t, who, pid) -> dict:
    r = client.get(f"/api/py/projects/{pid}/fields", headers=h(t, who))
    assert r.status_code == 200, r.text
    return r.json()


def field(d: dict, key: str) -> dict:
    return next(f for sec in d["sections"] for f in sec["fields"] if f["key"] == key)


def save(client, t, who, pid, key, value):
    return client.patch(f"/api/py/projects/{pid}/fields", headers=h(t, who), json={"key": key, "value": value})


def save_all(client, t, who, pid, values: dict) -> None:
    for k, v in values.items():
        r = save(client, t, who, pid, k, v)
        assert r.status_code == 200, (k, r.text)


def upload(client, t, st, who, slot, data=PDF, ctype="application/pdf", name=None):
    """Link, upload to wherever storage is, confirm. Returns the confirmation."""
    pid = st["pid"]
    name = name or f"{slot}.{storage.ALLOWED_TYPES.get(ctype, 'bin')}"
    link = client.post(
        f"/api/py/projects/{pid}/files/upload-link",
        headers=h(t, who),
        json={"category": slot, "fileName": name, "contentType": ctype, "size": len(data)},
    )
    if link.status_code != 200:
        return link
    url = link.json()["uploadUrl"]
    put = (client.r2 if url.startswith("https://") else client).put(url, content=data, headers=link.json()["headers"])
    assert put.status_code == 200, put.text[:200]
    st.setdefault("keys", []).append(link.json()["key"])
    st.setdefault("bytes", {})[link.json()["key"]] = data
    return client.post(
        f"/api/py/projects/{pid}/files",
        headers=h(t, who),
        json={"category": slot, "key": link.json()["key"], "fileName": name},
    )


def open_file(client, t, who, fid) -> httpx.Response | None:
    r = client.get(f"/api/py/files/{fid}", headers=h(t, who), follow_redirects=False)
    if r.status_code != 302:
        return None
    url = r.headers["location"]
    return (client.r2 if url.startswith("https://") else client).get(url)


def told(t, pid, kind: str) -> set[int]:
    rows = (
        t["conn"]
        .execute("select recipient_uid from notifications where project_id = %s and kind = %s", (pid, kind))
        .fetchall()
    )
    return {r["recipient_uid"] for r in rows}


def bucket_keys(client, prefix: str) -> list[str]:
    """Lists what's in the R2 dev bucket under a prefix (one request)."""
    cfg = storage._r2()
    url = storage._sign(cfg, "GET", "", 60, {}, {"list-type": "2", "prefix": prefix})
    r = client.r2.get(url)
    assert r.status_code == 200, r.text[:200]
    return re.findall(r"<Key>([^<]+)</Key>", r.text)


pytestmark = pytest.mark.parametrize("backend", BACKENDS)


# ------------------------------------------------------------ 1. creation


def test_01_pm_creates_the_project_from_a_postal_code(client, team, s, backend) -> None:
    body = {
        "name": f"Flow Residence ({backend})",
        "postalCode": "569933",
        "address": "53 Ang Mo Kio Ave 3",
        "homeownerId": team["ho"]["uid"],
        "contactNo": "+65 9123 4567",
        "contractor": {"type": "group", "groupId": team["group"]},
        "startDate": (today() + timedelta(days=5)).isoformat(),
    }
    assert client.post("/api/py/projects", headers=h(team, "admin"), json=body).status_code == 403
    r = client.post("/api/py/projects", headers=h(team, "pm"), json=body)
    assert r.status_code == 200, r.text
    s["pid"] = pid = r.json()["id"]
    row = (
        team["conn"]
        .execute(
            "select status, site_lat, site_lng, installation_start_date, target_end_date from projects "
            "where project_id = %s",
            (pid,),
        )
        .fetchone()
    )
    assert row["status"] == "awaiting_homeowner"
    assert (float(row["site_lat"]), float(row["site_lng"])) == (SITE.lat, SITE.lng), "GPS from the postal code"
    assert row["target_end_date"] - row["installation_start_date"] == timedelta(days=21), "end = start + 3 weeks"
    assert told(team, pid, "approval_request") == {team["ho"]["uid"]}


def test_02_nothing_can_be_filled_or_uploaded_before_approval(client, team, s, backend) -> None:
    pid = s["pid"]
    assert save(client, team, "admin", pid, "sales", "x").status_code == 403
    assert upload(client, team, s, "admin", "utility_bill").status_code == 403
    assert upload(client, team, s, "pm", "utility_bill").status_code == 403
    assert "keys" not in s, "no link was handed out, so nothing reached storage"
    assert client.get(f"/api/py/projects/{pid}/fields", headers=h(team, "outsider")).status_code == 404


def test_03_homeowner_declines_and_the_pm_asks_again(client, team, s, backend) -> None:
    pid = s["pid"]
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(team, "pm")).status_code == 409, "homeowner first"
    r = client.post(f"/api/py/projects/{pid}/decline", headers=h(team, "ho"), json={"reason": "Need to check the date"})
    assert r.status_code == 200 and status(team, pid) == "homeowner_declined"
    assert team["pm"]["uid"] in told(team, pid, "approval_declined")
    assert client.post(f"/api/py/projects/{pid}/remind", headers=h(team, "pm")).status_code == 200
    assert status(team, pid) == "awaiting_homeowner"


def test_04_homeowner_then_pm_approve(client, team, s, backend) -> None:
    pid = s["pid"]
    crew = client.post(f"/api/py/projects/{pid}/approve", headers=h(team, "admin"))
    assert crew.status_code == 409 and status(team, pid) == "awaiting_homeowner", "the crew has nothing to approve"
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(team, "ho")).status_code == 200
    assert status(team, pid) == "homeowner_approved"
    assert save(client, team, "admin", pid, "sales", "x").status_code == 403, "still waiting for the PM"
    assert client.post(f"/api/py/projects/{pid}/approve", headers=h(team, "pm")).status_code == 200
    assert status(team, pid) == "pm_approved"
    d = fields(client, team, "epc", pid)
    assert field(d, "utility_bill")["lockedReason"] is None
    assert "Milestone 1" in field(d, "pvl_letter")["lockedReason"]


def test_05_only_the_pm_changes_the_dates_and_it_is_audited(client, team, s, backend) -> None:
    pid = s["pid"]
    row = team["conn"].execute("select * from projects where project_id = %s", (pid,)).fetchone()
    new_end = row["target_end_date"] + timedelta(days=7)
    body = {
        "name": row["name"],
        "postalCode": "569933",
        "address": row["address"],
        "homeownerId": team["ho"]["uid"],
        "contactNo": "+65 9123 4567",
        "contractor": {"type": "group", "groupId": team["group"]},
        "startDate": row["installation_start_date"].isoformat(),
        "endDate": new_end.isoformat(),
    }
    assert client.patch(f"/api/py/projects/{pid}", headers=h(team, "admin"), json=body).status_code == 403
    assert client.patch(f"/api/py/projects/{pid}", headers=h(team, "pm"), json=body).status_code == 200
    got = team["conn"].execute("select target_end_date from projects where project_id = %s", (pid,)).fetchone()
    assert got["target_end_date"] == new_end
    log = client.get("/api/py/audit", headers=h(team, "pm"), params={"location": f"project:{pid}"}).json()["entries"]
    assert any(
        e["table"] == "projects" and e["actor"]["uid"] == team["pm"]["uid"] and "target_end_date" in str(e) for e in log
    )


# ------------------------------------------------------------ 2. on site


def test_06_a_visit_is_scheduled_and_the_crew_is_told(client, team, s, backend) -> None:
    pid = s["pid"]
    r = client.post(
        f"/api/py/projects/{pid}/visits",
        headers=h(team, "admin"),
        json={"date": today().isoformat(), "time": "09:00", "note": "Scaffolding and panel mounting"},
    )
    assert r.status_code == 200, r.text
    assert team["epc"]["uid"] in told(team, pid, "visit_assigned")
    assert client.post(
        f"/api/py/projects/{pid}/visits", headers=h(team, "ho"), json={"date": today().isoformat()}
    ).status_code in (403, 404)


def test_07_epc_checks_in_and_out_at_the_house(client, team, s, backend) -> None:
    pid = s["pid"]
    gps = {"lat": SITE.lat + 0.0002, "lng": SITE.lng, "accuracy": 12.0}  # about 22 m from the house
    assert (
        client.post(f"/api/py/projects/{pid}/check-ins", headers=h(team, "admin"), json={**gps, "crew": 4}).status_code
        == 403
    )
    far = client.post(
        f"/api/py/projects/{pid}/check-ins", headers=h(team, "epc"), json={**gps, "lat": SITE.lat + 0.01, "crew": 4}
    )
    assert far.status_code == 400 and far.json()["error"].startswith("You're not at the check-in location")
    r = client.post(f"/api/py/projects/{pid}/check-ins", headers=h(team, "epc"), json={**gps, "crew": 4})
    assert r.status_code == 200, r.text
    v = client.get(f"/api/py/projects/{pid}/visits", headers=h(team, "pm")).json()
    cid = v["visits"][0]["checkIns"][0]["id"]
    assert v["visits"][0]["state"] == "attended"
    out = client.post(f"/api/py/check-ins/{cid}/check-out", headers=h(team, "epc"), json={**gps, "crew": 3})
    assert out.status_code == 200, out.text
    assert (
        client.delete(f"/api/py/projects/{pid}/visits/{v['visits'][0]['id']}", headers=h(team, "pm")).status_code >= 400
    )


# ------------------------------------------------------------ 3. milestone 1


def test_08_before_milestone_1_documents_and_details(client, team, s, backend) -> None:
    pid = s["pid"]
    assert upload(client, team, s, "ho", "utility_bill").status_code == 403, "homeowners don't upload"
    assert upload(client, team, s, "admin", "utility_bill", b"<html>", "text/html").status_code == 400
    for slot in ("utility_bill", "gst_proof", "sp_forms_signed", "moc_change"):
        r = upload(client, team, s, "admin", slot)
        assert r.status_code == 200, (slot, r.text)
    assert status(team, pid) == "in_progress", "the first piece of work starts the project"
    save_all(
        client,
        team,
        "admin",
        pid,
        {
            "electricity_retailer_id": "SP Group",
            "homeowner.ic_last4": "567d",
            "sp_application_status": 1,
        },
    )


def test_09_survey_panels_and_inverter_with_photos(client, team, s, backend) -> None:
    pid = s["pid"]
    save_all(
        client,
        team,
        "epc",
        pid,
        {
            "sales": "K. Chandra",
            "waterproofing": False,
            "create_group_chat": True,
            "panel_quantity_estimate": 20,
            "panel_capacity": 610,
            "inverter_to_order": "Huawei SUN2000-10KTL",
            "inverter_collected": True,
            "inverter_serial_number": "HW-10KTL-1",
            "current_stage": 2,
        },
    )
    for n, (data, ctype) in enumerate([(JPEG, "image/jpeg"), (PNG, "image/png")]):
        r = upload(client, team, s, "epc", "panel_pictures", data, ctype, f"panels {n + 1}.{ctype[6:]}")
        assert r.status_code == 200, r.text
        s.setdefault("panel_ids", []).append(r.json()["id"])
    assert upload(client, team, s, "epc", "inverter_pictures", JPEG, "image/jpeg").status_code == 200
    f = field(fields(client, team, "ho", pid), "panel_pictures")
    assert len(f["files"]) == 2 and f["filled"]


def test_10_a_photo_removed_by_mistake_is_restored_from_the_audit_log(client, team, s, backend) -> None:
    pid, fid = s["pid"], s["panel_ids"][1]
    assert client.delete(f"/api/py/projects/{pid}/files/{fid}", headers=h(team, "ho")).status_code == 403
    assert client.delete(f"/api/py/projects/{pid}/files/{fid}", headers=h(team, "epc")).status_code == 200
    assert len(field(fields(client, team, "pm", pid), "panel_pictures")["files"]) == 1
    log = client.get("/api/py/audit", headers=h(team, "pm"), params={"location": f"project:{pid}"}).json()["entries"]
    gone = next(e for e in log if e["table"] == "project_files" and e["action"] == "delete")
    assert gone["actor"]["uid"] == team["epc"]["uid"]
    p = client.post(
        "/api/py/audit/actions/preview", headers=h(team, "pm"), json={"kind": "restore_record", "auditId": gone["id"]}
    )
    assert p.status_code == 200 and p.json()["blockers"] == [], p.text
    r = client.post(
        "/api/py/audit/actions/apply",
        headers=h(team, "pm"),
        json={"kind": "restore_record", "auditId": gone["id"], "reason": REASON, "expect": p.json()["expect"]},
    )
    assert r.status_code == 200, r.text
    assert len(field(fields(client, team, "pm", pid), "panel_pictures")["files"]) == 2
    # The stored copy was never deleted, so the restored photo opens again, byte for byte.
    got = open_file(client, team, "ho", fid)
    assert got is not None and got.status_code == 200 and got.content == PNG


def test_11_installation_completes_milestone_1_and_everyone_is_told(client, team, s, backend) -> None:
    pid = s["pid"]
    save_all(
        client,
        team,
        "epc",
        pid,
        {
            "installation_end_date": (today() + timedelta(days=9)).isoformat(),
            "scaffolding_removal": True,
            "scaffolding_removal_date": (today() + timedelta(days=10)).isoformat(),
            "sp_submission_date": (today() + timedelta(days=11)).isoformat(),
        },
    )
    assert fields(client, team, "pm", pid)["milestoneReached"] == 0, "the screenshot is still missing"
    r = upload(client, team, s, "epc", "sp_submission_screenshot", PNG, "image/png")
    assert r.status_code == 200 and "Milestone 1 complete" in r.json()["message"]
    d = fields(client, team, "ho", pid)
    assert d["milestoneReached"] == 1 and d["recordedMilestones"] == [1]
    assert {team["ho"]["uid"], team["pm"]["uid"], team["admin"]["uid"]} <= told(team, pid, "milestone_complete")


def test_12_milestone_1_is_fixed_for_the_crew_until_a_pm_reopens_it(client, team, s, backend) -> None:
    pid = s["pid"]
    assert save(client, team, "epc", pid, "sales", "Someone else").status_code == 403
    assert upload(client, team, s, "epc", "panel_pictures", PNG, "image/png").status_code == 403
    assert client.post(f"/api/py/projects/{pid}/milestones/1/reopen", headers=h(team, "epc")).status_code == 403
    assert client.post(f"/api/py/projects/{pid}/milestones/1/reopen", headers=h(team, "pm")).status_code == 200
    assert save(client, team, "epc", pid, "sales", "K. Chandra (Sales)").status_code == 200
    assert fields(client, team, "pm", pid)["milestoneReached"] >= 1


# ------------------------------------------------------------ 4. milestones 2 and 3


def test_13_milestone_2_commissioning_and_the_pvl_letter(client, team, s, backend) -> None:
    pid = s["pid"]
    save_all(
        client,
        team,
        "admin",
        pid,
        {
            "inverter_commission_grid_connection": True,
            "commission_date": (today() + timedelta(days=14)).isoformat(),
            "rcb_breaker_replacement": False,
            "pvl_received_date": (today() + timedelta(days=16)).isoformat(),
        },
    )
    assert upload(client, team, s, "admin", "sp_appointment_letter").status_code == 403, "Milestone 3 isn't open yet"
    r = upload(client, team, s, "admin", "pvl_letter")
    assert r.status_code == 200 and "Milestone 2 complete" in r.json()["message"]
    assert fields(client, team, "pm", pid)["recordedMilestones"] == [1, 2]


def test_14_milestone_3_inspection_and_closing_documents(client, team, s, backend) -> None:
    pid = s["pid"]
    save_all(
        client,
        team,
        "epc",
        pid,
        {
            "pre_inspection_date": (today() + timedelta(days=18)).isoformat(),
            "sp_appointment_letter_received_date": (today() + timedelta(days=19)).isoformat(),
            "sp_turn_on_inspection_date": (today() + timedelta(days=20)).isoformat(),
            "fusion_solar_app_access": True,
        },
    )
    for slot in ("sp_appointment_letter", "as_built_pv_layout", "final_submission_documents", "handover_docs"):
        r = upload(client, team, s, "epc", slot)
        assert r.status_code == 200, (slot, r.text)
    assert upload(client, team, s, "epc", "fusion_solar_access", PNG, "image/png").status_code == 200
    assert fields(client, team, "pm", pid)["milestoneReached"] == 2, "the signed completion form is still missing"
    r = upload(client, team, s, "admin", "completion_form_signed")
    assert r.status_code == 200 and "Milestone 3 complete" in r.json()["message"]
    assert status(team, pid) == "awaiting_signature", "the homeowner is asked to sign straight away"


def test_15_ready_for_handover(client, team, s, backend) -> None:
    pid = s["pid"]
    d = fields(client, team, "ho", pid)
    assert d["milestoneReached"] == 3 and d["recordedMilestones"] == [1, 2, 3]
    missing = [
        f["key"]
        for sec in d["sections"]
        for f in sec["fields"]
        if f.get("required") and f.get("shown", True) and not f["filled"]
    ]
    assert missing == [], missing
    listed = next(p for p in client.get("/api/py/projects", headers=h(team, "ho")).json()["projects"] if p["id"] == pid)
    assert listed["progress"] == 100
    assert told(team, pid, "signature_request") == {team["ho"]["uid"]}
    assert {team["pm"]["uid"], team["admin"]["uid"]} <= told(team, pid, "milestone_complete")


# ------------------------------------------------------------ 5. the record


def test_16_every_file_opens_for_the_homeowner_and_nobody_else(client, team, s, backend) -> None:
    pid = s["pid"]
    files = team["conn"].execute("select file_id, url from project_files where project_id = %s", (pid,)).fetchall()
    assert len(files) == 15 and {f["url"] for f in files} <= set(s["keys"])
    for f in files[:3]:  # three downloads are enough to prove the bytes; the rest were checked on arrival
        got = open_file(client, team, "ho", f["file_id"])
        assert got is not None and got.content == s["bytes"][f["url"]]
    for f in files:
        assert (
            client.get(f"/api/py/files/{f['file_id']}", headers=h(team, "outsider"), follow_redirects=False).status_code
            == 404
        )


def test_17_the_audit_log_names_who_did_each_step(client, team, s, backend) -> None:
    pid = s["pid"]
    log = client.get(
        "/api/py/audit", headers=h(team, "pm"), params={"location": f"project:{pid}", "limit": 500}
    ).json()["entries"]
    actors = {e["actor"]["uid"] for e in log if e.get("actor")}
    assert {team["pm"]["uid"], team["ho"]["uid"], team["admin"]["uid"], team["epc"]["uid"]} <= actors
    uploads = [e for e in log if e["table"] == "project_files" and e["action"] == "insert" and not e["restoresId"]]
    assert len(uploads) == 15
    assert any(e.get("restoresId") for e in log), "the restore is recorded, with its reason"
    assert client.get("/api/py/audit", headers=h(team, "epc")).status_code == 403


# ------------------------------------------------------------ 6. handover


def test_18_the_homeowner_reads_the_certificate_and_the_crew_can_no_longer_change_anything(
    client, team, s, backend
) -> None:
    pid = s["pid"]
    d = client.get(f"/api/py/projects/{pid}/handover", headers=h(team, "ho")).json()
    rows = dict(d["certificate"]["rows"])
    assert d["actions"]["sign"] and not d["actions"]["close"]
    assert rows["Solar panels"] == "20 × 610 W" and rows["System size"] == "12.20 kWp"
    assert rows["Inverter serial number"] == "HW-10KTL-1" and rows["Homeowner"] == "Flow Homeowner"
    assert d["fingerprint"] == certificate.fingerprint(d["certificate"])
    s["fingerprint"] = d["fingerprint"]
    assert save(client, team, "epc", pid, "sales", "Changed after").status_code == 403
    assert upload(client, team, s, "epc", "handover_docs").status_code == 403
    assert client.get(f"/api/py/projects/{pid}/handover", headers=h(team, "outsider")).status_code == 404


def test_19_only_the_homeowner_signs_and_only_what_they_saw(client, team, s, backend) -> None:
    pid = s["pid"]
    body = {
        "fingerprint": s["fingerprint"],
        "signerName": "Flow Homeowner",
        "signature": "data:image/jpeg;base64," + base64.b64encode(SIGNATURE).decode(),
        "agree": True,
    }
    for who in ("pm", "admin", "epc"):
        r = client.post(f"/api/py/projects/{pid}/handover/sign", headers=h(team, who), json=body)
        assert r.status_code == 403, (who, r.text)
    stale = client.post(
        f"/api/py/projects/{pid}/handover/sign", headers=h(team, "ho"), json={**body, "fingerprint": "0" * 64}
    )
    assert stale.status_code == 409 and "changed" in stale.json()["error"]
    unagreed = client.post(
        f"/api/py/projects/{pid}/handover/sign", headers=h(team, "ho"), json={**body, "agree": False}
    )
    assert unagreed.status_code == 400
    r = client.post(f"/api/py/projects/{pid}/handover/sign", headers=h(team, "ho"), json=body)
    assert r.status_code == 200, r.text
    assert status(team, pid) == "signed"
    assert told(team, pid, "signed") == {team["pm"]["uid"]}, "the project manager is alerted"
    again = client.post(f"/api/py/projects/{pid}/handover/sign", headers=h(team, "ho"), json=body)
    assert again.status_code == 409, "a signature is given once"
    row = team["conn"].execute("select * from project_signatures where project_id = %s", (pid,)).fetchone()
    assert row["signed_by"] == team["ho"]["uid"] and row["certificate_hash"] == s["fingerprint"]
    s.setdefault("keys", []).extend([row["certificate_url"], row["signature_url"]])


def test_20_the_signed_certificate_opens_for_everyone_on_the_project(client, team, s, backend) -> None:
    pid = s["pid"]
    for who in ("ho", "pm", "admin", "epc"):
        r = client.get(f"/api/py/projects/{pid}/handover/certificate.pdf", headers=h(team, who), follow_redirects=False)
        assert r.status_code == 302, (who, r.text)
    url = r.headers["location"]
    pdf = (client.r2 if url.startswith("https://") else client).get(url)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-1.4") and SIGNATURE in pdf.content
    page = zlib.decompress(pdf.content.split(b"/FlateDecode >>\nstream\n", 1)[1].split(b"\nendstream", 1)[0])
    assert s["fingerprint"].encode() in page and rb"(Flow Homeowner \(homeowner\)) Tj" in page
    r = client.get(f"/api/py/projects/{pid}/handover/certificate.pdf", headers=h(team, "outsider"))
    assert r.status_code == 404


def test_21_a_project_manager_closes_it_and_everyone_is_told(client, team, s, backend) -> None:
    pid = s["pid"]
    assert client.post(f"/api/py/projects/{pid}/close", headers=h(team, "ho")).status_code == 403
    assert client.post(f"/api/py/projects/{pid}/close", headers=h(team, "admin")).status_code == 403
    assert client.post(f"/api/py/projects/{pid}/milestones/3/reopen", headers=h(team, "pm")).status_code == 409
    r = client.post(f"/api/py/projects/{pid}/close", headers=h(team, "pm"))
    assert r.status_code == 200, r.text
    assert status(team, pid) == "closed"
    assert {team["ho"]["uid"], team["admin"]["uid"], team["epc"]["uid"]} <= told(team, pid, "project_closed")
    d = client.get(f"/api/py/projects/{pid}/handover", headers=h(team, "ho")).json()
    assert d["closed"]["by"] == "Flow PM" and d["signature"]["name"] == "Flow Homeowner"
    assert client.post(f"/api/py/projects/{pid}/close", headers=h(team, "pm")).status_code == 409


# ------------------------------------------------------------ 7. storage


def test_22_storage_holds_exactly_the_project_files_then_is_cleaned_up(client, team, s, backend) -> None:
    pid = s["pid"]
    prefix = f"projects/{pid}/"
    if backend == "laptop":
        stored = {
            str(p.relative_to(storage.LOCAL_DIR)).replace("\\", "/")
            for p in (storage.LOCAL_DIR / prefix).rglob("*")
            if p.is_file() and p.suffix != ".type"
        }
    else:
        stored = {k.removeprefix("pytest/") for k in bucket_keys(client, f"pytest/{prefix}")}
    assert stored == set(s["keys"]), "the files and the signed certificate: nothing extra, nothing missing"
    for key in s["keys"]:
        storage.delete(key)
    left = (
        bucket_keys(client, f"pytest/{prefix}") if backend == "r2" else list((storage.LOCAL_DIR / prefix).rglob("*.*"))
    )
    assert left == []
