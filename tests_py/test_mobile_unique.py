"""One mobile number, one account (migration 0033), end to end.

Every way a number reaches an account says so under the mobile field before
anything is saved: a PM making an account, someone asking for one, a PM
approving a request, and someone changing their own number. The database's
unique index holds whatever gets past those (an import, two at once).
Numbers are compared by their digits, so spacing and dashes don't hide one.
"""

from __future__ import annotations

import uuid

import psycopg
import pytest

from _lib import account as account_mod
from _lib import clerk
from conftest import bearer, fresh_mobile


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


def spaced(number: str) -> str:
    """The same number written differently: "+65 8123 4567" → "+65-8123-4567"."""
    return number.replace(" ", "-")


@pytest.fixture
def pm(fx):
    return fx.user("project_manager", full_name="Mobile PM")


@pytest.fixture
def holder(fx):
    """Someone who already has a number."""
    return fx.user("contractor", full_name="Has The Number", contact_no=fresh_mobile())


def new_person(number: str) -> dict:
    return {
        "fullName": "Second Person",
        "email": f"pytest-mob-{uuid.uuid4().hex[:8]}@example.com",
        "contactNo": number,
        "role": "homeowner",
        "noExpiry": True,
    }


# ------------------------------------------------------------ a PM makes an account


@pytest.mark.parametrize("written", ["same", "dashes", "no spaces"])
def test_a_pm_cannot_give_a_new_account_a_number_already_taken(client, pm, holder, written) -> None:
    n = holder["contact_no"]
    number = {"same": n, "dashes": spaced(n), "no spaces": n.replace(" ", "")}[written]
    r = client.post("/api/py/people", headers=h(pm), json=new_person(number))
    assert r.status_code == 409, r.text
    assert r.json() == {
        "error": "That mobile number is already on another account. Each person needs their own.",
        "field": "mobile",
    }


def test_a_new_number_is_fine(client, fx, pm, holder) -> None:
    r = client.post("/api/py/people", headers=h(pm), json=new_person(fresh_mobile()))
    assert r.status_code == 200, r.text
    fx.uids.append(r.json()["uid"])


def test_a_taken_email_is_said_under_the_email_field(client, pm, holder) -> None:
    body = {**new_person(fresh_mobile()), "email": holder["email"]}
    r = client.post("/api/py/people", headers=h(pm), json=body)
    assert r.status_code == 409 and r.json()["field"] == "email"


def test_a_deactivated_account_still_holds_its_number(client, fx, pm, holder) -> None:
    fx.conn.execute("update users set active = false where uid = %s", (holder["uid"],))
    r = client.post("/api/py/people", headers=h(pm), json=new_person(holder["contact_no"]))
    assert r.status_code == 409, "reactivating it later must never collide"


# ------------------------------------------------------------ asking for an account


@pytest.fixture
def newcomer(monkeypatch: pytest.MonkeyPatch, fx):
    clerk_id = f"user_test_new_{uuid.uuid4().hex[:10]}"
    email = f"pytest-new-{uuid.uuid4().hex[:8]}@example.com"
    fake = clerk.ClerkUser(clerk_id, [email], email, "Aisha Rahman", None)
    monkeypatch.setattr(account_mod.clerk, "get_user", lambda _id: fake)
    yield fake
    fx.conn.execute("delete from account_requests where clerk_user_id = %s", (clerk_id,))


def ask(client, who, number: str):
    return client.post(
        "/api/py/account-requests",
        headers=bearer(who.id),
        json={"fullName": "Aisha Rahman", "role": "homeowner", "contactNo": number},
    )


def test_asking_with_a_number_on_an_account_is_refused(client, newcomer, holder) -> None:
    r = ask(client, newcomer, spaced(holder["contact_no"]))
    assert r.status_code == 409
    assert r.json() == {
        "error": "That mobile number is already on another account. Use your own mobile number.",
        "field": "mobile",
    }


def test_asking_with_a_number_on_someone_elses_waiting_request_is_refused(client, fx, newcomer) -> None:
    number = fresh_mobile()
    other = f"user_other_{uuid.uuid4().hex[:8]}"
    fx.conn.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) "
        "values (%s, %s, 'Someone Else', 'homeowner', %s)",
        (other, f"pytest-other-{uuid.uuid4().hex[:8]}@example.com", number),
    )
    try:
        r = ask(client, newcomer, number)
        assert r.status_code == 409 and r.json()["field"] == "mobile"
    finally:
        fx.conn.execute("delete from account_requests where clerk_user_id = %s", (other,))


def test_asking_with_your_own_new_number_works(client, newcomer) -> None:
    assert ask(client, newcomer, fresh_mobile()).status_code == 200


# ------------------------------------------------------------ approving a request


def test_approving_a_request_whose_number_was_taken_since_is_refused(client, fx, pm, holder) -> None:
    rid = fx.conn.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no) "
        "values (%s, %s, 'Late Asker', 'homeowner', %s) returning request_id",
        (f"user_ask_{uuid.uuid4().hex[:8]}", f"pytest-ask-{uuid.uuid4().hex[:8]}@example.com", holder["contact_no"]),
    ).fetchone()["request_id"]
    try:
        r = client.post(
            f"/api/py/account-requests/{rid}/approve", headers=h(pm), json={"role": "homeowner", "noExpiry": True}
        )
        assert r.status_code == 409
        assert "already on another account" in r.json()["error"]
        status = fx.conn.execute("select status::text from account_requests where request_id = %s", (rid,))
        assert status.fetchone()["status"] == "pending", "nothing was granted"
    finally:
        fx.conn.execute("delete from account_requests where request_id = %s", (rid,))


# ------------------------------------------------------------ changing your own


def test_changing_to_someone_elses_number_sends_no_code(client, fx, holder) -> None:
    me = fx.user("homeowner", full_name="Changing Mine", contact_no=fresh_mobile())
    r = client.post("/api/py/me/mobile/send", headers=h(me), json={"number": spaced(holder["contact_no"])})
    assert r.status_code == 409
    assert r.json()["field"] == "mobile"
    sent = fx.conn.execute("select count(*) n from verification_codes where uid = %s", (me["uid"],)).fetchone()
    assert sent["n"] == 0


# ------------------------------------------------------------ the database's own rule


def test_the_database_refuses_a_second_account_with_the_number(fx, holder) -> None:
    with pytest.raises(psycopg.errors.UniqueViolation) as e:
        fx.user("homeowner", contact_no=holder["contact_no"].replace(" ", ""))
    assert e.value.diag.constraint_name == "users_contact_no_digits_idx"


def test_accounts_without_a_number_are_fine(fx) -> None:
    fx.user("homeowner")
    fx.user("homeowner")


def test_a_clash_the_forms_miss_still_reads_well(client, fx, pm, holder, monkeypatch: pytest.MonkeyPatch) -> None:
    """Two at once: the check passes for both, the index stops the second."""
    from _routes import people as people_mod

    monkeypatch.setattr(people_mod, "mobile_taken", lambda *_a, **_k: False)
    r = client.post("/api/py/people", headers=h(pm), json=new_person(holder["contact_no"]))
    assert r.status_code == 409
    assert r.json() == {
        "error": "That mobile number is already on another account. Each person needs their own.",
        "field": "mobile",
    }
