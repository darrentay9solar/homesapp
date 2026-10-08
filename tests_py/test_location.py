"""Sharing your location with project managers.

choice     only the person turns sharing on or off; a PM can't, even in the database
position   sent while sharing; refused otherwise; rough or impossible fixes refused
map        PMs see everyone, with positions only for those sharing; nobody else can look
forget     turning sharing off, or the account being disabled, deletes the position
ask        a PM can ask someone to share: they get an alert that opens Settings
"""

from __future__ import annotations

import psycopg
import pytest

from _lib.db import transaction
from conftest import bearer

HOME = {"lat": 1.3521, "lng": 103.8198, "accuracy": 12}


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


@pytest.fixture
def folks(fx):
    return {
        "pm": fx.user("project_manager", full_name="Map PM"),
        "e": fx.user("epc_team", full_name="Eli EPC"),
        "c": fx.user("contractor", full_name="Cara Contractor"),
        "ho": fx.user("homeowner", full_name="Hana Homeowner"),
    }


def share(client, u, on: bool = True):
    return client.patch("/api/py/me/settings", headers=h(u), json={"shareLocation": on})


def loc_row(fx, uid):
    return fx.conn.execute("select * from user_locations where uid = %s", (uid,)).fetchone()


# ------------------------------------------------------------------ choice


def test_sharing_is_off_until_the_person_turns_it_on(client, folks) -> None:
    e = folks["e"]
    assert client.get("/api/py/me", headers=h(e)).json()["settings"]["shareLocation"] is False
    r = share(client, e)
    assert r.status_code == 200, r.text
    assert r.json()["shareLocation"] is True
    assert client.get("/api/py/me", headers=h(e)).json()["settings"]["shareLocation"] is True


def test_a_pm_cannot_switch_someone_elses_sharing_even_in_the_database(fx, folks) -> None:
    pm, e = folks["pm"], folks["e"]
    with (
        pytest.raises(psycopg.Error, match="Only the person can choose to share their location"),
        transaction(pm["uid"]) as cur,
    ):
        cur.execute("update users set share_location = true where uid = %s", (e["uid"],))
    assert (
        fx.conn.execute("select share_location from users where uid = %s", (e["uid"],)).fetchone()["share_location"]
        is False
    )


def test_turning_it_on_is_in_the_audit_log(client, fx, folks) -> None:
    e = folks["e"]
    share(client, e)
    row = fx.conn.execute(
        "select changes from audit_log where entity_table = 'users' and entity_id = %s and changes ? 'share_location' "
        "order by audit_id desc limit 1",
        (str(e["uid"]),),
    ).fetchone()
    assert row and row["changes"]["share_location"]["to"] is True


# ------------------------------------------------------------------ position


def test_position_needs_sharing_on(client, folks) -> None:
    e = folks["e"]
    assert client.put("/api/py/me/location", headers=h(e), json=HOME).status_code == 409


def test_position_is_kept_and_replaced(client, fx, folks) -> None:
    e = folks["e"]
    share(client, e)
    assert client.put("/api/py/me/location", headers=h(e), json=HOME).status_code == 200
    assert (
        client.put("/api/py/me/location", headers=h(e), json={"lat": 1.30, "lng": 103.80, "accuracy": 8}).status_code
        == 200
    )
    r = loc_row(fx, e["uid"])
    assert (r["lat"], r["lng"], r["accuracy_m"]) == (1.30, 103.80, 8)
    assert (
        fx.conn.execute("select count(*)::int as n from user_locations where uid = %s", (e["uid"],)).fetchone()["n"]
        == 1
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"lat": 91, "lng": 103.8},
        {"lat": -91, "lng": 103.8},
        {"lat": 1.3, "lng": 181},
        {"lat": 1.3, "lng": -181},
        {"lat": 1.3, "lng": 103.8, "accuracy": -1},
        {"lat": 1.3, "lng": 103.8, "accuracy": 6000},
        {"lat": "here", "lng": 103.8},
        {"lng": 103.8},
        {},
    ],
)
def test_impossible_or_rough_positions_are_refused(client, folks, bad) -> None:
    e = folks["e"]
    share(client, e)
    assert client.put("/api/py/me/location", headers=h(e), json=bad).status_code in (400, 422)


