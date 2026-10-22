# Information security policies (draft)

**9 Solar Home Pte Ltd** · Version 0.1 · 22 Oct 2026 · Owner: _[name]_ ·
Approved by: _[director]_ on _[date]_ · Reviewed every year, and after any
serious incident.

Items in _[brackets]_ are for 9 Solar Home to fill in.

---

## 1. Information security policy

9 Solar Home installs, maintains and bills rooftop solar systems for
homeowners in Singapore. We hold our customers' names, addresses, contact
details, contracts, payments and system data, and we are trusted with their
homes. We protect that information so that it is:

- **confidential**: seen only by the people whose work needs it;
- **correct**: changed only by the right people, with a record of each change;
- **available**: there when customers and staff need it.

We follow Singapore's Personal Data Protection Act and meet ISO/IEC 27001.
We find and treat the risks to our information (risk-register.md), set
objectives and check them every quarter, and improve after every incident.
Everyone who works with our information follows these policies; breaking
them on purpose is a disciplinary matter.

**Objectives for the year**

1. No customer data exposed to anyone not entitled to it.
2. The app available 99.5% of the time; back within 4 hours of an outage.
3. Every member of staff on two-step verification and trained once a year.
4. Every quarter: access review signed, a backup restored as a test, the
   incident log reviewed.

## 2. Roles and responsibilities

| Role | Who | Responsible for |
|---|---|---|
| Information security owner | _[name]_ | These policies, the risk register, incidents, the quarterly review |
| Data Protection Officer | _[name]_, _[privacy@…]_ | PDPA: requests, breach notification, the privacy notice |
| Superadmins | _[names]_ (at most 3) | Accounts and roles, the access review, releases |
| Staff (managers, Admin, crew) | Everyone with an account | Following these policies; reporting anything odd at once |

## 3. Access control

- Access is given by role, and to the projects a person works on, never more
  (the roles are in access-control.md). The database enforces it.
- Accounts are personal: no shared logins, ever.
- New accounts and role changes are approved by a project manager or a
  superadmin; project manager and Admin accounts only by a superadmin;
  superadmins are added only by the owner, in the database.
- Leavers are switched off **the same day**; movers' roles changed the same
  day. Contractors' accounts get an end date.
- Every quarter a superadmin downloads the **access review** (People →
  Access review), checks each line, makes the changes and signs it off.

## 4. Passwords and two-step verification

- Passwords: at least 12 characters, not used anywhere else; a password
  manager is recommended. The sign-in service (Clerk) refuses known-breached
  passwords.
- **Everyone on staff uses two-step verification** (an authenticator app),
  and keeps their backup codes in their password manager. The app enforces
  it once `REQUIRE_STAFF_MFA` is on.
- Never share a password or a code, including with "IT support" by phone,
  WhatsApp or email: 9 Solar Home will never ask for them.
- The app signs staff out after 30 minutes without use.

## 5. Acceptable use

- Company information is used only for 9 Solar Home's work.
- Customer data stays in the app. Excel exports only when needed, kept on an
  encrypted laptop, deleted when done, never emailed to a personal address
  or put on a USB stick.
- Don't install software from unknown sources; don't open unexpected
  attachments; report suspicious messages.
- Everyone reads these policies when they join and once a year, and attends
  the yearly 30-minute security session.

_Acknowledgement:_ I have read and will follow these policies.
Name / signature / date: ______________________

## 6. Classifying information

| Class | Examples | Handling |
|---|---|---|
| **Confidential** | Customers' personal data, NRIC fragments, contracts, invoices, payments, signatures, photos of homes, backups, keys | In the app or encrypted; need-to-know; never in URLs, chats or personal email |
| **Internal** | Schedules, procedures, system data | Staff only |
| **Public** | The website, the Contact and Privacy pages, brochures | Anyone |

## 7. Laptops and phones

- Disk encryption on (BitLocker on Windows; FileVault on Mac); screen lock
  after 5 minutes; automatic updates; antivirus on (Windows Defender is fine).
- Phones used for the app or for two-step codes: screen lock, updates on.
- A lost or stolen device is reported at once (incident-response.md).
- Devices are wiped before being reused, sold or thrown away.
- Work from anywhere is fine; lock the screen when stepping away, and don't
  let others see customer details.

## 8. Backup and recovery

- The database is backed up every night (encrypted, kept 30 days) and before
  every change to production (encrypted restore point); Neon can also rewind
  it to any minute in recent days. Details: docs/backups.md.
- A backup is restored as a test **every quarter** (into dev, never
  production) and the result recorded.
- Targets: back within **4 hours**; at most **24 hours** of data lost.

## 9. Cryptography

- Everything travels over HTTPS (HSTS on); the database connection uses TLS.
- Data at rest is encrypted by the suppliers (database, files).
- Production backups are encrypted with AES-256 (PBKDF2, 200,000 rounds). The
  passphrase is kept in the company password manager and in GitHub's
  secrets; never in code, chat or email.
- Keys and passwords for services live only in Vercel's and GitHub's secret
  settings (marked Sensitive) and the release laptop's `.env.local`. A key that
  may have leaked is changed at once.

## 10. Suppliers

- Each supplier that handles our data is on the list in docs/pdpa.md (what it
  sees, where), with its data processing agreement accepted and filed.
- Once a year: check each supplier's security certification (ISO 27001 or
  SOC 2) is current, and whether we still need it.
- A new supplier is added only after checking what it will see and agreeing
  its terms; the privacy notice is updated if customers' data goes to it.

## 11. Secure development and change

- Every change: its reason recorded; tests (around 4,500, plus around 24,000
  UAT cases, including what each role may and may not do); the design check;
  then staging and the demo; then production **only on the owner's say-so**.
- Database changes to production take an encrypted restore point first.
- Production, demo/dev and test are kept apart: separate databases and keys;
  real customer data never in dev or test; tests can't reach real services.
- Libraries are kept up to date (Dependabot), and checked for known
  vulnerabilities on every change (npm audit, pip-audit).
- A penetration test by an outside firm once a year.

## 12. Logging and monitoring

- The app records every change (who, when, what) in an audit log that can't
  be edited, and every export.
- The live site and its database are checked every 15 minutes; a failure
  emails the owner. Failed nightly backups do the same.
- Logs are reviewed when something looks wrong, and in the quarterly review.

## 13. Retention and deletion

As docs/pdpa.md *Retention*: contract records 8 + 5 years, everything else a
year after it's no longer needed, deleted automatically.

## 14. Incidents

As incident-response.md: report at once, contain, assess (PDPA notification
within 3 days of deciding it's notifiable), fix, learn, and record.

## Asset inventory (to keep current)

| Asset | Owner | Notes |
|---|---|---|
| GetHomeApps (Vercel project homesapp) | _[owner]_ | Production; region Singapore |
| Database (Neon project GetHomeApps: production, dev, test) | _[owner]_ | Paid plan since 22 Oct 2026 |
| Files (Cloudflare R2 gethomeapps-prod, gethomeapps-dev) | _[owner]_ | Private |
| Sign-in (Clerk) | _[owner]_ | Production keys pending (YOUR_STEPS step 9) |
| Code and jobs (GitHub darrentay9solar/homesapp) | _[owner]_ | Private |
| FusionSolar (API account gethomeapps_api) | _[owner]_ | Read-only APIs; renew before its deadline |
| Release laptop | _[owner]_ | Holds `.env.local` and encrypted restore points; BitLocker |
| _[other laptops and phones]_ | | |
