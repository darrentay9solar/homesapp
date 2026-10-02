/**
 * Creates the least-privilege runtime role: `npm run db:app-role`.
 *
 * The app currently connects as `neondb_owner`, which can drop every table and
 * create new roles. A leaked connection string would therefore be total
 * compromise rather than a contained one.
 *
 * After this runs there are two roles with two jobs:
 *
 *   neondb_owner      owns the schema, runs migrations   -> MIGRATION_DATABASE_URL
 *   gethomeapps_app   reads and writes rows, nothing else -> DATABASE_URL
 *
 * DEFAULT PRIVILEGES matter more than the grants: the schema is empty today, so
 * what counts is that tables created *later* by the owner are automatically
 * readable and writable by the app role without anyone remembering to re-grant.
 *
 * Idempotent — safe to run twice. Passwords are never printed.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const APP_ROLE = "gethomeapps_app";

function generatePassword(length = 32): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue; // reject, so every character stays equally likely
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

function raw(client: unknown, text: string): Promise<unknown> {
  const strings = Object.assign([text], { raw: [text] });
  return (client as (s: TemplateStringsArray) => Promise<unknown>)(
    strings as unknown as TemplateStringsArray
  );
}

function readEnv(): { text: string; url: string } {
  const text = readFileSync(ENV_PATH, "utf8");
  const match = text.match(/^\s*(?:MIGRATION_)?DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!match) throw new Error("No DATABASE_URL found in .env.local");
  return { text, url: match[1].trim() };
}

/** Rewrites or appends a key in a .env file without disturbing the rest. */
function upsert(text: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

async function main() {
  const { text, url } = readEnv();
  const owner = new URL(url);

  console.log("\nCreate least-privilege app role\n" + "-".repeat(48));
  console.log(`  host     : ${owner.hostname}`);
  console.log(`  database : ${owner.pathname.replace(/^\//, "")}`);
  console.log(`  as       : ${decodeURIComponent(owner.username)}`);
  console.log("-".repeat(48));

  const sql = neon(url);
  const password = generatePassword(32);
  if (!/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error("Generated password is not alphanumeric; refusing to inline it.");
  }

  const [{ exists }] = (await sql`
    select exists(select 1 from pg_roles where rolname = ${APP_ROLE}) as exists
  `) as Array<{ exists: boolean }>;

  if (exists) {
    await raw(sql, `ALTER ROLE "${APP_ROLE}" WITH LOGIN PASSWORD '${password}'`);
    console.log(`  role ${APP_ROLE} already existed — password reset`);
  } else {
    await raw(sql, `CREATE ROLE "${APP_ROLE}" WITH LOGIN PASSWORD '${password}'`);
    console.log(`  role ${APP_ROLE} created`);
  }

  const db = owner.pathname.replace(/^\//, "");
  const statements = [
    // Explicitly no CREATE on the schema: the app may not add or drop tables.
    `GRANT CONNECT ON DATABASE "${db}" TO "${APP_ROLE}"`,
    `GRANT USAGE ON SCHEMA public TO "${APP_ROLE}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${APP_ROLE}"`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${APP_ROLE}"`,
    // The important part: covers tables that do not exist yet.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${APP_ROLE}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${APP_ROLE}"`,
  ];
  for (const stmt of statements) await raw(sql, stmt);
  console.log("  grants and default privileges applied");

  // Prove the new role can connect and that it genuinely cannot create tables.
  const appUrl = (() => {
    const u = new URL(url);
    u.username = APP_ROLE;
    u.password = encodeURIComponent(password);
    return u.toString();
  })();

  const appSql = neon(appUrl);
  const [who] = (await appSql`select current_user as who`) as Array<{ who: string }>;
  console.log(`  connected as ${who.who}`);

  let blocked = false;
  try {
    await raw(appSql, "CREATE TABLE _privilege_probe (id int)");
    await raw(appSql, "DROP TABLE _privilege_probe");
  } catch {
    blocked = true;
  }
  console.log(
    blocked
      ? "  verified: app role CANNOT create tables"
      : "  WARNING: app role was able to create a table — check grants"
  );

  let updated = upsert(text, "MIGRATION_DATABASE_URL", url);
  updated = upsert(updated, "DATABASE_URL", appUrl);
  writeFileSync(ENV_PATH, updated, "utf8");

  console.log("\n  DONE\n");
  console.log("  .env.local now holds:");
  console.log(`    DATABASE_URL           -> ${APP_ROLE} (runtime, least privilege)`);
  console.log("    MIGRATION_DATABASE_URL -> neondb_owner (migrations only)");
  console.log("\n  Update DATABASE_URL in Vercel to the new value:");
  console.log("    (Get-Content .env.local | Select-String '^DATABASE_URL') -replace");
  console.log("      '^DATABASE_URL=\"?|\"?$' | Set-Clipboard\n");
  console.log("  Keep MIGRATION_DATABASE_URL out of Vercel — migrations run from CI or locally.\n");
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
