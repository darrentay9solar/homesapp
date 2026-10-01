/**
 * Terminal version of the health check: `npm run db:check`.
 *
 * Useful because it tells you whether Neon is reachable without starting Next,
 * and because it never prints the credential — only its shape, so a wrong-looking
 * connection string can be diagnosed without anyone pasting a secret anywhere.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkDatabase } from "../lib/db";

/**
 * Next loads .env.local on its own; a standalone script does not. Parsed here
 * rather than pulling in dotenv for one variable. Real environment variables
 * win, so `DATABASE_URL=... npm run db:check` still overrides the file.
 */
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

/** Describes the URL without revealing the password. */
function describeUrl(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return ["DATABASE_URL: not set"];
  const notes: string[] = [];
  try {
    const u = new URL(raw);
    notes.push(`protocol  : ${u.protocol.replace(":", "")}`);
    notes.push(`host      : ${u.hostname}`);
    notes.push(`database  : ${u.pathname.replace(/^\//, "") || "(none)"}`);
    notes.push(`user      : ${u.username || "(none)"}`);
    notes.push(`password  : ${u.password ? `set (${u.password.length} chars)` : "MISSING"}`);
    notes.push(`sslmode   : ${u.searchParams.get("sslmode") ?? "not specified"}`);
    notes.push(`pooled    : ${u.hostname.includes("-pooler") ? "yes" : "no — see note below"}`);
  } catch {
    notes.push("DATABASE_URL is set but is not a valid URL.");
  }
  return notes;
}

async function main() {
  console.log("\nNeon connection check\n" + "-".repeat(40));
  for (const line of describeUrl(process.env.DATABASE_URL)) console.log("  " + line);

  const result = await checkDatabase();
  console.log("-".repeat(40));

  if (!result.ok) {
    console.error("\n  FAILED\n");
    console.error("  " + result.error);
    console.error("\n  " + result.hint + "\n");
    process.exit(1);
  }

  console.log("\n  CONNECTED\n");
  console.log(`  ${result.version}`);
  console.log(`  database   : ${result.database}`);
  console.log(`  user       : ${result.user}`);
  console.log(`  server time: ${result.serverTime}`);
  console.log(`  round trip : ${result.latencyMs} ms`);
  console.log(
    `  tables     : ${result.tables.length ? result.tables.join(", ") : "none yet (empty database)"}`
  );
  console.log(
    "\n  Note: a non-pooled host works locally but can exhaust connections on\n" +
      "  Vercel. Prefer the '-pooler' string from the Neon dashboard.\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
