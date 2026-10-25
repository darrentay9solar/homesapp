# ruff: noqa: E501  (one rule per line reads best here)
"""UAT · payments, and the other new functions, person by person (migration 0043).

Who may do what, written from the brief, independent of the code:

  Admin (fin) and the superadmin   everything about payments: the overview with amounts, every
                                   invoice, issuing the admin fee and a month's invoices, marking
                                   them paid or void, the bank statement, the invoice's design
  project managers                 whether each month and each admin fee is issued and paid, for
                                   what they run; never an amount; nothing to change
  a homeowner                      their own invoices only (with amounts and the PDF), the QR, and
                                   sending proof of payment; nobody else's
  crew and outsiders               nothing about payments
  an account switched off          nothing at all

Also: a project is closed into Maintenance only once its admin fee is paid; a project nobody
runs yet is taken on by a project manager; managers alone see the addresses of people they invite.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from uat import flowkit, spec

pytestmark = pytest.mark.uat

HANDLES = {"sa", "fin"}
MANAGERS = {"sa", "pm", "pm2"}


def code_for(actor: str, *, handles: int = 200, managers: int | None = None, homeowner: int | None = None, rest: int = 403) -> int:
    if actor == "inactive":
        return 403
    if actor in HANDLES:
        return handles
    if managers is not None and actor in MANAGERS:
        return managers
    if homeowner is not None and spec.ROLE[actor] == "homeowner":
        return homeowner
    return rest


def amounts_in(obj: object) -> bool:
    """Whether any amount appears anywhere in a response."""
    if isinstance(obj, dict):
        return any(k in ("amount", "paidAmount", "kwh", "rate", "totals", "adminFee") or amounts_in(v) for k, v in obj.items() if v is not None)
    if isinstance(obj, list):
        return any(amounts_in(x) for x in obj)
    return False


@pytest.fixture(scope="module")
def bills(world) -> dict[str, int]:
    """A system for the world's handed-over project with a month invoiced, and a fee waiting on a signed project."""
    c = world.conn
    closed, signed = world.pid["closed"], world.pid["signed"]
    sid = c.execute("select system_id from maintenance_systems where project_id = %s", (closed,)).fetchone()["system_id"]
    c.execute("update maintenance_systems set rate_per_kwh = 0.2650, turned_on_on = current_date - 90 where system_id = %s", (sid,))
    month = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1)

    def issue(**row: object) -> int:
        iid = c.execute("select nextval(pg_get_serial_sequence('invoices', 'invoice_id')) as id").fetchone()["id"]
        base = {"invoice_id": iid, "number": f"INV-UAT-{world.tag}-{iid}", "bill_to": "UAT Ho", "issued_on": date.today(),
                "due_on": date.today() + timedelta(days=14), "status": "issued"}  # fmt: skip
        row = {**base, **row}
        c.execute(f"insert into invoices ({', '.join(row)}) values ({', '.join(['%s'] * len(row))})", tuple(row.values()))
        return iid

    monthly = issue(kind="monthly", system_id=sid, project_id=closed, homeowner_id=world.uid("ho", closed), period=month,
                    kwh=812.4, rate=0.265, amount=215.29)  # fmt: skip
    c.execute("delete from invoices where project_id = %s and kind = 'admin_fee'", (signed,))
    fee = issue(kind="admin_fee", project_id=signed, homeowner_id=world.uid("ho", signed), amount=3500)
    return {"sid": sid, "monthly": monthly, "fee": fee, "closed": closed, "signed": signed}


# ------------------------------------------------------------------ the overview


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_sees_the_payments_overview(api, world, bills, actor) -> None:
    r = api.get("/api/py/finance/overview", headers=world.h(actor))
    assert r.status_code == code_for(actor, managers=200), r.text
    if r.status_code != 200:
        return
    d = r.json()
    if actor in HANDLES:
        assert d["amounts"] and "totals" in d
        assert bills["sid"] in {s["id"] for s in d["systems"]}
    else:
        assert not d["amounts"] and not amounts_in(d), "a project manager sees statuses, never amounts"
        mine = {s["id"] for s in d["systems"]}
        assert (bills["sid"] in mine) == (actor == "pm"), "only what they run"
        assert (world.pid["signed"] in {p["id"] for p in d["projects"]}) == (actor == "pm")


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_a_months_status_reads_the_same_for_admin_and_the_manager(api, world, bills, actor) -> None:
    if actor not in ("pm", "fin", "sa"):
        return
    d = api.get("/api/py/finance/overview", headers=world.h(actor)).json()
    row = next(s for s in d["systems"] if s["id"] == bills["sid"])
    states = [c["state"] for c in row["months"]]
    assert "waiting" in states or "overdue" in states, states


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_lists_every_invoice(api, world, bills, actor) -> None:
    r = api.get("/api/py/finance/invoices", headers=world.h(actor))
    assert r.status_code == code_for(actor), r.text


