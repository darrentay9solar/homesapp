# Two companies, one codebase

One codebase runs two separate sites. Each company has its own database, sign-in, file store, domain,
schedule and FusionSolar account, so projects, customers, invoices and data never mix. Every change is
tested once and released to both.

| | 9 Solar Home | 9 Solar Fintech |
|---|---|---|
| App name | GetHomeApps | GetApps |
| Setting (hosting) | `NEXT_PUBLIC_EDITION` and `EDITION` unset (or `home`) | both `fintech` |
| Homeowners | Yes | No: the role can't be given or asked for |
| Site check-in, crew locations | Yes | No: no check-in, no Sites page, no Map, no "running late" alerts |
| Maintenance | Yes | No: not in the menu; its pages say so; no maintenance reminders |
| Role names | Project Manager, EPC Team | HQ Staff, EPC Project Manager |
| Project workflow | As built | To be redesigned (the owner's spec to follow) |
| FusionSolar | 9 Solar Home's API account | Its own API account (to follow) |

How it works: `lib/client/edition.ts` (screens) and `api/_lib/edition.py` (server) read the setting.
Names are swapped where text is shown (after translation), in both English and Chinese, so the
translations stay as they are. Features are switched off on the server (refused) and on screen (hidden).

## Setting up 9 Solar Fintech's site

The owner creates the accounts (steps 1 to 4 and 6 to 8); the developer runs the database steps (5).
Connection strings and keys go into `.env.local` or Vercel directly, never into chat.

1. **Database (Neon).** console.neon.tech → New project → name `getapps`, region Singapore
   (AWS ap-southeast-1). Copy the **owner** connection string (role `neondb_owner`) into `.env.local`
   as `PROD_GETAPPS_MIGRATION_DATABASE_URL`.
2. **Sign-in (Clerk).** dashboard.clerk.com → Create application → name `GetApps`, email and password
   sign-in. Its own users, separate from 9 Solar Home's. Copy its publishable and secret keys for step 6.
   (Production keys come with the domain, as for 9 Solar Home: YOUR_STEPS.md step 9.)
3. **File store (Cloudflare R2).** A new bucket, e.g. `getapps-prod`, with its own API token (Object
   Read & Write, that bucket only), and the CORS rule from r2.md with the new site's address.
4. **Domain (optional now).** e.g. `app.9solarfintech.com`; the site works on its `vercel.app`
   address until then.
5. **Developer, on the new database:**
   1. `npm run db:migrate -- --key=PROD_GETAPPS_MIGRATION_DATABASE_URL --confirm` (the whole schema).
   2. The app's limited login and the backup login (`scripts/create-app-role.ts`,
      `scripts/create_backup_role.py`), pointed at the new database.
   3. `node scripts/py.mjs scripts/new_edition.py --target PROD_GETAPPS_MIGRATION_DATABASE_URL
      --person darrentay@9solarfintech.com --company "9 Solar Fintech" --confirm`: the one superadmin,
      with their details from 9 Solar Home's app, and the invoice company name. It refuses any
      database that already has accounts.
6. **Hosting (Vercel).** New Project → import the same GitHub repository → name `getapps`, production
   branch `main`. Environment variables (Production), Sensitive where they're keys:
   - `NEXT_PUBLIC_EDITION` = `fintech` and `EDITION` = `fintech`
   - `DATABASE_URL`: the new database's limited app login (from step 5.2)
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: from step 2
   - the R2 settings from step 3 (the same names as 9 Solar Home's, with the new bucket's values)
   - `CRON_SECRET`: a new one (YOUR_STEPS.md step 5's command); `APP_URL`: the new site's address
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: a new pair (YOUR_STEPS.md step 4)
   - no `FUSIONSOLAR_*` yet: the site runs without FusionSolar until its account is given
   Then Deploy.
7. **Schedule.** A second cron-job.org job, the same as 9 Solar Home's, to the new site's
   `/api/py/cron/visit-reminders` with the new `CRON_SECRET`.
8. **First sign-in.** Sign up on the new site with darrentay@9solarfintech.com; the account links
   itself by email and is the superadmin. Add everyone else from People.

Later: the FusionSolar API account (`FUSIONSOLAR_URL`, `FUSIONSOLAR_USER`, `FUSIONSOLAR_PASSWORD` in
the new site's Vercel), the project workflow, email and WhatsApp, the nightly backup of the new
database, and a "Switch company" link for people in both.
