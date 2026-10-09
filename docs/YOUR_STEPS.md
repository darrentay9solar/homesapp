# Your steps

What only you can do, because it needs your logins to Neon, Cloudflare,
Meta, Twilio, Resend or Clerk. In order of importance. Steps 1 and 2 get the
demo site working; step 3 makes you the superadmin; the rest are for the live site.

The two sites:

| | Link | Data |
|---|---|---|
| **Live (production)** | <https://homesapp-alpha.vercel.app> | Real accounts only. Starts empty except your own login. |
| **Demo** | <https://gethomeapps-demo.vercel.app> | Sample people and projects. Visitors pick a person and try the app, no password. |

Both run the same code: every update goes to both at once.

---

## 1. Fix the dev database login (needed for the demo) — ⚠️ needed again, 9 Oct 2026

It was fixed on 8 Oct with a new dev branch (endpoint `ep-dry-cloud`). On
9 Oct the dev database started refusing the passwords in `web/.env.local`
again (both the owner login and the app login), and the demo site can't reach
it either, so the demo shows no sample people. The test and production
databases are fine. Most likely the dev branch's passwords were reset or the
branch was recreated.

**Why it keeps breaking:** each dev branch has lasted about a day
(`ep-withered-cake`, then `ep-damp-fog` 6 to 7 Oct, then `ep-dry-cloud` 8 to
9 Oct), then both of its logins stop working at once. Neon answers a deleted
branch with the same "password authentication failed", so the branch is
being deleted. Nothing in this project can delete a Neon branch: there's no
Neon API key, no Neon command-line tool, no Neon integration on GitHub or
Vercel, and a database login can't remove a branch. The likeliest cause is
the **auto-delete (expiry) setting** when the branch is created in Neon.

1. Go to <https://console.neon.tech> and open the GetHomeApps project.
   Click **Branches**. If a **dev** branch is still listed, open it and look
   for an expiry date ("Expires" / "Auto-delete"); remove it. If it's gone,
   click **New branch**: name `dev`, parent **production**, and make sure
   **automatically delete / expire** is **off**.
2. Open the **dev** branch.
3. Click **Roles** (left menu, under the branch).
   - Beside **neondb_owner**, click **⋯ → Reset password**, confirm, and copy
     the new password.
   - Do the same for **gethomeapps_app**.
4. Click **Connect** (top right). Choose **Branch: dev**, **Role:
   neondb_owner**, and leave **Connection pooling** on. Copy the connection
   string.
5. Open `web/.env.local` and replace the value of
   `MIGRATION_DATABASE_URL=` with it.
6. In **Connect** again, choose **Role: gethomeapps_app**, copy, and replace
   `DATABASE_URL=` in `web/.env.local`.
7. Save the file and tell me "dev database fixed".

8. Vercel → **gethomeapps-demo** → Settings → Environment Variables: replace
   `DATABASE_URL` with the same app-login string as step 6, then Redeploy.

Then I'll do the rest for the demo:
- apply the latest database changes (migration 0031, Maintenance);
- fill it with the sample people and projects;
- give the demo site its database address;
- check every role works on <https://gethomeapps-demo.vercel.app>.

## 2. Let the demo site upload photos (Cloudflare R2) — ✅ done 8 Oct 2026

The dev bucket only accepts uploads from your laptop. Add the demo site:

1. <https://dash.cloudflare.com> → **R2 Object Storage** → **gethomeapps-dev**
   → **Settings**.
2. Under **CORS Policy**, click **Edit**, replace what's there with this,
   and **Save**:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://gethomeapps-demo.vercel.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

## 3. Make yourself the superadmin (live site) — ✅ done 8 Oct 2026

The live site's one account is now a superadmin. The SQL below stays for
adding or changing superadmins later.

A superadmin can't be created in the app, on purpose: their details go
straight into the database. The superadmin sees and edits every project,
manages every account (project managers included) and reads the whole audit
log. Project managers now see only the projects they run.

