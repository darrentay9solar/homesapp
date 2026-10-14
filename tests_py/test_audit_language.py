# ruff: noqa: E501
"""Switching the app's language isn't in the audit log (migration 0040), and older entries are hidden."""

from __future__ import annotations

import json

from conftest import bearer


def entries_about(fx, uid: int) -> list[dict]:
    return fx.conn.execute(
        "select changes from audit_log where entity_table = 'users' and entity_id = %s order by audit_id", (str(uid),)
    ).fetchall()


def test_switching_language_leaves_no_entry(client, fx) -> None:
    me = fx.user("homeowner")
    before = len(entries_about(fx, me["uid"]))
    for lang in ("zh", "en", "zh"):
        r = client.patch("/api/py/me/settings", headers=bearer(me["clerk_user_id"]), json={"language": lang})
        assert r.status_code == 200, r.text
    assert fx.conn.execute("select language from users where uid = %s", (me["uid"],)).fetchone()["language"] == "zh"
    assert len(entries_about(fx, me["uid"])) == before


def test_other_account_changes_are_still_recorded(fx) -> None:
    from _lib.db import transaction

    boss = fx.user("superadmin")
    someone = fx.user("contractor", full_name="Before")
    before = len(entries_about(fx, someone["uid"]))
    with transaction(boss["uid"]) as cur:
        cur.execute("update users set full_name = 'After', language = 'zh' where uid = %s", (someone["uid"],))
    rows = entries_about(fx, someone["uid"])
    assert len(rows) == before + 1
    assert "full_name" in rows[-1]["changes"] and "language" not in rows[-1]["changes"], "the name, not the language"


def test_older_language_entries_are_hidden(client, fx) -> None:
    pm = fx.user("project_manager")
    target = fx.user("homeowner")
    fx.conn.execute("alter table audit_log disable trigger audit_log_no_delete")
    try:
        aid = fx.conn.execute(
            "insert into audit_log (actor_uid, action, entity_table, entity_id, changes) values (%s, 'update', 'users', %s, %s) "
            "returning audit_id",
            (target["uid"], str(target["uid"]), json.dumps({"language": {"from": "en", "to": "zh"}})),
        ).fetchone()["audit_id"]
        r = client.get("/api/py/audit", headers=bearer(pm["clerk_user_id"]), params={"location": f"person:{target['uid']}"})
        assert r.status_code == 200, r.text
        assert all(e["id"] != aid for e in r.json()["entries"])
    finally:
        fx.conn.execute("delete from audit_log where audit_id = %s", (aid,))
        fx.conn.execute("alter table audit_log enable trigger audit_log_no_delete")
