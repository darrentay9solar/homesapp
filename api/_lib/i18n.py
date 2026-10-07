"""English → Simplified Chinese, shared with the app (lib/client/i18n.tsx reads the same file).

api/_lib/i18n/zh.json maps each English phrase to its Chinese. A phrase with
{placeholders} is a pattern: "{name} is now {role}." matches "Priya Nair is
now EPC Team." and translates the pieces that are themselves phrases (the
role), leaving the rest (the name) as written. Anything not in the file stays
in English, so a missing translation never hides information.

The server uses this for what leaves it in a person's language: phone
notifications and emails. Screens translate in the browser.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

LANGS = ("en", "zh")
# Placeholders that are always one word (a count, a number): they never swallow
# the rest of a line, so "Milestone {n}" can't match "Milestone 2 complete · …".
ONE_WORD = {
    "n",
    "n2",
    "days",
    "left",
    "wait",
    "mins",
    "mins2",
    "crew",
    "m",
    "shown",
    "used",
    "outcomes",
    "fields",
    "MAX_BYTES",
    "CODE_MINUTES",
    "pid",
    "code",
}


def _group(name: str) -> str:
    return f"(?P<{name}>" + (r"\S+?" if name in ONE_WORD else ".+?") + ")"


@lru_cache(maxsize=1)
def _table() -> tuple[dict[str, str], list[tuple[re.Pattern[str], str, list[str]]]]:
    data: dict[str, str] = json.loads((Path(__file__).parent / "i18n" / "zh.json").read_text(encoding="utf8"))
    exact = {k: v for k, v in data.items() if v}
    patterns = []
    for en, zh in exact.items():
        names = re.findall(r"\{(\w+)\}", en)
        if not names:
            continue
        parts = re.split(r"\{\w+\}", en)
        rx = "".join(re.escape(p) + (_group(names[i]) if i < len(names) else "") for i, p in enumerate(parts))
        patterns.append((re.compile(f"^{rx}$", re.S), zh, names, len("".join(parts))))
    # The most specific first: the most fixed words ("Running late · {p}" before
    # "{x} · {y}"), then the fewest blanks.
    patterns.sort(key=lambda p: (-p[3], len(p[2])))
    return exact, [(rx, zh, names) for rx, zh, names, _ in patterns]


def tr(text: str | None, lang: str | None) -> str | None:
    """``text`` in ``lang``; unchanged for English, or when there's no translation."""
    if not text or lang != "zh":
        return text
    exact, patterns = _table()
    if text in exact:
        return exact[text]
    for rx, zh, names in patterns:
        m = rx.match(text)
        if m:
            out = zh
            for n in names:
                out = out.replace("{" + n + "}", tr(m.group(n), lang) or "")
            return out
    return text
