/**
 * Which migrations a branch has applied: `npm run db:status`.
 *
 * Compares the journal on disk with drizzle's own bookkeeping table, so an
 * interrupted `db:migrate` can be diagnosed before it is re-run. Read-only.
 * Defaults to development; pass --key=PROD_MIGRATION_DATABASE_URL for
 * production.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

function envValue(key: string): string | null {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  return process.env[key]?.trim() || null;
}

async function main() {
  const keyArg = process.argv.find((a) => a.startsWith("--key="));
  const key = keyArg ? keyArg.slice("--key=".length) : "MIGRATION_DATABASE_URL";
  const url = envValue(key);
  if (!url) throw new Error(`${key} is not set in .env.local.`);
  const sql = neon(url);

  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), "db/migrations/meta/_journal.json"), "utf8")
  ) as { entries: Array<{ idx: number; tag: string; when: number }> };

  const applied = (await sql`
    select created_at from drizzle.__drizzle_migrations order by created_at`) as Array<{
    created_at: string;
  }>;
  const appliedWhen = new Set(applied.map((r) => Number(r.created_at)));

  console.log(`\nMigrations — ${key}\n${"-".repeat(52)}`);
  for (const e of journal.entries) {
    console.log(`  ${appliedWhen.has(e.when) ? "applied" : "PENDING"}  ${e.tag}`);
  }
  console.log("-".repeat(52) + "\n");
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
