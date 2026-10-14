# ruff: noqa: RUF001  (Chinese questions use Chinese punctuation)
"""Support, end to end against the test database (_routes/support.py, migration 0036).

A homeowner asks; the assistant answers from the managers' answers (Claude is
replaced here: with no key it picks the closest answer itself); asking for a
person tells the project's manager; the manager answers, brings in anyone
with an account, and either side settles it. Only the people in it, the
manager and the superadmins ever see it, and the database refuses the rest.
"""

from __future__ import annotations

import urllib.error
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
import pytest
from test_project_work import _onemap, new_project, team  # noqa: F401

from _lib import assistant, watch
from _lib.db import transaction
from conftest import bearer

SG = ZoneInfo("Asia/Singapore")
FAQ = [
    {
        "faq_id": 1, "question": "When is my next maintenance check?", "answer": "On your Maintenance tab.",
        "question_zh": "我的下一次维护检查是什么时候？", "answer_zh": "在维护标签页。", "position": 1, "active": True,
    },
    {
        "faq_id": 2, "question": "How do I clean my solar panels?", "answer": "Rinse them with water only.",
        "question_zh": None, "answer_zh": None, "position": 2, "active": True,
    },
]  # fmt: skip


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


@pytest.fixture(autouse=True)
def no_claude(monkeypatch: pytest.MonkeyPatch):
    """No key in tests: the assistant answers from this fixed list."""
    monkeypatch.setattr(assistant, "configured", lambda: False)
    monkeypatch.setattr(assistant, "faq", lambda: FAQ)


@pytest.fixture
def setup(client, fx, team):  # noqa: F811
    pid = new_project(client, team)
    boss = fx.user("superadmin", full_name="Support Boss")
    pm2 = fx.user("project_manager", full_name="Other PM")
    stranger = fx.user("homeowner", full_name="Someone Else")
    return {**team, "pid": pid, "boss": boss, "pm2": pm2, "stranger": stranger}


def ask(client, who, message: str, pid: int | None = None):
    return client.post("/api/py/support", headers=h(who), json={"message": message, "projectId": pid})


def alerts(fx, uid: int, kind: str) -> list[dict]:
    return fx.conn.execute(
        "select title, body, link from notifications where recipient_uid = %s and kind = %s order by notification_id",
        (uid, kind),
    ).fetchall()


def get(client, who, tid: int):
    return client.get(f"/api/py/support/{tid}", headers=h(who))


# ------------------------------------------------------------------ the assistant first


def test_the_assistant_answers_a_common_question(client, setup) -> None:
    r = ask(client, setup["ho"], "when is the next maintenance check?", setup["pid"])
    assert r.status_code == 200, r.text
    a = r.json()["assistant"]
    assert a == {"text": "On your Maintenance tab.", "suggestPerson": False, "source": "faq"}
    t = get(client, setup["ho"], r.json()["id"]).json()
    assert t["status"] == "assistant" and t["subject"] == "when is the next maintenance check?"
    assert [m["kind"] for m in t["messages"]] == ["text", "assistant"]
    assert t["can"]["askPerson"] and t["project"] == {"id": setup["pid"], "name": "Flow Residence"}


def test_in_chinese_it_answers_in_chinese(client, fx, setup) -> None:
    fx.conn.execute("update users set language = 'zh' where uid = %s", (setup["ho"]["uid"],))
    r = ask(client, setup["ho"], "下一次维护检查是什么时候", setup["pid"])
    assert r.json()["assistant"]["text"] == "在维护标签页。"


def test_not_sure_it_offers_a_person(client, setup) -> None:
    a = ask(client, setup["ho"], "my roof is leaking near the inverter", setup["pid"]).json()["assistant"]
    assert a["suggestPerson"] is True and a["source"] == "none" and "project manager" in a["text"]


def test_with_claude_its_answer_and_its_hand_over_come_through(client, setup, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "configured", lambda: True)
    seen = {}

    def fake(history, facts, lang):
        seen.update(history=history, facts=facts)
        return assistant.Reply("A project manager should look at that.", True, "ai")

    monkeypatch.setattr(assistant, "ask_claude", fake)
    a = ask(client, setup["ho"], "there are sparks", setup["pid"]).json()["assistant"]
    assert a == {"text": "A project manager should look at that.", "suggestPerson": True, "source": "ai"}
    assert any(
        line.startswith("Project: Flow Residence") for line in seen["facts"]
    ), "their own project, and only theirs"
    assert seen["history"][-1]["body"] == "there are sparks"


def test_claude_unreachable_falls_back_to_the_list(client, setup, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "configured", lambda: True)

    def down(*_a):
        raise urllib.error.URLError("no route")

    monkeypatch.setattr(assistant, "ask_claude", down)
    a = ask(client, setup["ho"], "how do I clean the solar panels", setup["pid"]).json()["assistant"]
    assert a["text"] == "Rinse them with water only." and a["source"] == "faq"


