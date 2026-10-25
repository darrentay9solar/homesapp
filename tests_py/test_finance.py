# ruff: noqa: E501  (one assertion per line reads best here)
"""Payments (migration 0043): amounts, the plan's months, bank statements, the PDF, and issuing.

amounts      kWh x rate to the cent, half a cent up; the plan's 96 months from the turn-on month
statements   a bank's CSV read whatever its layout; each credit matched by the invoice number it names
pdf          one A4 page with the number, the amount, how to pay, and PAID once it is
issuing      a month's invoices from each system's kWh, the homeowner told; paid from a statement
"""

from __future__ import annotations

import re
import uuid
import zlib
from datetime import date, timedelta
from decimal import Decimal

import pytest
from test_project_work import _onemap  # noqa: F401

from _lib import invoices as iv
from conftest import bearer


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


# ------------------------------------------------------------------ amounts


@pytest.mark.parametrize(("kwh", "rate", "want"), [
    ("812.40", "0.2650", "215.29"),   # 215.286 → .29
    ("100", "0.2125", "21.25"),
    ("1", "0.0050", "0.01"),          # half a cent goes up
    ("1", "0.0049", "0.00"),
    ("0", "0.30", "0.00"),
    ("12345.67", "0.2899", "3579.01"),
])  # fmt: skip
def test_kwh_times_rate(kwh, rate, want) -> None:
    assert iv.monthly_amount(kwh, rate) == Decimal(want)


def test_money_reads_like_singapore_dollars() -> None:
    assert iv.money("3500") == "S$3,500.00" and iv.money(Decimal("-12.4")) == "-S$12.40" and iv.money(None) == "S$0.00"


def test_the_plan_is_ninety_six_months_from_the_turn_on_month() -> None:
    months = iv.plan_months(date(2026, 3, 14), 8)
    assert len(months) == 96 and months[0] == date(2026, 3, 1) and months[-1] == date(2034, 2, 1)
    assert iv.in_plan(date(2034, 2, 1), date(2026, 3, 14), 8) and not iv.in_plan(date(2034, 3, 1), date(2026, 3, 14), 8)
    assert not iv.in_plan(date(2026, 2, 1), date(2026, 3, 14), 8) and not iv.in_plan(date(2026, 5, 1), None, 8)


def test_an_invoices_number_and_state() -> None:
    assert iv.number(42, date(2026, 11, 2)) == "INV-2026-00042"
    base = {"status": "issued", "due_on": date(2026, 11, 16)}
    assert iv.state(base, date(2026, 11, 16)) == "waiting" and iv.state(base, date(2026, 11, 17)) == "overdue"
    assert iv.state({**base, "status": "paid"}, date(2027, 1, 1)) == "paid"


# ------------------------------------------------------------------ statements

DBS = """Account Details For:,eMulti-Currency Autosave 123-456789-0
Statement as at:,15 Oct 2026

Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1,Transaction Ref2,Transaction Ref3
01 Oct 2026,ICT,,215.29,PAYNOW INV-2026-00042,TAN AH KOW,
02 Oct 2026,ICT,50.00,,GRAB,,
03 Oct 2026,ICT,,"3,500.00",inv 2026 00043 admin fee,LEE,
"""
OCBC = """Transaction date,Value date,Description,Withdrawals (SGD),Deposits (SGD)
05/10/2026,05/10/2026,FAST PAYMENT INV202600044 KOH,,140.00
06/10/2026,06/10/2026,NETS,12.00,
"""
SIGNED_AMOUNT = """Date,Details,Amount
2026-10-07,PAYNOW INV-2026-00045,88.10
2026-10-07,BILL PAYMENT,-20.00
2026-10-08,PAYNOW INV-2026-00046,(5.00)
"""


def test_a_dbs_style_statement() -> None:
    lines = iv.parse_statement(DBS)
    assert [(ln["date"], ln["amount"]) for ln in lines] == [("2026-10-01", "215.29"), ("2026-10-03", "3500.00")]
    assert "INV-2026-00042" in lines[0]["words"]


def test_an_ocbc_style_statement() -> None:
    lines = iv.parse_statement(OCBC)
    assert [(ln["date"], ln["amount"]) for ln in lines] == [("2026-10-05", "140.00")]


def test_one_amount_column_with_signs() -> None:
    assert [ln["amount"] for ln in iv.parse_statement(SIGNED_AMOUNT)] == ["88.10"], "money out is left out"


def test_a_file_that_isnt_a_statement() -> None:
    with pytest.raises(ValueError, match="columns"):
        iv.parse_statement("hello,world\n1,2\n")


