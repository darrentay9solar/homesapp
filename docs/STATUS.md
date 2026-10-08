# GetHomeApps: what's left

Last updated 8 Oct 2026. Two lists: settings only you can do (they need
your accounts or keys), and what's still to build from the original brief.

## 1. Settings for you to do

Live site: <https://homesapp-alpha.vercel.app>. Vercel settings go under
**Project → Settings → Environment Variables → Production**, then
**Redeploy**.

| # | What | Where | Why it matters |
|---|---|---|---|
| 1 | **Fix the dev database login.** Both dev passwords are being refused (`DATABASE_URL`, `MIGRATION_DATABASE_URL`). Copy fresh connection strings from Neon → the dev branch → Connect, into `web/.env.local`. | Neon, `.env.local` | The app on your laptop can't reach its database. Migration 0026 also still needs to go on dev. |
| 2 | **Phone notifications on the live site:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Make a fresh pair with `npm run vapid-keys`. | Vercel | Without them, nobody gets phone notifications from the live site (alerts still show in the app). See [alerts.md](alerts.md). |
| 3 | **The 15-minute job:** `CRON_SECRET` in Vercel, plus `APP_URL` and `CRON_SECRET` as GitHub repository secrets. | Vercel and GitHub → Settings → Secrets → Actions | No "running late" or "visit in 1 hour" alerts, and expired accounts only switch off when someone signs in or People is opened. |
| 4 | **Email:** `RESEND_API_KEY` and `EMAIL_FROM`, with your sending domain verified in Resend. | Resend, Vercel, `.env.local` | Invitations, approvals and decisions aren't emailed. |
| 5 | **WhatsApp:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and the message templates approved by Meta. | Meta Business, Vercel | No WhatsApp codes or messages. See [whatsapp.md](whatsapp.md). |
| 6 | **SMS fallback:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_FROM`. | Twilio, Vercel | No SMS when WhatsApp can't deliver. |
| 7 | **Production file-storage keys for the reset:** `PROD_R2_ACCESS_KEY_ID`, `PROD_R2_SECRET_ACCESS_KEY` in `.env.local`. | `.env.local` only | Needed for the production wipe and demo seed you chose, and to move older production files into the images/documents layout. |
| 8 | **Clerk for production:** switch the Clerk instance from Development to Production keys (and add your domain) before real customers sign up. | Clerk dashboard, Vercel | Development keys show a "development" badge and have usage limits. |
| 9 | **A custom domain** (optional), e.g. app.9solarhome.com. | Vercel → Domains | Then set `APP_URL` and `VAPID_SUBJECT` to it. |

## 2. Still to build, from the original brief

| Brief item | State |
|---|---|
| Homeowner e-signs the handover (Installation Certificate) when the project completes | **Not built.** Next step: the certificate filled from the project, signed on the phone, stored as a PDF in R2. |
| Project managers get an alert when it's signed; any PM checks and closes the project | **Not built** (goes with the e-sign). The statuses exist; the screens don't. |
| "Upon completion of the project, a push notification to the PM, admin team and homeowner" | Partly: "Ready for handover" goes to everyone on the project when Milestone 3 completes. The final "closed" notice comes with the e-sign. |
| Approve straight from the phone notification | Partly: tapping the notification opens the project with Approve and Decline on top. Buttons inside the notification itself aren't possible on iPhone, so not built. |
| Clearing out abandoned uploads (an upload link taken but never finished) | Not built; harmless meanwhile. See [r2.md](r2.md). |
| Emails and WhatsApp messages in Chinese | Not built: the screens and phone notifications follow the person's language; emails and WhatsApp are English. |
| A native app in the App Store / Play Store | Not planned: GetHomeApps installs from the browser to the home screen (a web app). Location is only shared while it's open; a store app would be needed to share it in the background. |

Everything else in the brief is built: the four roles and what each can do,
the projects list (late and no-shows in red), Create Project with
homeowner and contractor as accounts or text, every milestone field with
its conditions and uploads, milestones unlocking in order, homeowner then PM
approval, scheduling EPC visits with reminders and no-show alerts, GPS
check-in and check-out with crew counts, the audit log with revert and
restore, and the login screens.
