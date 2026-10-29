# Records: what was checked, when, and what was found

ISO 27001 asks for evidence that the controls actually run, not only that
they're written down. Add to the bottom of each table as things happen; never
edit an old line (correct it with a new one). Totals and dates only: no
customer's name, address or figures.

## Backups and restores (A.8.13, A.5.30)

| Date | What | Result |
|---|---|---|
| 12 Oct 2026 | Full restore on the test database: backed up, damaged, restored, backed up again | Every table's checksum and every counter matched |
| 22 Oct 2026 | Older production restore points encrypted (AES-256) | Done (backups.md) |
| 25 Oct 2026 | Restore point before the release | 52 tables, 93,602 rows |
| 25–27 Oct 2026 | Nightly encrypted backups (GitHub Actions) | Succeeded each night |
| 27 Oct 2026 | The 25 Oct production backup opened and every table's checksum recomputed against its manifest (nothing restored) | 52 tables, 93,602 rows: all match |
| 27 Oct 2026 | Restore point before the release | 52 tables, 105,734 rows |
| 27 Oct 2026 | Restore point before the release | 52 tables, 120,996 rows |
| 28 Oct 2026 | Restore point before the release | 52 tables, 157,539 rows |

Next: a point-in-time restore of production into a new Neon branch, checked
on the staging site (yearly; first one due before the audit).

## Vulnerabilities fixed (A.8.8)

| Date | What | How |
|---|---|---|
| 22 Oct 2026 | 8 known issues in starlette and certifi | Upgraded; pip-audit clean |
| 27 Oct 2026 | 3 Next.js advisories: remote code execution in `use cache` and in image optimisation (critical), denial of service in server actions (high) | Next.js 16.4.1, released 27 Oct 2026; `npm audit` of what the site runs: none |
| 28 Oct 2026 | Dependency updates: Next.js 16.4.3, React 19.3.1, MUI 9.5, Clerk 7.9.20, psycopg 3.3.6, FastAPI 0.161.1 (Dependabot) | Released 28 Oct 2026 after the full test suite and UAT; pip-audit clean |
| 27 Oct 2026 | Whole repository history scanned for keys and passwords (database URLs, Clerk, Anthropic, Resend, AWS keys, private keys) | None found; the only matches were documentation and AWS's published example key in a test |

## Incidents (A.5.24–5.28)

| Date | What happened | Effect | What changed |
|---|---|---|---|
| 22 Oct 2026 | The database reached its plan's usage allowance | The live site couldn't reach its data until the allowance was raised; nothing warned | Uptime check added (risk R4) |
| 26–27 Oct 2026 | The 15-minute job ran only every 2 to 4½ hours (GitHub's scheduler) | Live solar figures shown as not live; the power charts stopped on 26 Oct | Schedule moved to cron-job.org; FusionSolar pages fetch live figures when opened; power fetched a few batches a run |
| 27 Oct 2026 | cron-job.org calls failed: first timeouts (a run took up to 45 s; it waits 30), then 401s after the key was changed but not yet deployed | No scheduled sync from 10:52 to 16:20 | Each run's FusionSolar work kept within a time budget; the key change and redeploy steps written down (YOUR_STEPS.md step 5) |

## Access reviews (A.5.15–5.18)

| Date | Accounts | Reviewed by | Result |
|---|---|---|---|
| 27 Oct 2026 | 5 staff accounts, all signed in and active: 1 superadmin, 4 project managers. No Admin (finance), contractor, crew or homeowner accounts yet | Snapshot by the developer; **the superadmin still needs to confirm each one is needed** | Open |
| 29 Oct 2026 | Change: one project manager made a superadmin, at the owner's request (YOUR_STEPS.md step 3, as the database owner; in the audit log as "Outside the app"). Now 2 superadmins, 3 project managers | The owner | Done |
| 29 Oct 2026 | Change: the owner's sign-in moved from a personal Gmail address to darrentay@9solarfintech.com, at their request (Clerk, the live site's instance): the email added as verified and primary, the Gmail address removed, the password kept. An unused Clerk sign-in with that email (made 13 Oct, used once, no app account or access request) was deleted first, with the owner's go-ahead | The owner | Done |

Quarterly from here, with each account's last sign-in (access-control.md).

## Releases to production (A.8.32)

Each release: tests and UAT first, staging preview, the owner's go-ahead, a
restore point before any database change. Commit = the code that went live.

| Date | Commit | Main change |
|---|---|---|
| 24 Oct 2026 | df25735 | SP Power page; navigation groups |
| 25 Oct 2026 | 6009542 | SP Power history and averages; invoice check before issuing; Chinese wording |
| 27 Oct 2026 | 0f4ecf9 | Next.js security fix; scheduled job time limit; power charts; live figures on view; KPIs page |
| 27 Oct 2026 | 28364d1 | Projected Analytics (renamed); 10-second sync budget; ISO records and licence report |
| 28 Oct 2026 | 377febe | FusionSolar energy flow, revenue and rated power as FusionSolar shows them; dependency updates. Full UAT: 180,565 passed (a first run on 28 Oct failed 1,743 tests while the test database was slow; those passed on their own and in the full rerun) |
