# ruff: noqa: F811  (pytest fixtures imported from test_sites)
"""Where the EPC crew last were: only from their check-ins and check-outs.

fix         a crew member's location is the GPS fix of their latest check-in or check-out
nothing     no other way to send a location exists any more (no background sharing)
scope       a project manager sees fixes on the projects they run; a superadmin sees all
who         only project managers and superadmins can look
"""

from __future__ import annotations

import pytest
from test_sites import SITE, check_in, north, t  # noqa: F401

from conftest import bearer


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


def where(client, viewer) -> dict[int, dict]:
    r = client.get("/api/py/people/locations", headers=h(viewer))
    assert r.status_code == 200, r.text
    return {p["uid"]: p for p in r.json()["people"]}


# ------------------------------------------------------------------ fix


def test_no_check_ins_no_location(client, t) -> None:
    p = where(client, t["pm"])[t["epc2"]["uid"]]
    assert p["location"] is None and p["roleLabel"] == "EPC Team"


def test_the_check_in_fix_is_the_location(client, t) -> None:
    at = north(20)
    assert check_in(client, t, "epc", t["pid"], at=at, acc=12).status_code == 200
    loc = where(client, t["pm"])[t["epc"]["uid"]]["location"]
    assert loc["kind"] == "in" and loc["projectId"] == t["pid"]
    assert (round(loc["lat"], 6), round(loc["lng"], 6)) == (round(at[0], 6), round(at[1], 6))
    assert loc["accuracy"] == 12


def test_a_later_check_out_wins(client, t) -> None:
    r = check_in(client, t, "epc", t["pid"])
    assert r.status_code == 200, r.text
    open_id = client.get(f"/api/py/projects/{t['pid']}/visits", headers=h(t["epc"])).json()["myOpenCheckIn"]["id"]
    out = north(40)
    r = client.post(
        f"/api/py/check-ins/{open_id}/check-out",
        headers=h(t["epc"]),
        json={"lat": out[0], "lng": out[1], "accuracy": 9, "crew": 0},
    )
    assert r.status_code == 200, r.text
    loc = where(client, t["pm"])[t["epc"]["uid"]]["location"]
    assert loc["kind"] == "out" and round(loc["lat"], 6) == round(out[0], 6)


# ------------------------------------------------------------------ nothing else


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("put", "/api/py/me/location", {"lat": 1.3, "lng": 103.8}),
        ("post", "/api/py/people/1/ask-location", None),
    ],
)
def test_there_is_no_background_sharing(client, t, method, path, body) -> None:
    r = getattr(client, method)(path, headers=h(t["epc"]), **({"json": body} if body else {}))
    assert r.status_code in (404, 405)


def test_settings_no_longer_take_a_sharing_choice(client, t) -> None:
    assert client.patch("/api/py/me/settings", headers=h(t["epc"]), json={"shareLocation": True}).status_code == 400
    assert "shareLocation" not in client.get("/api/py/me", headers=h(t["epc"])).json()["settings"]


# ------------------------------------------------------------------ scope


def test_another_project_manager_sees_no_fix_from_projects_they_dont_run(client, fx, t) -> None:
    assert check_in(client, t, "epc", t["pid"]).status_code == 200
    other = fx.user("project_manager", full_name="Other PM")
    assert where(client, other)[t["epc"]["uid"]]["location"] is None


def test_a_superadmin_sees_every_fix(client, fx, t) -> None:
    assert check_in(client, t, "epc", t["pid"]).status_code == 200
    boss = fx.user("superadmin", full_name="The Superadmin")
    assert where(client, boss)[t["epc"]["uid"]]["location"]["projectId"] == t["pid"]


# ------------------------------------------------------------------ who


@pytest.mark.parametrize("who", ["ho", "admin", "epc"])
def test_only_project_managers_and_superadmins_look(client, t, who) -> None:
    assert client.get("/api/py/people/locations", headers=h(t[who])).status_code == 403
