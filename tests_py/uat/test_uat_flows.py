# ruff: noqa: RUF001  (Chinese full-width punctuation is the point)
"""UAT · the flows from the brief, start to finish, as the people who'd do them.

Each test is one story: a project created, approved, worked through its three
milestones, signed by the homeowner and closed, with the twists that happen
in real life along the way (a decline, a correction after signing was asked
for, someone looking at a project that isn't theirs). docs/PROCESS_FLOW.md
describes the same flows for people.
"""

from __future__ import annotations

import zlib

import pytest

from uat import flowkit, spec
from uat.conftest import SENT

pytestmark = pytest.mark.uat


@pytest.fixture
def flow(api, world) -> flowkit.Flow:
    return flowkit.Flow(api, world)


# ------------------------------------------------------------ the whole way


@pytest.mark.parametrize(
    ("m1", "m2", "m3"),
    [
        ("crew_epc", "crew_admin", "crew_epc"),
        ("assigned_epc", "assigned_epc", "assigned_epc"),
        ("crew_admin", "crew_admin", "crew_admin"),
        ("pm", "pm", "pm"),
        ("sa", "crew_epc", "pm"),
    ],
)
def test_start_to_finish(flow, world, m1, m2, m3) -> None:
    """Created → homeowner approves → PM approves → M1, M2, M3 → homeowner signs → PM closes."""
    assert flow.create().status_code == 200
    assert flow.status() == "awaiting_homeowner"
    assert flow.told("approval_request") == {world.uid("ho")}
    assert flow.post("ho", "/approve").status_code == 200
    assert flow.status() == "homeowner_approved"
    assert world.uid("pm") in flow.told("approval_request"), "the PM is asked next"
    assert flow.post("pm", "/approve").status_code == 200
    assert flow.status() == "pm_approved"

    r = flow.milestone_1(m1)
    assert r.status_code == 200 and "Milestone 1 complete" in r.json()["message"]
    assert flow.status() == "in_progress"
    r = flow.milestone_2(m2)
    assert r.status_code == 200 and "Milestone 2 complete" in r.json()["message"]
    r = flow.milestone_3(m3)
    assert r.status_code == 200 and "Milestone 3 complete" in r.json()["message"]
    assert flow.status() == "awaiting_signature"
    assert flow.told("signature_request") == {world.uid("ho")}

    assert flow.sign().status_code == 200
    assert flow.status() == "signed"
    assert flow.told("signed") == {world.uid("pm")}
    assert flow.post("pm", "/close").status_code == 200
    assert flow.status() == "closed"
    told = flow.told("project_closed")
    assert {world.uid("ho"), world.uid("crew_admin"), world.uid("crew_epc"), world.uid("assigned_epc")} <= told
    assert world.uid("sa") in told, "the admin team (superadmins) hear a project closed"

    listed = flow.get("ho").json()
    assert listed["status"] == "closed" and listed["progress"] == 100


def test_the_homeowner_declines_then_approves_when_asked_again(flow, world) -> None:
    assert flow.create().status_code == 200
    r = flow.post("ho", "/decline", {"reason": "Can we start in December?"})
    assert r.status_code == 200 and flow.status() == "homeowner_declined"
    assert flow.told("approval_declined") == {world.uid("pm")}
    assert flow.post("ho", "/decline", {"reason": "again"}).status_code == 409, "already declined"
    assert flow.post("pm", "/remind").status_code == 200
    assert flow.status() == "awaiting_homeowner"
    assert flow.post("ho", "/approve").status_code == 200
    assert flow.status() == "homeowner_approved"


def test_a_declined_project_can_still_be_approved_directly(flow) -> None:
    assert flow.create().status_code == 200
    assert flow.post("ho", "/decline", {"reason": ""}).status_code == 200
    assert flow.post("ho", "/approve").status_code == 200
    assert flow.status() == "homeowner_approved"


