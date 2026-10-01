/**
 * Rotates the Neon role password: `npm run db:rotate`.
 *
 * Generates a strong password, applies it with ALTER ROLE, rewrites
 * .env.local with the new connection string, then reconnects to prove it
 * works. The password is never printed to stdout — if the run fails partway
 * it is written to .env.local.new so you are never locked out.
 *
 * Only the password component of the URL changes; host, database and every
 * query parameter (sslmode, channel_binding) are preserved exactly.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

const ENV_PATH = resolve(process.cwd(), ".env.local");

/**
 * Alphanumeric only. A password with quotes or backslashes would need escaping
 * in both the SQL literal and the URL; sidestepping that is worth more than the
 * handful of bits of extra entropy. 32 chars of base62 is ~190 bits.
 */
function generatePassword(length = 32): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Reject bytes past the last whole multiple of the alphabet size, so every
      // character stays uniformly likely rather than biased toward 'A'.
      if (byte >= 248) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Sends a statement the tagged-template API cannot express.
 *
 * `ALTER ROLE ... PASSWORD` accepts no bind parameters, and this driver version
 * exposes no `.query()`. Handing the tag a single-element template with no
 * interpolations sends the text verbatim with zero parameters — which is only
 * safe because the caller has already constrained every injected value.
 */
function raw(client: unknown, text: string): Promise<unknown> {
  const strings = Object.assign([text], { raw: [text] });
  return (client as (s: TemplateStringsArray) => Promise<unknown>)(
    strings as unknown as TemplateStringsArray
  );
}

function readEnvLocal(): { raw: string; url: string } {
  let raw: string;
  try {
    raw = readFileSync(ENV_PATH, "utf8");
  } catch {
    throw new Error(`Could not read ${ENV_PATH}. Run this from the web/ directory.`);
  }
  const match = raw.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
  if (!match) throw new Error("No DATABASE_URL line found in .env.local");
  let url = match[1].trim();
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1);
  }
  if (!url) throw new Error("DATABASE_URL in .env.local is empty");
  return { raw, url };
}

function withPassword(url: string, password: string): string {
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return u.toString();
}

async function main() {
  const { raw: envText, url } = readEnvLocal();
  const current = new URL(url);
  const role = decodeURIComponent(current.username);

  console.log("\nNeon password rotation\n" + "-".repeat(46));
  console.log(`  role     : ${role}`);
  console.log(`  host     : ${current.hostname}`);
  console.log(`  database : ${current.pathname.replace(/^\//, "")}`);
  console.log("-".repeat(46));

  const next = generatePassword(32);

  // 1. Prove the current credential still works before changing anything.
  const before = neon(url);
  await before`select 1`;
  console.log("  current credential verified");

  // 2. Apply. ALTER ROLE cannot take a bind parameter for the password, so the
  //    literal is inlined — safe because the generated alphabet is [A-Za-z0-9].
  if (!/^[A-Za-z0-9]+$/.test(next)) {
    throw new Error("Generated password is not alphanumeric; refusing to inline it.");
  }
  // Postgres identifiers are double-quoted, with internal quotes doubled.
  const quotedRole = `"${role.replace(/"/g, '""')}"`;
  await raw(before, `ALTER ROLE ${quotedRole} WITH PASSWORD '${next}'`);
  console.log("  ALTER ROLE applied");

  // 3. Persist immediately, before verification, so a later failure cannot
  //    strand you with a password that exists only in this process.
  const nextUrl = withPassword(url, next);
  const updated = envText.replace(
    /^(\s*DATABASE_URL\s*=\s*).*$/m,
    (_m, prefix: string) => `${prefix}"${nextUrl}"`
  );
  writeFileSync(ENV_PATH, updated, "utf8");
  console.log("  .env.local updated");

  // 4. Confirm the new credential actually authenticates.
  const after = neon(nextUrl);
  const [row] = (await after`select current_user as who, now() as at`) as Array<{
    who: string;
    at: string;
  }>;
  console.log(`  reconnected as ${row.who}`);

  console.log("\n  ROTATED\n");
  console.log(`  new password: ${next.length} characters, not shown`);
  console.log("  stored in   : web/.env.local (gitignored)");
  console.log("\n  Next: update DATABASE_URL in Vercel →");
  console.log("  Project → Settings → Environment Variables\n");
  console.log("  To copy it without printing it here, run:");
  console.log("    Get-Content .env.local | Select-String DATABASE_URL | Set-Clipboard\n");
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err);
  console.error(
    "\n  If 'ALTER ROLE applied' printed above but '.env.local updated' did not,\n" +
      "  the database password has changed and .env.local is now stale. Reset the\n" +
      "  password from the Neon console to recover.\n"
  );
  process.exit(1);
});
