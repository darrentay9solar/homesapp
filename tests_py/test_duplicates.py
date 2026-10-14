# ruff: noqa: E501  (one assertion per line reads best here)
"""Adding what's already in the system is refused, with the field it's about (api/_lib/duplicates.py).

projects   the same address (however it's spelt), the same postal code unless confirmed,
           a system in Maintenance at that address, a number that's another person's
accounts   the same name at the same postal code, an email or mobile on a request waiting
"""

from __future__ import annotations

import random
import uuid

import pytest
from test_project_work import _onemap, team  # noqa: F401

from _lib import duplicates
from conftest import bearer, fresh_mobile

pytestmark = pytest.mark.duplicates


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


def free_postal(fx) -> str:
    """A postal code no project or system in the test database has."""
    while True:
        p = f"{random.randrange(100000, 829999):06d}"
        if not fx.conn.execute(
            "select 1 from projects where postal_code = %(p)s union all select 1 from maintenance_systems where postal_code = %(p)s",
            {"p": p},
        ).fetchone():
            return p


@pytest.fixture
def made(fx):
    """Projects and systems the test makes, removed after."""
    m = {"projects": [], "systems": []}
    yield m
    fx.conn.execute("delete from projects where project_id = any(%s)", (m["projects"],))
    fx.conn.execute("delete from maintenance_systems where system_id = any(%s)", (m["systems"],))


def body(postal: str, **over) -> dict:
    b = {
        "name": "Duplicate Residence",
        "postalCode": postal,
        "address": "12 Hillcrest Avenue",
        "homeownerName": "Typed Owner",
        "contactNo": fresh_mobile(),
        "contractor": {"type": "text", "text": "Some Contractor"},
        "startDate": "2026-10-12",
    }
    return {**b, **over}


def create(client, team, made, b):  # noqa: F811
    r = client.post("/api/py/projects", headers=h(team["pm"]), json=b)
    if r.status_code == 200:
        made["projects"].append(r.json()["id"])
    return r


# ------------------------------------------------------------------ addresses


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("12 Hillcrest Avenue", "12 HILLCREST AVE"),
        ("12 Hillcrest Avenue", "12, Hillcrest Ave., Singapore {p}"),
        ("Blk 5 Jalan Kayu #03-12", "5 jln kayu #03-12"),
        ("88 Upper Thomson Road", "88 Upp Thomson Rd"),
    ],
)
def test_address_spellings_are_the_same_place(a, b) -> None:
    assert duplicates.address_key(a, "123456") == duplicates.address_key(b.replace("{p}", "123456"), "123456")


@pytest.mark.parametrize(("a", "b"), [("12 Hillcrest Avenue", "14 Hillcrest Avenue"), ("5 Jalan Kayu #03-12", "5 Jalan Kayu #03-14")])
def test_different_homes_stay_different(a, b) -> None:
    assert duplicates.address_key(a) != duplicates.address_key(b)


def test_the_same_address_is_refused_under_the_address(client, fx, team, made) -> None:  # noqa: F811
    postal = free_postal(fx)
    assert create(client, team, made, body(postal)).status_code == 200
    r = create(client, team, made, body(postal, address="12 hillcrest ave", name="Another Name"))
    assert r.status_code == 409 and r.json()["field"] == "address"
    assert "Duplicate Residence" in r.json()["error"]
    r = create(client, team, made, body(postal, address="12 Hillcrest Ave", samePostalOk=True))
    assert r.status_code == 409 and r.json()["field"] == "address", "confirming the postal code doesn't let the same address through"


def test_the_same_postal_code_needs_confirming(client, fx, team, made) -> None:  # noqa: F811
    postal = free_postal(fx)
    assert create(client, team, made, body(postal, address="5 Jalan Kayu #03-12")).status_code == 200
    r = create(client, team, made, body(postal, address="5 Jalan Kayu #03-14"))
    assert r.status_code == 409 and r.json()["field"] == "postal" and "tick the box" in r.json()["error"]
    assert create(client, team, made, body(postal, address="5 Jalan Kayu #03-14", samePostalOk=True)).status_code == 200


def test_a_system_in_maintenance_at_the_address(client, fx, team, made) -> None:  # noqa: F811
    postal = free_postal(fx)
    sid = fx.conn.execute(
        "insert into maintenance_systems (address, postal_code, homeowner_name, project_code) values (%s, %s, 'Tan', '9SH9999') returning system_id",
        (f"12 Hillcrest Avenue Singapore {postal}", postal),
    ).fetchone()["system_id"]
    made["systems"].append(sid)
    r = create(client, team, made, body(postal))
    assert r.status_code == 409 and r.json()["field"] == "address" and "Maintenance" in r.json()["error"] and "9SH9999" in r.json()["error"]