def test_matching() -> None:
    open_ = [
        {"invoice_id": 42, "number": "INV-2026-00042", "amount": Decimal("215.29"), "status": "issued"},
        {"invoice_id": 43, "number": "INV-2026-00043", "amount": Decimal("3500.00"), "status": "issued"},
        {"invoice_id": 44, "number": "INV-2026-00044", "amount": Decimal("150.00"), "status": "issued"},
        {"invoice_id": 45, "number": "INV-2026-00045", "amount": Decimal("88.10"), "status": "paid"},
    ]
    lines = iv.parse_statement(DBS) + iv.parse_statement(OCBC) + iv.parse_statement(SIGNED_AMOUNT)
    lines.append({"date": "2026-10-09", "amount": "215.29", "words": "PAYNOW INV-2026-00042 AGAIN"})
    got = [(m["number"], m["result"]) for m in iv.match(lines, open_)]
    assert got == [
        ("INV-2026-00042", "match"),
        ("INV-2026-00043", "match"),
        ("INV-2026-00044", "amount differs"),
        ("INV-2026-00045", "already paid"),
        ("INV-2026-00042", "already paid"),
    ]


# ------------------------------------------------------------------ the PDF


def _text(pdf: bytes) -> str:
    stream = re.search(rb"stream\n(.*?)\nendstream", pdf, re.S).group(1)
    return zlib.decompress(stream).decode("latin-1")


SETTINGS = {"company_name": "9 Solar Home", "company_address": "10 Example Crescent", "company_uen": "202000000X",
            "pay_note": "Scan the QR and put the invoice number as the reference.", "accent": "#0B8A5A",
            "invoice_title": "INVOICE", "terms": "Due in 14 days.", "footer": "Thank you.", "show": {}}  # fmt: skip
INV = {"number": "INV-2026-00042", "kind": "monthly", "bill_to": "Tan Ah Kow", "bill_address": "7 Example Avenue", "bill_email": None,
       "issued_on": date(2026, 11, 1), "due_on": date(2026, 11, 15), "period": date(2026, 10, 1), "kwh": Decimal("812.40"),
       "rate": Decimal("0.2650"), "amount": Decimal("215.29"), "status": "issued"}  # fmt: skip


def test_the_pdf_says_what_and_how_to_pay() -> None:
    pdf = iv.pdf(INV, SETTINGS)
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    t = _text(pdf)
    for words in ("INV-2026-00042", "Tan Ah Kow", "S$215.29", "October 2026", "812.40", "Reference: INV-2026-00042", "UEN 202000000X", "Due in 14 days."):
        assert words in t, words


def test_a_paid_invoice_says_so_and_hides_how_to_pay() -> None:
    t = _text(iv.pdf({**INV, "status": "paid", "paid_on": date(2026, 11, 6), "paid_amount": Decimal("215.29")}, SETTINGS))
    assert "PAID S$215.29 on 06 Nov 2026" in t and "HOW TO PAY" not in t


def test_the_admin_fee_and_hidden_parts() -> None:
    t = _text(iv.pdf({**INV, "kind": "admin_fee", "period": None, "kwh": None, "rate": None, "amount": Decimal("3500")},
                     {**SETTINGS, "show": {"uen": False, "terms": False}}))  # fmt: skip
    assert r"Admin fee \(one-time\)" in t and "S$3,500.00" in t and "KWH" not in t and "UEN" not in t and "Due in 14 days." not in t


# ------------------------------------------------------------------ issuing, through the API


@pytest.fixture
def fin(fx):
    return fx.user("finance", full_name="Test Admin")


@pytest.fixture
def system(fx):
    """A system turned on three months ago, with a homeowner account and last month's kWh."""
    ho = fx.user("homeowner", full_name="Billed Homeowner")
    month = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1)
    sid = fx.conn.execute(
        "insert into maintenance_systems (import_ref, address, postal_code, homeowner_id, rate_per_kwh, turned_on_on, kwp) "
        "values (%s, '7 Test Avenue', '466001', %s, 0.2650, current_date - 90, 8) returning system_id",
        (f"pytest-fin-{uuid.uuid4().hex[:8]}", ho["uid"]),
    ).fetchone()["system_id"]
    fx.conn.execute("insert into system_output (system_id, month, kwh) values (%s, %s, 812.40)", (sid, month))
    yield {"sid": sid, "ho": ho, "month": month}
    fx.conn.execute("delete from invoices where system_id = %s", (sid,))
    fx.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def test_a_months_invoices_from_the_kwh(client, fx, fin, system) -> None:
    m = system["month"].strftime("%Y-%m")
    rows = client.get(f"/api/py/finance/run?month={m}", headers=h(fin)).json()["rows"]
    row = next(r for r in rows if r["systemId"] == system["sid"])
    assert (row["kwh"], row["amount"], row["invoice"]) == ("812.40", "215.29", None)
    r = client.post("/api/py/finance/run", headers=h(fin), json={"month": m, "items": [{"systemId": system["sid"], "kwh": "812.40"}]})
    assert r.status_code == 200, r.text
    inv = fx.conn.execute("select * from invoices where system_id = %s", (system["sid"],)).fetchone()
    assert inv["amount"] == Decimal("215.29") and inv["homeowner_id"] == system["ho"]["uid"] and inv["due_on"] == inv["issued_on"] + timedelta(days=14)
    told = fx.conn.execute("select title from notifications where recipient_uid = %s and kind = 'invoice_issued'", (system["ho"]["uid"],)).fetchall()
    assert told and told[0]["title"] == f"Invoice {inv['number']}"
    again = client.post("/api/py/finance/run", headers=h(fin), json={"month": m, "items": [{"systemId": system["sid"], "kwh": "812.40"}]})
    assert again.status_code == 409, "a month is invoiced once"