def test_a_daily_limit(client, setup, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "replies_today", lambda _uid: assistant.DAILY_LIMIT)
    a = ask(client, setup["ho"], "when is my next maintenance check", setup["pid"]).json()["assistant"]
    assert a["suggestPerson"] and "Talk to a person" in a["text"]


def test_the_conversation_the_model_reads() -> None:
    msgs = [
        {"kind": "event", "body": "x"},
        {"kind": "assistant", "body": "hello"},
        {"kind": "text", "body": "a"},
        {"kind": "text", "body": "b"},
        {"kind": "assistant", "body": "c"},
    ]
    assert assistant._conversation(msgs) == [
        {"role": "user", "content": "a\n\nb"},
        {"role": "assistant", "content": "c"},
    ]


@pytest.mark.parametrize(
    ("q", "faq_id"),
    [("next maintenance check date?", 1), ("cleaning my panels", 2), ("维护检查", 1), ("what is the weather", None)],
)
def test_the_closest_answer(q, faq_id) -> None:
    row, score = assistant.closest(q, FAQ)
    got = row["faq_id"] if row and score >= assistant.MATCH else None
    assert got == faq_id


# ------------------------------------------------------------------ a person


def asked_for_person(client, setup) -> int:
    tid = ask(client, setup["ho"], "my inverter shows an error", setup["pid"]).json()["id"]
    r = client.post(f"/api/py/support/{tid}/ask-person", headers=h(setup["ho"]))
    assert r.status_code == 200, r.text
    return tid


def test_asking_for_a_person_tells_the_projects_manager(client, fx, setup) -> None:
    tid = asked_for_person(client, setup)
    got = alerts(fx, setup["pm"]["uid"], "support_request")
    assert got and got[-1]["link"] == f"/support/{tid}"
    assert "Flow Homeowner asked for help about Flow Residence" in got[-1]["body"]
    assert "my inverter shows an error" in got[-1]["body"]
    t = get(client, setup["pm"], tid).json()
    assert t["status"] == "waiting" and t["handledBy"]["uid"] == setup["pm"]["uid"]
    assert any(m["uid"] == setup["pm"]["uid"] and m["handler"] for m in t["members"]), "the manager joins on first look"
    me = client.get("/api/py/me", headers=h(setup["pm"])).json()
    assert me["supportWaiting"] >= 1


def test_the_manager_answers_and_the_homeowner_hears(client, fx, setup) -> None:
    tid = asked_for_person(client, setup)
    r = client.post(f"/api/py/support/{tid}/messages", headers=h(setup["pm"]), json={"body": "Can you send a photo?"})
    assert r.status_code == 200, r.text
    t = get(client, setup["ho"], tid).json()
    assert t["status"] == "open" and t["answeredAt"]
    got = alerts(fx, setup["ho"]["uid"], "support_message")
    assert got[-1]["body"] == "Flow PM: Can you send a photo?"
    assert client.get("/api/py/me", headers=h(setup["ho"])).json()["supportUnread"] == 1
    client.post(f"/api/py/support/{tid}/read", headers=h(setup["ho"]))
    assert client.get("/api/py/me", headers=h(setup["ho"])).json()["supportUnread"] == 0


def test_crew_go_straight_to_a_person(client, fx, setup) -> None:
    r = ask(client, setup["epc"], "The scaffolding isn't there", setup["pid"])
    assert r.status_code == 200 and "assistant" not in r.json()
    t = get(client, setup["epc"], r.json()["id"]).json()
    assert t["status"] == "waiting" and alerts(fx, setup["pm"]["uid"], "support_request")


def test_managers_answer_rather_than_ask(client, setup) -> None:
    assert ask(client, setup["pm"], "hello").status_code == 403


def test_only_about_your_own_project(client, setup) -> None:
    assert ask(client, setup["stranger"], "hi", setup["pid"]).status_code == 404


# ------------------------------------------------------------------ bringing people in


def test_the_manager_brings_in_anyone_with_an_account(client, fx, setup) -> None:
    tid = asked_for_person(client, setup)
    outsider = setup["outsider"]  # not on the project
    r = client.post(f"/api/py/support/{tid}/members", headers=h(setup["pm"]), json={"uid": outsider["uid"]})
    assert r.status_code == 200, r.text
    assert alerts(fx, outsider["uid"], "support_added")[-1]["link"] == f"/support/{tid}"
    t = get(client, outsider, tid)
    assert t.status_code == 200 and t.json()["can"]["write"] and not t.json()["can"]["add"]
    assert (
        client.post(
            f"/api/py/support/{tid}/messages", headers=h(outsider), json={"body": "I'll check the wiring."}
        ).status_code
        == 200
    )
    names = [m["body"] for m in get(client, setup["ho"], tid).json()["messages"] if m["kind"] == "event"]
    assert "Flow PM added Not On It." in names
    # Taken out again, they no longer see it.
    assert client.delete(f"/api/py/support/{tid}/members/{outsider['uid']}", headers=h(setup["pm"])).status_code == 200
    assert get(client, outsider, tid).status_code == 404