# ------------------------------------------------------------------ one invoice


@pytest.mark.parametrize("which", ["monthly", "fee"])
@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_opens_an_invoice_and_its_pdf(api, world, bills, actor, which) -> None:
    iid = bills[which]
    pid = bills["closed"] if which == "monthly" else bills["signed"]
    own = spec.ROLE[actor] == "homeowner" and actor == "ho"
    r = api.get(f"/api/py/invoices/{iid}", headers=world.h(actor, pid))
    expect = 403 if actor == "inactive" else 200 if actor in HANDLES or own else 404
    assert r.status_code == expect, r.text
    pdf = api.get(f"/api/py/invoices/{iid}/pdf", headers=world.h(actor, pid))
    assert pdf.status_code == expect
    if expect == 200:
        assert pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
        assert r.json()["amount"], "the homeowner and Admin see what's owed"


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_a_homeowner_sees_only_their_own_invoices(api, world, bills, actor) -> None:
    r = api.get("/api/py/payments", headers=world.h(actor, bills["closed"]))
    expect = 403 if actor == "inactive" or spec.ROLE[actor] != "homeowner" else 200
    assert r.status_code == expect
    if expect == 200:
        ids = {i["id"] for i in r.json()["invoices"]}
        assert (bills["monthly"] in ids) == (actor == "ho") and bills["fee"] not in ids


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_may_send_proof_of_payment(api, world, bills, actor) -> None:
    r = api.post(f"/api/py/invoices/{bills['monthly']}/proof/upload-link", headers=world.h(actor, bills["closed"]),
                 json={"contentType": "image/jpeg", "size": 1000})  # fmt: skip
    expect = 403 if actor == "inactive" else 200 if actor == "ho" else 404
    assert r.status_code == expect, r.text


# ------------------------------------------------------------------ changing things


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_issues_an_admin_fee(api, world, actor) -> None:
    pid = world.project("homeowner_approved", name=f"UAT fee {actor}")
    r = api.post("/api/py/finance/admin-fee", headers=world.h(actor, pid), json={"projectId": pid})
    assert r.status_code == code_for(actor), r.text
    if r.status_code == 200:
        assert r.json()["invoice"]["amount"] == "3500.00"
        assert api.post("/api/py/finance/admin-fee", headers=world.h(actor, pid), json={"projectId": pid}).status_code == 409, "once"


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_checks_and_issues_admin_fees_together(api, world, actor) -> None:
    pid = world.project("homeowner_approved", name=f"UAT fees {actor}")
    r = api.get("/api/py/finance/admin-fees", headers=world.h(actor, pid))
    assert r.status_code == code_for(actor), r.text
    if r.status_code == 200:
        row = next(x for x in r.json()["rows"] if x["projectId"] == pid)
        assert (row["amount"], row["problem"]) == ("3500.00", None), "the check shows the invoice as it will be issued"
    r = api.post("/api/py/finance/admin-fees", headers=world.h(actor, pid), json={"projectIds": [pid]})
    assert r.status_code == code_for(actor), r.text
    if r.status_code == 200:
        assert api.post("/api/py/finance/admin-fees", headers=world.h(actor, pid), json={"projectIds": [pid]}).status_code == 400, "once"


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_marks_an_invoice_paid_or_void(api, world, actor) -> None:
    pid = world.project("homeowner_approved", name=f"UAT pay {actor}")
    fee = api.post("/api/py/finance/admin-fee", headers=world.h("fin"), json={"projectId": pid}).json()["invoice"]
    r = api.post(f"/api/py/finance/invoices/{fee['id']}/paid", headers=world.h(actor, pid), json={"paidOn": fee["issuedOn"], "amount": "3500"})
    assert r.status_code == code_for(actor, rest=403), r.text
    v = api.post(f"/api/py/finance/invoices/{fee['id']}/void", headers=world.h(actor, pid), json={"reason": "UAT"})
    assert v.status_code == (409 if actor in HANDLES else code_for(actor)), "a paid invoice isn't voided"


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_designs_the_invoice(api, world, actor) -> None:
    assert api.get("/api/py/finance/settings", headers=world.h(actor)).status_code == code_for(actor)
    r = api.put("/api/py/finance/settings", headers=world.h(actor), json={"footer": f"UAT {actor}"})
    assert r.status_code == code_for(actor), r.text


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_uploads_a_bank_statement(api, world, actor) -> None:
    csv = "Transaction Date,Reference,Debit Amount,Credit Amount\n01 Oct 2026,PAYNOW INV-1999-00001,,10.00\n"
    r = api.post("/api/py/finance/statements", headers=world.h(actor), json={"fileName": "s.csv", "text": csv})
    assert r.status_code == code_for(actor), r.text


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_issues_a_month(api, world, bills, actor) -> None:
    month = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    r = api.get(f"/api/py/finance/run?month={month}", headers=world.h(actor))
    assert r.status_code == code_for(actor), r.text
    if r.status_code == 200:
        row = next(x for x in r.json()["rows"] if x["systemId"] == bills["sid"])
        assert row["invoice"]["id"] == bills["monthly"], "already invoiced: not issued twice"


