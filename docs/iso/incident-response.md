# Incidents: what to do (A.5.24–5.30, A.6.8)

An **incident** is anything that harms, or could harm, the confidentiality,
correctness or availability of our information: the app down, data seen by
the wrong person, a lost laptop, a leaked key, a phishing click.

## 1. Report it, at once

Anyone who notices something odd tells the **information security owner**
(_[name, mobile]_) straight away, by phone or WhatsApp, even if unsure.
No blame for reporting; delay is the only mistake. Out of hours too.

## 2. Assess (the owner, within the hour)

1. Open an entry in the incident log (below): when, who reported, what's known.
2. **Is personal data involved?** If customers' or staff's personal data may
   have been seen, changed, lost or deleted by the wrong people, it's a
   possible **data breach**: bring in the DPO now.
3. **How bad?** Severity 1: customers' data exposed, or the app down for
   everyone. Severity 2: one part down, or a near miss. Severity 3: minor.

## 3. Contain, fix, recover

Use the runbook below that fits. Keep evidence: don't delete logs; save
screenshots; note times. Restore into dev first, never straight over
production, unless the owner decides otherwise.

## 4. PDPA: notify if needed (the DPO)

A breach is **notifiable** if it affects **500 or more people**, or could
cause them **significant harm** (e.g. a name with an NRIC fragment, financial
details, contracts). Then:

- Tell the **PDPC within 3 calendar days** of deciding it's notifiable:
  pdpc.gov.sg → *Report a data breach*.
- Tell the **people affected** as soon as practical (unless the PDPC says
  otherwise): what happened, what data, what we're doing, what they can do.
- Decide whether it's notifiable as fast as possible; aim for within 30 days
  of first knowing, and record the reasoning either way.

## 5. Learn (within 2 weeks)

Write in the log what caused it, what was changed so it can't happen again,
and whether a policy, the risk register or this procedure needs updating.

## Contacts

| Who | How |
|---|---|
| Information security owner | _[name, mobile]_ |
| DPO | _[name, email]_ |
| PDPC (data breaches) | pdpc.gov.sg → Report a data breach |
| SingCERT (cyber incidents) | csa.gov.sg/singcert → Report an incident |
| Police (crime, e.g. stolen laptop, fraud) | 999 / police.gov.sg e-services |
| Neon (database) | console.neon.tech → Support |
| Vercel (app) | vercel.com/help |
| Clerk (sign-in) | dashboard.clerk.com → Support |
| Cloudflare (files) | dash.cloudflare.com → Support |
| Huawei FusionSolar | FusionSolar support / the installer's account manager |

## Runbooks

### The app or its database is down

The uptime check (GitHub Actions → *Uptime*) emails when
`/api/py/health` fails three times in a row.

1. Open the live site; open `/api/py/health`. "database: unavailable" → step 2;
   no answer at all → step 4.
2. Neon console → the GetHomeApps project: is a limit reached (compute,
   storage, transfer)? Raise it or upgrade; check the spending cap. Is there
   a Neon incident (neonstatus.com)?
3. If the database itself is damaged: Neon → Restore to a time before the
   damage (into a new branch first, check it, then switch); or a backup
   (docs/backups.md).
4. Vercel → homesapp → Deployments: a failed deployment? Promote the last
   good one (*Instant Rollback*). A Vercel incident (vercel-status.com)?
5. Tell staff (and customers if it's long) what's happening.

### Customer data may have been exposed

1. Contain: disable the account involved (People), or turn off the export or
   feature; change any key that may be out (below).
2. Find out what was seen and whose: the audit log (Audit), the exports log,
   Vercel logs, Clerk's sign-in history.
3. DPO: step 4 above.

### A key or password may have leaked

(Keys: Clerk, Neon, R2, Resend, Meta, Twilio, Anthropic, FusionSolar,
VAPID, CRON_SECRET, the backup passphrase.)

1. Make a new one in the supplier's console; put it in Vercel (Sensitive) and
   `.env.local`; redeploy; delete the old one. Database passwords:
   `npm run db:rotate`.
2. Check the supplier's logs for use of the old key since the leak.
3. Remove the key from wherever it leaked (chat, email, code history).

### A laptop or phone is lost or stolen

1. Change that person's passwords and sign them out everywhere (Clerk →
   the user → Sessions → Revoke).
2. If it was the release laptop: change every key in `.env.local` (above).
   The restore points on it are encrypted; BitLocker protects the rest.
3. Police report if stolen; record it.

### Someone clicked a phishing link or gave away a code

1. Change their password; sign them out everywhere; check two-step is on.
2. Look at the audit log for anything they did after the click.
3. Remind everyone: 9 Solar Home never asks for passwords or codes.

### FusionSolar stops answering

The rest of the app carries on; Solar shows "not live" and when it last
updated. Check the API account's deadline in FusionSolar → Northbound
Management (extend it), and its password in Vercel.

## Incident log

| # | Date | What happened | Severity | Personal data? | What was done | Lesson / change |
|---|---|---|---|---|---|---|
| 1 | 22 Oct 2026 | The database provider (Neon, free plan) ran out of its monthly allowance after heavy testing; every connection was refused, so the live site, demo and tests couldn't reach their data for a short while | 1 (availability) | No | Owner upgraded the Neon plan; service back at once; the stopped FusionSolar import resumed | Uptime check every 15 minutes added; testing to move off production's allowance (a separate Neon project); spending cap |
| 2 | 22 Oct 2026 | With FusionSolar's API account in the laptop's settings, an automated test ran the 15-minute job and copied the 91 real plants (names and addresses) into the **test** database | 3 (near miss; test database, access limited to the developer laptop and tests) | Yes (addresses), not exposed outside | Removed from the test database the same hour; audit log checked (no copies) | Tests now can't reach any real outside service (FusionSolar, Claude, email, WhatsApp, SMS), whatever the settings; a test proves it |
