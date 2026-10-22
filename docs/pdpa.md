# Personal data (PDPA)

How GetHomeApps handles personal data under Singapore's Personal Data
Protection Act 2012, what the app does for each obligation, and what
9 Solar Home itself has to do. The app helps; compliance is the company's.

## What the app does

| PDPA obligation | In the app |
|---|---|
| **Consent** | Asking for access needs the privacy notice ticked (`/privacy`, version in `api/_lib/privacy.py`). People added by a manager, or there before the notice, are asked once when they next open the app. Each agreement is kept with its date and version (migration 0044); only the person can record it. |
| **Notification** (purpose) | The notice at `/privacy` says what is collected, why, who it goes to, and how long it is kept. It's linked from sign-up, Request Access and Account. |
| **Purpose limitation** | Data is used to run the installation, maintenance, payments and support of the person's own solar system. Messages are service messages only (no marketing), so the Do Not Call rules don't apply to them. |
| **Access** | Account → *Download my data*: a JSON file of what the app holds about the person (profile, requests, homes, systems, invoices, meetings, signatures, site check-ins, uploads (on a project, or a staff member's not on one yet), support messages, notifications, devices). Sign-in ids and device keys are left out. Someone whose account is switched off asks the Data Protection Officer. |
| **Correction** | People change their own name, mobile, address and photo in Account; anything else through their project manager. Every change is in the audit log. |
| **Accuracy** | Postal codes fill in the address from OneMap; mobile numbers are checked by a code; duplicates (mobile, email, address, postal code, project code) are refused. |
| **Protection** | Sign-in by Clerk (passwords never reach us); every request is checked for role and project; the database itself refuses what a role may not do (row guards and row-level security); files are private in R2 and opened only through short-lived links; the NRIC is kept as the last 3 digits and letter only, per the PDPC's NRIC advisory, and never sent to the browser; nightly backups are encrypted. |
| **Retention** | Non-essential data is deleted a year after it stops being needed; see *Retention* below. |
| **Transfer abroad** | See *Where data goes* below. |
| **Accountability** | This document, the audit log, and the steps for 9 Solar Home below. |
| **Breach notification** | See *If data leaks* below. |

## What is held

| Whose | What | Why |
|---|---|---|
| Everyone with an account | Name, email, mobile, role, language, notification choices, photo (optional), sign-in times, privacy agreement | Sign-in, messages, knowing who did what |
| Homeowners | Address, postal code, last 3 digits + letter of NRIC (optional), salutation, contract (plan, rate, PPA, dates), system details, generation readings, invoices and payments, payment proofs | Installing and maintaining their system, billing for 8 years |
| Crew (contractors, EPC) | Site check-in and check-out location (GPS, accuracy) and time | Showing work was done at the site |
| People who sign | Signature image, name, time, IP address, browser | A certificate the signature can be checked against |
| Anyone who writes in | Support messages, meeting replies, feedback | Answering them |
| Staff (project managers, superadmins) | Files uploaded before they're on a project (My Files → Unassigned): the file, its name, a note, who uploaded it and when | Keeping documents until they're filed on their project |
| Everyone | The audit log of their changes | Accountability, undoing mistakes |

## Where data goes

| Service | What it sees | Where |
|---|---|---|
| Neon (database) | Everything | Singapore (AWS ap-southeast-1) |
| Vercel (the app) | Requests passing through | Singapore (`sin1`) |
| Cloudflare R2 (files) | Uploaded files and photos | Asia-Pacific location hint |
| Clerk (sign-in) | Name, email, mobile, password | United States |
| Resend (email) | Name, email, message text | United States |
| Meta WhatsApp | Mobile, message text | Meta's servers (outside Singapore) |
| Twilio (SMS) | Mobile, message text | United States |
| Anthropic (support assistant, when switched on) | The question and the asker's own project facts; never other people's | United States |
| Zoom / Microsoft Teams / Google Meet (when switched on) | Meeting title and time | Their own regions |
| OneMap (Singapore Land Authority) | Postal codes and addresses being looked up | Singapore |

Sending data abroad is allowed when the receiver protects it to a standard
comparable to the PDPA. These services' data processing agreements do that:
9 Solar Home should accept each one in that service's dashboard (step 13 of
[YOUR_STEPS.md](YOUR_STEPS.md)) and say so in the notice (it already
names them).

## Retention

Non-essential data is kept for a year after it stops being needed, then
deleted (9 Solar Home's decision, 18 Oct 2026); essential records 5 years
after the contract ends (22 Oct 2026). The database does it
(`purge_old_data()`, migration 0045), once a day from the 15-minute job.
The deletes aren't copied into the audit log; each run is recorded with
how many of each it removed (`retention_runs`).

| Data | Kept | Then |
|---|---|---|
| Notifications and their delivery records | 1 year from sending | Deleted |
| Verification codes (stored hashed) | 1 year | Deleted |
| Phones and browsers for notifications | 1 year since last reached | Deleted |
| Access and role requests, once decided | 1 year from the decision | Deleted |
| Busy times and meetings | 1 year after they end | Deleted, with who was invited and the reminders sent |
| Support conversations, once settled | 1 year after settling | Deleted, with their messages |
| Records of reminders and warnings sent | 1 year | Deleted |
| Abandoned upload records | 1 year | Deleted |
| **Essential:** a system and its project: contract, yearly maintenance checks, output and billing records, invoices and payments, signatures and certificates, files, site visits and check-ins | 5 years after the contract ends: the 8-year plan from turn-on, or the PPA or maintenance plan if longer (so 8 + 5 years) | Deleted, files removed from storage too (0050) |
| **Essential:** a project that never became a system (declined, cancelled) | 13 years after it was last changed | Deleted (0050) |
| A homeowner's account, once none of their projects or systems are left | Until then | No personal details kept: "Former customer" (0050) |
| Staff uploads with no project yet (Unassigned) | Kept | Not deleted (9 Solar Home's decision, 22 Oct 2026) |
| Staff accounts, exports | As the records they describe | Kept |
| The audit log | An entry about a record that no longer exists: 13 years | Deleted once both have happened: the record is gone and the entry is 13 years old (0050) |
| Backups | 30 days (nightly, encrypted) | Replaced |

When essential records go was decided on 22 Oct 2026: 8 + 5 years (IRAS keeps
business records 5 years). The audit log is otherwise append-only: only the
daily run may remove entries, and only those above.

## If data leaks

1. Contain it: switch off the account or key involved (Clerk, Neon, R2,
   Vercel), rotate the keys (`npm run db:rotate` for the database).
2. Find out what was exposed and whose; the audit log and Neon's history help.
3. **Within 3 calendar days** of deciding it's notifiable, tell the PDPC
   (pdpc.gov.sg → report a data breach) when it affects 500 or more people,
   or could cause significant harm (an NRIC fragment with a name, financial
   details, and so on). Tell the people affected too, as soon as practical.
4. Write down what happened and what changed, whether or not it was notified.

## What 9 Solar Home must do

- **Appoint a Data Protection Officer** and give them an email address
  (a privacy@ address works); the notice shows it from
  `NEXT_PUBLIC_DPO_EMAIL` (Vercel → Settings → Environment Variables).
  Until then it tells people to write through Help in the app.
- **Read and approve the notice** at `/privacy`; it is a draft written from
  what the app actually does, not legal advice.
- **Decide the retention rules** above; once decided, a nightly job can apply them.
- **Accept each provider's data processing agreement** (Clerk, Resend,
  Meta, Twilio, Anthropic, Cloudflare, Neon, Vercel).
- **Laptop backups**: the restore-point backups in `backups/` are not
  encrypted and hold real customers' data. Keep that laptop's disk
  encrypted (BitLocker) and delete restore points you no longer need.
- **Answer access and correction requests within 30 days**; most people can
  use *Download my data* themselves.