1. <https://console.neon.tech> → the GetHomeApps project → **SQL Editor**.
   At the top, choose **Branch: production** (and database `neondb`).
2. **To make your own account the superadmin** (you already sign in with
   it), paste this with your sign-in email, then **Run**:

   ```sql
   update users set user_type = 'superadmin', disable_on = null, enable_on = null
    where lower(email) = lower('darrentay1993@gmail.com');
   ```

   It should say `UPDATE 1`. Sign out and in again (or refresh) and Account →
   Access reads "As Superadmin you can: …".
3. **To add someone new as a superadmin**, insert them, then send them to
   <https://homesapp-alpha.vercel.app/sign-up> to make their login with the
   same email. The account links itself by email on their first sign-in:

   ```sql
   insert into users (full_name, email, contact_no, user_type)
   values ('Their Name', 'their@email.com', '+65 9123 4567', 'superadmin');
   ```

4. **To turn a superadmin back into a project manager** (or switch one off):

   ```sql
   update users set user_type = 'project_manager' where lower(email) = lower('their@email.com');
   update users set active = false where lower(email) = lower('their@email.com');
   ```

These run as the database owner, so the app's own rules don't block them, and
each is still recorded in the audit log (as "Outside the app"). Keep at least
one superadmin: only a superadmin can create or change project managers.

Your existing projects keep their project manager. A project made before this
change with nobody set is visible only to a superadmin, who can hand it to a
manager with **Edit → Project manager**. Production has none, so this only
matters later.

## 4. Phone notifications on the live site (VAPID keys) — ✅ done 8 Oct 2026

A production pair is in Vercel (homesapp, Production; the private key is
marked Sensitive) and the live site was redeployed with it. Nothing more to
do. What follows is only for reference, e.g. a future second environment.

Without these, nobody gets phone notifications from the live site (alerts
still show inside the app).

**Easiest:** reply "set the VAPID keys" and I'll make a fresh pair and add
them to Vercel for you.

To do it yourself:
1. In a terminal in `web`, run `npm run vapid-keys`. It prints three lines.
2. <https://vercel.com> → **homesapp** → **Settings** → **Environment
   Variables**. Add each line for **Production**:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (tick **Sensitive**), and
   `VAPID_SUBJECT` (`https://homesapp-alpha.vercel.app`).
3. **Deployments** → the latest → **⋯ → Redeploy**.

Keep the pair. Replacing it later switches notifications off on every phone
until people turn them on again.

## 5. The 15-minute job (reminders, "running late", expiry dates) — ✅ done 8 Oct 2026

`CRON_SECRET` is in Vercel and GitHub, and `APP_URL` in GitHub. The first run
reached the live site and succeeded; it now runs every 15 minutes. What
follows is only for reference.

This sends "site visit in 1 hour" and "running late" alerts. It also
disables accounts on their expiry date even when nobody signs in.

**Easiest:** reply "set up the reminder job" and I'll make the secret, add it
to Vercel, and add both GitHub secrets.

To do it yourself:
1. Make a long random secret. In a terminal: `openssl rand -hex 32`, or any
   password generator, 40+ characters.
2. Vercel → **homesapp** → **Settings** → **Environment Variables** → add
   `CRON_SECRET` = that secret, for **Production**, ticked **Sensitive**.
   Then redeploy.
3. <https://github.com/darrentay9solar/homesapp> → **Settings** → **Secrets
   and variables** → **Actions** → **New repository secret**, twice:
   - `APP_URL` = `https://homesapp-alpha.vercel.app`
   - `CRON_SECRET` = the same secret as in Vercel.
4. **Actions** → **Visit reminders** → **Run workflow** to try it. It should
   finish green.

## 6. Email (Resend)

Used for invitations, approvals and decisions.

1. Sign up at <https://resend.com>.
2. **Domains** → **Add domain**, e.g. `9solarhome.com`. Add the DNS records
   it shows at your domain registrar, and wait until Resend says
   **Verified**.
