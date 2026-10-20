# ruff: noqa: E501  (case tables read better whole)
"""Million · invoices over time, and bank statements paying them.

due dates    an invoice is due the set number of days after it's issued (0 to 60)
states       paid and void stay so; otherwise overdue from the day after it's due, waiting until then
statements   a bank's CSV export, in the layouts banks use (a credit column, or one amount
             column with debits beside it), dates written nine ways, amounts written with
             commas, S$, SGD, CR: every credit is read with its date and amount; debits,
             blank lines and rows without a date are left out
matching     a credit naming an invoice number pays it when the amount is exact; another
             amount is "amount differs"; a paid invoice, or one already matched above, is
             "already paid"; no number is "no invoice number"
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import Decimal

import pytest

from _lib import invoices

ISSUED = [date(2024, 1, 1) + timedelta(days=i * 3) for i in range(487)]
DUE = [(d, n) for d in ISSUED for n in range(0, 61, 1)]
STATES = [(status, off, t) for status in ("issued", "paid", "void") for off in range(-400, 401) for t in range(8)]

DATE_WAYS = ["%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y", "%d-%b-%Y", "%d %b %y", "%d/%m/%y", "%d-%b-%y", "%d %B %Y"]
AMOUNT_WAYS = ["{a}", "{c}", "S${c}", "SGD {a}", "{a} CR", "${c}", " {a} "]
LAYOUTS = ["credit", "amount_with_debit", "deposit", "money_in"]
STATEMENTS = [
    (layout, dw, aw, seed)
    for layout in LAYOUTS
    for dw in range(len(DATE_WAYS))
    for aw in range(len(AMOUNT_WAYS))
    for seed in range(60)
]
MATCHES = list(range(25_000))


def cents_text(cents: int, way: str) -> str:
    a = f"{cents // 100}.{cents % 100:02d}"
    c = f"{cents // 100:,}.{cents % 100:02d}"
    return way.format(a=a, c=c)


@pytest.mark.parametrize(("issued", "days"), DUE, ids=[f"due:{i}" for i in range(len(DUE))])
def test_due_date(issued, days) -> None:
    got = invoices.due(issued, days)
    assert got.toordinal() - issued.toordinal() == days


@pytest.mark.parametrize(("status", "off", "t"), STATES, ids=[f"state:{i}" for i in range(len(STATES))])
def test_invoice_state(status, off, t) -> None:
    today = date(2025, 1, 1) + timedelta(days=t * 97)
    due_on = today + timedelta(days=off)
    want = status if status in ("paid", "void") else ("overdue" if off < 0 else "waiting")
    assert invoices.state({"status": status, "due_on": due_on}, today) == want


def statement(layout: str, date_way: str, amount_way: str, rng: random.Random) -> tuple[str, list[dict]]:
    """A CSV export and the credits in it, as a person reading it would list them."""
    head = {
        "credit": ["Transaction Date", "Reference", "Debit Amount", "Credit Amount"],
        "amount_with_debit": ["Date", "Description", "Withdrawals", "Amount"],
        "deposit": ["Value Date", "Transaction Details", "Withdrawal", "Deposit"],
        "money_in": ["Date", "Narrative", "Money Out", "Money In"],
    }[layout]
    lines = [["Account Number", "123-456789-0"], ["Statement period", "Oct 2026"], [], head]
    credits = []
    day = date(2025, 1, 1) + timedelta(days=rng.randrange(0, 600))
    for _ in range(rng.randrange(1, 12)):
        day += timedelta(days=rng.randrange(0, 4))
        cents = rng.randrange(1, 2_000_000)
        words = rng.choice(
            ["PAYNOW TRANSFER", f"INV-2026-{rng.randrange(1, 99999):05d}", "GIRO", "FAST PAYMENT JOHN TAN"]
        )
        kind = rng.random()
        if kind < 0.2:  # money going out
            if layout == "amount_with_debit":
                lines.append([day.strftime(date_way), words, cents_text(cents, "{a}"), cents_text(cents, "{a}")])
            else:
                lines.append([day.strftime(date_way), words, cents_text(cents, "{a}"), ""])
            continue
        if kind < 0.25:  # a blank line
            lines.append(["", "", "", ""])
            continue
        if kind < 0.3:  # a line without a date (a carried-forward balance)
            lines.append(["Balance B/F", "", "", cents_text(cents, "{a}")])
            continue
        lines.append([day.strftime(date_way), words, "", cents_text(cents, amount_way)])
        credits.append({"date": day.isoformat(), "amount": f"{cents // 100}.{cents % 100:02d}", "words": words})
    text = "\n".join(",".join(f'"{c}"' if "," in c else c for c in row) for row in lines)
    return text, credits


@pytest.mark.parametrize(
    ("layout", "dw", "aw", "seed"), STATEMENTS, ids=[f"statement:{i}" for i in range(len(STATEMENTS))]
)
def test_reading_a_statement(layout, dw, aw, seed) -> None:
    text, credits = statement(layout, DATE_WAYS[dw], AMOUNT_WAYS[aw], random.Random(seed * 1000 + dw * 10 + aw))
    got = invoices.parse_statement(text)
    assert [(g["date"], g["amount"], g["words"]) for g in got] == [
        (c["date"], c["amount"], c["words"]) for c in credits
    ]


@pytest.mark.parametrize("seed", MATCHES, ids=[f"match:{i}" for i in MATCHES])
def test_matching_payments(seed) -> None:
    rng = random.Random(seed)
    open_invoices = []
    for _ in range(rng.randrange(1, 6)):
        iid = rng.randrange(1, 99999)
        if any(i["invoice_id"] == iid for i in open_invoices):
            continue
        open_invoices.append(
            {
                "invoice_id": iid,
                "number": invoices.number(iid, date(2026, 1, 1)),
                "amount": Decimal(rng.randrange(100, 500_000)) / 100,
                "status": rng.choice(["issued", "issued", "paid"]),
            }
        )
    lines, want, taken = [], [], set()
    for _ in range(rng.randrange(1, 8)):
        inv = rng.choice(open_invoices) if rng.random() < 0.8 else None
        if inv is None:
            amount = Decimal(rng.randrange(100, 500_000)) / 100
            lines.append({"date": "2026-01-05", "amount": f"{amount:.2f}", "words": "PAYNOW FROM A NEIGHBOUR"})
            want.append((None, "no invoice number"))
            continue
        exact = rng.random() < 0.7
        amount = inv["amount"] if exact else inv["amount"] + Decimal(rng.choice([-100, -1, 1, 50])) / 100
        number = inv["number"]
        written = rng.choice(
            [number, number.lower(), number.replace("-", " "), number.replace("-", ""), f"Ref {number} Oct"]
        )
        lines.append({"date": "2026-01-05", "amount": f"{amount:.2f}", "words": f"PAYNOW {written}"})
        if inv["status"] == "paid" or inv["invoice_id"] in taken:
            want.append((inv["invoice_id"], "already paid"))
        elif exact:
            want.append((inv["invoice_id"], "match"))
            taken.add(inv["invoice_id"])
        else:
            want.append((inv["invoice_id"], "amount differs"))
    got = invoices.match(lines, open_invoices)
    assert [(g["invoiceId"], g["result"]) for g in got] == want
