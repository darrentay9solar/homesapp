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
| **Access** | Account → *Download my data*: a JSON file of what the app holds about the person (profile, requests, homes, systems, invoices, meetings, signatures, site check-ins, uploads, support messages, notifications, devices). Sign-in ids and device keys are left out. Someone whose account is switched off asks the Data Protection Officer. |
| **Correction** | People change their own name, mobile, address and photo in Account; anything else through their project manager. Every change is in the audit log. |
| **Accuracy** | Postal codes fill in the address from OneMap; mobile numbers are checked by a code; duplicates (mobile, email, address, postal code, project code) are refused. |
| **Protection** | Sign-in by Clerk (passwords never reach us); every request is checked for role and project; the database itself refuses what a role may not do (row guards and row-level security); files are private in R2 and opened only through short-lived links; the NRIC is kept as the last 3 digits and letter only, per the PDPC's NRIC advisory, and never sent to the browser; nightly backups are encrypted. |
| **Retention** | See *Retention* below: the rules are proposed, not yet switched on. |
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

## Retention (proposed)

Keep personal data only while it serves a purpose. Proposed, for
9 Solar Home to decide before anything deletes itself:

| Data | Keep | Why |
|---|---|---|
| Homeowner's contract, system, invoices, payments, signatures | The 8-year plan + 5 years | Contract, and IRAS's 5 years for business records |
| Site check-ins and project files | As the project, above | Proof of work under the warranty |
| Turned-down access requests | 12 months | Enough to answer "why was I refused?" |
| Verification codes (stored hashed) | 30 days | Only needed for minutes |
| Notifications | 2 years | Past that, nobody reads them |
| Accounts switched off | Anonymise 2 years after the last project or contract ends | Name, mobile, email, address and photo cleared; the audit trail keeps the record of what happened |
| Audit log | As the records it describes | Accountability |
| Backups | 30 days (nightly, encrypted) | Recovery |

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
