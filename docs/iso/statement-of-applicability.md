# Statement of Applicability (draft)

ISO/IEC 27001:2022 Annex A, all 93 controls. For each: whether it applies,
how it's met, and its state on **27 Oct 2026**.

**State:** ✅ in place · 🟡 partly (what's left is named) · 🏢 for the
company to do (outside the app) · ➖ not applicable (with the reason).

"Suppliers" below means GetHomeApps' hosting and services: Vercel (app),
Neon (database), Cloudflare R2 (files), Clerk (sign-in), GitHub (code, jobs),
cron-job.org (the 15-minute schedule; sees no data), Resend, Meta, Twilio, Anthropic, Huawei FusionSolar, OneMap. Their data
centres and staff are covered by their own certifications (ISO 27001 and/or
SOC 2); keep their reports on file (A.5.19–5.23).

## A.5 Organisational controls

| # | Control | Applies | How it's met | State |
|---|---|---|---|---|
| 5.1 | Policies for information security | Yes | policies.md: the information security policy and topic policies | 🏢 approve, sign, tell staff |
| 5.2 | Roles and responsibilities | Yes | policies.md §2 names the owner, DPO, superadmins, staff duties | 🏢 name the people |
| 5.3 | Segregation of duties | Yes | Admin (finance) records payments but can't edit projects; managers can't issue invoices or mark payments; only superadmins create managers and Admins; production changes need explicit confirmation | ✅ |
| 5.4 | Management responsibilities | Yes | Policy approved by management; quarterly review (README) | 🏢 |
| 5.5 | Contact with authorities | Yes | incident-response.md lists PDPC, SingCERT, police | ✅ |
| 5.6 | Contact with special interest groups | Yes | Subscribe to CSA/SingCERT advisories; GitHub security advisories reach us through Dependabot | 🟡 subscribe to SingCERT alerts |
| 5.7 | Threat intelligence | Yes | Dependabot and npm/pip audit advisories; SingCERT alerts | 🟡 as 5.6 |
| 5.8 | Information security in project management | Yes | Every change: risk thought through in its description, tests, staging, design check, then production | ✅ |
| 5.9 | Inventory of information and assets | Yes | pdpa.md *What is held* (data); policies.md *Asset inventory* (systems, suppliers, laptops) | 🟡 list the laptops and phones |
| 5.10 | Acceptable use | Yes | policies.md §5 | 🏢 staff to acknowledge |
| 5.11 | Return of assets | Yes | Leavers procedure (access-control.md): accounts off, devices back | 🏢 |
| 5.12 | Classification of information | Yes | policies.md §6: Public / Internal / Confidential (customers' personal data) | ✅ |
| 5.13 | Labelling of information | Yes | Exports are named and recorded; customer files private by default | ✅ |
| 5.14 | Information transfer | Yes | HTTPS only; files shared by short-lived signed links; email/WhatsApp carry no NRIC or full documents | ✅ |
| 5.15 | Access control | Yes | Role- and project-based, enforced in the database (access-control.md) | ✅ |
| 5.16 | Identity management | Yes | One Clerk identity per person; accounts approved by a manager; no shared logins | ✅ |
| 5.17 | Authentication information | Yes | Clerk holds passwords (breached-password checks, rate limits); two-step with backup codes | ✅ |
| 5.18 | Access rights | Yes | Quarterly access review (People → Access review) with sign-off; leavers switched off the same day; scheduled disable dates | 🟡 run and file the first review |
| 5.19 | Information security in supplier relationships | Yes | Supplier list with what each sees and where (pdpa.md) | ✅ |
| 5.20 | Supplier agreements | Yes | Each supplier's data processing agreement | 🏢 accept and file them |
| 5.21 | ICT supply chain | Yes | Pinned dependency versions, lockfiles, audits in CI, Dependabot | ✅ |
| 5.22 | Monitoring of supplier services | Yes | Uptime check; supplier status pages; yearly review of their certifications | 🟡 yearly review |
| 5.23 | Cloud services | Yes | Vercel, Neon, R2, Clerk: Singapore region where offered; least-privilege keys; secrets marked Sensitive | ✅ |
| 5.24 | Incident management planning | Yes | incident-response.md | ✅ |
| 5.25 | Assessment of events | Yes | incident-response.md §2 (is it an incident? is it notifiable?) | ✅ |
| 5.26 | Response to incidents | Yes | incident-response.md runbooks | ✅ |
| 5.27 | Learning from incidents | Yes | Incident log with lessons (two recorded on 22 Oct 2026) | ✅ |
| 5.28 | Collection of evidence | Yes | Audit log, exports log, Vercel and GitHub logs, Neon history; keep copies when an incident is opened | ✅ |
| 5.29 | Information security during disruption | Yes | Security controls stay on during recovery (restores into dev first; no keys loosened) | ✅ |
| 5.30 | ICT readiness for business continuity | Yes | Targets: back within 4 hours (RTO), at most 24 hours' data lost (RPO; usually minutes with Neon's restore). Nightly backups; full restore tested on test data 12 Oct 2026; the latest production backup opened and every table's checksum matched, 27 Oct 2026 (records.md) | 🟡 yearly restore drill, incl. Neon point-in-time on a branch |
| 5.31 | Legal and contractual requirements | Yes | PDPA (pdpa.md); Electronic Transactions Act for e-signatures; tax/records duties via retention rules | ✅ |
| 5.32 | Intellectual property rights | Yes | Licensed fonts and open-source libraries only; licence report in licences.md (permissive, plus LGPL psycopg used unmodified) | ✅ · 🏢 IP assignment of the app to the company |
| 5.33 | Protection of records | Yes | Append-only audit log; records kept 8 + 5 years then deleted automatically | ✅ |
| 5.34 | Privacy and protection of PII | Yes | pdpa.md: consent, minimum data (NRIC last 4 only), download, retention, notice | 🟡 DPO named, DPAs accepted |
| 5.35 | Independent review | Yes | Internal audit yearly (consultant), then the certification audits | 🏢 |
| 5.36 | Compliance with policies | Yes | Quarterly check of the access review, backups, alerts and incident log | 🏢 |
| 5.37 | Documented operating procedures | Yes | docs/ (backups, releases in STATUS, solar, payments, support, YOUR_STEPS) | ✅ |

## A.6 People controls

| # | Control | Applies | How it's met | State |
|---|---|---|---|---|
| 6.1 | Screening | Yes | Reference checks for staff with access to customer data | 🏢 |
| 6.2 | Terms and conditions of employment | Yes | Confidentiality and security duties in contracts | 🏢 |
| 6.3 | Awareness, education and training | Yes | Yearly 30-minute session (policies.md §5); record attendance | 🏢 |
| 6.4 | Disciplinary process | Yes | Breaches of the policies handled under HR's process | 🏢 |
| 6.5 | After termination or change | Yes | Leavers/movers procedure (access-control.md): same-day disable, role changed by a superadmin | ✅ |
| 6.6 | Confidentiality agreements | Yes | NDAs for staff, contractors, EPC teams | 🏢 |
| 6.7 | Remote working | Yes | The app is web-based: laptop rules (policies.md §7) apply anywhere; idle sign-out | 🟡 laptops |
| 6.8 | Event reporting | Yes | Anyone reports to the security owner at once (incident-response.md §1) | ✅ |

## A.7 Physical controls

GetHomeApps runs entirely on suppliers' data centres (covered by their
certifications). These controls apply to the office and the staff's devices.