def test_this_month_isnt_invoiced_yet(client, fin, system) -> None:
    m = date.today().strftime("%Y-%m")
    r = client.post("/api/py/finance/run", headers=h(fin), json={"month": m, "items": [{"systemId": system["sid"], "kwh": "1"}]})
    assert r.status_code == 400


def test_paid_from_the_bank_statement(client, fx, fin, system) -> None:
    m = system["month"].strftime("%Y-%m")
    client.post("/api/py/finance/run", headers=h(fin), json={"month": m, "items": [{"systemId": system["sid"], "kwh": "812.40"}]})
    inv = fx.conn.execute("select * from invoices where system_id = %s", (system["sid"],)).fetchone()
    csv = f"Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1\n{date.today():%d %b %Y},ICT,,215.29,PAYNOW {inv['number']} HOMEOWNER\n"
    r = client.post("/api/py/finance/statements", headers=h(fin), json={"fileName": "oct.csv", "text": csv})
    assert r.status_code == 200 and r.json()["lines"][0]["result"] == "match"
    c = client.post(f"/api/py/finance/statements/{r.json()['id']}/confirm", headers=h(fin), json={"lines": [0]})
    assert c.status_code == 200, c.text
    done = fx.conn.execute("select status, paid_via, paid_amount from invoices where invoice_id = %s", (inv["invoice_id"],)).fetchone()
    assert (done["status"], done["paid_via"], done["paid_amount"]) == ("paid", "statement", Decimal("215.29"))
    assert client.post(f"/api/py/finance/statements/{r.json()['id']}/confirm", headers=h(fin), json={"lines": [0]}).status_code == 409


@pytest.mark.parametrize(("body", "ok"), [({"accent": "#12AB34"}, True), ({"accent": "green"}, False), ({"dueDays": 91}, False),
                                          ({"adminFee": "-1"}, False), ({"companyName": ""}, False), ({"show": {"qr": False}}, True)])  # fmt: skip
def test_the_design_is_checked(client, fin, body, ok) -> None:
    r = client.put("/api/py/finance/settings", headers=h(fin), json=body)
    assert (r.status_code == 200) is ok, r.text
    client.put("/api/py/finance/settings", headers=h(fin), json={"accent": "#0B8A5A", "show": {}})


def test_the_qr_must_be_a_jpeg(client, fin) -> None:
    from _lib import storage

    link = client.post("/api/py/finance/settings/qr/upload-link", headers=h(fin), json={"contentType": "image/jpeg", "size": 100})
    assert link.status_code == 200, link.text
    key = link.json()["key"]
    path = storage.local_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"not a picture")
    assert client.post("/api/py/finance/settings/qr", headers=h(fin), json={"key": key}).status_code == 400
    assert client.post("/api/py/finance/settings/qr/upload-link", headers=h(fin), json={"contentType": "image/png", "size": 100}).status_code == 400


def test_an_admin_account_is_a_superadmins_to_make(client, fx) -> None:
    pm, boss = fx.user("project_manager"), fx.user("superadmin")
    from conftest import fresh_mobile

    body = {"fullName": "New Admin", "email": f"admin-{uuid.uuid4().hex[:6]}@example.com", "contactNo": fresh_mobile(), "role": "finance", "noExpiry": True}
    assert client.post("/api/py/people", headers=h(pm), json=body).status_code == 403
    r = client.post("/api/py/people", headers=h(boss), json=body)
    assert r.status_code == 200, r.text
    fx.conn.execute("delete from users where email = %s", (body["email"],))


