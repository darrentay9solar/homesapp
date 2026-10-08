# GetHomeApps: what's left

Last updated 8 Oct 2026. Two lists: settings only you can do (they need
your accounts or keys), and what's still to build from the original brief.

## 1. Settings for you to do

Step by step, with where to click: **[YOUR_STEPS.md](YOUR_STEPS.md)**. In short:

1. Fix the dev database login (Neon), so the demo site has its data.
2. Let the demo site upload photos (the dev bucket's CORS, Cloudflare).
3. Make yourself the superadmin (one line in Neon's SQL editor).
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
