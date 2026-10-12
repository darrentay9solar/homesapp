# Backups: keeping the data safe

Four layers, from the smallest mistake to the worst day.

| What went wrong | What puts it back |
|---|---|
| Someone changed or deleted something by mistake | **The audit log** (Audit page): revert a change, restore a deleted file, visit or group. |
| A bug wrote bad data a few hours ago | **Neon's instant restore**: rewind the whole database to a minute in the past (Neon console → your project → Restore). How far back depends on the Neon plan; check Settings → *History retention* and keep it at 7 days or more. |
| A database update (migration) went wrong | **The restore point** taken automatically just before every production migration. |
| Anything else, or Neon itself | **The nightly backup**: every row, every night, kept 30 days, encrypted. |

## The restore point before every production migration

`npm run db:migrate -- --key=PROD_MIGRATION_DATABASE_URL --confirm` now backs
up production first (into `backups/` on the laptop that runs it) and won't
migrate if that fails. The file is named like
`backups/gethomeapps-prod-20261012-173000.tar.gz`.

## The nightly backup

`.github/workflows/backup.yml` runs at 02:00 Singapore time. It connects as
`gethomeapps_backup`, a login that can read every row and write nothing, and
keeps the encrypted file for 30 days as a private artifact of the GitHub
repository (Actions → *Nightly backup* → a run → *Artifacts*).

Turning it on (once, after the code is on `main`, because GitHub only runs
scheduled jobs from the main branch):

```bash
python scripts/create_backup_role.py --target prod --github
```

That creates the read-only login, saves it in `.env.local` and in the
repository's secrets, and makes a passphrase (`BACKUP_PASSPHRASE` in
`.env.local`). **Put the passphrase in your password manager**: without it
the backups can't be opened. Then run the job once by hand (Actions →
Nightly backup → Run workflow) to see it succeed.

## Taking a backup by hand

```bash
npm run db:backup -- --target prod
```

## Opening a nightly backup

Download the artifact, unzip it, then (Git Bash on Windows has `openssl`):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in gethomeapps-prod-….tar.gz.enc -out gethomeapps-prod.tar.gz -pass env:BACKUP_PASSPHRASE
```

Inside: one CSV per table (opens in Excel) and `manifest.json` (when it was
taken, the migrations the database had, each table's rows and checksum).

## Restoring

Always look first; nothing is written without `--apply`:

```bash
npm run db:restore -- backups/gethomeapps-prod-….tar.gz --target dev
```

It lists each table's rows now and in the backup. With `--apply` it first
backs up what it's about to replace (so a restore can be undone too), then
loads the backup in one transaction, ids and counters included; if anything
fails, nothing changes. The database must have the same migrations as the
backup. Production also needs `--confirm-restore-production`.

The safest way to recover production: restore into the **dev** database (or
a new Neon branch), check it in the demo or staging site, then restore
production.

Tested on 12 Oct 2026: the test database was backed up, damaged, restored,
and backed up again; every table's checksum and every counter matched.

## Not covered yet

Photos and documents in Cloudflare R2 are not copied anywhere. The database
keeps every file's record, and files taken off a project stay in R2
(restorable from the audit log), but a deleted bucket or a wrong key would
lose them. A nightly copy to a second bucket is the next step.
