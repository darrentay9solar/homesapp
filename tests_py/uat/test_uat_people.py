"""UAT · creating accounts and the messages people get, in their language.

The brief (as changed in October): a project manager creates accounts for
every role except project manager; a superadmin for every role except
superadmin, which only ever goes straight into the database. Nobody else
creates accounts. The new person's email and WhatsApp come in the language
chosen for them.
"""

from __future__ import annotations

import re
import uuid

import pytest

from uat import spec
from uat.conftest import SENT

pytestmark = pytest.mark.uat

NEW_ROLES = ["homeowner", "contractor", "epc_team", "project_manager", "superadmin"]


def creates(actor: str, role: str) -> int:
    if actor == "inactive":
        return 403
    who = spec.ROLE[actor]
    if who not in ("project_manager", "superadmin"):
        return 403
    if role == "superadmin":
        return 400  # not a role anyone can choose: superadmins only go straight into the database
    if role == "project_manager" and who != "superadmin":
        return 403
    return 200


def _body(role: str, lang: str = "en") -> dict:
    return {
        "fullName": "UAT New Person",
        "email": f"uat-new-{uuid.uuid4().hex[:8]}@example.com",
        "role": role,
        "contactNo": "+65 9123 4567",
        "noExpiry": True,
        "language": lang,
        "icLast4": "123A" if role == "homeowner" else "",
    }


@pytest.fixture
def made(world):
    out: list[str] = []
    yield out
    if out:
        uids = [r["uid"] for r in world.conn.execute("select uid from users where email = any(%s)", (out,)).fetchall()]
        world.made_uids.extend(uids)


@pytest.mark.parametrize(("actor", "role"), [(a, r) for a in spec.ACTORS for r in NEW_ROLES])
def test_who_creates_which_accounts(api, world, made, actor, role) -> None:
    body = _body(role)
    r = api.post("/api/py/people", headers=world.h(actor), json=body)
    assert r.status_code == creates(actor, role), r.text
    if r.status_code == 200:
        made.append(body["email"])
        row = world.conn.execute("select user_type, language from users where email = %s", (body["email"],)).fetchone()
        assert row["user_type"] == role and row["language"] == "en"


HAN = re.compile(r"[一-鿿]")


@pytest.mark.parametrize("lang", ["en", "zh"])
@pytest.mark.parametrize("role", ["homeowner", "contractor", "epc_team"])
def test_a_new_account_is_greeted_in_the_chosen_language(api, world, made, lang, role) -> None:
    SENT.clear()
    body = _body(role, lang)
    r = api.post("/api/py/people", headers=world.h("pm"), json=body)
    assert r.status_code == 200, r.text
    made.append(body["email"])
    email = next(m for m in SENT if m["channel"] == "email" and m["to"] == body["email"])
    assert bool(HAN.search(email["subject"] + email["text"])) == (lang == "zh")
    wa = next(m for m in SENT if m["channel"] == "whatsapp")
    assert wa["template"] == "account_created" and wa.get("lang") == lang
    assert (
        world.conn.execute("select language from users where email = %s", (body["email"],)).fetchone()["language"]
        == lang
    )


@pytest.mark.parametrize("lang", ["fr", "", "ZH", "zh-CN"])
def test_an_unknown_language_falls_back_to_english(api, world, made, lang) -> None:
    body = _body("epc_team", lang)
    assert api.post("/api/py/people", headers=world.h("pm"), json=body).status_code == 200
    made.append(body["email"])
    assert (
        world.conn.execute("select language from users where email = %s", (body["email"],)).fetchone()["language"]
        == "en"
    )


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_may_check_file_storage(api, world, actor) -> None:
    r = api.get("/api/py/storage/check", headers=world.h(actor))
    expect = 200 if spec.ROLE[actor] in ("project_manager", "superadmin") and actor != "inactive" else 403
    assert r.status_code == expect


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_sees_the_audit_log(api, world, actor) -> None:
    r = api.get("/api/py/audit", headers=world.h(actor))
    expect = 200 if spec.ROLE[actor] in ("project_manager", "superadmin") and actor != "inactive" else 403
    assert r.status_code == expect


@pytest.mark.parametrize("state", spec.STATE_KEYS)
def test_another_pm_reads_nothing_of_a_project_they_dont_run_in_the_audit_log(api, world, state) -> None:
    pid = world.pid[state]
    mine = api.get("/api/py/audit", headers=world.h("pm"), params={"location": f"project:{pid}"})
    theirs = api.get("/api/py/audit", headers=world.h("pm2"), params={"location": f"project:{pid}"})
    boss = api.get("/api/py/audit", headers=world.h("sa"), params={"location": f"project:{pid}"})
    assert mine.status_code == theirs.status_code == boss.status_code == 200
    assert theirs.json()["entries"] == []
    assert len(boss.json()["entries"]) >= len(mine.json()["entries"])
