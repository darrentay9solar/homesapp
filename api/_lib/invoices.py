# ruff: noqa: E501  (messages and the PDF layout read better whole)
"""Invoices: what a homeowner owes, when, how a bank statement pays them, and the PDF.

The one plan: after the admin fee (paid before the handover), a homeowner
pays every month for the solar power their system generated, kWh times the
rate in their contract, for the plan's years (8) from the month the system
was turned on. Pure functions here; the routes are _routes/finance.py.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from _lib import pdfdoc

CENT = Decimal("0.01")


# ------------------------------------------------------------------ amounts and months


def money(v: Decimal | float | int | str | None) -> str:
    """'S$1,234.50'."""
    d = Decimal(str(v or 0)).quantize(CENT, ROUND_HALF_UP)
    sign = "-" if d < 0 else ""
    return f"{sign}S${abs(d):,.2f}"


def monthly_amount(kwh: Decimal | float | str, rate: Decimal | float | str) -> Decimal:
    """kWh x rate, to the cent (half a cent rounds up)."""
    return (Decimal(str(kwh)) * Decimal(str(rate))).quantize(CENT, ROUND_HALF_UP)


def month_start(d: date) -> date:
    return d.replace(day=1)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def plan_months(turned_on: date | None, years: int) -> list[date]:
    """Every month a system is billed for: from the month it was turned on, for the plan's years."""
    if not turned_on:
        return []
    first = month_start(turned_on)
    return [add_months(first, i) for i in range(years * 12)]


def in_plan(month: date, turned_on: date | None, years: int) -> bool:
    if not turned_on:
        return False
    first = month_start(turned_on)
    return first <= month_start(month) < add_months(first, years * 12)


def month_text(d: date) -> str:
    return d.strftime("%B %Y")


def number(invoice_id: int, issued: date) -> str:
    """'INV-2026-00042': the year it was issued and its own number."""
    return f"INV-{issued.year}-{invoice_id:05d}"


def due(issued: date, days: int) -> date:
    return issued + timedelta(days=days)


def state(inv: dict[str, Any], today: date) -> str:
    """What the screens show: paid, overdue, waiting (issued, not yet due), or void."""
    if inv["status"] == "paid":
        return "paid"
    if inv["status"] == "void":
        return "void"
    return "overdue" if inv["due_on"] < today else "waiting"


# ------------------------------------------------------------------ bank statements

NUMBER = re.compile(r"INV\W*(\d{4})\W*(\d{5})", re.I)
DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y", "%d-%b-%Y", "%d %b %y", "%d/%m/%y", "%d-%b-%y", "%d %B %Y")


def _amount(s: str) -> Decimal | None:
    t = (s or "").strip().replace(",", "").replace("S$", "").replace("SGD", "").replace("$", "").strip()
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()").strip()
    if t.endswith(("CR", "cr")):
        t = t[:-2].strip()
    if not t:
        return None
    try:
        d = Decimal(t)
    except ArithmeticError:
        return None
    return -d if neg else d


def _day(s: str) -> date | None:
    t = (s or "").strip()
    for f in DATE_FORMATS:
        try:
            return datetime.strptime(t, f).date()
        except ValueError:
            continue
    return None


def _find(header: list[str], *words: str) -> int | None:
    for i, h in enumerate(header):
        k = h.strip().lower()
        if any(w in k for w in words):
            return i
    return None


def parse_statement(text: str) -> list[dict[str, Any]]:
    """The money that came in, from a bank's CSV export: each credit's date, amount and words.

    Banks lay their exports out differently (DBS, OCBC, UOB, and others), so
    the header row is found by its words: a date, a credit (or amount)
    column, and the references or description. Debits are left out.
    """
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    head_at = next((i for i, r in enumerate(rows[:40]) if _find(r, "date") is not None
                    and (_find(r, "credit", "deposit", "amount", "money in") is not None)), None)  # fmt: skip
    if head_at is None:
        raise ValueError("Couldn't find the statement's columns. Export it from your bank as CSV, with a date and a credit (or amount) column.")
    header = rows[head_at]
    c_date = _find(header, "transaction date", "date")
    c_credit = _find(header, "credit", "deposit", "money in")
    c_amount = _find(header, "amount") if c_credit is None else None
    c_debit = _find(header, "debit", "withdrawal", "money out")
    words = [i for i, h in enumerate(header) if any(w in h.strip().lower() for w in ("ref", "description", "details", "particular", "narrative", "remark", "payment"))]
    out = []
    for r in rows[head_at + 1 :]:
        if not r or all(not c.strip() for c in r):
            continue
        day = _day(r[c_date]) if c_date is not None and c_date < len(r) else None
        if c_credit is not None:
            amt = _amount(r[c_credit]) if c_credit < len(r) else None
        else:
            amt = _amount(r[c_amount]) if c_amount is not None and c_amount < len(r) else None
            if amt is not None and c_debit is not None and c_debit < len(r) and _amount(r[c_debit]):
                amt = None
        if day is None or amt is None or amt <= 0:
            continue
        text_words = " ".join(r[i].strip() for i in words if i < len(r) and r[i].strip())
        out.append({"date": day.isoformat(), "amount": str(amt.quantize(CENT, ROUND_HALF_UP)), "words": text_words[:300]})
    return out


