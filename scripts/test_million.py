"""The million-case suite: npm run test:million.

Each file in tests_million/ runs in its own pytest process, several at once
(one per spare core), so a million cases take minutes rather than an hour.
Prints each file's result and the total; exits non-zero if anything failed.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = sorted((ROOT / "tests_million").glob("test_*.py"))


def run(path: Path) -> tuple[str, int, int, int, float, str]:
    start = time.monotonic()
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--no-header", str(path.relative_to(ROOT))],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr.strip()[-300:]
    count = lambda word: int(m.group(1)) if (m := re.search(rf"(\d+) {word}", tail)) else 0  # noqa: E731
    failures = "\n".join(line for line in proc.stdout.splitlines() if line.startswith(("FAILED", "ERROR")))[:4000]
    return (
        path.name,
        count("passed"),
        count("failed") + count("error"),
        proc.returncode,
        time.monotonic() - start,
        failures,
    )


def main() -> int:
    workers = max(1, min(len(FILES), (os.cpu_count() or 2) - 2))
    print(f"{len(FILES)} files, {workers} at a time")
    started = time.monotonic()
    passed = failed = 0
    bad = False
    with ThreadPoolExecutor(workers) as pool:
        for name, ok, ko, code, secs, failures in pool.map(run, FILES):
            passed += ok
            failed += ko
            bad |= code != 0
            print(f"  {name:28} {ok:>9,} passed {ko:>6,} failed  {secs:6.0f}s")
            if failures:
                print(failures)
    print(f"{passed:,} passed, {failed:,} failed in {time.monotonic() - started:.0f}s")
    return 1 if bad or failed else 0


if __name__ == "__main__":
    sys.exit(main())
