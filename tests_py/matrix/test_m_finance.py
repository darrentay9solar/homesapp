# ruff: noqa: E501  (case tables read better whole)
"""Matrix: payments, case by case.

  amounts      8,000 kWh and rates: kWh x rate to the cent, half a cent up (worked out in whole numbers)
  plan         every month 2 years either side of 60 turn-on dates: in the 8-year plan or not
  statements   3,000 credits written the ways banks write them: the right day and amount, debits left out
  matching     2,000 references, however the payer typed the invoice number: it's found

Run with: npm run test:matrix
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import Decimal

import pytest

from _lib import invoices as iv

# ------------------------------------------------------------------ amounts


def amount_case(rng: random.Random) -> tuple[str, str, str]:
    kwh_c = rng.randrange(0, 5_000_000)  # hundredths of a kWh
    rate_t = rng.randrange(0, 10_000)  # ten-thousandths of a dollar
    tiny = kwh_c * rate_t  # millionths of a dollar
    cents = (tiny + 5_000) // 10_000
    return f"{kwh_c // 100}.{kwh_c % 100:02d}", f"{rate_t // 10_000}.{rate_t % 10_000:04d}", f"{cents // 100}.{cents % 100:02d}"


RNG = random.Random(4300)
AMOUNTS = [amount_case(RNG) for _ in range(8000)]


@pytest.mark.parametrize(("kwh", "rate", "want"), AMOUNTS, ids=[f"amount:{i}" for i in range(len(AMOUNTS))])
def test_amount(kwh, rate, want) -> None:
    assert iv.monthly_amount(kwh, rate) == Decimal(want)


# ------------------------------------------------------------------ the plan's months

TURN_ONS = [date(2024, 1, 1) + timedelta(days=37 * i) for i in range(60)]
PLAN_CASES = [(t, k) for t in TURN_ONS for k in range(-24, 24 * 5 + 1, 5)]


@pytest.mark.parametrize(("turned_on", "k"), PLAN_CASES, ids=[f"plan:{i}" for i in range(len(PLAN_CASES))])
def test_in_the_plan(turned_on, k) -> None:
    y, m = divmod(turned_on.month - 1 + k, 12)
    month = date(turned_on.year + y, m + 1, 1)
    assert iv.in_plan(month, turned_on, 8) == (0 <= k < 96)


# ------------------------------------------------------------------ statements

FORMATS = ["%d %b %Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y"]


def written(rng: random.Random, cents: int) -> str:
    whole, part = divmod(cents, 100)
    plain = f"{whole}.{part:02d}"
    grouped = f"{whole:,}.{part:02d}"
    # A thousands comma is inside quotes in a CSV, as banks write it (unquoted, it would be two columns).
    return rng.choice([plain, f'"{grouped}"', f'"S${grouped}"', f"{plain} CR", f"SGD {plain}", f"S${plain}"])


def statement_case(rng: random.Random) -> tuple[str, list[tuple[str, str]]]:
    fmt = rng.choice(FORMATS)
    layout = rng.randrange(2)
    rows, want = [], []
    for _ in range(rng.randrange(1, 6)):
        d = date(2026, 1, 1) + timedelta(days=rng.randrange(0, 365))
        cents = rng.randrange(1, 900_000)
        credit = rng.random() < 0.7
        words = f"PAYNOW INV-2026-{rng.randrange(1, 99999):05d}"
        if layout == 0:
            rows.append(f"{d.strftime(fmt)},ICT,{'' if credit else written(rng, cents)},{written(rng, cents) if credit else ''},{words}")
        else:
            rows.append(f"{d.strftime(fmt)},{words},{'' if credit else '-'}{whole_dec(cents)}")
        if credit:
            want.append((d.isoformat(), f"{cents // 100}.{cents % 100:02d}"))
    head = "Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1" if layout == 0 else "Date,Description,Amount"
    return "\n".join(["Bank export", "", head, *rows]) + "\n", want


def whole_dec(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


RNG2 = random.Random(9)
STATEMENTS = [statement_case(RNG2) for _ in range(3000)]


@pytest.mark.parametrize(("text", "want"), STATEMENTS, ids=[f"statement:{i}" for i in range(len(STATEMENTS))])
def test_statement(text, want) -> None:
    assert [(ln["date"], ln["amount"]) for ln in iv.parse_statement(text)] == want


# ------------------------------------------------------------------ matching


def ref_case(rng: random.Random) -> tuple[str, str]:
    n = rng.randrange(1, 99999)
    number = f"INV-2026-{n:05d}"
    typed = rng.choice([number, number.lower(), f"INV 2026 {n:05d}", f"INV2026{n:05d}", f"inv/2026/{n:05d}", f"INV-2026 -{n:05d}"])
    words = rng.choice([f"PAYNOW {typed}", f"{typed} TAN AH KOW", f"FAST PAYMENT REF {typed} BILL", typed])
    return words, number


RNG3 = random.Random(77)
REFS = [ref_case(RNG3) for _ in range(2000)]


@pytest.mark.parametrize(("words", "number"), REFS, ids=[f"ref:{i}" for i in range(len(REFS))])
def test_reference_found(words, number) -> None:
    got = iv.match([{"date": "2026-10-01", "amount": "10.00", "words": words}],
                   [{"invoice_id": 1, "number": number, "amount": Decimal("10.00"), "status": "issued"}])  # fmt: skip
    assert got[0]["result"] == "match", words