def test_editing_without_moving_is_fine(client, fx, team, made) -> None:  # noqa: F811
    postal = free_postal(fx)
    a = create(client, team, made, body(postal, address="5 Jalan Kayu #03-12")).json()["id"]
    assert create(client, team, made, body(postal, address="5 Jalan Kayu #03-14", samePostalOk=True)).status_code == 200
    contact = fx.conn.execute("select homeowner_contact_no from projects where project_id = %s", (a,)).fetchone()["homeowner_contact_no"]
    r = client.patch(f"/api/py/projects/{a}", headers=h(team["pm"]), json=body(postal, address="5 Jalan Kayu #03-12", name="Renamed", contactNo=contact))
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/py/projects/{a}", headers=h(team["pm"]), json=body(postal, address="5 Jalan Kayu #03-14", contactNo=contact, samePostalOk=True))
    assert r.status_code == 409 and r.json()["field"] == "address", "moving it onto the other one's address"


# ------------------------------------------------------------------ the homeowner's number


def test_a_homeowner_accounts_number_means_link_the_account(client, fx, team, made) -> None:  # noqa: F811
    number = fx.conn.execute("select contact_no from users where uid = %s", (team["ho"]["uid"],)).fetchone()["contact_no"]
    if not number:
        number = fresh_mobile()
        fx.conn.execute("update users set contact_no = %s where uid = %s", (number, team["ho"]["uid"]))
    r = create(client, team, made, body(free_postal(fx), contactNo=number))
    assert r.status_code == 409 and r.json()["field"] == "contact" and "Flow Homeowner" in r.json()["error"]
    r = create(client, team, made, body(free_postal(fx), contactNo=number, homeownerId=team["ho"]["uid"], homeownerName=""))
    assert r.status_code == 200, r.text


def test_a_staff_number_is_refused(client, fx, team, made) -> None:  # noqa: F811
    number = fresh_mobile()
    fx.conn.execute("update users set contact_no = %s where uid = %s", (number, team["admin"]["uid"]))
    r = create(client, team, made, body(free_postal(fx), contactNo=number))
    assert r.status_code == 409 and r.json()["field"] == "contact" and "staff" in r.json()["error"]


def test_another_homeowners_number_is_refused_but_the_same_homeowner_is_fine(client, fx, team, made) -> None:  # noqa: F811
    number = fresh_mobile()
    assert create(client, team, made, body(free_postal(fx), contactNo=number, homeownerName="Mdm Lee")).status_code == 200
    assert create(client, team, made, body(free_postal(fx), contactNo=number, homeownerName="mdm lee ")).status_code == 200, "her second home"
    r = create(client, team, made, body(free_postal(fx), contactNo=number, homeownerName="Mr Ong"))
    assert r.status_code == 409 and r.json()["field"] == "contact"


# ------------------------------------------------------------------ accounts


def person(**over) -> dict:
    return {"fullName": "Dup Person", "email": f"dup-{uuid.uuid4().hex[:8]}@example.com", "contactNo": fresh_mobile(),
            "role": "homeowner", "noExpiry": True, **over}  # fmt: skip


def test_the_same_person_at_the_same_postal_code(client, fx, team, monkeypatch) -> None:  # noqa: F811
    from _lib import onemap

    postal = f"{random.randrange(100000, 829999):06d}"
    loc = type("L", (), {"address": "1 Somewhere Road", "postal_code": postal, "lat": 1.3, "lng": 103.8})()
    monkeypatch.setattr(onemap, "resolve", lambda _a, _p: loc)
    name = f"Dup {uuid.uuid4().hex[:6]}"
    r = client.post("/api/py/people", headers=h(team["pm"]), json=person(fullName=name, postalCode=postal, address="1 Somewhere Road"))
    assert r.status_code == 200, r.text
    try:
        r = client.post("/api/py/people", headers=h(team["pm"]), json=person(fullName=f" {name.upper()} ", postalCode=postal, address="1 Somewhere Road"))
        assert r.status_code == 409 and r.json()["field"] == "fullName" and "already has an account" in r.json()["error"]
    finally:
        fx.conn.execute("delete from users where postal_code = %s and lower(full_name) = lower(%s)", (postal, name))


def test_an_email_or_mobile_on_a_waiting_request(client, fx, team) -> None:  # noqa: F811
    email, mobile = f"waiting-{uuid.uuid4().hex[:8]}@example.com", fresh_mobile()
    rid = fx.conn.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) values (%s, %s, 'Waiting', 'homeowner', %s) returning request_id",
        (f"user_{uuid.uuid4().hex[:8]}", email, mobile),
    ).fetchone()["request_id"]
    try:
        r = client.post("/api/py/people", headers=h(team["pm"]), json=person(email=email))
        assert r.status_code == 409 and r.json()["field"] == "email"
        r = client.post("/api/py/people", headers=h(team["pm"]), json=person(contactNo=mobile))
        assert r.status_code == 409 and r.json()["field"] == "mobile"
    finally:
        fx.conn.execute("delete from account_requests where request_id = %s", (rid,))
