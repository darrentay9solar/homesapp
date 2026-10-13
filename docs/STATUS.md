# GetHomeApps: what's left

Last updated 9 Oct 2026. Two lists: settings only you can do (they need
your accounts or keys), and what's still to build from the original brief.

## 1. Settings for you to do

Step by step, with where to click: **[YOUR_STEPS.md](YOUR_STEPS.md)**. In short:

1. ~~Fix the dev database login~~ done again 9 Oct (new dev branch,
   `ep-square-wind`; keep its auto-delete off).
2. ~~Let the demo site upload photos~~ done.
3. ~~Make yourself the superadmin~~ done.
4. ~~Phone notification keys for the live site~~ done.
5. ~~The 15-minute reminder job~~ done.
6. Email (Resend), 7. WhatsApp (Meta), 8. SMS (Twilio).
9. Clerk production keys before real customers, 10. your own domain.

Production no longer needs a wipe or its R2 keys in `.env.local`. It
already holds only your login, and sample data now lives on the demo site
(<https://gethomeapps-demo.vercel.app>) alone.

## 2. Still to build, from the original brief

| Brief item | State |
|---|---|
| Homeowner e-signs the handover (Installation Certificate) when the project completes | **Built.** At Milestone 3 the homeowner is asked to sign; the certificate is filled from the project, signed on the phone, and kept as a one-page PDF in R2 with its fingerprint. |
| Project managers get an alert when it's signed; a PM checks and closes the project | **Built.** "Handover signed" to the project's PM; Close project after checking the PDF. |
| "Upon completion of the project, a push notification to the PM, admin team and homeowner" | **Built.** "Project closed" to everyone on the project, the superadmins and the homeowner (by email too). |
| Approve straight from the phone notification | Partly: tapping the notification opens the project with Approve and Decline on top. Buttons inside the notification itself aren't possible on iPhone, so not built. |
| Clearing out abandoned uploads (an upload link taken but never finished) | **Built.** Every link is written down; after a day the 15-minute job deletes what an unfinished upload left. See [r2.md](r2.md). |
| Emails and WhatsApp messages in Chinese | **Built.** Every email, WhatsApp and text follows the reader's language. New accounts get a "Messages in" choice; sign-ups keep the language they signed up in. WhatsApp needs Chinese (zh_CN) versions of the templates approved in Meta; until then those go in English (see [YOUR_STEPS.md](YOUR_STEPS.md)). |
| Maintenance tracking after the handover | **Built (9 Oct).** A signed project shows as Completed; once a PM closes it, it's Handed Over: it leaves the Projects list and becomes a maintenance record on the Maintenance page (system, contract, 6-month and 1-year checks, urgent issues). The 49 systems in the 28 Aug 2026 project listing are in production, waiting for a superadmin to assign their managers. |
| Meetings and calendars | **Built (12 Oct).** Everyone's own calendar in 30-minute rows (week, day, upcoming); arranging a meeting over the times everyone is free, with Teams or Google Meet links; accept or decline; blocking out time or whole days; adding to Google Calendar, Outlook or any calendar app. |
| The maintenance stage, reminders and booking | **Built (12 Oct).** A handed-over project is In Maintenance: the homeowner sees a Maintenance tab and the installation archived beside it. Reminders 14 days before, on the day and when overdue; a visit booked through the calendar. The dashboard has a Maintenance tab. |
| The dashboard fitted to the live data | **Built (13 Oct).** With no projects yet but systems to look after, the dashboard opens on Maintenance and the project tabs say what fills them. The Overview carries a Maintenance summary. Checks coming up leads with the overdue ones and names the busiest month; inverters are grouped by rating (every model in the table); system sizes in bands with the typical (median) size; when PPAs end, by year. |
| One mobile number per account | **Built (13 Oct).** A number already on an account (or on someone else's waiting request) is refused under the mobile field in Request Access, New Account, approving a request and Your Mobile; the database's unique index (0033) holds it. |
| Excel exports | **Built (12 Oct).** All projects (with a Maintenance sheet like the listing) and all people, from the Projects and People headers. |
| A native app in the App Store / Play Store | Not planned: GetHomeApps installs from the browser to the home screen (a web app). |

Everything in the brief is built: the roles and what each can do, the
projects list (late and no-shows in red), Create Project with homeowner and
contractor as accounts or text, every milestone field with its conditions
and uploads, milestones unlocking in order, homeowner then PM approval,
scheduling EPC visits with reminders and no-show alerts, GPS check-in and
check-out with crew counts, the handover e-signature and closing, the audit
log with revert and restore, messages in English and Chinese, and the login
screens. It's checked by 19,621 user acceptance tests (see
[TEST_CASES.md](TEST_CASES.md)).
