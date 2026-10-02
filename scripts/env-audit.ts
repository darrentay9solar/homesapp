/**
 * Audits every connection string in .env.local: `npm run db:env`.
 *
 * Reports which role each one authenticates as and whether it can create
 * tables, so a privilege mistake is visible rather than theoretical. Prints
 * no passwords — only their length.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createHash } from "node:crypto";

import { neon } from "@neondatabase/serverless";

function raw(client: unknown, text: string): Promise<unknown> {
  const strings = Object.assign([text], { raw: [text] });
  return (client as (s: TemplateStringsArray) => Promise<unknown>)(
    strings as unknown as TemplateStringsArray
  );
}

async function main() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");

  const entries: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && m[2]) entries.push([m[1], m[2]]);
  }

  if (entries.length === 0) {
    console.log("\n  .env.local has no values set.\n");
    return;
  }

  console.log("\nEnvironment audit\n" + "=".repeat(72));

  for (const [key, value] of entries) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      console.log(`\n  ${key}\n    not a URL (${value.length} chars)`);
      continue;
    }

    const endpoint = url.hostname.split(".")[0];
    console.log(`\n  ${key}`);
    console.log(`    endpoint : ${endpoint}`);
    console.log(`    user     : ${url.username}`);
    console.log(`    database : ${url.pathname.replace(/^\//, "")}`);
    console.log(`    password : ${url.password.length} chars`);
    console.log(`    sslmode  : ${url.searchParams.get("sslmode") ?? "NOT SET"}`);
    console.log(`    pooled   : ${url.hostname.includes("-pooler") ? "yes" : "NO — see README"}`);
    console.log(`    branch#  : ${createHash("sha256").update(url.hostname).digest("hex").slice(0, 12)}`);

    try {
      const sql = neon(value);
      const rows = (await sql`select current_user as who`) as Array<{ who: string }>;

      let canCreate = false;
      try {
        await raw(sql, "CREATE TABLE _env_audit_probe (id int)");
        await raw(sql, "DROP TABLE _env_audit_probe");
        canCreate = true;
      } catch {
        /* expected for the restricted role */
      }

      console.log(`    connects : YES, as ${rows[0].who}`);
      console.log(`    can DDL  : ${canCreate ? "YES — schema owner" : "no — least privilege"}`);
    } catch (err) {
      console.log(
        `    connects : NO — ${err instanceof Error ? err.message.split("\n")[0] : err}`
      );
    }
  }

  // Branch separation only matters once a non-production branch exists.
  const hosts = new Set(
    entries
      .map(([, v]) => {
        try {
          return new URL(v).hostname;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[]
  );

  console.log("\n" + "=".repeat(72));
  console.log(`  distinct Neon endpoints: ${hosts.size}`);
  if (hosts.size === 1) {
    console.log("  note: every variable points at the same branch, so preview and");
    console.log("        production would share one database. Fine while it is empty.");
  }
  console.log();
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