def test_a_typed_homeowner_waits_in_draft_until_their_account_is_linked(flow, world) -> None:
    assert flow.create(homeowner=None).status_code == 200
    assert flow.status() == "draft"
    assert flow.post("ho", "/approve").status_code == 404, "not theirs until linked"
    p = world.conn.execute("select * from projects where project_id = %s", (flow.pid,)).fetchone()
    body = {
        "name": p["name"],
        "postalCode": p["postal_code"],
        "address": p["address"],
        "homeownerId": world.uid("ho"),
        "contactNo": p["homeowner_contact_no"],
        "contractor": {"type": "group", "groupId": world.group},
        "startDate": p["installation_start_date"].isoformat(),
        "endDate": p["target_end_date"].isoformat(),
    }
    r = flow.api.patch(f"/api/py/projects/{flow.pid}", headers=world.h("pm"), json=body)
    assert r.status_code == 200 and "asked to approve" in r.json()["message"]
    assert flow.status() == "awaiting_homeowner"
    assert flow.post("ho", "/approve").status_code == 200


# ------------------------------------------------------------ milestones


def test_milestones_open_in_order(flow) -> None:
    assert flow.create().status_code == 200
    flow.approve_both()
    assert flow.save("crew_epc", "pvl_received_date", "2026-12-01").status_code == 403, "Milestone 2 isn't open"
    assert flow.save("crew_epc", "pre_inspection_date", "2026-12-01").status_code == 403, "nor Milestone 3"
    assert flow.milestone_1().status_code == 200
    assert flow.save("crew_epc", "pre_inspection_date", "2026-12-01").status_code == 403, "Milestone 3 still shut"
    assert flow.milestone_2().status_code == 200
    assert flow.save("crew_epc", "pre_inspection_date", "2026-12-01").status_code == 200


def test_a_completed_milestone_is_fixed_for_the_crew_until_a_pm_reopens_it(flow) -> None:
    assert flow.create().status_code == 200
    flow.approve_both()
    assert flow.milestone_1().status_code == 200
    assert flow.save("crew_epc", "sales", "Someone else").status_code == 403
    assert flow.save("pm", "sales", "Corrected by the PM").status_code == 200, "a PM can still correct it"
    assert flow.save("pm", "sales", "").status_code == 400, "but not empty a required field of a completed milestone"
    assert flow.post("crew_epc", "/milestones/1/reopen").status_code == 403
    assert flow.post("pm", "/milestones/1/reopen").status_code == 200
    r = flow.save("crew_epc", "sales", "K. Chandra")
    assert r.status_code == 200 and "Milestone 1 complete" in r.json()["message"], "complete again, so recorded again"
    assert flow.post("pm", "/milestones/3/reopen").status_code == 409, "Milestone 3 was never complete"


def test_a_conditional_date_that_no_longer_applies_can_be_cleared(flow) -> None:
    """The inverter was due for collection on a date; once collected, that date isn't needed."""
    assert flow.create().status_code == 200
    flow.approve_both()
    assert flow.save("crew_epc", "inverter_collected", False).status_code == 200
    assert flow.save("crew_epc", "inverter_date", "2026-11-20").status_code == 200
    assert flow.milestone_1().status_code == 200  # sets inverter_collected back to True
    assert flow.save("pm", "inverter_date", None).status_code == 200


# ------------------------------------------------------------ handover


def test_the_homeowner_signs_only_what_they_saw(flow, world) -> None:
    flow.to_signature()
    seen = flow.handover()["fingerprint"]
    p = world.conn.execute("select * from projects where project_id = %s", (flow.pid,)).fetchone()
    body = {
        "name": "UAT flow renamed while reading",
        "postalCode": p["postal_code"],
        "address": p["address"],
        "homeownerId": world.uid("ho"),
        "contactNo": p["homeowner_contact_no"],
        "contractor": {"type": "group", "groupId": world.group},
        "startDate": p["installation_start_date"].isoformat(),
        "endDate": p["target_end_date"].isoformat(),
    }
    assert flow.api.patch(f"/api/py/projects/{flow.pid}", headers=world.h("pm"), json=body).status_code == 200
    stale = flow.sign(fingerprint=seen)
    assert stale.status_code == 409 and "changed" in stale.json()["error"]
    fresh = flow.handover()
    assert dict(fresh["certificate"]["rows"])["Project"] == "UAT flow renamed while reading"
    assert flow.sign().status_code == 200
    signed = flow.handover("pm")
    assert dict(signed["certificate"]["rows"])["Project"] == "UAT flow renamed while reading"
    # After signing, the signed version stays put even if details change again.
    body["name"] = "UAT flow renamed after signing"
    assert flow.api.patch(f"/api/py/projects/{flow.pid}", headers=world.h("pm"), json=body).status_code == 200
    assert dict(flow.handover("pm")["certificate"]["rows"])["Project"] == "UAT flow renamed while reading"


