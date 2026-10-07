"""English → Chinese on the server (_lib/i18n): what phones and alerts receive.

The same dictionary drives the screens (lib/client/i18n.tsx); tests/i18n.test.ts
covers that side. These need no database.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from _lib.i18n import _table, tr

DICT: dict[str, str] = json.loads((Path(__file__).parent.parent / "api/_lib/i18n/zh.json").read_text(encoding="utf8"))


@pytest.mark.parametrize(
    ("en", "zh"),
    [
        ("Projects", "项目"),
        ("Site visit assigned", "已分配现场访问"),
        ("Running late · Seletar Hills Home", "迟到 · Seletar Hills Home"),
        ("Priya Nair is now EPC Team.", "Priya Nair 现在是EPC 团队。"),
        ("Your role has been changed to Project Manager.", "您的角色已变更为项目经理。"),
        ("Milestone 2 complete · Jalan Kayu", "里程碑 2 已完成 · Jalan Kayu"),
        ("Crew arrived 1 h 20 min late · Jalan Kayu", "施工队迟到 1 小时 20 分钟 · Jalan Kayu"),
        (
            "The EPC crew was due 07 Oct 2026 at 09:00 and hasn't checked in an hour later.",
            "EPC 施工队应于 07 Oct 2026 at 09:00 到达，一小时后仍未签到。",
        ),
        (
            "Ravi Kumar checked in at 10:20 for the 09:00 visit, with 4 crew.",
            "Ravi Kumar 于 10:20 签到（原定 09:00 的访问），共 4 名施工人员。",
        ),
        (
            "Approved Aisha Tan as Homeowner. Email sent · WhatsApp skipped — muted in their settings",
            "已批准 Aisha Tan 为屋主。电子邮件已发送 · WhatsApp 未发送——对方已在设置中静音",
        ),
    ],
)
def test_translates(en: str, zh: str) -> None:
    assert tr(en, "zh") == zh


def test_english_is_untouched() -> None:
    assert tr("Projects", "en") == "Projects"
    assert tr("Projects", None) == "Projects"


def test_unknown_text_stays_english() -> None:
    assert tr("Hillcrest Villa", "zh") == "Hillcrest Villa"


def test_empty() -> None:
    assert tr("", "zh") == ""
    assert tr(None, "zh") is None


def test_every_pattern_compiles_and_names_match() -> None:
    _, patterns = _table()
    assert len(patterns) > 150
    names = lambda s: sorted(re.findall(r"\{(\w+)\}", s))  # noqa: E731
    assert [k for k, v in DICT.items() if names(k) != names(v)] == []


def test_every_alert_title_the_server_sends_is_translated() -> None:
    """The fixed titles notify() is called with, and the alert kinds' labels."""
    titles = [
        "Account approved",
        "New account request",
        "Role change request",
        "Role changed",
        "Role request declined",
        "Site visit assigned",
        "Site visit cancelled",
        "Site visit in 1 hour",
        "Milestone 1 complete",
        "Milestone 2 complete",
        "Ready for handover",
        "New project assigned",
        "Test notification",
        "A change of yours was undone",
    ]
    assert [t for t in titles if not DICT.get(t)] == []


def test_one_word_placeholders_match_the_app() -> None:
    from _lib.i18n import ONE_WORD

    src = (Path(__file__).parent.parent / "lib/client/i18n.tsx").read_text(encoding="utf8")
    m = re.search(r"const ONE_WORD = new Set\(\[([^\]]*)\]\)", src)
    assert m
    assert set(re.findall(r'"(\w+)"', m.group(1))) == ONE_WORD
