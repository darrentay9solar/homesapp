# ruff: noqa: RUF001  (Chinese full-width punctuation is the point)
"""UAT · everything a person reads comes in their language.

Every phrase in the shared dictionary translates, with its blanks filled in;
every email, WhatsApp and text is written in the reader's language, and a
missing translation stays in English rather than disappearing.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from _lib import notify
from _lib.i18n import ONE_WORD, tr
from uat.conftest import REAL_SEND_WHATSAPP

pytestmark = pytest.mark.uat

DICT: dict[str, str] = json.loads(
    (Path(__file__).resolve().parents[2] / "api" / "_lib" / "i18n" / "zh.json").read_text(encoding="utf8")
)
HAN = re.compile(r"[一-鿿]")
EXACT = sorted(k for k in DICT if "{" not in k)
PATTERNS = sorted(k for k in DICT if "{" in k)


@pytest.mark.parametrize("en", EXACT)
def test_phrase(en: str) -> None:
    assert tr(en, "zh") == DICT[en]
    assert tr(en, "en") == en


def _filled(text: str, values: dict[str, str]) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: values[m.group(1)], text)


@pytest.mark.parametrize("en", PATTERNS)
def test_pattern_with_its_blanks_filled(en: str) -> None:
    names = re.findall(r"\{(\w+)\}", en)
    # One word each: two blanks side by side ("{number} {where}") can't be told apart otherwise.
    values = {n: ("7" if n in ONE_WORD else f"Zq{i}xWv") for i, n in enumerate(names)}
    got = tr(_filled(en, values), "zh")
    assert got is not None
    for v in values.values():
        assert v in got, "the filled-in part is kept"
    assert got != _filled(en, values) or not HAN.search(DICT[en]), "and the rest is translated"


@pytest.mark.parametrize("en", [k for k in DICT if len(k.split()) > 3])
def test_translation_is_chinese(en: str) -> None:
    assert HAN.search(DICT[en]) or not re.search(
        r"[A-Za-z]{4,}", re.sub(r"\{\w+\}|GetHomeApps|9 Solar Home|SP|PDF|EPC|PM", "", en)
    )


ROLES = ["Homeowner", "Project Manager", "Contractor Admin", "EPC Team"]
NAMES = ["Aisha Rahman", "陈美玲", "Ng Wei Ling"]
BUILDERS = {
    "account_created": lambda n, r, lang: notify.msg_account_created(n, r, "https://x.test/s", lang),
    "account_approved": lambda n, r, lang: notify.msg_account_approved(n, r, "https://x.test", lang),
    "account_rejected": lambda n, r, lang: notify.msg_account_rejected(n, "Please call us", lang),
    "account_rejected_no_note": lambda n, r, lang: notify.msg_account_rejected(n, None, lang),
    "account_requested": lambda n, r, lang: notify.msg_account_requested(n, "a@example.com", r, "https://x.test", lang),
    "role_requested": lambda n, r, lang: notify.msg_role_requested(
        n, "EPC Team", r, "Moving office", "https://x.test", lang
    ),
    "role_approved": lambda n, r, lang: notify.msg_role_decided(n, r, True, None, "https://x.test", lang),
    "role_declined": lambda n, r, lang: notify.msg_role_decided(n, r, False, "Not yet", "https://x.test", lang),
    "approve_project": lambda n, r, lang: notify.msg_approve_project(
        n, "Jalan Kayu", "14 Jalan Kayu", "https://x.test", lang
    ),
    "sign_handover": lambda n, r, lang: notify.msg_sign_handover(
        n, "Jalan Kayu", "14 Jalan Kayu", "https://x.test", lang
    ),
    "project_closed": lambda n, r, lang: notify.msg_project_closed(n, "Jalan Kayu", "https://x.test", lang),
}
MSG_GRID = [(b, n, r) for b in BUILDERS for n in NAMES for r in ROLES]


def _english_words(text: str, keep: list[str]) -> list[str]:
    for k in [*keep, "GetHomeApps", "9 Solar Home", "Jalan Kayu", "https://x.test/s", "https://x.test", "a@example.com",
              "Please call us", "Not yet", "Moving office", "WhatsApp", "SP", "EPC"]:  # fmt: skip
        text = text.replace(k, "")
    return re.findall(r"[A-Za-z]{3,}", text)


@pytest.mark.parametrize(("builder", "name", "role"), MSG_GRID, ids=[f"{b}-{n}-{r}" for b, n, r in MSG_GRID])
def test_message_in_chinese(builder, name, role) -> None:
    m = BUILDERS[builder](name, role, "zh")
    subject, html_body, text = m["email"]
    assert HAN.search(subject) and HAN.search(text)
    assert _english_words(text.replace("— ", ""), [name]) == [], "no sentence left in English"
    assert html_body.startswith('<!doctype html><html lang="zh-Hans">')
    assert name in text, "names are kept as written"
    if "sms" in m:
        assert HAN.search(m["sms"]) and _english_words(m["sms"], [name]) == []


@pytest.mark.parametrize(("builder", "name", "role"), MSG_GRID, ids=[f"{b}-{n}-{r}" for b, n, r in MSG_GRID])
def test_message_in_english(builder, name, role) -> None:
    m = BUILDERS[builder](name, role, "en")
    subject, html_body, text = m["email"]
    assert subject.startswith("9 Solar Home")
    assert not HAN.search(text.replace(name, ""))
    assert html_body.startswith('<!doctype html><html lang="en">')


@pytest.mark.parametrize("lang", ["en", "zh"])
@pytest.mark.parametrize("code", ["000000", "123456", "987654"])
def test_verification_code_text(lang, code) -> None:
    text = notify.msg_verification_code(code, 10, lang)
    assert code in text and "10" in text
    assert bool(HAN.search(text)) == (lang == "zh")


@pytest.mark.parametrize(
    ("lang", "env", "want"),
    [
        ("en", {}, "en"),
        ("zh", {}, "zh_CN"),
        ("zh", {"WHATSAPP_TEMPLATE_LANG_ZH": "zh_HK"}, "zh_HK"),
        ("en", {"WHATSAPP_TEMPLATE_LANG": "en_GB"}, "en_GB"),
    ],  # fmt: skip
)
def test_whatsapp_template_language(monkeypatch, lang, env, want) -> None:
    monkeypatch.setattr(notify, "env", lambda key, _e=env: _e.get(key))
    assert notify.template_language(lang) == want


@pytest.mark.parametrize(
    ("first", "falls_back"),
    [
        (notify.SendResult("failed", "WhatsApp 404 (132001): template name does not exist in the translation"), True),
        (notify.SendResult("failed", "WhatsApp 400 (131026): message undeliverable"), False),
        (notify.SendResult("sent"), False),
        (notify.SendResult("skipped", "WhatsApp not configured"), False),
    ],
)
def test_chinese_whatsapp_falls_back_to_english_only_when_the_translation_is_missing(monkeypatch, first, falls_back):
    calls: list[str] = []

    def fake(to, template, params, copy_code, code):
        calls.append(code)
        return first if len(calls) == 1 else notify.SendResult("sent")

    monkeypatch.setattr(notify, "_send_whatsapp", fake)
    monkeypatch.setattr(notify, "env", lambda key: None)
    REAL_SEND_WHATSAPP("6591234567", "account_created", ["A"], lang="zh")
    assert calls == (["zh_CN", "en"] if falls_back else ["zh_CN"])
