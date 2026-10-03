# GetHomeApps

Rooftop solar installation tracking for **9 Solar Home** — Next.js on Vercel,
Postgres on Neon.

Right now this repository contains the **deployment health check** only. It
proves the GitHub → Vercel → Neon chain works before the real application is
built on top of it.

- Production: https://homesapp-alpha.vercel.app
- Health JSON: https://homesapp-alpha.vercel.app/api/health

## Running locally

```bash
npm install
cp .env.example .env.local   # then paste your Neon connection strings
npm run dev
```

Open http://localhost:3000. The page reports three checks: the Vercel runtime,
Git commit metadata, and Neon connectivity.

## Environment

| Variable | Branch | Used by | Set where |
| --- | --- | --- | --- |
| `DATABASE_URL` | development | local dev, Vercel Preview | `.env.local`, Vercel (Preview + Development) |
| `MIGRATION_DATABASE_URL` | development | migrations | `.env.local` — **never Vercel** |
| `PROD_DATABASE_URL` | production | reference | Vercel (Production) holds this value |
| `PROD_MIGRATION_DATABASE_URL` | production | production migrations | `.env.local` — **never Vercel** |

All are Neon **pooled** connection strings (host contains `-pooler`). The
non-pooled host works locally but exhausts connections on serverless functions.

### Two branches, and why the default is the safe one

Neon branches the database like git branches code. `development` is a
copy-on-write branch of `production`.

The unprefixed variables point at **development**, deliberately. `npm run dev`,
and any migration run without arguments, therefore hit a database you can
afford to break. Production has to be named explicitly:

```bash
npm run db:app-role -- --key=PROD_MIGRATION_DATABASE_URL
```

`npm run db:env` reports every connection string in `.env.local` — which role
it authenticates as, and whether it can create tables. Run it whenever you are
unsure what you are pointed at. It prints no passwords.

Without this split, a preview deployment testing "delete project" would delete
real projects, and a schema change on a feature branch would alter production
tables.

### Two roles, deliberately

| Role | Can | Used for |
| --- | --- | --- |
| `gethomeapps_app` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | every request the app serves |
| `neondb_owner` | owns the schema, creates and drops tables | migrations only |

The app cannot create or drop tables. If its connection string leaks, the blast
radius is the data, not the schema. `ALTER DEFAULT PRIVILEGES` is already set,
so tables created later by migrations are automatically usable by the app role
with no further grants.

Recreate or rotate the app role with `npm run db:app-role`.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | local dev server |
| `npm run build` | production build — must pass with no database available |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:check` | Neon connectivity, with the common failures decoded |
| `npm run db:env` | audits every connection string: role, privileges, branch |
| `npm run db:roles` | lists roles and databases that actually exist |
| `npm run db:rotate` | rotates the password in `MIGRATION_DATABASE_URL`'s role |
| `npm run db:app-role` | creates/rotates the least-privilege runtime role |
| `npm run db:status` | which migrations a branch has applied |
| `npm run db:bootstrap-pm -- --email=… --name="…"` | creates the first project manager (add `--prod --confirm` for production) |
| `npm run db:verify-accounts` | proves only PMs can create/approve accounts |
| `npm run db:verify-geofence` | proves the 100 m check-in fence, including tamper cases |
| `npm run db:verify-fields` | checks the SP status / As Built PV Layout field decisions |

## Accounts

Only a project manager can create an account (`/admin/users`); the database
refuses anyone else, whatever the app does. People can also sign up through
Clerk themselves: they land on `/onboarding`, ask for a role, and wait until a
PM approves. Signing in to Clerk alone grants nothing.

The very first PM has to come from outside the app — `npm run db:bootstrap-pm`.

Setup guides: [file storage (R2)](docs/r2.md) ·
[email and WhatsApp](docs/whatsapp.md).

None of these print a password. `db:check` reports the connection string's
*shape* — host, database, user, sslmode, password length — so a broken string
can be diagnosed without anyone pasting a credential anywhere.

## Deployment

Pushing to `main` deploys to production. CI runs typecheck, lint, `npm audit`
and a build on every push and pull request.

`vercel.json` pins functions to **`sin1` (Singapore)**. This is not cosmetic:
the database is in Singapore, and running functions in the US made every query
cross the Pacific twice — 1337 ms versus 22 ms. Leave the region alone.

The build must never require a database. A Neon outage should not become a
deploy outage, which is why CI builds with no `DATABASE_URL` set.

## Node

`.nvmrc` pins **24**, matching Vercel's runtime. `engines` allows >= 20.11 so
older local installs still work, but CI and production both run 24 — prefer to
match it.

## Conventions

- `.env.local` is gitignored and must never be committed. Secret scanning push
  protection is the backstop; don't rely on it.
- Dependabot opens grouped dependency PRs weekly. Security advisories arrive
  separately and should be merged promptly — Vercel refuses to deploy Next.js
  versions with known CVEs, so a stale dependency becomes a release blocker.
