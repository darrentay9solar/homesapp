"""The "Show warnings" switch is kept with the account (migration 0060), so it's the same on every device."""

from __future__ import annotations

import pytest

from conftest import bearer


@pytest.mark.parametrize("role", ["superadmin", "project_manager", "finance", "contractor", "epc_team", "homeowner"])
def test_the_switch_is_kept_with_the_account(client, fx, role) -> None:
    u = fx.user(role)
    h = bearer(u["clerk_user_id"])
    assert client.get("/api/py/me", headers=h).json()["settings"]["showWarnings"] is False, "off unless turned on"
    r = client.patch("/api/py/me/settings", headers=h, json={"showWarnings": True})
    assert r.status_code == 200 and r.json()["showWarnings"] is True, r.text
    assert client.get("/api/py/me", headers=h).json()["settings"]["showWarnings"] is True, "the next device sees it on"
    client.patch("/api/py/me/settings", headers=h, json={"showWarnings": False})
    assert client.get("/api/py/me", headers=h).json()["settings"]["showWarnings"] is False


def test_it_changes_nothing_else(client, fx) -> None:
    u = fx.user("project_manager")
    h = bearer(u["clerk_user_id"])
    before = client.get("/api/py/me", headers=h).json()["settings"]
    client.patch("/api/py/me/settings", headers=h, json={"showWarnings": True})
    after = client.get("/api/py/me", headers=h).json()["settings"]
    assert {k: v for k, v in after.items() if k != "showWarnings"} == {
        k: v for k, v in before.items() if k != "showWarnings"
    }