def test_the_asker_stays_in(client, setup) -> None:
    tid = asked_for_person(client, setup)
    r = client.delete(f"/api/py/support/{tid}/members/{setup['ho']['uid']}", headers=h(setup["pm"]))
    assert r.status_code == 409


def test_only_the_manager_brings_people_in(client, setup) -> None:
    tid = asked_for_person(client, setup)
    r = client.post(f"/api/py/support/{tid}/members", headers=h(setup["ho"]), json={"uid": setup["outsider"]["uid"]})
    assert r.status_code == 403


def test_who_can_see_it(client, setup) -> None:
    tid = asked_for_person(client, setup)
    assert get(client, setup["stranger"], tid).status_code == 404
    assert get(client, setup["pm2"], tid).status_code == 404, "another manager's conversation"
    assert get(client, setup["boss"], tid).status_code == 200, "a superadmin sees every one"
    inbox = client.get("/api/py/support", headers=h(setup["stranger"])).json()
    assert all(t["id"] != tid for t in inbox["threads"])


def test_people_to_bring_in_put_the_projects_team_first(client, setup) -> None:
    tid = asked_for_person(client, setup)
    r = client.get(f"/api/py/support/people?thread={tid}&q=", headers=h(setup["pm"]))
    people = r.json()["people"]
    assert people[0]["onProject"] is True
    assert all(p["uid"] != setup["ho"]["uid"] for p in people), "already in it"
    found = client.get(f"/api/py/support/people?thread={tid}&q=not on", headers=h(setup["pm"])).json()["people"]
    assert [p["name"] for p in found if p["uid"] == setup["outsider"]["uid"]] == ["Not On It"]


def test_a_superadmin_hands_it_to_another_manager(client, fx, setup) -> None:
    tid = asked_for_person(client, setup)
    r = client.post(f"/api/py/support/{tid}/assign", headers=h(setup["boss"]), json={"uid": setup["pm2"]["uid"]})
    assert r.status_code == 200, r.text
    assert get(client, setup["pm2"], tid).json()["handledBy"]["uid"] == setup["pm2"]["uid"]
    assert alerts(fx, setup["pm2"]["uid"], "support_request")


# ------------------------------------------------------------------ settling


def test_settled_then_reopened_by_writing(client, fx, setup) -> None:
    tid = asked_for_person(client, setup)
    client.post(f"/api/py/support/{tid}/messages", headers=h(setup["pm"]), json={"body": "Fixed remotely."})
    assert client.post(f"/api/py/support/{tid}/settle", headers=h(setup["pm"])).status_code == 200
    assert alerts(fx, setup["ho"]["uid"], "support_settled")
    assert client.post(f"/api/py/support/{tid}/messages", headers=h(setup["pm"]), json={"body": "x"}).status_code == 409
    r = client.post(f"/api/py/support/{tid}/messages", headers=h(setup["ho"]), json={"body": "It's back again."})
    assert r.status_code == 200
    assert get(client, setup["ho"], tid).json()["status"] == "waiting"


def test_either_side_settles_and_reopens(client, setup) -> None:
    tid = asked_for_person(client, setup)
    assert client.post(f"/api/py/support/{tid}/settle", headers=h(setup["ho"])).status_code == 200
    assert client.post(f"/api/py/support/{tid}/reopen", headers=h(setup["pm"])).status_code == 200
    assert get(client, setup["ho"], tid).json()["status"] == "open"


# ------------------------------------------------------------------ the database's own rules


def test_the_database_keeps_what_was_said(client, setup) -> None:
    tid = asked_for_person(client, setup)
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(setup["ho"]["uid"]) as cur:
        cur.execute("update support_messages set body = 'changed' where thread_id = %s", (tid,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(setup["ho"]["uid"]) as cur:
        cur.execute("delete from support_threads where thread_id = %s", (tid,))


def test_the_database_refuses_strangers(client, setup) -> None:
    tid = asked_for_person(client, setup)
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(setup["stranger"]["uid"]) as cur:
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, body) values (%s, %s, 'hi')",
            (tid, setup["stranger"]["uid"]),
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(setup["ho"]["uid"]) as cur:
        cur.execute("insert into support_members (thread_id, user_id) values (%s, %s)", (tid, setup["stranger"]["uid"]))
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(setup["ho"]["uid"]) as cur:
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, null, 'assistant', 'fake')",
            (tid,),
        )


