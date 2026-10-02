import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "drizzle-kit";

/**
 * Migrations run as the schema owner, never as the app role — the whole point
 * of the two-role split is that the running app cannot alter the schema.
 *
 * MIGRATION_DATABASE_URL points at the development branch by default. To touch
 * production you must name it:
 *   npm run db:migrate -- --key=PROD_MIGRATION_DATABASE_URL
 */
function envValue(key: string): string {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      const match = text.match(new RegExp(`^\s*${key}\s*=\s*"?([^"\n]+)"?`, "m"));
      if (match) return match[1].trim();
    } catch {
      /* file may not exist in CI */
    }
  }
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  throw new Error(`${key} is not set. See .env.example.`);
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: envValue("MIGRATION_DATABASE_URL") },
  strict: true,
  verbose: true,
});
