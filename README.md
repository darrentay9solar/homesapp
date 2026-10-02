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

| Variable | Used by | Set where |
| --- | --- | --- |
| `DATABASE_URL` | the running app | `.env.local` and Vercel |
| `MIGRATION_DATABASE_URL` | migrations only | `.env.local` and CI — **never Vercel** |

Both are Neon **pooled** connection strings (host contains `-pooler`). The
non-pooled host works locally but exhausts connections on serverless functions.

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
| `npm run db:roles` | lists roles and databases that actually exist |
| `npm run db:rotate` | rotates the password in `MIGRATION_DATABASE_URL`'s role |
| `npm run db:app-role` | creates/rotates the least-privilege runtime role |

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
