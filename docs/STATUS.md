# GetHomeApps: what's left

Last updated 15 Oct 2026. Two lists: settings only you can do (they need
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
| Warnings for managers | **Built (13 Oct).** The day a project passes its target end date, its manager is told (once). Two weeks late, or a maintenance check a month overdue on a managed system, the superadmins are told (once). Every morning at 8, Monday to Saturday, each project manager and superadmin gets a summary of what needs them (late projects, urgent and overdue systems, approvals and handovers waiting, requests, checks this week) from the dashboard's own numbers, only when there's something. In the app, on the phone and by email; each can be muted in Notifications. |
| 9 Solar Home's project list in the app | **Built (14 Oct).** `scripts/import_client_list.py` reads the list workbook. Turned-on clients add their record to their maintenance system (the 49 from August matched by address; new ones added); signed clients not yet turned on become projects in progress, waiting for a manager. Monthly solar output (against the estimate), billing periods and homeowner feedback show on each system; the client record and the inverter's warranty and price show to project managers on projects and systems. Leads and buy-in prices are left out for now. |
| Support, with an assistant | **Built (14 Oct).** Homeowners ask in Help; an assistant answers common questions from the managers' answers and their own project (Claude, once an Anthropic key is added; until then the closest answer from the list); Talk to a person hands it to the project's manager, who can bring in anyone with an account, hand it on and settle it. Alerts and emails at each step; a request unanswered for a day goes to the superadmins and the morning summary. See [support.md](support.md). |
| Payments | **Built (15 Oct).** A new account type, Admin (finance), set up by a superadmin: full rights to payments and invoices, read-only on every project and system. The one plan: a 3,500 admin fee (paid before a project moves to Maintenance; closing waits for it), then each month the kWh a system generated times its contract's rate, for 8 years from the month it was turned on. Admin issues a month's invoices (kWh prefilled from the output records), marks them paid, or uploads the bank's CSV statement to match payments by invoice number; homeowners see their invoices in Payments with the company's PayNow QR, download each as a PDF with the company's header, and can send proof of paying. Project managers see only whether each fee and month is issued and paid. The invoice is designed in the app (company details, logo, QR, colour, wording, what shows), previewed live. See [payments.md](payments.md). |
| One homeowner, one project | **Built (15 Oct).** A homeowner account is on one project (and one system) at most; linking them to a second is refused under the homeowner field, and the database's unique indexes (0043) hold it. |
| Duplicates refused | **Built (14 Oct).** Adding what's already in the system is refused under the field concerned: the same address (however it's spelt), a system in Maintenance there, the same postal code unless confirmed as another home, a homeowner's number that's another person's, the same person at the same postal code, an email or mobile on a waiting request. |
| Who runs a project | **Built (14 Oct).** A project manager creating a project chooses who runs it (themselves or another manager, who's told); a project nobody runs yet (from the project list) is taken on with Take on this project. |
| The meeting form, like Google Calendar's | **Built (15 Oct).** A date with 30-minute start and end times (busy times can't be picked); repeats (daily, weekdays, weekly, every 2 weeks, monthly by date or weekday, yearly), changed, answered or cancelled one at a time or this and the following; up to five notifications (an hour before unless changed); Online, Physical (the postal code fills the address; a joiner's, the project's or your own address in one tap) or a call; Teams, Google Meet and Zoom links set up for the meeting's time (made automatically once the company's accounts are connected, step 12), never a meeting now. |
| Dashboard periods | **Built (15 Oct).** 30, 60 or 90 days, 12 months, all time, or any number of days (1 to 3,650). |
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