3. **API Keys** → **Create API key** (Sending access).
4. Vercel → **homesapp** → Environment Variables (Production):
   - `RESEND_API_KEY` = the key (Sensitive)
   - `EMAIL_FROM` = e.g. `GetHomeApps <noreply@9solarhome.com>` (must be on
     the verified domain)
5. Redeploy.

## 7. WhatsApp (Meta)

Used for codes and messages. The full walk-through is in
[whatsapp.md](whatsapp.md). In short:

1. <https://business.facebook.com>: create or choose 9 Solar Home's Business
   account and verify the business.
2. <https://developers.facebook.com> → **My Apps** → **Create app** →
   **Business** → add **WhatsApp**.
3. Add and verify the business phone number. Note its **Phone number ID**.
4. **Business settings** → **System users** → add one, give it the app and
   the WhatsApp account, and **Generate token** (never expires, with
   `whatsapp_business_messaging`).
5. Create and submit the message templates listed in whatsapp.md, and wait
   for approval (usually minutes to a day).
6. Vercel (Production): `WHATSAPP_TOKEN` (Sensitive) and
   `WHATSAPP_PHONE_NUMBER_ID`. Redeploy.
7. *(For Chinese readers.)* For each template, **Add language → Chinese
   (CHN) `zh_CN`**, with the same name and the same `{{1}}`, `{{2}}`… in the
   same order, written in Chinese. People whose language is 简体中文 then get
   that version. Until Meta approves it they get the English one, so nothing
   is lost in the meantime.

## 8. SMS fallback (Twilio)

Used when WhatsApp can't deliver.

1. Sign up at <https://www.twilio.com>, upgrade the account (trial accounts
   only text verified numbers), and buy a number or set an alphanumeric
   sender ID that Singapore allows.
2. From the Console home, copy the **Account SID** and **Auth Token**.
3. Vercel (Production): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   (Sensitive), and `SMS_FROM` (the number or sender ID). Redeploy.

## 9. Clerk production keys (before real customers sign up)

The live site still uses Clerk's development keys. These show a "Development
mode" badge and have sign-up limits.

1. <https://dashboard.clerk.com> → your application → **Create production
   instance** (top bar).
2. It needs your own domain (step 10). Add the DNS records Clerk lists.
3. Under **Configure**, copy the settings from development: email + password
   sign-in, username off, and the same sign-in and sign-up URLs.
4. **API keys** → copy the production `pk_live_…` and `sk_live_…`.
5. Vercel → **homesapp** (not the demo) → Environment Variables
   (Production): replace `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `CLERK_SECRET_KEY`. Redeploy.
6. Sign up again on the live site with your own email; your project-manager
   account links to the new login by email automatically.

The demo keeps the development keys; that's what they're for.

## 10. Your own address (optional, but needed for step 9)

1. Vercel → **homesapp** → **Settings** → **Domains** → add e.g.
   `app.9solarhome.com`, and add the DNS record it shows.
2. Then update `APP_URL` (step 5, in GitHub too) and `VAPID_SUBJECT` (step 4)
   to it.
3. Cloudflare → R2 → **gethomeapps-prod** → Settings → CORS policy: add the
   new address to `AllowedOrigins`, or uploads from it are refused (see
   [r2.md](r2.md)).
4. Optional: the same for the demo, e.g. `demo.9solarhome.com` on the
   **gethomeapps-demo** project. Tell me, and I'll add it to step 2's
   uploads list and the demo's settings.

---

### What's already done (nothing for you to do)

- Production has every update and its database is up to date. It holds no
  test accounts or test projects: only your own login.
- The demo (gethomeapps-demo) deploys with every update. It has its sign-in
  keys, the dev photo bucket, the demo switch, its own phone-notification
  keys, and the dev database with sample people and a project at every
  stage, from Draft to Closed.
- Neither the demo nor production can ever turn the other's data into
  sample data. The demo needs its own switch *and* a marker that only the
  dev database has. Sample people can only be created by the seed script on
  the dev database.
