# Open-source licences

What the live app is built from, as of 27 Oct 2026 (`scripts/licences.py`; run it again after
dependency changes). Development-only tools (tests, linters, the build) aren't shipped and are left out.

Permissive licences (MIT, Apache-2.0, BSD, ISC) allow commercial use with the notice kept. A copyleft
licence used as an unmodified library (LGPL, MPL) also allows it; GPL or AGPL in what's shipped would
need a closer look.

## JavaScript (the web app)

163 packages.

| Licence | Packages |
|---|---|
| MIT | 133 |
| ISC | 11 |
| not stated | 7 |
| BSD-3-Clause | 4 |
| Apache-2.0 | 3 |
| BSD-2-Clause | 2 |
| CC-BY-4.0 | 1 |
| Unlicense | 1 |
| 0BSD | 1 |

To look at (copyleft, or no licence stated):

- `@next/swc-darwin-arm64` 16.4.1: not stated
- `@next/swc-darwin-x64` 16.4.1: not stated
- `@next/swc-linux-arm64-gnu` 16.4.1: not stated
- `@next/swc-linux-arm64-musl` 16.4.1: not stated
- `@next/swc-linux-x64-gnu` 16.4.1: not stated
- `@next/swc-linux-x64-musl` 16.4.1: not stated
- `@next/swc-win32-arm64-msvc` 16.4.1: not stated

## Python (the API)

16 packages.

| Licence | Packages |
|---|---|
| MIT | 8 |
| MIT License | 2 |
| BSD-3-Clause | 2 |
| Apache-2.0 | 2 |
| GNU Lesser General Public License v3 (LGPLv3) | 1 |
| PSF-2.0 | 1 |

To look at (copyleft, or no licence stated):

- `psycopg` 3.2.3: GNU Lesser General Public License v3 (LGPLv3)

## Notes on the ones to look at

- `@next/swc-*`: Next.js's own compiler, one build per platform; only the build for the machine
  that runs it is installed, so the others show no licence here. They are MIT, like Next.js.
- `psycopg` (the database driver): LGPL-3.0, used unmodified as a library, which the LGPL allows in
  closed-source commercial software.
