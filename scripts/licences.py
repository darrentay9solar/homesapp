"""The open-source licences of what the live app is built from, for due diligence (docs/licences.md).

    node scripts/py.mjs scripts/licences.py            # writes docs/licences.md

JavaScript: every package package-lock.json installs for production (dev-only tools left out), with the
licence its own package.json declares. Python: each package pyproject.toml's [project] needs and what it pulls in,
from the installed metadata. Copyleft licences (GPL, LGPL, AGPL, MPL, EPL) are listed by name so they can
be looked at; the rest are counted.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COPYLEFT = re.compile(r"\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|SSPL)", re.I)


def js() -> list[tuple[str, str, str]]:
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf8"))
    out = []
    for path, p in lock.get("packages", {}).items():
        if not path or p.get("dev") or p.get("devOptional"):
            continue
        name = path.split("node_modules/")[-1]
        lic = p.get("license")
        if not lic:
            pj = ROOT / path / "package.json"
            if pj.exists():
                d = json.loads(pj.read_text(encoding="utf8"))
                lic = d.get("license") or (d.get("licenses") or [{}])[0].get("type")
        out.append((name, p.get("version", ""), str(lic or "not stated")))
    return sorted(set(out))


def py() -> list[tuple[str, str, str]]:
    import tomllib

    deps = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf8"))["project"]["dependencies"]
    todo = [re.split(r"[<>=!~\[; ]", d.strip())[0] for d in deps]
    seen: dict[str, tuple[str, str, str]] = {}
    while todo:
        name = todo.pop()
        key = name.lower().replace("_", "-")
        if key in seen:
            continue
        try:
            m = metadata.metadata(name)
        except metadata.PackageNotFoundError:
            continue
        lic = m.get("License-Expression") or ""
        if not lic or len(lic) > 60:
            classifiers = [
                c.split("::")[-1].strip() for c in m.get_all("Classifier") or [] if c.startswith("License ::")
            ]
            lic = ", ".join(classifiers) or (m.get("License") or "")[:60] or "not stated"
        seen[key] = (m["Name"], m["Version"], lic)
        for r in metadata.requires(name) or []:
            if "extra ==" not in r:
                todo.append(re.split(r"[<>=!~\[; (]", r.strip())[0])
    return sorted(seen.values())


def section(title: str, rows: list[tuple[str, str, str]]) -> list[str]:
    counts = Counter(r[2] for r in rows)
    lines = [f"## {title}", "", f"{len(rows)} packages.", "", "| Licence | Packages |", "|---|---|"]
    lines += [f"| {lic} | {n} |" for lic, n in counts.most_common()]
    flagged = [r for r in rows if COPYLEFT.search(r[2]) or r[2] == "not stated"]
    lines += ["", "To look at (copyleft, or no licence stated):", ""]
    lines += [f"- `{n}` {v}: {lic}" for n, v, lic in flagged] or ["- None."]
    return [*lines, ""]


def main() -> None:
    body = [
        "# Open-source licences",
        "",
        f"What the live app is built from, as of {date.today():%d %b %Y} (`scripts/licences.py`; run it again after",
        "dependency changes). Development-only tools (tests, linters, the build) aren't shipped and are left out.",
        "",
        "Permissive licences (MIT, Apache-2.0, BSD, ISC) allow commercial use with the notice kept. A copyleft",
        "licence used as an unmodified library (LGPL, MPL) also allows it; GPL or AGPL in what's shipped would",
        "need a closer look.",
        "",
        *section("JavaScript (the web app)", js()),
        *section("Python (the API)", py()),
        "## Notes on the ones to look at",
        "",
        "- `@next/swc-*`: Next.js's own compiler, one build per platform; only the build for the machine",
        "  that runs it is installed, so the others show no licence here. They are MIT, like Next.js.",
        "- `psycopg` (the database driver): LGPL-3.0, used unmodified as a library, which the LGPL allows in",
        "  closed-source commercial software.",
        "",
    ]
    (ROOT / "docs" / "licences.md").write_text("\n".join(body), encoding="utf8")
    print("wrote docs/licences.md")


if __name__ == "__main__":
    main()