def test_nobody_can_write_someone_elses_position_in_the_database(fx, folks) -> None:
    pm, e = folks["pm"], folks["e"]
    fx.conn.execute("update users set share_location = true where uid = %s", (e["uid"],))
    with (
        pytest.raises(psycopg.Error, match="Only the person can share their own location"),
        transaction(pm["uid"]) as cur,
    ):
        cur.execute("insert into user_locations (uid, lat, lng) values (%s, 1.3, 103.8)", (e["uid"],))


def test_the_database_refuses_a_position_while_not_sharing(fx, folks) -> None:
    e = folks["e"]
    with pytest.raises(psycopg.Error, match="Turn on location sharing first"), transaction(e["uid"]) as cur:
        cur.execute("insert into user_locations (uid, lat, lng) values (%s, 1.3, 103.8)", (e["uid"],))


# ------------------------------------------------------------------ map


def test_pms_see_everyone_with_positions_only_for_those_sharing(client, folks) -> None:
    pm, e, c = folks["pm"], folks["e"], folks["c"]
    share(client, e)
    client.put("/api/py/me/location", headers=h(e), json=HOME)
    r = client.get("/api/py/people/locations", headers=h(pm))
    assert r.status_code == 200, r.text
    by = {p["uid"]: p for p in r.json()["people"]}
    assert by[e["uid"]]["sharing"] is True
    assert by[e["uid"]]["location"]["lat"] == HOME["lat"]
    assert by[e["uid"]]["roleLabel"] == "EPC Team"
    assert by[c["uid"]]["sharing"] is False and by[c["uid"]]["location"] is None


@pytest.mark.parametrize("who", ["e", "c", "ho"])
def test_only_pms_see_the_map(client, folks, who) -> None:
    assert client.get("/api/py/people/locations", headers=h(folks[who])).status_code == 403


def test_disabled_accounts_are_not_on_the_map(client, fx, folks) -> None:
    pm, e = folks["pm"], folks["e"]
    fx.conn.execute("update users set active = false where uid = %s", (e["uid"],))
    uids = {p["uid"] for p in client.get("/api/py/people/locations", headers=h(pm)).json()["people"]}
    assert e["uid"] not in uids


# ------------------------------------------------------------------ forget


def test_turning_sharing_off_deletes_the_position(client, fx, folks) -> None:
    e = folks["e"]
    share(client, e)
    client.put("/api/py/me/location", headers=h(e), json=HOME)
    assert loc_row(fx, e["uid"]) is not None
    r = share(client, e, False)
    assert "deleted" in r.json()["message"]
    assert loc_row(fx, e["uid"]) is None


def test_disabling_the_account_deletes_the_position(client, fx, folks) -> None:
    pm, e = folks["pm"], folks["e"]
    share(client, e)
    client.put("/api/py/me/location", headers=h(e), json=HOME)
    r = client.patch(f"/api/py/people/{e['uid']}", headers=h(pm), json={"active": False})
    assert r.status_code == 200, r.text
    assert loc_row(fx, e["uid"]) is None


# ------------------------------------------------------------------ ask


def test_a_pm_can_ask_and_the_alert_opens_settings(client, fx, folks) -> None:
    pm, c = folks["pm"], folks["c"]
    r = client.post(f"/api/py/people/{c['uid']}/ask-location", headers=h(pm))
    assert r.status_code == 200, r.text
    n = fx.conn.execute(
        "select * from notifications where recipient_uid = %s and kind = 'location_request'", (c["uid"],)
    ).fetchone()
    assert n and n["link"] == "/account?tab=settings"
    assert "Map PM" in n["body"]
    # Not twice in a row.
    assert client.post(f"/api/py/people/{c['uid']}/ask-location", headers=h(pm)).status_code == 429


def test_asking_someone_already_sharing_says_so(client, folks) -> None:
    pm, e = folks["pm"], folks["e"]
    share(client, e)
    r = client.post(f"/api/py/people/{e['uid']}/ask-location", headers=h(pm))
    assert r.status_code == 200 and "already sharing" in r.json()["message"]


def test_only_pms_can_ask(client, folks) -> None:
    assert client.post(f"/api/py/people/{folks['c']['uid']}/ask-location", headers=h(folks["e"])).status_code == 403


def test_asking_nobody(client, folks) -> None:
    assert client.post("/api/py/people/999999999/ask-location", headers=h(folks["pm"])).status_code == 404
