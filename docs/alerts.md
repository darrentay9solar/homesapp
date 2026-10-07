# Alerts and phone notifications

Everything the app tells someone is an **alert**. Alerts appear in two
places, which always agree:

- **The Alerts screen**: newest first, grouped by day, with tabs for All,
  Unread and Running late. Tapping an alert marks it read and opens what it's
  about (a project, its site visits, People, or Account).
- **A phone notification**, for anyone who turned them on. Tapping it marks
  the alert read and opens the same place. The app icon's badge shows the
  unread count, and an open Alerts screen refreshes by itself.

## What raises an alert

| Alert | Who | Opens |
|---|---|---|
| Approve this project / approved / declined | Homeowner, PMs, crew | The project |
| Site visit scheduled; in 1 hour | EPC crew | The project's site visits |
| **Running late**: no check-in 1 hour after a timed visit (next morning for an untimed one) | **The project's PM** and the EPC crew, marked urgent | The project's site visits |
| **Crew arrived late**: first check-in an hour or more after the start | **The project's PM**, urgent | The project's site visits |
| Milestone complete; ready for handover | Everyone on the project | The project |
| Account / role requests | PMs | People |
| Account or role approved / declined | The person | Account |
| A PM reverted or restored your change | The person | The project (or Account) |

The visit alerts come from a job that runs every 15 minutes
(`.github/workflows/visit-reminders.yml`). **It runs only once `CRON_SECRET`
is set in Vercel and `APP_URL` + `CRON_SECRET` are set as GitHub repository
secrets.** Until then, no "Running late" alerts go out on the live site.

## Turning on phone notifications

People do this themselves, on each phone: **Alerts** (or **Account →
Notifications**) → **Turn on notifications**, then allow them.

- **Android**: works in Chrome straight away. Installing the app (Chrome menu →
  Add to Home screen) is nicer but not required.
- **iPhone / iPad (iOS 16.4 or later)**: Apple only allows notifications for
  an app on the Home Screen. In Safari: **Share → Add to Home Screen**, open
  GetHomeApps from the new icon, then turn notifications on there.
- **Desktop**: Chrome, Edge, Firefox and Safari all work.

"Send a test" on the same card sends one to that device.

## Server setup (once per environment)

Phone notifications are signed with a VAPID key pair. The laptop already has
one in `.env.local`. For the live site, make a separate pair:

```bash
npm run vapid-keys
```

Paste the three lines it prints into Vercel → Settings → Environment
Variables, for **Production** (tick *Sensitive* for the private key), and
redeploy:

```
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=https://homesapp-alpha.vercel.app
```

Keep the pair: replacing it later switches notifications off on every phone
until people turn them on again.

## How it works

- `api/_lib/push.py` encrypts each message for one phone (RFC 8291) and signs
  a token for the push service (RFC 8292), with no extra libraries. It's
  checked against the standard's own worked example in `tests_py/test_alerts.py`.
- `api/_lib/notify.py` records the alert, then sends it to each of the
  person's phones, recording the outcome in `notification_deliveries`
  (channel `push`). A phone the push service says is gone is forgotten.
- `public/sw.js` shows the notification, sets the badge, and opens the alert's
  link through `/alerts?open=<id>`, which marks it read.
