# Risk register (draft)

How we judge a risk: **likelihood** (1 rare … 5 almost certain) × **impact**
(1 minor … 5 severe: many customers' data exposed, or the business stopped)
= **score** (1–25). Above 12 needs treating now; 6–12 within the year; below 6
accept and watch. Reviewed every quarter and after every incident.

Scores are _before_ → _after_ the treatment listed.

| # | Risk | L×I before | Treatment (controls) | L×I after | Owner | State |
|---|---|---|---|---|---|---|
| R1 | A staff password is phished or guessed, and someone reads many customers' records | 4×5 = 20 | Two-step verification required for staff (A.8.5); Clerk breached-password checks and rate limits; idle sign-out; awareness training; audit log shows what they did | 1×5 = 5 | Security owner | 🟡 turn on REQUIRE_STAFF_MFA; train staff |
| R2 | A role or project rule is wrong, so someone sees what they shouldn't | 3×4 = 12 | Rules enforced in the database; every role × every action tested in the UAT before each release; quarterly access review | 1×4 = 4 | Developer / superadmin | ✅ |
| R3 | A leaver or a changed job keeps access | 3×4 = 12 | Same-day disable; disable dates for contractors; quarterly access review with last sign-in | 1×4 = 4 | Superadmin | 🟡 first review |
| R4 | The database becomes unavailable (provider limits, outage) | 3×4 = 12 (happened 22 Oct 2026) | Paid plan with spending cap; uptime check every 15 minutes; tests on their own allowance; Neon restore; runbook | 1×4 = 4 | Security owner | 🟡 separate test project |
| R5 | Data lost or corrupted (bug, mistake, attack) | 2×5 = 10 | Audit log with revert; Neon point-in-time restore; nightly encrypted backups (30 days); restore point before each production change; quarterly restore test | 1×3 = 3 | Developer | ✅ backups · 🟡 quarterly test |
| R6 | A backup file leaks (laptop or download) | 2×5 = 10 | All production backups encrypted (AES-256), passphrase in the password manager; BitLocker on the laptop | 1×2 = 2 | Security owner | ✅ encrypted · 🏢 BitLocker |
| R7 | A key in `.env.local` or Vercel leaks | 2×5 = 10 | Keys only in Vercel (Sensitive), GitHub secrets and the release laptop; owner keys never in Vercel; rotation runbook | 1×4 = 4 | Developer | ✅ |
| R8 | A library with a known vulnerability is exploited | 3×4 = 12 | npm audit + pip-audit in CI; Dependabot weekly; security headers; content security policy | 1×4 = 4 | Developer | ✅ · 🟡 enforce CSP |
| R9 | A supplier mishandles our data or has a breach | 2×4 = 8 | Data processing agreements; reputable certified suppliers; least data shared (pdpa.md); yearly review | 2×3 = 6 | DPO | 🏢 DPAs |
| R10 | Real customer data ends up in the demo, dev or test database | 3×4 = 12 (near miss 22 Oct 2026) | Demo/dev seeded with invented people only; tests can't reach real services; production data never copied down | 1×3 = 3 | Developer | ✅ |
| R11 | A laptop or phone is lost or stolen | 3×3 = 9 | BitLocker; screen lock; encrypted backups; sign-out-everywhere runbook | 2×2 = 4 | Each person | 🏢 BitLocker, locks |
| R12 | Personal data kept longer than needed (PDPA) | 3×3 = 9 | Automatic retention (pdpa.md) | 1×2 = 2 | DPO | ✅ |
| R13 | A data breach isn't notified in time (PDPA) | 2×4 = 8 | Incident procedure with the 3-day rule; DPO named; contacts listed | 1×3 = 3 | DPO | 🟡 name the DPO |
| R14 | FusionSolar access lapses (API account deadline) and solar figures and invoices stop | 3×3 = 9 | Deadline in the calendar; the app shows when figures were last updated; uptime of the sync visible in Solar | 1×2 = 2 | Security owner | 🟡 calendar reminder |
| R15 | The developer laptop is the single place releases happen from | 3×3 = 9 | Code in GitHub; releases documented (STATUS, YOUR_STEPS); secrets recoverable from the suppliers' consoles; backups in GitHub | 2×2 = 4 | Owner | ✅ |
| R16 | A bad release breaks the live site | 3×3 = 9 | Tests, UAT and design check before release; staging and demo first; Vercel instant rollback; restore point before database changes | 1×3 = 3 | Developer | ✅ |
| R18 | The source code is public, so anyone can study how the app works and look for weaknesses | 4×3 = 12 (found 27 Oct 2026) | No secrets or customer data in the repository or its history (scanned 27 Oct 2026); every rule enforced on the server and in the database, not by hiding code | 1×2 = 2 | Owner | 🏢 make the repository private, in a company organisation |
| R19 | The schedule stops (cron-job.org or GitHub), so figures go stale and reminders aren't sent | 3×3 = 9 (GitHub ran hours apart, Oct 2026) | cron-job.org every 15 minutes with failure emails; GitHub every two hours as a back-up; the FusionSolar pages fetch live figures when opened; each call kept under 30 seconds | 1×2 = 2 | Security owner | ✅ |
| R20 | Ownership of the app is unclear (personal accounts, AI-assisted code, one person who knows it) | 3×4 = 12 | Documentation in the repository (docs/, STATUS); release steps written down; commit history records how code was written | 2×3 = 6 | Owner | 🏢 company-owned accounts; IP assignment; a second person able to release |
| R17 | The support assistant (AI) says something wrong or reveals another customer's data | 2×3 = 6 | It sees only the asker's own project facts and the written answers; never other people's; hands over to a person for faults, billing, safety; daily limit | 1×2 = 2 | Security owner | ✅ |

**Accepted:** none above 6 after treatment. **To review next:** _[date]_.