@pytest.mark.parametrize(
    ("over", "code", "words"),
    [
        ({"agree": False}, 400, "Tick the box"),
        ({"signerName": ""}, 400, "full name"),
        ({"signerName": "A"}, 400, "full name"),
        ({"signature": ""}, 400, "signature"),
        ({"signature": "data:image/png;base64,iVBORw0KGgo="}, 400, "signature"),
        ({"signature": "not base64 at all!"}, 400, "signature"),
        ({"signature": "data:image/jpeg;base64,/9j/4AAQ"}, 400, "signature"),
        ({"fingerprint": ""}, 409, "changed"),
        ({"fingerprint": "f" * 64}, 409, "changed"),
    ],
)
def test_a_signature_needs_everything(flow, over, code, words) -> None:
    flow.to_signature()
    r = flow.sign(**over)
    assert r.status_code == code and words in r.json()["error"], r.text
    assert flow.status() == "awaiting_signature", "nothing was signed"


def test_reopening_a_milestone_withdraws_the_request_to_sign(flow, world) -> None:
    flow.to_signature()
    assert flow.post("pm", "/milestones/3/reopen").status_code == 200
    assert flow.status() == "in_progress"
    assert flow.sign().status_code == 409, "not waiting for a signature any more"
    titles = [
        r["title"]
        for r in world.conn.execute(
            "select title from notifications where project_id = %s and recipient_uid = %s",
            (flow.pid, world.uid("ho")),
        ).fetchall()
    ]
    assert any(t.startswith("Signature request withdrawn") for t in titles)
    r = flow.upload("crew_epc", "handover_docs")
    assert r.status_code == 200 and "Milestone 3 complete" in r.json()["message"], "asked again once complete"
    assert flow.status() == "awaiting_signature"
    assert flow.sign().status_code == 200


def test_at_handover_the_crew_can_no_longer_change_anything(flow) -> None:
    flow.to_signature()
    for key, value in flowkit.M1_FIELDS.items():
        assert flow.save("crew_epc", key, value).status_code == 403, key
    for slot in flowkit.M1_FILES + flowkit.M3_FILES:
        assert flow.upload("crew_admin", slot).status_code == 403, slot
    assert flow.post("crew_epc", "/visits", {"date": flowkit.DAY.isoformat()}).status_code == 400


def test_a_signed_certificate_is_a_pdf_with_the_signature_and_fingerprint(flow) -> None:
    flow.to_signature()
    assert flow.sign().status_code == 200
    h = flow.handover("ho")
    r = flow.get("crew_admin", "/handover/certificate.pdf")
    assert r.status_code == 302
    pdf = flow.api.get(r.headers["location"]).content
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    page = zlib.decompress(pdf.split(b"/FlateDecode >>\nstream\n", 1)[1].split(b"\nendstream", 1)[0])
    assert h["fingerprint"].encode() in page and b"Installation Certificate" in page
    assert flowkit.world_mod.SIGNATURE in pdf


def test_the_pm_closes_only_after_the_signature(flow, world) -> None:
    flow.to_signature()
    assert flow.post("pm", "/close").status_code == 409
    assert flow.post("pm2", "/close").status_code == 404, "another PM's project"
    assert flow.sign().status_code == 200
    assert flow.post("crew_admin", "/close").status_code == 403
    assert flow.post("ho", "/close").status_code == 403
    assert flow.post("pm", "/milestones/1/reopen").status_code == 409, "signed: no going back"
    assert flow.post("pm", "/close").status_code == 200
    h = flow.handover("ho")
    assert h["closed"]["by"] == world.people["pm"]["full_name"]


def test_a_superadmin_can_close_any_project(flow, world) -> None:
    flow.to_signature()
    assert flow.sign().status_code == 200
    assert flow.post("sa", "/close").status_code == 200
    assert flow.handover("pm")["closed"]["by"] == world.people["sa"]["full_name"]


