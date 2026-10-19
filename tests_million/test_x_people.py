# ruff: noqa: E501  (case tables read better whole)
"""Million · what people type: mobile numbers and the last 4 of the NRIC.

docs/form-rules.md:
  mobile      stored with its country code, "+65 9123 4567". A bare 8-digit number starting
              3, 6, 8 or 9 is taken as Singapore; any other bare number is refused (choose the
              country). With a +: digits, spaces and dashes only, 8 to 15 digits; a Singapore
              number has exactly 8 after +65.
  NRIC        the last 4 only: three digits and a letter ("567D", any case, stored in capitals);
              never more than 4 characters; only kept for a homeowner.
"""

from __future__ import annotations

import random

import pytest
from fastapi import HTTPException

from _lib.profile import ProfileIn, clean_phone, clean_profile

rng = random.Random(2026)
SG_NUMBERS = [f"{rng.choice('3689')}{rng.randrange(0, 10**7):07d}" for _ in range(4000)]
SG_WAYS = ["{a}{b}", "{a} {b}", "{a}-{b}", " {a} {b} ", "+65 {a} {b}", "+65{a}{b}", "+65-{a}-{b}", "+65  {a}  {b}"]
PHONES = [(n, w) for n in SG_NUMBERS for w in range(len(SG_WAYS))]
BAD_BARE = [f"{d}{rng.randrange(0, 10**7):07d}" for d in "012457" for _ in range(500)] + [
    f"9{rng.randrange(0, 10**k):0{k}d}" for k in (5, 6, 8, 9) for _ in range(300)
]
BAD_SG = [f"+65 {rng.randrange(0, 10**k):0{k}d}" for k in (6, 7, 9, 10) for _ in range(400)]
ABROAD = [
    f"+{cc} {rng.randrange(10**(n - 1), 10**n)}"
    for cc, n in (("60", 9), ("852", 8), ("44", 10), ("1", 10), ("86", 11), ("62", 10))
    for _ in range(400)
]
LETTERS = [f"+65 9{rng.randrange(0, 10**3):03d} {c}{rng.randrange(0, 10**3):03d}" for c in "abcxyz" for _ in range(100)]
NRIC_GOOD = [(f"{n:03d}{c}", case) for n in range(1000) for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" for case in (0,)]
NRIC_LOWER = [(f"{n:03d}{c}", 1) for n in range(0, 1000, 7) for c in "abcdefghijklmnopqrstuvwxyz"]
NRIC_BAD = [
    *(f"S{n:07d}{c}" for n in range(0, 10**7, 99_991) for c in "AZ"),
    *(f"{n:02d}{c}" for n in range(100) for c in "ABZ"),
    *(f"{c}{n:03d}" for n in range(0, 1000, 3) for c in "AZ"),
    *(f"{n:04d}" for n in range(0, 10000, 17)),
    *(f"{n:03d}{c}" for n in range(0, 1000, 11) for c in "-#é1"),
]


def refused(fn, *a, **k) -> bool:
    try:
        fn(*a, **k)
    except HTTPException as e:
        return e.status_code == 400
    return False


@pytest.mark.parametrize(("number", "way"), PHONES, ids=[f"phone:{i}" for i in range(len(PHONES))])
def test_singapore_mobiles(number, way) -> None:
    typed = SG_WAYS[way].format(a=number[:4], b=number[4:])
    got = clean_phone(typed)
    if typed.strip().startswith("+"):
        assert got == " ".join(typed.strip().split())
    else:
        assert got == f"+65 {number[:4]} {number[4:]}"


@pytest.mark.parametrize(
    "typed",
    BAD_BARE + BAD_SG + LETTERS,
    ids=[f"phone_refused:{i}" for i in range(len(BAD_BARE) + len(BAD_SG) + len(LETTERS))],
)
def test_mobiles_refused(typed) -> None:
    assert refused(clean_phone, typed)


@pytest.mark.parametrize("typed", ABROAD, ids=[f"abroad:{i}" for i in range(len(ABROAD))])
def test_numbers_abroad(typed) -> None:
    assert clean_phone(typed) == typed


@pytest.mark.parametrize(
    ("ic", "lower"), NRIC_GOOD + NRIC_LOWER, ids=[f"nric:{i}" for i in range(len(NRIC_GOOD) + len(NRIC_LOWER))]
)
def test_nric_last_4(ic, lower) -> None:
    out = clean_profile(ProfileIn(fullName="Aisha Rahman", role="homeowner", icLast4=ic))
    assert out["ic_last4"] == ic.upper()
    # Only a homeowner's is kept.
    assert clean_profile(ProfileIn(fullName="Aisha Rahman", role="epc_team", icLast4=ic))["ic_last4"] is None


@pytest.mark.parametrize("ic", NRIC_BAD, ids=[f"nric_refused:{i}" for i in range(len(NRIC_BAD))])
def test_nric_refused(ic) -> None:
    assert refused(clean_profile, ProfileIn(fullName="Aisha Rahman", role="homeowner", icLast4=ic))
