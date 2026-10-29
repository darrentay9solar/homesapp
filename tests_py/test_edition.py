# ruff: noqa: E501  (the cases read better whole)
"""The two editions (_lib/edition, docs/editions.md): names, roles and features, each in a fresh process
(the edition is read once, from the environment, as the site starts)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

API = str(Path(__file__).resolve().parent.parent / "api")


def run(edition: str, code: str) -> str:
    env = {**os.environ, "EDITION": edition, "PYTHONIOENCODING": "utf8"}
    out = subprocess.run(
        [sys.executable, "-c", f"import sys; sys.path.insert(0, {API!r})\n{code}"],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf8",
        check=True,
    )
    return out.stdout.strip()


def test_9_solar_home_is_unchanged() -> None:
    assert (
        run("", "from _lib.i18n import tr; print(tr('Priya Nair is now EPC Team.', 'en'))")
        == "Priya Nair is now EPC Team."
    )
    assert (
        run("", "from _lib.profile import ROLES; print(','.join(ROLES))")
        == "homeowner,project_manager,contractor,epc_team,finance"
    )


def test_fintech_names_in_both_languages() -> None:
    code = "from _lib.i18n import tr\nfor s in ['Your role has been changed to Project Manager.', 'Priya Nair is now EPC Team.', 'GetHomeApps · 9 Solar Home']:\n    print(tr(s, 'en') + ' | ' + tr(s, 'zh'))"
    lines = run("fintech", code).splitlines()
    assert lines[0] == "Your role has been changed to HQ Staff. | 您的角色已变更为总部员工。"
    assert lines[1] == "Priya Nair is now EPC Project Manager. | Priya Nair 现在是EPC 项目经理。"
    assert lines[2].startswith("GetApps · 9 Solar Fintech")


def test_renaming_twice_changes_nothing_more() -> None:
    assert (
        run("fintech", "from _lib.edition import rebrand; print(rebrand(rebrand('EPC Team and a Project Manager')))")
        == "EPC Project Manager and a HQ Staff"
    )


def test_fintech_has_no_homeowners_check_in_or_maintenance() -> None:
    assert (
        run("fintech", "from _lib.profile import ROLES; print(','.join(ROLES))")
        == "project_manager,contractor,epc_team,finance"
    )
    assert (
        run("fintech", "from _lib.edition import FEATURES; print(sorted(k for k, v in FEATURES.items() if v))") == "[]"
    )


def test_fintech_clients_are_businesses_at_sites() -> None:
    code = (
        "from _lib.i18n import tr\n"
        "for s in ['Homes', 'Homeowner contact no.', 'This is a different home at the same postal code', 'Phase']:\n"
        "    print(tr(s, 'en') + ' | ' + tr(s, 'zh'))"
    )
    lines = run("fintech", code).splitlines()
    assert lines[0] == "Clients | 客户"
    assert lines[1].startswith("Client contact no. | ")
    assert lines[2].startswith("This is a different site at the same postal code | ")
    assert "场地" in lines[2]
    assert lines[3] == "Phase | 期"
    # 9 Solar Home keeps its words.
    assert (
        run("", "from _lib.i18n import tr; print(tr('Homes', 'zh'), tr('Phase', 'zh'), tr('Homeowner', 'en'))")
        == "住宅 相 Homeowner"
    )


def test_fintech_chinese_name() -> None:
    assert (
        run("fintech", "from _lib.i18n import tr; print(tr('GetHomeApps · 9 Solar Home · 九太阳家', 'en'))")
        == "GetApps · 9 Solar Fintech · 九太阳"
    )