def test_an_older_project_at_milestone_3_can_be_sent_for_signature(flow, world) -> None:
    """Projects that finished Milestone 3 before e-signing existed wait in progress; a PM sends them."""
    flow.to_signature()
    world.conn.execute("update projects set status = 'in_progress' where project_id = %s", (flow.pid,))
    assert flow.handover("pm")["actions"]["request"] is True
    assert flow.post("crew_epc", "/handover/request").status_code == 403
    assert flow.post("pm", "/handover/request").status_code == 200
    assert flow.status() == "awaiting_signature"
    assert flow.post("pm", "/handover/request").status_code == 409


def test_the_pm_can_remind_the_homeowner_to_sign(flow, world) -> None:
    flow.to_signature()
    before = len(flow.told("signature_request"))
    assert flow.post("pm", "/handover/remind").status_code == 200
    n = world.conn.execute(
        "select count(*)::int as n from notifications where project_id = %s and kind = 'signature_request'",
        (flow.pid,),
    ).fetchone()["n"]
    assert before == 1 and n == 2


# ------------------------------------------------------------ who runs what


def test_another_pm_sees_nothing_of_a_project_they_dont_run(flow) -> None:
    assert flow.create().status_code == 200
    for path in ("", "/fields", "/visits", "/handover"):
        assert flow.get("pm2", path).status_code == 404, path
    assert flow.post("pm2", "/remind").status_code == 404


def test_a_superadmin_hands_a_project_to_another_pm(flow, world) -> None:
    assert flow.create(by="sa", manager="pm2").status_code == 200
    assert flow.get("pm2").status_code == 200
    assert flow.get("pm").status_code == 404, "pm doesn't run this one"
    assert flow.post("ho", "/approve").status_code == 200
    assert flow.post("pm", "/approve").status_code == 404
    assert flow.post("pm2", "/approve").status_code == 200


def test_a_pm_cant_create_a_project_for_another_pm(flow) -> None:
    r = flow.create(by="pm", manager="pm2")
    assert r.status_code == 403


@pytest.mark.parametrize("actor", ["crew_admin", "crew_epc", "ho", "out_admin", "inactive"])
def test_only_project_managers_create_projects(flow, actor) -> None:
    assert flow.create(by=actor).status_code == 403


# ------------------------------------------------------------ messages in Chinese


def test_a_chinese_speaking_homeowner_gets_their_emails_in_chinese(flow, world) -> None:
    world.conn.execute("update users set language = 'zh' where uid = %s", (world.uid("ho"),))
    try:
        SENT.clear()
        flow.to_signature()
        to_ho = [m for m in SENT if m["channel"] == "email" and m["to"] == world.people["ho"]["email"]]
        subjects = [m["subject"] for m in to_ho]
        assert any(s.startswith("9 Solar Home：请批准") for s in subjects), subjects
        assert any("请签署" in s and "移交证书" in s for s in subjects), subjects
        assert all(m["html"].startswith('<!doctype html><html lang="zh-Hans">') for m in to_ho)
        assert flow.sign().status_code == 200
        SENT.clear()
        assert flow.post("pm", "/close").status_code == 200
        closed = [m for m in SENT if m["channel"] == "email" and m["to"] == world.people["ho"]["email"]]
        assert closed and "已完成" in closed[0]["subject"] and "感谢您选择" in closed[0]["text"]
    finally:
        world.conn.execute("update users set language = 'en' where uid = %s", (world.uid("ho"),))


def test_an_english_speaking_homeowner_gets_english(flow, world) -> None:
    SENT.clear()
    flow.to_signature()
    to_ho = [m for m in SENT if m["channel"] == "email" and m["to"] == world.people["ho"]["email"]]
    assert {m["subject"].split(":")[0] for m in to_ho} == {"9 Solar Home"}
    assert any("sign the handover certificate" in m["subject"] for m in to_ho)
    assert not any("移交" in m["text"] for m in to_ho)


# ------------------------------------------------------------ notifications


def test_who_hears_what_along_the_way(flow, world) -> None:
    flow.to_signature()
    ho, pm, crew = world.uid("ho"), world.uid("pm"), {world.uid(a) for a in spec.CREW}
    assert flow.told("approval_request") == {ho, pm}
    assert crew <= flow.told("approval_granted") and ho in flow.told("approval_granted")
    assert flow.told("milestone_complete") >= crew - {world.uid("crew_epc")} | {pm}
    assert flow.told("signature_request") == {ho}
    assert world.uid("pm2") not in set().union(*(flow.told(k) for k in ("approval_request", "milestone_complete")))