| # | Control | Applies | How it's met | State |
|---|---|---|---|---|
| 7.1 | Physical security perimeters | Yes (office) | Locked office; no servers on site | 🏢 |
| 7.2 | Physical entry | Yes (office) | Keys/cards issued and returned | 🏢 |
| 7.3 | Securing offices | Yes (office) | Locked when empty | 🏢 |
| 7.4 | Physical security monitoring | Partly | Building's own; no data on site to protect beyond laptops | 🏢 |
| 7.5 | Physical and environmental threats | ➖ for our systems | Data centres are the suppliers' | ➖ |
| 7.6 | Working in secure areas | ➖ | No secure areas: no servers or paper records on site | ➖ |
| 7.7 | Clear desk and clear screen | Yes | Screen lock after 5 minutes (laptops); the app signs staff out after 30 idle minutes; no customer papers left out | 🟡 laptops |
| 7.8 | Equipment siting and protection | Yes | Laptops kept out of view, not left in cars | 🏢 |
| 7.9 | Assets off-premises | Yes | Laptops encrypted (BitLocker); phones with screen lock | 🏢 BitLocker |
| 7.10 | Storage media | Yes | Production backups on the laptop are encrypted (AES-256); no USB copies of customer data | ✅ backups · 🏢 USB rule |
| 7.11 | Supporting utilities | ➖ | Suppliers' data centres | ➖ |
| 7.12 | Cabling security | ➖ | No owned network infrastructure | ➖ |
| 7.13 | Equipment maintenance | Yes | Laptops updated automatically; repairs by approved shops with the disk encrypted | 🏢 |
| 7.14 | Secure disposal or re-use | Yes | Laptops wiped (reset with BitLocker on) before disposal or reuse | 🏢 |

## A.8 Technological controls

