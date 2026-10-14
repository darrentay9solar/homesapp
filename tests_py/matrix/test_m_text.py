# ruff: noqa: RUF001, E501  (Chinese text; case tables read better whole)
"""Matrix: every translation, and the mobile and email rules, case by case.

  translations  every entry in zh.json: Simplified characters only (GB2312),
                the same {placeholders} as the English, Mainland wording,
                and real Chinese for anything longer than a couple of words
  mobiles       20,000 numbers written every way people write them
  emails        5,000 addresses, good and bad

Run with: npm run test:matrix
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from _lib.profile import clean_email, clean_phone

ZH = json.loads((Path(__file__).resolve().parents[2] / "api/_lib/i18n/zh.json").read_text(encoding="utf8"))
ENTRIES = sorted(ZH.items())
CJK = re.compile(r"[㐀-鿿]")
# Taiwan and Hong Kong words with a Mainland one the app uses instead.
REGIONAL = ["登出", "设定", "电邮", "栏位", "讯息", "帐户", "帐号", "网路", "视讯", "资讯", "档案", "软体", "萤幕", "预设", "简讯"]


@pytest.mark.parametrize(("en", "zh"), ENTRIES, ids=[f"simplified:{i}" for i in range(len(ENTRIES))])
def test_simplified_only(en, zh) -> None:
    bad = []
    for ch in CJK.findall(zh):
        try:
            ch.encode("gb2312")
        except UnicodeEncodeError:
            bad.append(ch)
    assert not bad, f"Traditional characters {bad} in {zh!r}"


@pytest.mark.parametrize(("en", "zh"), ENTRIES, ids=[f"placeholders:{i}" for i in range(len(ENTRIES))])
def test_same_placeholders(en, zh) -> None:
    assert sorted(re.findall(r"\{(\w+)\}", en)) == sorted(re.findall(r"\{(\w+)\}", zh)), (en, zh)


@pytest.mark.parametrize(("en", "zh"), ENTRIES, ids=[f"mainland:{i}" for i in range(len(ENTRIES))])
def test_mainland_words(en, zh) -> None:
    assert not [w for w in REGIONAL if w in zh], (en, zh)


@pytest.mark.parametrize(("en", "zh"), ENTRIES, ids=[f"translated:{i}" for i in range(len(ENTRIES))])
def test_really_translated(en, zh) -> None:
    words = re.findall(r"[A-Za-z]{2,}", re.sub(r"\{\w+\}", "", en))
    # Brand names, models and codes stay as they are; a phrase of three or more words gets Chinese.
    if len(words) >= 3 and not en.startswith(("9 Solar Home:", "SUN2000")):
        assert CJK.search(zh), (en, zh)


# ------------------------------------------------------------------ mobiles


def phone_case(rng: random.Random) -> tuple[str, str | None]:
    """A number as someone might type it, and what the app should store (None: refused)."""
    kind = rng.randrange(7)
    digits = "".join(rng.choice("0123456789") for _ in range(8))
    sep = rng.choice([" ", "", "-", "  "])
    if kind == 0:  # bare Singapore number
        ok = digits[0] in "3689"
        return f"{digits[:4]}{sep}{digits[4:]}", f"+65 {digits[:4]} {digits[4:]}" if ok else None
    if kind == 1:  # +65 and eight digits, spaced any way
        raw = f"+65{sep}{digits[:4]}{sep}{digits[4:]}"
        return raw, re.sub(r"\s+", " ", raw) if not re.search(r"\s{3,}", raw) else re.sub(r"\s+", " ", raw)
    if kind == 2:  # +65 with the wrong count
        n = rng.choice([6, 7, 9, 10])
        return "+65 " + "".join(rng.choice("0123456789") for _ in range(n)), None
    if kind == 3:  # another country: 8 to 15 digits in all
        cc = rng.choice(["60", "62", "86", "44", "1", "91"])
        rest = "".join(rng.choice("0123456789") for _ in range(rng.randrange(5, 14)))
        total = len(cc) + len(rest)
        raw = f"+{cc} {rest}"
        return raw, raw if 8 <= total <= 15 and len(raw) <= 21 else None
    if kind == 4:  # letters in it
        return f"+65 {digits[:3]}x{digits[4:]}", None
    if kind == 5:  # empty
        return rng.choice(["", "   "]), "EMPTY"
    return f"+{digits}{digits}{digits}", None  # far too long


RNG = random.Random(20261014)
PHONES = [phone_case(RNG) for _ in range(20000)]


@pytest.mark.parametrize(("raw", "want"), PHONES, ids=[f"mobile:{i}" for i in range(len(PHONES))])
def test_mobile(raw, want) -> None:
    if want == "EMPTY":
        assert clean_phone(raw) is None
        return
    if want is None:
        with pytest.raises(HTTPException):
            clean_phone(raw)
        return
    got = clean_phone(raw)
    assert got == want
    assert clean_phone(got) == got, "saving it again changes nothing"
    assert re.sub(r"\D", "", got).endswith(re.sub(r"\D", "", raw)[-8:]), "no digit lost"


# ------------------------------------------------------------------ emails


def email_case(rng: random.Random) -> tuple[str, str | None]:
    local = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789._+-") for _ in range(rng.randrange(1, 12)))
    domain = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789-") for _ in range(rng.randrange(1, 10)))
    tld = rng.choice(["com", "sg", "com.sg", "io", "co"])
    kind = rng.randrange(6)
    if kind == 0:
        raw = f"{local}@{domain}.{tld}"
        return raw, raw.lower()
    if kind == 1:  # capitals and spaces around
        raw = f"  {local.upper()}@{domain.upper()}.{tld}  "
        return raw, raw.strip().lower()
    if kind == 2:
        return f"{local}{domain}.{tld}", None  # no @
    if kind == 3:
        return f"{local}@{domain}", None  # no dot after the @
    if kind == 4:
        return f"{local} x@{domain}.{tld}", None  # a space inside
    return f"{local}@@{domain}.{tld}", None


RNG2 = random.Random(1410)
EMAILS = [email_case(RNG2) for _ in range(5000)]


@pytest.mark.parametrize(("raw", "want"), EMAILS, ids=[f"email:{i}" for i in range(len(EMAILS))])
def test_email(raw, want) -> None:
    if want is None:
        with pytest.raises(HTTPException):
            clean_email(raw)
    else:
        assert clean_email(raw) == want