def match(lines: list[dict[str, Any]], open_invoices: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each credit with the invoice it pays, when its words carry the invoice number.

    result: "match" (the number and the exact amount), "amount differs" (the
    number, another amount: Admin decides), "already paid", or "no invoice
    number". An invoice is matched once, by the first credit naming it.
    """
    by_number = {i["number"].upper(): i for i in open_invoices}
    taken: set[int] = set()
    out = []
    for ln in lines:
        found = None
        for m in NUMBER.finditer(ln["words"]):
            key = f"INV-{m.group(1)}-{m.group(2)}"
            if key in by_number:
                found = by_number[key]
                break
        row = {**ln, "invoiceId": None, "number": None, "result": "no invoice number"}
        if found:
            row.update(invoiceId=found["invoice_id"], number=found["number"])
            if found["status"] == "paid" or found["invoice_id"] in taken:
                row["result"] = "already paid"
            elif Decimal(ln["amount"]) == Decimal(str(found["amount"])).quantize(CENT):
                row["result"] = "match"
                taken.add(found["invoice_id"])
            else:
                row["result"] = "amount differs"
        out.append(row)
    return out


# ------------------------------------------------------------------ the PDF


def _lines(s: str | None) -> list[str]:
    return [x for x in (s or "").splitlines() if x.strip()]


def pdf(inv: dict[str, Any], settings: dict[str, Any], *, logo: bytes | None = None, qr: bytes | None = None) -> bytes:
    """One A4 page in the company's design: header, who it's for, what it's for, how to pay."""
    show = settings.get("show") or {}
    accent = pdfdoc.hex_rgb(settings.get("accent") or "")
    ink, soft, faint = (0.1, 0.1, 0.12), (0.42, 0.42, 0.45), (0.93, 0.95, 0.94)
    pg = pdfdoc.Page()
    left, right = 48.0, 547.0
    # Header band in the accent colour, with the logo and the company's details.
    pg.box(0, 772, 595, 70, accent)
    x = left
    if logo and show.get("logo", True):
        drawn = pg.picture(logo, left, 784, 120, 46)
        if drawn:
            x = left + drawn[0] + 14
    pg.text(x, 812, settings.get("company_name") or "9 Solar Home", 15, bold=True, rgb=(1, 1, 1))
    sub = [settings.get("company_address") or ""]
    if show.get("uen", True) and settings.get("company_uen"):
        sub.append(f"UEN {settings['company_uen']}")
    contact = " · ".join(x for x in (settings.get("company_email"), settings.get("company_phone")) if x)
    y = 797
    for ln in [s for s in [", ".join(_lines(sub[0])), *sub[1:], contact] if s][:3]:
        pg.text(x, y, ln.replace(" · ", "  |  "), 8.5, rgb=(0.92, 0.97, 0.94))
        y -= 11
    pg.text(right, 806, settings.get("invoice_title") or "INVOICE", 20, bold=True, rgb=(1, 1, 1), align="right")

    # Number, dates and who it's for.
    y = 740
    pg.text(left, y, "BILLED TO", 8, bold=True, rgb=soft)
    pg.text(330, y, "INVOICE NO.", 8, bold=True, rgb=soft)
    pg.text(right, y, inv["number"], 10, bold=True, rgb=ink, align="right")
    y -= 15
    pg.text(left, y, inv["bill_to"], 11, bold=True, rgb=ink)
    pg.text(330, y, "ISSUED", 8, bold=True, rgb=soft)
    pg.text(right, y, inv["issued_on"].strftime("%d %b %Y"), 10, rgb=ink, align="right")
    y -= 14
    by = y
    for ln in pdfdoc.wrap(inv.get("bill_address") or "", 9.5, 250)[:3] + ([inv["bill_email"]] if inv.get("bill_email") else []):
        pg.text(left, by, ln, 9.5, rgb=soft)
        by -= 12
    pg.text(330, y, "DUE", 8, bold=True, rgb=soft)
    pg.text(right, y, inv["due_on"].strftime("%d %b %Y"), 10, bold=True, rgb=ink, align="right")
    y = min(by, y) - 16
    if settings.get("intro"):
        for ln in pdfdoc.wrap(settings["intro"], 9.5, right - left)[:4]:
            pg.text(left, y, ln, 9.5, rgb=ink)
            y -= 13
        y -= 6

    # What it's for.
    pg.box(left, y - 6, right - left, 22, faint)
    pg.text(left + 8, y + 2, "DESCRIPTION", 8, bold=True, rgb=soft)
    kwh_cols = inv["kind"] == "monthly" and show.get("kwh", True)
    if kwh_cols:
        pg.text(355, y + 2, "KWH", 8, bold=True, rgb=soft, align="right")
        pg.text(440, y + 2, "RATE", 8, bold=True, rgb=soft, align="right")
    pg.text(right - 8, y + 2, "AMOUNT", 8, bold=True, rgb=soft, align="right")
    y -= 26
    if inv["kind"] == "admin_fee":
        desc = ["Admin fee (one-time)", "Solar PV installation: paid before the handover"]
    else:
        desc = [f"Solar power generated, {month_text(inv['period'])}", "Monthly payment under your solar plan"]
    pg.text(left + 8, y, desc[0], 10, bold=True, rgb=ink)
    if kwh_cols:
        pg.text(355, y, f"{Decimal(str(inv['kwh'])):,.2f}", 10, rgb=ink, align="right")
        pg.text(440, y, f"S${Decimal(str(inv['rate'])):.4f}", 10, rgb=ink, align="right")
    pg.text(right - 8, y, money(inv["amount"]), 10, rgb=ink, align="right")
    y -= 13
    pg.text(left + 8, y, desc[1], 8.5, rgb=soft)
    y -= 16
    pg.line(left, y, right, y)
    y -= 22
    pg.text(380, y, "TOTAL DUE", 9, bold=True, rgb=soft)
    pg.text(right - 8, y, money(inv["amount"]), 15, bold=True, rgb=accent, align="right")
    if inv["status"] == "paid":
        y -= 22
        pg.text(right - 8, y, f"PAID {money(inv['paid_amount'])} on {inv['paid_on'].strftime('%d %b %Y')}", 10, bold=True, rgb=(0.05, 0.55, 0.3), align="right")
    elif inv["status"] == "void":
        y -= 22
        pg.text(right - 8, y, "VOID: no payment is due", 10, bold=True, rgb=(0.75, 0.15, 0.15), align="right")
    y -= 34

    # How to pay: the QR and the note.
    if inv["status"] == "issued":
        pg.text(left, y, "HOW TO PAY", 8, bold=True, rgb=soft)
        y -= 14
        text_x = left
        top, qr_h = y, 0.0
        if qr and show.get("qr", True):
            drawn = pg.picture(qr, left, y - 120, 120, 120)
            if drawn:
                text_x, qr_h = left + drawn[0] + 18, drawn[1]
        for ln in pdfdoc.wrap(settings.get("pay_note") or "", 9.5, right - text_x)[:6]:
            pg.text(text_x, y, ln, 9.5, rgb=ink)
            y -= 13
        pg.text(text_x, y - 4, f"Reference: {inv['number']}", 10, bold=True, rgb=ink)
        y = min(y - 22, top - qr_h - 10)

    if show.get("terms", True) and settings.get("terms"):
        pg.text(left, y, "TERMS", 8, bold=True, rgb=soft)
        y -= 13
        for ln in pdfdoc.wrap(settings["terms"], 8.5, right - left)[:8]:
            pg.text(left, y, ln, 8.5, rgb=soft)
            y -= 11
    if settings.get("footer"):
        fy = 46
        for ln in pdfdoc.wrap(settings["footer"], 8, right - left)[:2]:
            pg.text(297.5, fy, ln, 8, rgb=soft, align="center")
            fy -= 10
    pg.line(left, 60, right, 60, rgb=accent, w=1.2)
    return pdfdoc.render(pg, title=f"{settings.get('invoice_title') or 'Invoice'} {inv['number']}")
