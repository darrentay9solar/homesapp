# ruff: noqa: E501  (case tables read better whole)
"""The screens and the server agree on every form rule (lib/client/rules.ts, api/_lib/profile.py).

A form says what's wrong before it sends (a red box, a reason under it). If
the screen accepted something the server then refused, people would fill a
form in "correctly" and still be told off; if it refused something the server
accepts, they'd be stuck. So each value below goes through both: the screen's
rule (run with tsx, tests/rules-dump.ts) and the server's, and both must say
yes, or both no.

mobile     Singapore and other countries, spaced, dashed, short, long, letters, bare
email      the shapes people type, and the ones that aren't emails
nric       last four only: three digits and a letter
postal     six digits
name       at least two characters, spaces don't count
password   Clerk's policy as set in its dashboard (min length, no other character rules)
language   the language picked anywhere is saved on the account, both ways, for every role
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

from _lib import onemap
from _lib.profile import ProfileIn, clean_email, clean_phone, clean_profile
from conftest import bearer

ROOT = Path(__file__).resolve().parent.parent

# Clerk's password policy (Clerk dashboard → User & authentication → Password), read from the
# instance's environment on 12 Oct 2026. If it changes there, change it here and in rules.ts.
CLERK_PASSWORD = {
    "min_length": 15,
    "require_special_char": False,
    "require_numbers": False,
    "require_uppercase": False,
    "require_lowercase": False,
}

# ------------------------------------------------------------------ cases

SG_FIRST = ["3", "6", "8", "9", "1", "5"]
OTHER_DIALS = ["60", "62", "63", "66", "84", "86", "852", "853", "91", "92", "1", "44", "61", "64", "81", "82", "971", "966"]


def mobile_cases() -> list[str]:
    out: list[str] = [
        "",
        "+",
        "+65",
        "+65 ",
        "+65  ",
        "  +65 9123 4567  ",
        "+65 9123 4567 ",
        "+65 (9123) 4567",
        "+65 9123.4567",
        "+65 9123 456a",
        "+65 abcd efgh",
        "+65 9123\t4567",
        "+65--91234567",
        "+65 9123-4567",
        "+65 9123 - 4567",
        "+6591234567",
        "+659123456",
        "+65912345678",
        "++65 9123 4567",
        "+ 65 9123 4567",
        "65 9123 4567",
        "6591234567",
        "+65 0000 0000",
        "+65 9999 9999",
    ]
    for first in SG_FIRST:
        for n in range(1, 13):
            local = (first + "1234567890123")[:n]
            out.append(f"+65 {local}")
            if n == 8:
                out.append(f"+65 {local[:4]} {local[4:]}")
                out.append(f"+65 {local[:4]}-{local[4:]}")
                out.append(local)  # bare, as an older form or an import sends it
                out.append(f"{local[:4]} {local[4:]}")
    for dial in OTHER_DIALS:
        for n in range(3, 15):
            local = ("1234567890123456")[:n]
            out.append(f"+{dial} {local}")
        out.append(f"+{dial} 12 345 6789")
        out.append(f"+{dial} 12-345-6789")
        out.append(f"+{dial}")
        out.append(f"+{dial} ")
    for n in range(1, 13):
        out.append("9" * n)
        out.append("1" * n)
    return out


def email_cases() -> list[str]:
    good = [
        "jo@example.com",
        "a@b.co",
        "first.last@example.com",
        "first+tag@example.com",
        "UPPER@EXAMPLE.COM",
        "x_y-z@sub.example.co.sg",
        "me@localhost.lan",
        "1@2.3",
        "tan.ah.kow@9solarhome.com",
        "名字@example.com",
        "o'neil@example.ie",
        "a@b.c.d",
    ]
    bad = [
        "",
        " ",
        "jo",
        "jo@",
        "@example.com",
        "jo@example",
        "jo@.com.",
        "jo example@x.com",
        "jo@exa mple.com",
        "jo@@example.com",
        "jo@ex@ample.com",
        "jo@example.",
        ".",
        "@",
        "a@b",
        "jo@example .com",
    ]
    out = []
    for g in good:
        out += [g, f"  {g}  ", g.upper()]
    for b in bad:
        out += [b, f" {b} "]
    for i in range(80):
        out.append(f"user{i}@domain{i % 7}.{['com', 'sg', 'net', 'org', 'io'][i % 5]}")
        out.append(f"user{i}domain{i % 7}.com")
    return out


def ic_cases() -> list[str]:
    out = [
        "",
        " ",
        "567D",
        "567d",
        " 567D ",
        "000A",
        "999Z",
        "56D",
        "5678",
        "567DD",
        "S567",
        "S1234567D",
        "56 D",
        "5-6D",
        "567@",
        "ABCD",
        "".join(map(chr, (0xFF11, 0xFF12, 0xFF13))) + "A",  # full-width digits
    ]
    for i in range(0, 1000, 37):
        for letter in ["A", "z", "M", "9", "é"]:
            out.append(f"{i:03d}{letter}")
    return out


def postal_cases() -> list[str]:
    out = [
        "",
        " ",
        "569933",
        " 569933 ",
        "56993",
        "5699333",
        "56993A",
        "569 933",
        "000000",
        "999999",
        "12345a",
        "abcdef",
        "56-993",
    ]
    for i in range(0, 999999, 14999):
        out.append(f"{i:06d}")
        out.append(str(i))
    return out


def name_cases() -> list[str]:
    out = [
        "",
        " ",
        "  ",
        "J",
        " J ",
        "Jo",
        " Jo ",
        "Tan Ah Kow",
        "陈",
        "陈明",
        "Ng",
        "A B",
        "\tJo\t",
        "O'Neil",
        "Nur Aisyah binte Ahmad",
        "J.",
        " . ",
    ]
    for n in range(0, 40):
        out.append("x" * n)
    return out


def password_cases() -> list[str]:
    out = [
        "",
        " ",
        "short",
        "a short sentence",
        "exactly fifteen",
        "fourteen chars",
        "a" * 14,
        "a" * 15,
        "a" * 16,
        "A" * 15,
        "1" * 15,
        "!" * 15,
        "Correct horse battery",
        "ทดสอบรหัสผ่านยาวมาก!",
        "密码密码密码密码密码密码密码密码",
    ]
    for n in range(0, 40):
        out.append(("abc def ghi jkl mno pqr stu vwx yz " * 2)[:n])
    return out


CASES = (
    [("mobile", v) for v in mobile_cases()]
    + [("email", v) for v in email_cases()]
    + [("ic", v) for v in ic_cases()]
    + [("postal", v) for v in postal_cases()]
    + [("name", v) for v in name_cases()]
    + [("password", v) for v in password_cases()]
)


# ------------------------------------------------------------------ the screens' answers


@pytest.fixture(scope="module")
def screen(tmp_path_factory) -> dict[tuple[str, str], str | None]:
    path = tmp_path_factory.mktemp("rules") / "cases.json"
    path.write_text(json.dumps([{"kind": k, "value": v} for k, v in CASES]), encoding="utf-8")
    tsx = ROOT / "node_modules" / ".bin" / ("tsx.cmd" if sys.platform == "win32" else "tsx")
    out = subprocess.run(
        [str(tsx), "tests/rules-dump.ts", str(path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        shell=sys.platform == "win32",
        check=True,
    )
    data = json.loads(out.stdout)
    assert data["passwordMin"] == CLERK_PASSWORD["min_length"], "The screens' password length isn't Clerk's"
    return {(r["kind"], r["value"]): r["problem"] for r in data["results"]}


# ------------------------------------------------------------------ the server's answers


def server_ok(kind: str, value: str) -> bool:
    try:
        if kind == "mobile":
            return clean_phone(value) is not None  # every form that asks needs one
        if kind == "email":
            clean_email(value)
            return True
        if kind == "ic":
            clean_profile(ProfileIn(fullName="Test Person", role="homeowner", icLast4=value))
            return True
        if kind == "postal":
            # The rule before the OneMap lookup (which needs the network): six digits, or nothing.
            v = value.strip()
            return not v or (bool(onemap.SG_POSTAL.match(v)) and v.isascii())
        if kind == "name":
            clean_profile(ProfileIn(fullName=value, role="homeowner"))
            return True
        if kind == "password":
            p = CLERK_PASSWORD
            return len(value) >= p["min_length"]
    except HTTPException:
        return False
    raise AssertionError(kind)


@pytest.mark.parametrize(("kind", "value"), CASES, ids=[f"{k}:{v!r}" for k, v in CASES])
def test_the_screen_and_the_server_agree(screen, kind, value):
    says = screen[(kind, value)]
    ok = server_ok(kind, value)
    assert (
        says is None
    ) == ok, f"{kind} {value!r}: the screen says {says!r}, the server {'accepts' if ok else 'refuses'} it"
    if says is not None:
        assert says.strip() and says.rstrip().endswith((".", "。")), f"a reason is a whole sentence: {says!r}"


def test_there_are_at_least_a_thousand_cases():
    assert len(CASES) >= 1000, len(CASES)


# ------------------------------------------------------------------ the language reaches the account


ROLES = ["homeowner", "contractor", "epc_team", "project_manager", "superadmin"]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(("start", "pick"), [("en", "zh"), ("zh", "en"), ("zh", "zh"), ("en", "en")])
def test_the_language_picked_is_saved_on_the_account(client, fx, role, start, pick):
    u = fx.user(role)
    fx.conn.execute("update users set language = %s where uid = %s", (start, u["uid"]))
    h = bearer(u["clerk_user_id"])
    assert client.get("/api/py/me", headers=h).json()["settings"]["language"] == start
    r = client.patch("/api/py/me/settings", headers=h, json={"language": pick})
    assert r.status_code == 200, r.text
    assert client.get("/api/py/me", headers=h).json()["settings"]["language"] == pick
    assert fx.conn.execute("select language from users where uid = %s", (u["uid"],)).fetchone()["language"] == pick


@pytest.mark.parametrize("bad", ["fr", "", "ZH", "zh-CN", "english"])
def test_only_english_or_chinese(client, fx, bad):
    u = fx.user("homeowner")
    r = client.patch("/api/py/me/settings", headers=bearer(u["clerk_user_id"]), json={"language": bad})
    assert r.status_code == 400
