/**
 * Proves the database itself refuses a full NRIC: `npm run db:verify-nric`.
 *
 * The PDPA restriction is on *collecting* the full number, so the guarantee
 * has to live where it cannot be bypassed. Validation in a form can be skipped
 * by a seed script, a CSV import or a direct query; a check constraint cannot.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

function envValue(key: string): string {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  if (!m) throw new Error(`${key} is not set`);
  return m[1].trim();
}

const cases: Array<{ value: string | null; label: string; shouldPass: boolean }> = [
  { value: "567D", label: "last 4, uppercase letter", shouldPass: true },
  { value: "123a", label: "last 4, lowercase letter", shouldPass: true },
  { value: null, label: "null (not yet recorded)", shouldPass: true },
  { value: "S1234567D", label: "FULL NRIC", shouldPass: false },
  { value: "1234567D", label: "NRIC without prefix", shouldPass: false },
  { value: "567", label: "digits only, no letter", shouldPass: false },
  { value: "SS7D", label: "letters where digits belong", shouldPass: false },
  { value: "", label: "empty string", shouldPass: false },
];

async function main() {
  const sql = neon(envValue("TEST_MIGRATION_DATABASE_URL"));
  console.log("\nNRIC storage constraint\n" + "=".repeat(54));

  let failures = 0;

  for (const { value, label, shouldPass } of cases) {
    let accepted = false;
    let message = "";
    try {
      const inserted = (await sql`
        insert into users (email, user_type, ic_last4)
        values (${`nric-probe-${Date.now()}-${Math.random()}@example.com`}, 'homeowner', ${value})
        returning uid
      `) as Array<{ uid: number }>;
      accepted = true;
      await sql`delete from users where uid = ${inserted[0].uid}`;
    } catch (err) {
      message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    }

    const correct = accepted === shouldPass;
    if (!correct) failures++;
    const shown = value === null ? "null" : `"${value}"`;
    console.log(
      `  ${correct ? "ok  " : "FAIL"}  ${shown.padEnd(13)} ${label.padEnd(28)} ` +
        `${accepted ? "accepted" : "rejected"}${!correct && message ? ` (${message})` : ""}`
    );
  }

  console.log("=".repeat(54));
  console.log(
    failures === 0
      ? "\n  A full NRIC cannot be stored, by construction.\n"
      : `\n  ${failures} case(s) behaved unexpectedly.\n`
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
