# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · personal data (PDPA, migration 0044), person by person.

Written from the brief, independent of the code:

  everyone with an account that's on   downloads a copy of their own data, and only their own;
                                       agrees to the privacy notice for themself
  nobody                               agrees for someone else, even a superadmin
  an account switched off              neither (they ask the Data Protection Officer)
"""

from __future__ import annotations

import psycopg
import pytest

from _lib import privacy
from _lib.db import transaction
from uat import spec

pytestmark = pytest.mark.uat

ON = [a for a in spec.ACTORS if a != "inactive"]


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_downloads_their_own_data(api, world, actor) -> None:
    r = api.get("/api/py/me/data", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
        return
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["profile"]["uid"] == world.uid(actor)
    assert d["profile"]["user_type"] == spec.ROLE[actor]
    assert "ic_last4" not in d["profile"] and "clerk_user_id" not in d["profile"]
    # Their own notifications, all of them, and nobody else's.
    n = world.conn.execute(
        "select count(*)::int as n from notifications where recipient_uid = %s", (world.uid(actor),)
    ).fetchone()["n"]
    assert len(d["notifications"]) == n


def test_a_homeowner_sees_their_home_and_nobody_elses(api, world) -> None:
    pid = world.pid["closed"]
    d = api.get("/api/py/me/data", headers=world.h("ho", pid)).json()
    mine = world.conn.execute("select project_code, address from projects where project_id = %s", (pid,)).fetchone()
    assert [h["address"] for h in d["homes"]] == [mine["address"]]
    other = api.get("/api/py/me/data", headers=world.h("ho2")).json()
    assert mine["address"] not in [h["address"] for h in other["homes"]]


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_agrees_to_the_privacy_notice(api, world, actor) -> None:
    r = api.post("/api/py/me/privacy", headers=world.h(actor))
    if actor == "inactive":
        assert r.status_code == 403
        return
    assert r.status_code == 200, r.text
    row = world.conn.execute("select privacy_version from users where uid = %s", (world.uid(actor),)).fetchone()
    assert row["privacy_version"] == privacy.VERSION


@pytest.mark.parametrize("actor", ON)
def test_nobody_agrees_for_someone_else(world, actor) -> None:
    target = world.uid("ho2" if actor != "ho2" else "ho")
    # Refused outright, or the row isn't theirs to touch: either way it's unchanged.
    try:
        with transaction(world.uid(actor)) as cur:
            cur.execute("update users set privacy_accepted_at = now(), privacy_version = 'x' where uid = %s", (target,))
    except psycopg.Error:
        pass
    row = world.conn.execute("select privacy_version from users where uid = %s", (target,)).fetchone()
    assert row["privacy_version"] != "x"