# ------------------------------------------------------------------ on a project's page


@pytest.mark.parametrize(("actor", "state"), [(a, s) for a in spec.ACTORS for s in ("signed", "closed")])
def test_a_projects_payments_card(api, world, bills, actor, state) -> None:
    pid = world.pid[state]
    r = api.get(f"/api/py/projects/{pid}/payments", headers=world.h(actor, pid))
    sees = spec.sees(actor, state)
    may = sees == 200 and spec.ROLE[actor] in ("project_manager", "superadmin", "finance", "homeowner")
    assert r.status_code == (403 if actor == "inactive" else 200 if may else 404 if sees != 403 else 403), r.text
    if r.status_code == 200:
        d = r.json()
        assert d["fee"] is not None
        assert amounts_in(d) == (actor in HANDLES or actor == "ho"), "managers see statuses only"


# ------------------------------------------------------------------ the handover waits for the fee


def test_closing_waits_for_the_admin_fee(api, world) -> None:
    f = flowkit.Flow(api, world)
    try:
        assert f.create().status_code == 200
        assert f.post("ho", "/approve").status_code == 200
        assert f.post("pm", "/approve").status_code == 200
        # Straight to signed (the work itself is tested elsewhere).
        world.conn.execute("update projects set status = 'signed' where project_id = %s", (f.pid,))
        r = f.post("pm", "/close")
        assert r.status_code == 409 and "admin fee" in r.json()["error"]
        assert f.get("pm", "/handover").json()["feePaid"] is False
        fee = api.post("/api/py/finance/admin-fee", headers=world.h("fin"), json={"projectId": f.pid}).json()["invoice"]
        assert f.post("pm", "/close").status_code == 409, "issued isn't paid"
        assert api.post(f"/api/py/finance/invoices/{fee['id']}/paid", headers=world.h("fin"),
                        json={"paidOn": fee["issuedOn"], "amount": fee["amount"]}).status_code == 200  # fmt: skip
        assert f.get("pm", "/handover").json()["feePaid"] is True
        assert f.post("pm", "/close").status_code == 200
    finally:
        f.release()


# ------------------------------------------------------------------ taking on a project nobody runs


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_who_takes_on_a_project_nobody_runs(api, world, actor) -> None:
    pid = world.project("pm_approved", name=f"UAT unassigned {actor}")
    world.conn.execute("update projects set project_manager_id = null where project_id = %s", (pid,))
    seen = api.get(f"/api/py/projects/{pid}", headers=world.h(actor, pid))
    # Every project manager sees a project nobody runs (to take it on); Admin sees every project; its crew and homeowner theirs.
    may_see = actor in ("sa", "pm", "pm2", "fin", "ho") or actor in spec.CREW
    assert seen.status_code == (403 if actor == "inactive" else 200 if may_see else 404)
    r = api.post(f"/api/py/projects/{pid}/take-on", headers=world.h(actor, pid))
    expect = 403 if actor == "inactive" or spec.ROLE[actor] not in ("project_manager", "superadmin") else 200
    assert r.status_code == expect, r.text
    if expect == 200:
        assert world.conn.execute("select project_manager_id from projects where project_id = %s", (pid,)).fetchone()["project_manager_id"] == world.uid(actor)


# ------------------------------------------------------------------ calendars: whose address


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_only_managers_see_the_addresses_of_people_they_invite(api, world, actor) -> None:
    world.conn.execute("update users set address = '7 UAT Avenue', postal_code = '466001' where uid = %s", (world.uid("ho2"),))
    r = api.get("/api/py/calendar/contacts", headers=world.h(actor, world.pid["signed"]))
    if actor == "inactive":
        assert r.status_code == 403
        return
    people = r.json()["people"]
    shown = any(p.get("postalCode") for p in people)
    assert shown == (actor in MANAGERS), "addresses are for project managers and superadmins only"
