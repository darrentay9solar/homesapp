/**
 * Applies pending migrations: `npm run db:migrate`.
 *
 * Runs against the DEVELOPMENT branch by default. Production must be named:
 *   npm run db:migrate -- --key=PROD_MIGRATION_DATABASE_URL --confirm
 *
 * Both flags are required for production, and neither has a default. "I ran
 * that against the wrong database" should take two deliberate acts, not one
 * forgotten argument.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

function envValue(key: string): string | null {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
      if (match) return match[1].trim();
    } catch {
      /* not present is fine */
    }
  }
  return process.env[key]?.trim() || null;
}

async function main() {
  const keyArg = process.argv.find((a) => a.startsWith("--key="));
  const key = keyArg ? keyArg.slice("--key=".length) : "MIGRATION_DATABASE_URL";
  const targetsProduction = key.startsWith("PROD_");

  if (targetsProduction && !process.argv.includes("--confirm")) {
    throw new Error(
      "Refusing to migrate production without --confirm.\n" +
        "  Migrations alter the schema your live site depends on. Run it against\n" +
        "  the development branch first, verify, then repeat here with --confirm."
    );
  }

  const url = envValue(key);
  if (!url) throw new Error(`${key} is not set in .env.local. See .env.example.`);

  const parsed = new URL(url);
  if (parsed.username !== "neondb_owner") {
    throw new Error(
      `${key} connects as "${parsed.username}", which cannot alter the schema.\n` +
        "  Migrations need the owner; the app role deliberately cannot do this."
    );
  }

  console.log("\nApplying migrations\n" + "-".repeat(52));
  console.log(`  source   : ${key}`);
  console.log(`  endpoint : ${parsed.hostname.split(".")[0]}`);
  console.log(`  as       : ${parsed.username}`);
  console.log(`  target   : ${targetsProduction ? "PRODUCTION" : "development"}`);
  console.log("-".repeat(52));

  const db = drizzle(neon(url));
  await migrate(db, { migrationsFolder: "./db/migrations" });

  console.log("\n  Migrations applied.\n");
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
