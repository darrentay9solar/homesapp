# ruff: noqa: E501  (SQL and messages read better whole)
"""Payments: the admin fee, monthly invoices, the company's QR, bank statements (migration 0043).

  GET  /finance/overview?year=          each project's admin fee and each system's months: issued? paid?
                                         (Admin and superadmins see the amounts; a project manager only
                                         the statuses, for the projects and systems they run)
  GET  /finance/invoices                every invoice, newest first (Admin)
  POST /finance/admin-fee               issue a project's admin fee {projectId} (Admin)
  GET  /finance/run?month=              the month's invoices to issue: each system, its kWh and amount (Admin)
  POST /finance/run                     issue them {month, items: [{systemId, kwh}]} (Admin)
  POST /finance/invoices/{id}/paid      mark it paid {paidOn, amount, ref} (Admin)
  POST /finance/invoices/{id}/void      void it {reason} (Admin)
  POST /finance/statements              a bank statement (CSV): what each credit pays (Admin)
  POST /finance/statements/{id}/confirm mark the chosen matches paid (Admin)
  GET  /finance/settings, PUT           the invoice's design, the company's details, the fee (Admin)
  POST /finance/settings/{logo|qr}/...  upload the logo or the PayNow QR (Admin)
  GET  /finance/qr, /finance/logo       the pictures, for the screens
  GET  /payments                        the homeowner's own invoices, and how to pay
  GET  /invoices/{id}, /invoices/{id}/pdf   one invoice, and its PDF (its homeowner, or Admin)
  POST /invoices/{id}/proof/...         the homeowner attaches proof of payment

"Admin" is the finance account type (user_type 'finance'); a superadmin can
do everything Admin can. Amounts are the plan's: the admin fee, then kWh x
rate every month for the plan's years from the month the system was turned
on (_lib/invoices.py).
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from _lib import invoices as iv
from _lib import notify, storage, sweep
from _lib.account import Account
from _lib.certificate import jpeg_size
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import active

router = APIRouter()
SG = ZoneInfo("Asia/Singapore")
PICTURE_MAX = 1536 * 1024
PROOF_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
PROOF_MAX = 8 * 1024 * 1024
MAX_STATEMENT = 2 * 1024 * 1024


def today() -> date:
    return datetime.now(SG).date()


def handles(acct: Account) -> bool:
    return acct.role in ("finance", "superadmin")


def admin_only(acct: Account = Depends(active)) -> Account:
    if not handles(acct):
        raise HTTPException(403, "Only Admin handles payments and invoices.")
    return acct


def settings() -> dict[str, Any]:
    s = fetch_one("select * from finance_settings where id = 1")
    if not s:
        raise HTTPException(503, "Payments aren't set up yet.")
    return s


def _month(v: str | None) -> date:
    m = re.fullmatch(r"(\d{4})-(\d{2})", v or "")
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise HTTPException(400, "Choose a month, like 2026-10.")
    return date(int(m.group(1)), int(m.group(2)), 1)


def _decimal(v: Any, what: str) -> Decimal:
    try:
        d = Decimal(str(v).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        raise HTTPException(400, f"The {what} isn't a number.") from None
    if d < 0 or d > Decimal("10000000"):
        raise HTTPException(400, f"The {what} isn't a sensible amount.")
    return d


def _out(inv: dict[str, Any], *, amounts: bool = True) -> dict[str, Any]:
    """An invoice for the screens; without amounts for a project manager."""
    out = {
        "id": inv["invoice_id"], "number": inv["number"], "kind": inv["kind"], "status": inv["status"],
        "state": iv.state(inv, today()), "projectId": inv["project_id"], "systemId": inv["system_id"],
        "billTo": inv["bill_to"], "period": inv["period"].isoformat() if inv["period"] else None,
        "issuedOn": inv["issued_on"].isoformat(), "dueOn": inv["due_on"].isoformat(),
        "paidOn": inv["paid_on"].isoformat() if inv["paid_on"] else None,
        "hasProof": bool(inv["proof_key"]),
        "proofAt": inv["proof_at"].isoformat() if inv["proof_at"] else None,
    }  # fmt: skip
    if amounts:
        out.update({
            "amount": str(inv["amount"]), "kwh": str(inv["kwh"]) if inv["kwh"] is not None else None,
            "rate": str(inv["rate"]) if inv["rate"] is not None else None,
            "paidAmount": str(inv["paid_amount"]) if inv["paid_amount"] is not None else None,
            "paidVia": inv["paid_via"], "paidRef": inv["paid_ref"], "voidReason": inv["void_reason"],
            "billAddress": inv["bill_address"], "billEmail": inv["bill_email"], "proofNote": inv["proof_note"],
        })  # fmt: skip
    return out


def _invoice(iid: int) -> dict[str, Any]:
    inv = fetch_one("select * from invoices where invoice_id = %s", (iid,))
    if not inv:
        raise HTTPException(404, "No such invoice.")
    return inv


def _may_see(acct: Account, inv: dict[str, Any]) -> None:
    if handles(acct) or (acct.role == "homeowner" and inv["homeowner_id"] == acct.uid and inv["status"] != "void"):
        return
    raise HTTPException(404, "No such invoice.")


# ------------------------------------------------------------------ who's billed


SYSTEMS = """
select s.system_id, s.project_id, s.project_code, s.address, s.postal_code, s.homeowner_id, s.run_by, s.turned_on_on,
       s.rate_per_kwh, coalesce(u.full_name, s.homeowner_name) as name, coalesce(u.email, s.homeowner_email) as email
  from maintenance_systems s left join users u on u.uid = s.homeowner_id
