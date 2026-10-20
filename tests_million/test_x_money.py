# ruff: noqa: E501  (case tables read better whole)
"""Million · money: a month's amount, how money is written, invoice numbers.

a month's amount  kWh (to the thousandth) x the contract's rate (to 4 places), to the
                  cent, half a cent rounding up (docs/payments.md). The reference does it
                  in whole numbers, without Decimal.
writing money     'S$1,234.50': two decimals, commas every thousand, a minus in front
invoice numbers   'INV-2026-00042': the year issued, the number in five digits
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from _lib import invoices

# kWh from 0 to 2,000 in uneven steps (to the thousandth), rates from S$0.1000 to S$0.4985.
KWH_MILLI = list(range(0, 2_000_000, 7_919))
RATES_4DP = list(range(1_000, 5_000, 15))
AMOUNTS = [(k, r) for k in KWH_MILLI for r in RATES_4DP[::2]]
# Cents from -S$1,000,000 to S$10,000,000, in uneven steps, and the halves between them.
CENTS = [*range(-100_000_000, 1_000_000_000, 43_997), *range(0, 300_000, 21)]
MONEY = [(c, half) for c in CENTS for half in (False, True)]
NUMBERS = [(i, y) for i in [*range(1, 2_000), *range(2_000, 99_999, 397)] for y in (2026, 2027, 2033)]


def dec(n: int, places: int) -> str:
    """A whole number of hundredths (or thousandths...) written as a decimal, without floats."""
    sign = "-" if n < 0 else ""
    whole, part = divmod(abs(n), 10**places)
    return f"{sign}{whole}.{part:0{places}d}"


def cents_of(kwh_milli: int, rate_4dp: int) -> int:
    """kWh x rate in cents, half a cent up. kWh is in thousandths, the rate in ten-thousandths."""
    product = kwh_milli * rate_4dp  # in units of 10^-7 dollars, so 10^-5 cents
    whole, rest = divmod(product, 100_000)
    return whole + (1 if rest * 2 >= 100_000 else 0)


def written(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    dollars, c = divmod(abs(cents), 100)
    digits = str(dollars)
    groups = []
    while len(digits) > 3:
        groups.insert(0, digits[-3:])
        digits = digits[:-3]
    groups.insert(0, digits)
    return f"{sign}S${','.join(groups)}.{c:02d}"


@pytest.mark.parametrize(("kwh", "rate"), AMOUNTS, ids=[f"amount:{i}" for i in range(len(AMOUNTS))])
def test_monthly_amount(kwh, rate) -> None:
    got = invoices.monthly_amount(dec(kwh, 3), dec(rate, 4))
    assert got == Decimal(cents_of(kwh, rate)) / 100
    assert got.as_tuple().exponent == -2


@pytest.mark.parametrize(("cents", "half"), MONEY, ids=[f"money:{i}" for i in range(len(MONEY))])
def test_money(cents, half) -> None:
    if not half:
        assert invoices.money(dec(cents, 2)) == written(cents)
        return
    # Half a cent more (or less, below zero) rounds away from zero.
    value = Decimal(cents) / 100 + (Decimal("0.005") if cents >= 0 else Decimal("-0.005"))
    assert invoices.money(str(value)) == written(cents + (1 if cents >= 0 else -1))


@pytest.mark.parametrize(("invoice_id", "year"), NUMBERS, ids=[f"number:{i}" for i in range(len(NUMBERS))])
def test_invoice_number(invoice_id, year) -> None:
    got = invoices.number(invoice_id, date(year, 6, 1))
    assert got == f"INV-{year}-{str(invoice_id).rjust(5, '0')}"
    # And a bank statement that carries it finds it again, however the payer wrote it.
    for words in (got, got.lower(), got.replace("-", " "), got.replace("-", ""), f"payment {got}."):
        m = invoices.NUMBER.search(words)
        assert m and (int(m.group(1)), int(m.group(2))) == (year, invoice_id)
