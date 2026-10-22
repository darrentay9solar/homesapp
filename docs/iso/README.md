# ISO/IEC 27001: getting 9 Solar Home ready

ISO/IEC 27001 certifies a company's **information security management
system (ISMS)**: how it finds and treats the risks to the information it
holds, across people, laptops, suppliers and the software. GetHomeApps is
the biggest part of that for 9 Solar Home, so this folder holds what the app
already does, the documents the auditor will ask for (drafted from how the
app actually works), and what only the company can do.

Drafts, not legal or certification advice: a certification body (or a
consultant) should review them before the audit.

## The documents

| Document | What it is | ISO clause / control |
|---|---|---|
| [policies.md](policies.md) | The information security policy and the topic policies (access, passwords and two-step, acceptable use, backup, cryptography, suppliers, secure development, logging, retention) | 5.2, A.5.1 |
| [statement-of-applicability.md](statement-of-applicability.md) | All 93 Annex A controls: which apply, how each is met, what's still to do | 6.1.3 d) |
| [risk-register.md](risk-register.md) | The risks, how likely and how bad, what treats them, who owns them | 6.1.2, 6.1.3, 8.2, 8.3 |
| [access-control.md](access-control.md) | Roles and what each sees, joiners/movers/leavers, the quarterly access review | A.5.15–5.18, A.8.2–8.5 |
| [incident-response.md](incident-response.md) | What to do when something goes wrong (outage, breach, lost laptop, leaked key), PDPA notification, the incident log | A.5.24–5.28, A.5.29–5.30, A.6.8 |
| [../pdpa.md](../pdpa.md) | Personal data: what's held, where it goes, how long it's kept | A.5.34, A.8.10 |
| [../backups.md](../backups.md) | Backups, restore points, restoring | A.8.13 |
| [../solar.md](../solar.md) | The FusionSolar connection (a supplier and a data flow) | A.5.19–5.22 |

## Scope (proposed)

> The information security management system covers GetHomeApps (the web app
> at homesapp-alpha.vercel.app, its database, files and integrations) and the
> customer, staff and installation information it holds, as operated by
> 9 Solar Home Pte Ltd from Singapore, including the staff and laptops that
> administer it.

Keep the scope narrow for the first certificate; it can grow later.

## What the app does (evidence for the auditor)

| Area | In the app | Where |
|---|---|---|
| Least privilege | Six roles; each sees only its projects; enforced in the database itself (row-level guards), not just the screens | access-control.md, db/migrations |
| Strong sign-in | Clerk (passwords never reach us); **two-step verification** with an authenticator app and backup codes; required for staff once `REQUIRE_STAFF_MFA=1` | components/two-step.tsx, api/_lib/web.py |
| Session control | Staff signed out after **30 minutes idle** (a minute's warning), shared across tabs | components/idle.tsx |
| Access review | Superadmin → People → **Access review (Excel)**: everyone's role, since when, last sign-in, two-step status, with a sign-off sheet | api/_routes/exports.py |
| Audit trail | Every change recorded (who, when, before/after); append-only; only retention may remove old entries | docs/pdpa.md, audit page |
| Exports logged | Every Excel export recorded (who, what, how many rows) | data_exports |
| Backups | Nightly, encrypted, 30 days; an encrypted restore point before every production change; restore tested | docs/backups.md |
| Encryption | HTTPS everywhere (HSTS); database, files and backups encrypted at rest; backups AES-256 with our own passphrase | vercel.json, scripts/backup_crypt.py |
| Vulnerabilities | npm audit and **pip-audit** in CI; Dependabot weekly (npm, Python, Actions) | .github |
| Monitoring | **Uptime check every 15 minutes** (app + database); content-policy reports logged | .github/workflows/uptime.yml |
| Secure development | Staging first; ~4,500 tests plus ~24,000 UAT cases and a design check before release; production changes only with explicit confirmation | docs/STATUS.md |
| Separate environments | Production, demo/dev and test are separate databases; tests can never reach production or real outside services | tests_py/conftest.py |
| Privacy | Consent with versioned notice; Download my data; automatic retention | docs/pdpa.md |

## What only 9 Solar Home can do

In order; the first five are quick.

1. **Name an owner for information security** (can be a director) and a
   **Data Protection Officer** (see YOUR_STEPS step 13).
2. **Approve the policies** in [policies.md](policies.md): read, adjust,
   sign and date them; tell staff.
3. **Turn on two-step verification for everyone on staff**, then set
   `REQUIRE_STAFF_MFA` = `1` in Vercel (homesapp → Environment Variables,
   Production) and redeploy. From then on, staff can't use the app without it.
   In the Clerk dashboard: *User & authentication → Multi-factor* → allow
   **Authenticator application** and **Backup codes**.
4. **Laptops**: BitLocker on, screen lock after 5 minutes, automatic
   updates, an antivirus (Windows Defender is fine), and no shared logins.
5. **Accept the suppliers' data processing agreements** (Clerk, Resend,
   Meta, Twilio, Anthropic, Cloudflare, Neon, Vercel, Huawei) and keep a copy.
6. **Run the first access review** (People → Access review), sign it, file
   it; then every quarter.
7. **Security awareness** for staff once a year (30 minutes: phishing,
   passwords, two-step, reporting incidents), with a sign-in sheet.
8. **Review the risk register** with management; agree the treatments.
9. **Run an incident drill** (e.g. "the database is down") using
   incident-response.md, and record it.
10. **Switch the content security policy from report-only to enforcing**
    once its reports are clean for a few weeks (tell me; it's one line).
11. **Internal audit and management review** (can be a consultant), then a
    certification body's stage 1 (documents) and stage 2 (practice) audits.

### A sensible route

1. **CSA Cyber Trust mark** (Singapore's Cyber Security Agency): tiered,
   cheaper, and built to lead into ISO 27001. Most of the above counts.
2. **IMDA Data Protection Trustmark (DPTM)**: certifies the PDPA side.
3. **ISO/IEC 27001** (and **27701** for privacy, as an add-on) once the
   controls have run for 3 months or so, so there are records to show.
