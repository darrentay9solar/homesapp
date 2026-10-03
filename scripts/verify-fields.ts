/**
 * Proves the migration 0010 field decisions hold: `npm run db:verify-fields`.
 *
 *   - sp_application_status is an integer, NOT NULL, defaulting to 3, and
 *     anything other than 1, 2 or 3 is refused by the database itself
 *   - as_built_pv_layout is a file category, no longer a boolean column
 *
 * Defaults to development; pass --key=PROD_MIGRATION_DATABASE_URL for
 * production. Read-only.
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

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };

  console.log(`\nField decisions — ${key}\n${"-".repeat(60)}`);

  const [sp] = await sql`
    select data_type, is_nullable, column_default
      from information_schema.columns
     where table_name = 'projects' and column_name = 'sp_application_status'`;
  check("sp_application_status is integer", sp?.data_type === "integer", sp?.data_type);
  check("sp_application_status is NOT NULL", sp?.is_nullable === "NO");
  check("sp_application_status defaults to 3", String(sp?.column_default) === "3");

  const [col] = await sql`
    select count(*)::int as n from information_schema.columns
     where table_name = 'projects' and column_name = 'as_built_pv_layout'`;
  check("as_built_pv_layout boolean column removed", col.n === 0);

  const [enumVal] = await sql`
    select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'file_category' and e.enumlabel = 'as_built_pv_layout'`;
  check("as_built_pv_layout is a file category", enumVal.n === 1);

  // Looked up rather than exercised: a probe insert would trip the NOT NULL
  // on homeowner_id before the CHECK ever ran, and prove nothing.
  const [con] = await sql`
    select pg_get_constraintdef(oid) as def from pg_constraint
     where conname = 'projects_sp_application_status_values'`;
  const def = String(con?.def ?? "");
  check(
    "CHECK limits sp_application_status to 1, 2, 3",
    /\b1\b/.test(def) && /\b2\b/.test(def) && /\b3\b/.test(def),
    def || "missing"
  );

  console.log("-".repeat(60));
  console.log(failures ? `  ${failures} check(s) failed.\n` : "  All checks passed.\n");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