# ------------------------------------------------------------------ the answers


def test_managers_keep_the_answers(client, fx, setup) -> None:
    pm = setup["pm"]
    q = f"Pytest question {uuid.uuid4().hex[:6]}?"
    r = client.post("/api/py/support/answers", headers=h(pm), json={"question": q, "answer": "Pytest answer."})
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    try:
        assert (
            client.patch(f"/api/py/support/answers/{fid}", headers=h(pm), json={"answerZh": "测试答案。"}).status_code
            == 200
        )
        assert (
            client.patch(f"/api/py/support/answers/{fid}", headers=h(pm), json={"active": False})
            .json()["message"]
            .startswith("Turned off")
        )
        listed = client.get("/api/py/support/answers", headers=h(pm)).json()["answers"]
        row = next(a for a in listed if a["id"] == fid)
        assert row["answerZh"] == "测试答案。" and row["active"] is False
        assert (
            client.post(
                "/api/py/support/answers", headers=h(setup["ho"]), json={"question": "x", "answer": "y"}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/py/support/answers", headers=h(pm), json={"question": " ", "answer": "y"}).status_code
            == 400
        )
    finally:
        fx.conn.execute("delete from support_faq where faq_id = %s", (fid,))


# ------------------------------------------------------------------ warnings


def test_a_day_without_an_answer_goes_to_the_superadmins(client, fx, setup) -> None:
    tid = asked_for_person(client, setup)
    fx.conn.execute("update support_threads set asked_at = now() - interval '26 hours' where thread_id = %s", (tid,))
    now = datetime.now(SG)
    assert watch.unanswered_support(now, uids=[setup["boss"]["uid"]], thread_ids=[tid]) == 1
    got = alerts(fx, setup["boss"]["uid"], "escalation")
    assert got[-1]["title"] == "No answer for a day · my inverter shows an error"
    assert watch.unanswered_support(now, uids=[setup["boss"]["uid"]], thread_ids=[tid]) == 0, "once"
    assert watch.support_waiting(setup["pm"]["uid"], False) >= 1


def test_the_summary_leads_with_people_waiting() -> None:
    d = {
        "tiles": {k: {"count": 0, "ids": []} for k in ("late", "awaitingPm", "handover")},
        "projects": {},
        "delivery": {"dueSoon": []},
    }
    u = {"tiles": {k: {"count": 0, "ids": []} for k in ("urgent", "overdue", "unassigned")}, "systems": {}}
    today = datetime.now(SG).date() + timedelta(days=0)
    assert watch.summary_lines(d, u, 0, superadmin=False, today=today, support=2) == [
        "People waiting for a support answer: 2"
    ]


# ------------------------------------------------------------------ a video call


@pytest.mark.parametrize(
    "link",
    [
        "https://meet.google.com/abc-defg-hij",
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x",
        "https://us02web.zoom.us/j/123456789?pwd=abc",
        "https://zoom.us/j/987",
    ],
)
def test_the_manager_sends_a_video_call(client, fx, setup, link) -> None:
    tid = asked_for_person(client, setup)
    r = client.post(f"/api/py/support/{tid}/call", headers=h(setup["pm"]), json={"link": link})
    assert r.status_code == 200, r.text
    t = get(client, setup["ho"], tid).json()
    assert t["messages"][-1]["kind"] == "call" and t["messages"][-1]["body"] == link
    assert t["status"] == "open", "a call is an answer"
    assert alerts(fx, setup["ho"]["uid"], "support_message")[-1]["title"].startswith("Video call · ")


@pytest.mark.parametrize(
    "link",
    [
        "http://meet.google.com/abc",
        "https://meet.google.com.evil.example/abc",
        "https://evil.example/meet.google.com/abc",
        "javascript:alert(1)",
        "https://meet.google.com/",
        "",
        "https://meet.google.com/abc def",
    ],
)
def test_only_real_meeting_links(client, setup, link) -> None:
    tid = asked_for_person(client, setup)
    assert client.post(f"/api/py/support/{tid}/call", headers=h(setup["pm"]), json={"link": link}).status_code == 400


def test_only_the_manager_starts_a_call(client, setup) -> None:
    tid = asked_for_person(client, setup)
    r = client.post(f"/api/py/support/{tid}/call", headers=h(setup["ho"]), json={"link": "https://meet.google.com/abc"})
    assert r.status_code == 403
    with pytest.raises(psycopg.errors.InsufficientPrivilege), transaction(setup["ho"]["uid"]) as cur:
        cur.execute(
            "insert into support_messages (thread_id, sender_uid, kind, body) values (%s, %s, 'call', 'https://meet.google.com/x')",
            (tid, setup["ho"]["uid"]),
        )