def test_one_homeowner_one_project(client, fx) -> None:
    pm, ho = fx.user("project_manager"), fx.user("homeowner")
    body = {"name": "First", "postalCode": "569933", "address": "53 Ang Mo Kio Ave 3", "homeownerId": ho["uid"], "contactNo": "+65 9123 4567",
            "contractor": {"type": "text", "text": "Some Contractor"}, "startDate": "2026-10-12"}  # fmt: skip
    first = client.post("/api/py/projects", headers=h(pm), json=body)
    try:
        assert first.status_code == 200, first.text
        r = client.post("/api/py/projects", headers=h(pm), json={**body, "name": "Second"})
        assert r.status_code == 409 and r.json()["field"] == "homeowner"
    finally:
        fx.conn.execute("delete from projects where project_id = %s", (first.json().get("id"),))


# ------------------------------------------------------------------ admin fees: checked, then issued together


@pytest.fixture
def projects(fx):
    """Projects whose admin fee is still to invoice (one homeowner without an account), and one already in maintenance."""
    ho, ho2 = fx.user("homeowner", full_name="Fee Homeowner"), fx.user("homeowner", full_name="Fee Homeowner Two")
    made = []
    for name, owner, status in (("Fee One", ho["uid"], "awaiting_homeowner"), ("Fee Two", ho2["uid"], "awaiting_homeowner"),
                                ("Fee Named", None, "awaiting_homeowner"), ("Fee Imported", None, "maintenance")):  # fmt: skip
        made.append(fx.conn.execute(
            "insert into projects (name, address, postal_code, homeowner_id, homeowner_name, homeowner_contact_no, installation_start_date, target_end_date, status) "
            "values (%s, '9 Fee Road', '466002', %s, case when %s::int is null then 'Named Homeowner' end, '+65 9123 4567', current_date, current_date + 30, %s) returning project_id",
            (f"{name} {uuid.uuid4().hex[:6]}", owner, owner, status),
        ).fetchone()["project_id"])  # fmt: skip
    yield {"one": made[0], "two": made[1], "named": made[2], "imported": made[3], "ho": ho}
    fx.conn.execute("delete from invoices where project_id = any(%s)", (made,))
    fx.conn.execute("delete from projects where project_id = any(%s)", (made,))


def test_the_check_shows_each_admin_fee_as_it_will_read(client, fin, projects) -> None:
    rows = {r["projectId"]: r for r in client.get("/api/py/finance/admin-fees", headers=h(fin)).json()["rows"]}
    one = rows[projects["one"]]
    assert (one["billTo"], one["billEmail"], one["problem"]) == ("Fee Homeowner", projects["ho"]["email"], None)
    assert one["billAddress"].startswith("9 Fee Road") and Decimal(one["amount"]) > 0 and one["dueOn"] > one["issuedOn"]
    named = rows[projects["named"]]
    assert (named["billTo"], named["billEmail"], named["problem"]) == ("Named Homeowner", None, None), "billed by name; they see it in the app"
    assert projects["imported"] not in rows, "imported systems' projects aren't billed an admin fee"


def test_admin_fees_go_out_together_or_not_at_all(client, fx, fin, projects) -> None:
    count = lambda: fx.conn.execute("select count(*) as n from invoices where project_id = any(%s)", ([projects["one"], projects["two"], projects["named"]],)).fetchone()["n"]  # noqa: E731
    _fee(client, fin, projects["named"])
    r = client.post("/api/py/finance/admin-fees", headers=h(fin), json={"projectIds": [projects["one"], projects["named"]]})
    assert r.status_code == 400 and "already invoiced" in r.text and count() == 1, "one that can't be issued stops them all"
    assert client.post("/api/py/finance/admin-fees", headers=h(fin), json={"projectIds": []}).status_code == 400
    assert client.post("/api/py/finance/admin-fees", headers=h(fx.user("project_manager")), json={"projectIds": [projects["one"]]}).status_code == 403
    r = client.post("/api/py/finance/admin-fees", headers=h(fin), json={"projectIds": [projects["one"], projects["two"]]})
    assert r.status_code == 200 and r.json()["count"] == 2 and count() == 3, r.text
    told = fx.conn.execute("select 1 from notifications where recipient_uid = %s and kind = 'invoice_issued'", (projects["ho"]["uid"],)).fetchall()
    assert told
    again = client.post("/api/py/finance/admin-fees", headers=h(fin), json={"projectIds": [projects["one"]]})
    assert again.status_code == 400 and count() == 3
    left = {r["projectId"] for r in client.get("/api/py/finance/admin-fees", headers=h(fin)).json()["rows"]}
    assert projects["one"] not in left and projects["two"] not in left


def _fee(client, fin, pid) -> dict:
    r = client.post("/api/py/finance/admin-fee", headers=h(fin), json={"projectId": pid})
    assert r.status_code == 200, r.text
    return r.json()["invoice"]
