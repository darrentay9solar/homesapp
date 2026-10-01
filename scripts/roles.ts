/**
 * Lists the login roles and databases that actually exist, straight from
 * Postgres: `npm run db:roles`.
 *
 * Useful when the Neon console and the database appear to disagree — the
 * console groups roles under a branch, so they are easy to miss, but the
 * catalog never lies. Prints no credentials.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sql } from "../lib/db";

function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

loadEnvLocal();

async function main() {
  const db = sql();

  const roles = (await db`
    select rolname,
           rolsuper   as is_super,
           rolcreatedb as can_create_db,
           rolcreaterole as can_create_role,
           rolcanlogin as can_login
      from pg_roles
     where rolcanlogin = true
       and rolname not like 'pg\\_%'
     order by rolname
  `) as Array<{
    rolname: string;
    is_super: boolean;
    can_create_db: boolean;
    can_create_role: boolean;
    can_login: boolean;
  }>;

  const dbs = (await db`
    select datname, pg_get_userbyid(datdba) as owner
      from pg_database
     where datistemplate = false
     order by datname
  `) as Array<{ datname: string; owner: string }>;

  const [me] = (await db`select current_user as who`) as Array<{ who: string }>;

  console.log("\nLogin roles on this Neon branch\n" + "-".repeat(52));
  for (const r of roles) {
    const flags = [
      r.is_super ? "superuser" : null,
      r.can_create_db ? "createdb" : null,
      r.can_create_role ? "createrole" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const marker = r.rolname === me.who ? "  <-- you are connected as this" : "";
    console.log(`  ${r.rolname.padEnd(22)} ${flags || "no special privileges"}${marker}`);
  }

  console.log("\nDatabases\n" + "-".repeat(52));
  for (const d of dbs) {
    console.log(`  ${d.datname.padEnd(22)} owner: ${d.owner}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("\n  Failed:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
