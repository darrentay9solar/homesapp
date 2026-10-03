/**
 * Creates (or promotes) a project manager: `npm run db:bootstrap-pm -- --email=you@example.com --name="Your Name"`.
 *
 * The app can only create accounts on behalf of an existing project manager,
 * so the first one has to come from outside it. This runs on the owner
 * connection, which the database's account guards exempt for exactly this.
 *
 * Then sign in (or sign up) with that same email: the account links to the
 * login automatically, because the email is verified by Clerk.
 *
 * Development by default. Production needs both flags:
 *   npm run db:bootstrap-pm -- --email=... --name="..." --prod --confirm
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

function envValue(key: string): string {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  if (!m) throw new Error(`${key} is not set in .env.local`);
  return m[1].trim();
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  const prod = process.argv.includes("--prod");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Pass --email=you@example.com (and --name="Your Name").');
  }
  if (prod && !process.argv.includes("--confirm")) {
    throw new Error("Refusing to change production without --confirm.");
  }

  const sql = neon(envValue(prod ? "PROD_MIGRATION_DATABASE_URL" : "MIGRATION_DATABASE_URL"));

  const existing = (await sql`select uid, user_type, active from users where lower(email) = ${email}`) as Array<{
    uid: number;
    user_type: string;
    active: boolean;
  }>;

  let uid: number;
  if (existing.length) {
    uid = existing[0].uid;
    await sql`
      update users set user_type = 'project_manager', active = true,
                       full_name = coalesce(${name}, full_name), updated_at = now()
       where uid = ${uid}`;
    console.log(`\n  Promoted existing user #${uid} (${existing[0].user_type}) to project manager.`);
  } else {
    const [row] = (await sql`
      insert into users (email, user_type, full_name)
      values (${email}, 'project_manager', ${name}) returning uid`) as Array<{ uid: number }>;
    uid = row.uid;
    console.log(`\n  Created project manager #${uid}.`);
  }

  console.log(`  Target  : ${prod ? "PRODUCTION" : "development"}`);
  console.log(`  Email   : ${email}`);
  console.log("  Next    : sign in with this email — the account links on first visit.\n");
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