"""
PROJECTS = """
select p.project_id, p.project_code, p.name, p.address, p.postal_code, p.homeowner_id, p.project_manager_id, p.status::text as status,
       coalesce(u.full_name, p.homeowner_name) as homeowner, coalesce(u.email, p.homeowner_email) as email
  from projects p left join users u on u.uid = p.homeowner_id
"""


def _bill_address(row: dict[str, Any]) -> str:
    a = row.get("address") or ""
    pc = row.get("postal_code")
    return f"{a}, Singapore {pc}" if pc and pc not in a else a


def _issue(cur: Any, acct: Account, s: dict[str, Any], **row: Any) -> dict[str, Any]:
    """Inserts one invoice with its own number; returns it."""
    cur.execute("select nextval(pg_get_serial_sequence('invoices', 'invoice_id')) as id")
    got = cur.fetchone()
    assert got is not None
    iid = got["id"]
    issued = today()
    cur.execute(
        "insert into invoices (invoice_id, number, kind, project_id, system_id, homeowner_id, bill_to, bill_address, bill_email, "
        "period, kwh, rate, amount, issued_on, due_on, created_by) values (%(id)s, %(number)s, %(kind)s, %(project_id)s, "
        "%(system_id)s, %(homeowner_id)s, %(bill_to)s, %(bill_address)s, %(bill_email)s, %(period)s, %(kwh)s, %(rate)s, "
        "%(amount)s, %(issued)s, %(due)s, %(by)s) returning *",
        {"id": iid, "number": iv.number(iid, issued), "issued": issued, "due": iv.due(issued, s["due_days"]), "by": acct.uid,
         "project_id": None, "system_id": None, "period": None, "kwh": None, "rate": None, **row},
    )  # fmt: skip
    inv = cur.fetchone()
    assert inv is not None
    return inv


def _tell_issued(inv: dict[str, Any]) -> None:
    if not inv["homeowner_id"]:
        return
    h = fetch_one("select email, language from users where uid = %s and active", (inv["homeowner_id"],))
    if not h:
        return
    what = "the admin fee" if inv["kind"] == "admin_fee" else f"solar power in {iv.month_text(inv['period'])}"
    title = f"Invoice {inv['number']}"
    body = f"{iv.money(inv['amount'])} for {what}, due {inv['due_on'].strftime('%d %b %Y')}. Pay with the QR in Payments."
    lang = h["language"] or "en"
    html, text = notify.email_shell(title, [body], ("See the invoice", f"{notify.app_url()}/payments?invoice={inv['invoice_id']}"), lang)
    try:
        notify.notify(inv["homeowner_id"], "invoice_issued", title, body, project_id=inv["project_id"],
                      link=f"/payments?invoice={inv['invoice_id']}",
                      email=(h["email"], notify.tr(f"{notify.BRAND}: {title}", lang) or title, html, text) if h["email"] else None)  # fmt: skip
    except Exception as exc:  # the invoice is issued either way
        print(f"[finance] telling {inv['homeowner_id']} about {inv['number']} failed: {exc}")


def _tell_paid(inv: dict[str, Any]) -> None:
    if not inv["homeowner_id"]:
        return
    try:
        notify.notify(inv["homeowner_id"], "payment_received", f"Payment received · {inv['number']}",
                      f"{iv.money(inv['paid_amount'])} received on {inv['paid_on'].strftime('%d %b %Y')}. Thank you.",
                      project_id=inv["project_id"], link=f"/payments?invoice={inv['invoice_id']}")  # fmt: skip
    except Exception as exc:
        print(f"[finance] telling {inv['homeowner_id']} about a payment failed: {exc}")


# ------------------------------------------------------------------ the overview


@router.get("/finance/overview")
def overview(year: int | None = None, acct: Account = Depends(active)) -> dict[str, Any]:
    if not (handles(acct) or acct.role == "project_manager"):
        raise HTTPException(403, "Only Admin and project managers see payments.")
    y = year or today().year
    if not 2000 <= y <= 2100:
        raise HTTPException(400, "Choose a year.")
    amounts = handles(acct)
    s = settings()
    mine = "" if amounts else " where {col} = %(me)s"
    systems = fetch_all(SYSTEMS + mine.format(col="s.run_by") + " order by s.project_code nulls last, s.address", {"me": acct.uid})
    projects = fetch_all(PROJECTS + mine.format(col="p.project_manager_id") + " order by p.project_code nulls last, p.name", {"me": acct.uid})
    months = [date(y, m, 1) for m in range(1, 13)]
    invs = fetch_all(
        "select * from invoices where status <> 'void' and (kind = 'admin_fee' or period between %s and %s)",
        (months[0], months[-1]),
    )
    monthly = {(i["system_id"], i["period"]): i for i in invs if i["kind"] == "monthly"}
    fees = {i["project_id"]: i for i in invs if i["kind"] == "admin_fee"}
    t = today()
    this_month = iv.month_start(t)

    def cell(sys: dict[str, Any], m: date) -> dict[str, Any]:
        inv = monthly.get((sys["system_id"], m))
        if inv:
            c: dict[str, Any] = {"state": iv.state(inv, t), "id": inv["invoice_id"]}
            if amounts:
                c["amount"] = str(inv["amount"])
            return c
        if not iv.in_plan(m, sys["turned_on_on"], s["plan_years"]):
            return {"state": "none"}
        # A month is invoiced once it's over.
        return {"state": "to_issue" if m < this_month else "later"}

    sys_rows = [{
        "id": r["system_id"], "projectId": r["project_id"], "code": r["project_code"], "name": r["name"],
        "address": r["address"], "turnedOn": r["turned_on_on"].isoformat() if r["turned_on_on"] else None,
        "rate": str(r["rate_per_kwh"]) if amounts and r["rate_per_kwh"] is not None else None,
        "months": [cell(r, m) for m in months],
    } for r in systems]  # fmt: skip
    proj_rows = []
    for p in projects:
        fee = fees.get(p["project_id"])
        row: dict[str, Any] = {
            "id": p["project_id"], "code": p["project_code"], "name": p["name"], "homeowner": p["homeowner"],
            "status": p["status"], "fee": {"state": iv.state(fee, t), "id": fee["invoice_id"]} if fee else {"state": "to_issue"},
        }  # fmt: skip
        if amounts and fee:
            row["fee"]["amount"] = str(fee["amount"])
        proj_rows.append(row)
    out: dict[str, Any] = {"year": y, "months": [m.isoformat() for m in months], "systems": sys_rows, "projects": proj_rows, "amounts": amounts}
    if amounts:
        live = [i for i in invs if i["kind"] == "admin_fee" or i["period"].year == y]
        out["totals"] = {
            "issued": str(sum((i["amount"] for i in live), Decimal(0))),
            "paid": str(sum((i["paid_amount"] or 0 for i in live if i["status"] == "paid"), Decimal(0))),
            "outstanding": str(sum((i["amount"] for i in live if i["status"] == "issued"), Decimal(0))),
            "overdue": sum(1 for i in live if iv.state(i, t) == "overdue"),
            "proofs": sum(1 for i in live if i["status"] == "issued" and i["proof_key"]),
        }
        out["adminFee"] = str(s["admin_fee"])
    return out


# ------------------------------------------------------------------ invoices


@router.get("/finance/invoices")
def list_invoices(status: str | None = None, q: str | None = None, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    where, params = ["true"], {}
    if status in ("issued", "paid", "void"):
        where.append("status = %(st)s")
        params["st"] = status
    elif status == "overdue":
        where.append("status = 'issued' and due_on < current_date")
    elif status == "proof":
        where.append("status = 'issued' and proof_key is not null")
    if q and q.strip():
        where.append("(number ilike %(q)s or bill_to ilike %(q)s or bill_address ilike %(q)s)")
        params["q"] = f"%{q.strip()}%"
    rows = fetch_all(f"select * from invoices where {' and '.join(where)} order by invoice_id desc limit 500", params)
    return {"invoices": [_out(r) for r in rows]}


@router.get("/invoices/{iid}")
def one(iid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    inv = _invoice(iid)
    _may_see(acct, inv)
    return _out(inv)


@router.get("/invoices/{iid}/pdf")
def invoice_pdf(iid: int, acct: Account = Depends(active)) -> Response:
    inv = _invoice(iid)
    _may_see(acct, inv)
    s = settings()

    def picture(key: str | None) -> bytes | None:
        if not key:
            return None
        try:
            data = storage.get(key, PICTURE_MAX)
        except storage.StorageNotConfiguredError:
            return None
        return data if data and jpeg_size(data) else None

    body = iv.pdf(inv, s, logo=picture(s["logo_key"]), qr=picture(s["qr_key"]))
    return Response(body, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{inv["number"]}.pdf"', "Cache-Control": "private, no-store"})  # fmt: skip


class FeeIn(BaseModel):
    projectId: int


@router.post("/finance/admin-fee")
def admin_fee(body: FeeIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    p = fetch_one(PROJECTS + " where p.project_id = %s", (body.projectId,))
    if not p:
        raise HTTPException(404, "No such project.")
    if fetch_one("select 1 from invoices where project_id = %s and kind = 'admin_fee' and status <> 'void'", (body.projectId,)):
        raise HTTPException(409, "This project's admin fee is already invoiced.")
    if not p["homeowner"]:
        raise HTTPException(400, "Add the homeowner to the project first.")
    s = settings()
    with transaction(acct.uid) as cur:
        inv = _issue(cur, acct, s, kind="admin_fee", project_id=p["project_id"], homeowner_id=p["homeowner_id"],
                     bill_to=p["homeowner"], bill_address=_bill_address(p), bill_email=p["email"], amount=s["admin_fee"])  # fmt: skip
    _tell_issued(inv)
    return {"message": f"Issued {inv['number']} for {iv.money(inv['amount'])}.", "invoice": _out(inv)}


def _run_rows(month: date) -> list[dict[str, Any]]:
    s = settings()
    issued = {r["system_id"]: r for r in fetch_all(
        "select * from invoices where kind = 'monthly' and period = %s and status <> 'void'", (month,))}  # fmt: skip
    output = {r["system_id"]: r["kwh"] for r in fetch_all("select system_id, kwh from system_output where month = %s", (month,))}
    rows = []
    for r in fetch_all(SYSTEMS + " order by s.project_code nulls last, s.address"):
        if not iv.in_plan(month, r["turned_on_on"], s["plan_years"]):
            continue
        inv = issued.get(r["system_id"])
        kwh = output.get(r["system_id"])
        rate = r["rate_per_kwh"]
        rows.append({
            "systemId": r["system_id"], "code": r["project_code"], "name": r["name"], "address": r["address"],
            "rate": str(rate) if rate is not None else None, "kwh": str(kwh) if kwh is not None else None,
            "amount": str(iv.monthly_amount(kwh, rate)) if kwh is not None and rate is not None else None,
            "invoice": _out(inv) if inv else None,
            "problem": None if inv else ("No rate per kWh in the client record." if rate is None
                                         else "No name to bill." if not r["name"] else None),
        })  # fmt: skip
    return rows


@router.get("/finance/run")
def run_preview(month: str, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    m = _month(month)
    return {"month": m.isoformat(), "rows": _run_rows(m), "over": m < iv.month_start(today())}


class RunItem(BaseModel):
    systemId: int
    kwh: str


class RunIn(BaseModel):
    month: str
    items: list[RunItem]


@router.post("/finance/run")
def run_issue(body: RunIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    m = _month(body.month)
    if m >= iv.month_start(today()):
        raise HTTPException(400, "A month is invoiced once it's over.")
    if not body.items:
        raise HTTPException(400, "Choose the systems to invoice.")
    rows = {r["systemId"]: r for r in _run_rows(m)}
    s = settings()
    made: list[dict[str, Any]] = []
    with transaction(acct.uid) as cur:
        for it in body.items:
            r = rows.get(it.systemId)
            if not r:
                raise HTTPException(400, "One of those systems isn't billed that month.")
            if r["invoice"]:
                raise HTTPException(409, f"{r['code'] or r['address']} already has an invoice for {iv.month_text(m)}.")
            if r["problem"]:
                raise HTTPException(400, f"{r['code'] or r['address']}: {r['problem']}")
            kwh = _decimal(it.kwh, "kWh")
            sys = fetch_one(SYSTEMS + " where s.system_id = %s", (it.systemId,))
            assert sys is not None
            made.append(_issue(cur, acct, s, kind="monthly", system_id=sys["system_id"], project_id=sys["project_id"],
                               homeowner_id=sys["homeowner_id"], bill_to=sys["name"], bill_address=_bill_address(sys),
                               bill_email=sys["email"], period=m, kwh=kwh, rate=sys["rate_per_kwh"],
                               amount=iv.monthly_amount(kwh, sys["rate_per_kwh"])))  # fmt: skip
    for inv in made:
        _tell_issued(inv)
    total = sum((i["amount"] for i in made), Decimal(0))
    return {"message": f"Issued {len(made)} invoices for {iv.month_text(m)}, {iv.money(total)} in all.", "count": len(made)}


class PaidIn(BaseModel):
    paidOn: str
    amount: str
    ref: str | None = None


@router.post("/finance/invoices/{iid}/paid")
def mark_paid(iid: int, body: PaidIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    inv = _invoice(iid)
    if inv["status"] != "issued":
        raise HTTPException(409, "Only an unpaid invoice can be marked paid.")
    try:
        on = date.fromisoformat(body.paidOn)
    except ValueError:
        raise HTTPException(400, "The payment date isn't a date.") from None
    if on > today():
        raise HTTPException(400, "The payment date is in the future.")
    amount = _decimal(body.amount, "amount")
    with transaction(acct.uid) as cur:
        cur.execute(
            "update invoices set status = 'paid', paid_on = %s, paid_amount = %s, paid_via = 'manual', paid_ref = %s, "
            "confirmed_by = %s where invoice_id = %s returning *",
            (on, amount, (body.ref or "").strip()[:200] or None, acct.uid, iid),
        )
        done = cur.fetchone()
    assert done is not None
    _tell_paid(done)
    note = "" if amount == inv["amount"] else f" It was for {iv.money(inv['amount'])}."
    return {"message": f"{inv['number']} marked paid: {iv.money(amount)} on {on.strftime('%d %b %Y')}.{note}", "invoice": _out(done)}


class VoidIn(BaseModel):
    reason: str


@router.post("/finance/invoices/{iid}/void")
def void(iid: int, body: VoidIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    inv = _invoice(iid)
    if inv["status"] != "issued":
        raise HTTPException(409, "Only an unpaid invoice can be voided.")
    reason = " ".join(body.reason.split())[:300]
    if len(reason) < 3:
        raise HTTPException(400, "Say why it's voided.")
    with transaction(acct.uid) as cur:
        cur.execute("update invoices set status = 'void', void_reason = %s where invoice_id = %s returning *", (reason, iid))
        done = cur.fetchone()
    assert done is not None
    return {"message": f"{inv['number']} voided. Issue a new one if something is still owed.", "invoice": _out(done)}


# ------------------------------------------------------------------ bank statements


class StatementIn(BaseModel):
    fileName: str
    text: str


@router.post("/finance/statements")
def statement(body: StatementIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    if len(body.text.encode()) > MAX_STATEMENT:
        raise HTTPException(400, "That statement is too large. Export a month at a time.")
    try:
        lines = iv.parse_statement(body.text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not lines:
        raise HTTPException(400, "No money coming in was found in that statement.")
    found = {n for ln in lines for n in (f"INV-{m.group(1)}-{m.group(2)}" for m in iv.NUMBER.finditer(ln["words"]))}
    invs = fetch_all("select invoice_id, number, amount, status from invoices where upper(number) = any(%s) and status <> 'void'",
                     ([n.upper() for n in found],)) if found else []  # fmt: skip
    matched = iv.match(lines, invs)
    with transaction(acct.uid) as cur:
        cur.execute(
            "insert into bank_statements (file_name, lines, matched, uploaded_by) values (%s, %s::jsonb, %s, %s) returning statement_id",
            (body.fileName[:200] or "statement.csv", json.dumps(matched),
             sum(1 for x in matched if x["result"] == "match"), acct.uid),
        )  # fmt: skip
        got = cur.fetchone()
    assert got is not None
    return {"id": got["statement_id"], "lines": matched}


class ConfirmIn(BaseModel):
    lines: list[int]


@router.post("/finance/statements/{sid}/confirm")
def confirm(sid: int, body: ConfirmIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    st = fetch_one("select * from bank_statements where statement_id = %s", (sid,))
    if not st:
        raise HTTPException(404, "No such statement.")
    if st["confirmed_at"]:
        raise HTTPException(409, "This statement was already confirmed.")
    lines = st["lines"]
    chosen = [lines[i] for i in sorted(set(body.lines)) if 0 <= i < len(lines)]
    if not chosen or any(c["result"] not in ("match", "amount differs") for c in chosen):
        raise HTTPException(400, "Choose lines that name an unpaid invoice.")
    paid: list[dict[str, Any]] = []
    with transaction(acct.uid) as cur:
        for c in chosen:
            cur.execute(
                "update invoices set status = 'paid', paid_on = %s, paid_amount = %s, paid_via = 'statement', paid_ref = %s, "
                "confirmed_by = %s where invoice_id = %s and status = 'issued' returning *",
                (c["date"], c["amount"], c["words"][:200] or None, acct.uid, c["invoiceId"]),
            )
            row = cur.fetchone()
            if row:
                paid.append(row)
        cur.execute("update bank_statements set confirmed_at = now() where statement_id = %s", (sid,))
    for inv in paid:
        _tell_paid(inv)
    return {"message": f"Marked {len(paid)} invoices paid from the statement.", "count": len(paid)}


# ------------------------------------------------------------------ settings and pictures

TEXTS = {"companyName": ("company_name", 120), "companyAddress": ("company_address", 300), "companyUen": ("company_uen", 40),
         "companyEmail": ("company_email", 200), "companyPhone": ("company_phone", 40), "payNote": ("pay_note", 600),
         "invoiceTitle": ("invoice_title", 40), "intro": ("intro", 600), "footer": ("footer", 300), "terms": ("terms", 1500)}  # fmt: skip
SHOW = ("logo", "qr", "uen", "kwh", "terms")


def _settings_out(s: dict[str, Any]) -> dict[str, Any]:
    out = {k: s[col] for k, (col, _n) in TEXTS.items()}
    v = int(s["updated_at"].timestamp())
    out.update({
        "adminFee": str(s["admin_fee"]), "planYears": s["plan_years"], "dueDays": s["due_days"], "accent": s["accent"],
        "show": {k: bool((s["show"] or {}).get(k, True)) for k in SHOW},
        "logo": f"/api/py/finance/logo?v={v}" if s["logo_key"] else None,
        "qr": f"/api/py/finance/qr?v={v}" if s["qr_key"] else None,
    })  # fmt: skip
    return out


@router.get("/finance/settings")
def get_settings(acct: Account = Depends(admin_only)) -> dict[str, Any]:
    return _settings_out(settings())


class SettingsIn(BaseModel):
    companyName: str | None = None
    companyAddress: str | None = None
    companyUen: str | None = None
    companyEmail: str | None = None
    companyPhone: str | None = None
    payNote: str | None = None
    invoiceTitle: str | None = None
    intro: str | None = None
    footer: str | None = None
    terms: str | None = None
    adminFee: str | None = None
    dueDays: int | None = None
    accent: str | None = None
    show: dict[str, bool] | None = None


@router.put("/finance/settings")
def put_settings(body: SettingsIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    given = body.model_fields_set
    sets: dict[str, Any] = {}
    for k, (col, most) in TEXTS.items():
        if k in given:
            v = (getattr(body, k) or "").strip()
            if len(v) > most:
                raise HTTPException(400, f"Keep that under {most} characters.")
            sets[col] = v or None
    for col in ("company_name", "pay_note", "invoice_title"):
        if col in sets and not sets[col]:
            raise HTTPException(400, "The company's name, the payment note and the invoice's title can't be empty.")
    if "adminFee" in given:
        sets["admin_fee"] = _decimal(body.adminFee, "admin fee")
    if "dueDays" in given:
        if body.dueDays is None or not 0 <= body.dueDays <= 90:
            raise HTTPException(400, "Days to pay: 0 to 90.")
        sets["due_days"] = body.dueDays
    if "accent" in given:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", body.accent or ""):
            raise HTTPException(400, "Choose a colour like #0B8A5A.")
        sets["accent"] = body.accent
    if "show" in given and body.show is not None:
        sets["show"] = json.dumps({k: bool(body.show.get(k, True)) for k in SHOW})
    if not sets:
        raise HTTPException(400, "Nothing to change.")
    cols = ", ".join(f"{c} = %({c})s" + ("::jsonb" if c == "show" else "") for c in sets)
    with transaction(acct.uid) as cur:
        cur.execute(f"update finance_settings set {cols}, updated_by = %(me)s where id = 1 returning *", {**sets, "me": acct.uid})
        s = cur.fetchone()
    assert s is not None
    return {"message": "Saved. New invoices use it.", "settings": _settings_out(s)}


class LinkIn(BaseModel):
    contentType: str
    size: int


class KeyIn(BaseModel):
    key: str


@router.post("/finance/settings/{which}/upload-link")
def picture_link(which: str, body: LinkIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    if which not in ("logo", "qr"):
        raise HTTPException(404, "No such picture.")
    if body.contentType != "image/jpeg":
        raise HTTPException(400, "The picture is sent as a JPEG.")
    if not 0 < body.size <= PICTURE_MAX:
        raise HTTPException(400, "Pictures must be under 1.5 MB.")
    key = f"finance/{which}/{uuid.uuid4()}.jpg"
    try:
        url = storage.upload_link(key, body.contentType, body.size)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc
    sweep.record(key, acct.uid)
    return {"key": key, "uploadUrl": url, "headers": {"Content-Type": body.contentType}}


@router.post("/finance/settings/{which}")
def picture_use(which: str, body: KeyIn, acct: Account = Depends(admin_only)) -> dict[str, Any]:
    if which not in ("logo", "qr"):
        raise HTTPException(404, "No such picture.")
    if not re.fullmatch(rf"finance/{which}/[0-9a-f-]{{36}}\.jpg", body.key):
        raise HTTPException(400, "That picture doesn't belong here.")
    data = storage.get(body.key, PICTURE_MAX)
    if not data or len(data) > PICTURE_MAX or not jpeg_size(data):
        if data is not None:
            storage.delete(body.key)
        sweep.done(body.key, acct.uid)
        raise HTTPException(400, "That picture didn't arrive as a JPEG under 1.5 MB. Please try again.")
    with transaction(acct.uid) as cur:
        cur.execute(f"update finance_settings set {which}_key = %s, updated_by = %s where id = 1 returning *", (body.key, acct.uid))
        s = cur.fetchone()
    sweep.done(body.key, acct.uid)
    assert s is not None
    return {"message": "The QR is updated." if which == "qr" else "The logo is updated.", "settings": _settings_out(s)}


def _picture(which: str) -> RedirectResponse:
    s = settings()
    key = s[f"{which}_key"]
    if not key:
        raise HTTPException(404, "There's no picture yet.")
    try:
        return RedirectResponse(storage.view_link(key, f"{which}.jpg"), status_code=302)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/finance/qr")
def qr(_acct: Account = Depends(active)) -> RedirectResponse:
    return _picture("qr")


@router.get("/finance/logo")
def logo(_acct: Account = Depends(active)) -> RedirectResponse:
    return _picture("logo")


# ------------------------------------------------------------------ the homeowner


@router.get("/payments")
def my_payments(acct: Account = Depends(active)) -> dict[str, Any]:
    if acct.role != "homeowner":
        raise HTTPException(403, "Payments are for homeowners.")
    s = settings()
    rows = fetch_all("select * from invoices where homeowner_id = %s and status <> 'void' order by issued_on desc, invoice_id desc", (acct.uid,))
    t = today()
    due_now = [r for r in rows if r["status"] == "issued"]
    v = int(s["updated_at"].timestamp())
    return {
        "invoices": [_out(r) for r in rows],
        "owing": str(sum((r["amount"] for r in due_now), Decimal(0))),
        "overdue": sum(1 for r in due_now if iv.state(r, t) == "overdue"),
        "qr": f"/api/py/finance/qr?v={v}" if s["qr_key"] else None,
        "payNote": s["pay_note"],
        "company": s["company_name"],
    }


@router.post("/invoices/{iid}/proof/upload-link")
def proof_link(iid: int, body: LinkIn, acct: Account = Depends(active)) -> dict[str, Any]:
    inv = _invoice(iid)
    if acct.role != "homeowner" or inv["homeowner_id"] != acct.uid:
        raise HTTPException(404, "No such invoice.")
    if inv["status"] != "issued":
        raise HTTPException(409, "This invoice is already settled.")
    ext = PROOF_TYPES.get(body.contentType)
    if not ext:
        raise HTTPException(400, "Attach a photo (JPEG, PNG, WebP) or a PDF.")
    if not 0 < body.size <= PROOF_MAX:
        raise HTTPException(400, "Files must be under 8 MB.")
    key = f"payments/{iid}/{uuid.uuid4()}.{ext}"
    try:
        url = storage.upload_link(key, body.contentType, body.size)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc
    sweep.record(key, acct.uid)
    return {"key": key, "uploadUrl": url, "headers": {"Content-Type": body.contentType}}


class ProofIn(BaseModel):
    key: str
    note: str | None = None


@router.post("/invoices/{iid}/proof")
def proof(iid: int, body: ProofIn, acct: Account = Depends(active)) -> dict[str, Any]:
    inv = _invoice(iid)
    if acct.role != "homeowner" or inv["homeowner_id"] != acct.uid:
        raise HTTPException(404, "No such invoice.")
    if inv["status"] != "issued":
        raise HTTPException(409, "This invoice is already settled.")
    exts = "|".join(PROOF_TYPES.values())
    if not re.fullmatch(rf"payments/{iid}/[0-9a-f-]{{36}}\.({exts})", body.key):
        raise HTTPException(400, "That file doesn't belong to this invoice.")
    got = storage.head(body.key)
    if not got or got[0] > PROOF_MAX or got[1] not in PROOF_TYPES:
        raise HTTPException(400, "The file never arrived. Please try again.")
    note = " ".join((body.note or "").split())[:300] or None
    with transaction(acct.uid) as cur:
        cur.execute("update invoices set proof_key = %s, proof_at = now(), proof_note = %s where invoice_id = %s", (body.key, note, iid))
    sweep.done(body.key, acct.uid)
    for r in fetch_all("select uid from users where active and user_type::text in ('finance', 'superadmin')"):
        try:
            notify.notify(r["uid"], "payment_proof", f"Payment proof · {inv['number']}",
                          f"{inv['bill_to']} sent proof of paying {iv.money(inv['amount'])}. Check it and mark the invoice paid.",
                          project_id=inv["project_id"], link=f"/finance?invoice={iid}")  # fmt: skip
        except Exception as exc:
            print(f"[finance] telling {r['uid']} about proof failed: {exc}")
    return {"message": "Thank you. Admin will check your payment and confirm it here."}


@router.get("/invoices/{iid}/proof")
def proof_file(iid: int, acct: Account = Depends(active)) -> RedirectResponse:
    inv = _invoice(iid)
    _may_see(acct, inv)
    if not inv["proof_key"]:
        raise HTTPException(404, "No proof was attached.")
    try:
        return RedirectResponse(storage.view_link(inv["proof_key"], f"{inv['number']}-proof.{inv['proof_key'].rsplit('.', 1)[-1]}"), status_code=302)
    except storage.StorageNotConfiguredError as exc:
        raise HTTPException(503, str(exc)) from exc


def fee_paid(pid: int) -> bool:
    """The project's admin fee is paid (it's what lets it move to Maintenance)."""
    return bool(fetch_one("select 1 from invoices where project_id = %s and kind = 'admin_fee' and status = 'paid'", (pid,)))


@router.get("/projects/{pid}/payments")
def project_payments(pid: int, acct: Account = Depends(active)) -> dict[str, Any]:
    """A project's admin fee and its system's months, as statuses: for the project page."""
    from _routes import projects as proj

    if not proj._load(acct, pid) or acct.role not in ("project_manager", "superadmin", "finance", "homeowner"):
        raise HTTPException(404, "No such project.")
    amounts = handles(acct) or acct.role == "homeowner"
    fee = fetch_one("select * from invoices where project_id = %s and kind = 'admin_fee' and status <> 'void'", (pid,))
    months = fetch_all(
        "select i.* from invoices i join maintenance_systems s on s.system_id = i.system_id "
        "where s.project_id = %s and i.kind = 'monthly' and i.status <> 'void' order by i.period desc limit 24",
        (pid,),
    )
    return {
        "fee": _out(fee, amounts=amounts) if fee else None,
        "feePaid": bool(fee and fee["status"] == "paid"),
        "months": [_out(m, amounts=amounts) for m in months],
    }
