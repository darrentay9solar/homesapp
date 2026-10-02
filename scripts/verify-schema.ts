/**
 * Proves the migration landed and the privilege split still holds:
 * `npm run db:verify`.
 *
 * The interesting case is the app role. ALTER DEFAULT PRIVILEGES was set
 * before these tables existed; this confirms it actually covered them, so
 * nobody has to remember to re-grant after every migration.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

function envValue(key: string): string | null {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
      if (m) return m[1].trim();
    } catch {
      /* ignore */
    }
  }
  return process.env[key]?.trim() || null;
}

function raw(client: unknown, text: string): Promise<unknown> {
  const strings = Object.assign([text], { raw: [text] });
  return (client as (s: TemplateStringsArray) => Promise<unknown>)(
    strings as unknown as TemplateStringsArray
  );
}

async function main() {
  const appUrl = envValue("DATABASE_URL");
  if (!appUrl) throw new Error("DATABASE_URL is not set");
  const app = neon(appUrl);

  const tables = (await app`
    select table_name,
           (select count(*) from information_schema.columns c
             where c.table_name = t.table_name and c.table_schema = 'public') as columns
      from information_schema.tables t
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `) as Array<{ table_name: string; columns: string }>;

  console.log("\nTables on this branch\n" + "-".repeat(52));
  for (const t of tables) {
    console.log(`  ${t.table_name.padEnd(28)} ${t.columns} columns`);
  }

  const enums = (await app`
    select t.typname, count(e.enumlabel) as values
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     group by t.typname
     order by t.typname
  `) as Array<{ typname: string; values: string }>;

  console.log("\nEnums\n" + "-".repeat(52));
  for (const e of enums) console.log(`  ${e.typname.padEnd(28)} ${e.values} values`);

  console.log("\nApp-role privileges on the new tables\n" + "-".repeat(52));

  // Read: should succeed on every table.
  let reads = 0;
  for (const t of tables) {
    try {
      await raw(app, `select 1 from "${t.table_name}" limit 1`);
      reads++;
    } catch (err) {
      console.log(`  CANNOT READ ${t.table_name}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  console.log(`  readable                     ${reads}/${tables.length}`);

  // Write: round-trips a row, then removes it.
  let canWrite = false;
  try {
    const inserted = (await app`
      insert into electricity_retailers (name)
      values (${"__verify_probe__"})
      returning retailer_id
    `) as Array<{ retailer_id: number }>;
    await app`delete from electricity_retailers where retailer_id = ${inserted[0].retailer_id}`;
    canWrite = true;
  } catch (err) {
    console.log(`  write failed: ${(err as Error).message.split("\n")[0]}`);
  }
  console.log(`  can insert/delete rows       ${canWrite ? "yes" : "NO"}`);

  // DDL: must fail. This is the guarantee, not a nicety.
  let blockedDdl = false;
  try {
    await raw(app, "create table _verify_probe (id int)");
    await raw(app, "drop table _verify_probe");
  } catch {
    blockedDdl = true;
  }
  console.log(`  blocked from CREATE TABLE    ${blockedDdl ? "yes" : "NO — check grants"}`);

  let blockedDrop = false;
  try {
    await raw(app, "drop table projects");
  } catch {
    blockedDrop = true;
  }
  console.log(`  blocked from DROP TABLE      ${blockedDrop ? "yes" : "NO — check grants"}`);

  const ok = reads === tables.length && canWrite && blockedDdl && blockedDrop;
  console.log("\n  " + (ok ? "ALL CHECKS PASSED" : "SOMETHING IS WRONG — see above") + "\n");
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