| # | Control | Applies | How it's met | State |
|---|---|---|---|---|
| 8.1 | User endpoint devices | Yes | Laptop rules (policies.md §7): encryption, lock, updates, antivirus, no shared logins | 🏢 |
| 8.2 | Privileged access rights | Yes | Superadmins few and named; database owner and production keys only on the release laptop, never in Vercel; production changes need `--confirm` | ✅ |
| 8.3 | Information access restriction | Yes | Database-enforced role and project rules; homeowners see only their own; files private | ✅ |
| 8.4 | Access to source code | Yes | GitHub repository; no secrets or customer data in it or its history (scanned 27 Oct 2026); two-step on GitHub accounts | 🏢 the repository is **public**: move it to a company organisation and make it private · 🟡 check GitHub two-step for everyone |
| 8.5 | Secure authentication | Yes | Clerk; two-step verification (authenticator app + backup codes), required for staff with `REQUIRE_STAFF_MFA=1`; idle sign-out; new-device email check | 🟡 turn on REQUIRE_STAFF_MFA |
| 8.6 | Capacity management | Yes | Neon paid plan with spending cap; uptime check catches running out (as on 22 Oct 2026); tests moved off production's allowance | 🟡 separate test project |
| 8.7 | Protection against malware | Yes | Uploads stored privately, never run; laptops with antivirus | 🟡 laptops |
| 8.8 | Technical vulnerabilities | Yes | npm audit + pip-audit in CI; Dependabot weekly; fixed on 22 Oct 2026: 8 known issues in starlette/certifi; on 27 Oct 2026: 3 Next.js advisories (2 critical) by moving to 16.4.1 | ✅ |
| 8.9 | Configuration management | Yes | Settings in code (vercel.json, migrations, workflows) and reviewed like code; secrets listed by name in YOUR_STEPS | ✅ |
| 8.10 | Information deletion | Yes | Automatic retention (pdpa.md); deleted files removed from storage | ✅ |
| 8.11 | Data masking | Yes | NRIC: last 4 only; homeowners never see serial numbers or others' data; logs drop query strings | ✅ |
| 8.12 | Data leakage prevention | Yes | Exports limited by role and recorded; no personal data in URLs; tests can't reach real services | ✅ |
| 8.13 | Information backup | Yes | Nightly encrypted (30 days); encrypted restore point before each production change; Neon point-in-time restore; backup integrity checked 27 Oct 2026 (records.md) | ✅ · 🟡 photos and documents (R2) not yet copied elsewhere |
| 8.14 | Redundancy | Yes | Suppliers' managed redundancy (Neon storage, Vercel edge, R2) | ✅ |
| 8.15 | Logging | Yes | Audit log (every change), exports log, sign-ins (Clerk), Vercel/GitHub logs | ✅ |
| 8.16 | Monitoring activities | Yes | The live site and database called every 15 minutes by cron-job.org (failures emailed) and checked hourly by GitHub; failed jobs emailed; CSP reports; alerts on failed backups | ✅ |
| 8.17 | Clock synchronisation | Yes | Suppliers' synchronised clocks; times stored in UTC with time zone | ✅ |
| 8.18 | Privileged utility programs | Yes | Scripts that touch production need explicit flags (`--confirm`) and take a backup first | ✅ |
| 8.19 | Software on operational systems | Yes | Only through releases (CI build); no manual changes on servers (there are none to log into) | ✅ |
| 8.20 | Networks security | Yes | HTTPS only (HSTS), database over TLS, no open ports of our own | ✅ |
| 8.21 | Security of network services | Yes | Suppliers' managed networking; keys scoped per service | ✅ |
| 8.22 | Segregation of networks | Yes | Production, demo/dev and test are separate databases and keys; the demo can never reach production data | ✅ |
| 8.23 | Web filtering | Partly | Office/laptop browsing: DNS filtering or browser protection | 🏢 |
| 8.24 | Use of cryptography | Yes | TLS; encryption at rest by suppliers; backups AES-256 (PBKDF2, 200,000 rounds); key in the password manager | ✅ |
| 8.25 | Secure development life cycle | Yes | Branch → tests → staging → design check → production; reviewable commits | ✅ |
| 8.26 | Application security requirements | Yes | Requirements written per feature (who may see/do what) and tested per role in the UAT | ✅ |
| 8.27 | Secure architecture | Yes | Rules enforced in the database, not only the screens; least-privilege database login; security headers; content security policy (report-only, then enforced) | 🟡 enforce CSP |
| 8.28 | Secure coding | Yes | Parameterised SQL only; inputs validated; linting in CI | ✅ |
| 8.29 | Security testing | Yes | Per-role access tests in the UAT (every role × every action); dependency audits; a yearly external penetration test | 🟡 pen test |
| 8.30 | Outsourced development | Yes | Development is done with an AI assistant under 9 Solar Home's direction; every change reviewed, tested and released by 9 Solar Home | ✅ |
| 8.31 | Separation of environments | Yes | Separate production, dev/demo and test databases and keys; tests refuse to run against production | ✅ |
| 8.32 | Change management | Yes | Every change committed with its reason; staging first; production on the owner's say-so; migrations with a restore point | ✅ |
| 8.33 | Test information | Yes | Tests and the demo use invented people only; real customer data never in dev/test (an exception on 22 Oct 2026 was found, removed and prevented) | ✅ |
| 8.34 | Protection during audit testing | Yes | Auditors get read-only views or exports; no production changes during audits | 🏢 |
