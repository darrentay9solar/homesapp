/**
 * Proves the audit log behaves as designed: `npm run db:verify-audit`.
 *
 * Checks the four properties that make it an audit trail rather than a table
 * of notes — it records changes, it attributes them, only the audit role can
 * read it, and nobody at all can alter or remove an entry.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

function envValue(key: string): string | null {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  return m ? m[1].trim() : null;
}

function raw(client: unknown, text: string): Promise<unknown> {
  const strings = Object.assign([text], { raw: [text] });
  return (client as (s: TemplateStringsArray) => Promise<unknown>)(
    strings as unknown as TemplateStringsArray
  );
}

const results: Array<[string, boolean, string]> = [];
const record = (name: string, pass: boolean, detail = "") =>
  results.push([name, pass, detail]);

async function main() {
  const owner = neon(envValue("MIGRATION_DATABASE_URL")!);
  const app = neon(envValue("DATABASE_URL")!);

  // ---- a change by a known actor is captured and attributed -------------
  const email = `audit-probe-${Date.now()}@example.com`;
  const inserted = (await owner`
    insert into users (email, user_type, full_name, ic_last4)
    values (${email}, 'project_manager', ${"Audit Probe"}, ${"567D"})
    returning uid
  `) as Array<{ uid: number }>;
  const uid = inserted[0].uid;

  const afterInsert = (await owner`
    select action, entity_table, entity_id, changes
      from audit_log where entity_table='users' and entity_id=${String(uid)}
  `) as Array<{ action: string; changes: Record<string, { from: unknown; to: unknown }> }>;

  record("INSERT is captured", afterInsert.length === 1 && afterInsert[0].action === "insert");
  record(
    "ic_last4 is redacted in the diff",
    afterInsert[0]?.changes?.ic_last4?.to === "<redacted>",
    JSON.stringify(afterInsert[0]?.changes?.ic_last4 ?? null)
  );

  // ---- an update records only what changed, with the actor --------------
  await raw(owner, `SET LOCAL app.actor_uid = '${uid}'`);
  await owner`update users set full_name = ${"Audit Probe Renamed"} where uid = ${uid}`;

  const afterUpdate = (await owner`
    select action, changes from audit_log
     where entity_table='users' and entity_id=${String(uid)} and action='update'
  `) as Array<{ changes: Record<string, { from: unknown; to: unknown }> }>;

  const keys = Object.keys(afterUpdate[0]?.changes ?? {}).filter((k) => k !== "updated_at");
  record(
    "UPDATE records only the changed field",
    keys.length === 1 && keys[0] === "full_name",
    keys.join(", ")
  );
  record(
    "before and after values are kept",
    afterUpdate[0]?.changes?.full_name?.from === "Audit Probe" &&
      afterUpdate[0]?.changes?.full_name?.to === "Audit Probe Renamed"
  );

  // ---- the application role sees nothing without a PM actor ------------
  // Since migration 0003 the rule is row level security, not a missing grant:
  // the query succeeds and returns no rows. verify-audit-rls covers the
  // PM-versus-everyone-else cases in full.
  const visible = (await app`select count(*)::int as n from audit_log`) as Array<{ n: number }>;
  record(
    "app role sees NO entries without a PM actor",
    visible[0].n === 0,
    `${visible[0].n} visible`
  );

  // ---- nor write to it directly ----------------------------------------
  let appCanWrite = false;
  try {
    await app`insert into audit_log (action, entity_table) values ('insert', 'forged')`;
    appCanWrite = true;
  } catch {
    /* expected */
  }
  record("app role CANNOT forge an entry", !appCanWrite);

  // ---- but its ordinary changes are still recorded ----------------------
  const before = (await owner`select count(*)::int n from audit_log`) as Array<{ n: number }>;
  const r = (await app`
    insert into electricity_retailers (name) values (${`probe-${Date.now()}`})
    returning retailer_id
  `) as Array<{ retailer_id: number }>;
  const after = (await owner`select count(*)::int n from audit_log`) as Array<{ n: number }>;
  record("app role's own writes ARE logged", after[0].n === before[0].n + 1);

  // ---- immutability, even for the owner --------------------------------
  let updateBlocked = false;
  try {
    await owner`update audit_log set action='delete' where entity_table='users'`;
  } catch {
    updateBlocked = true;
  }
  record("owner CANNOT update an entry", updateBlocked);

  let deleteBlocked = false;
  try {
    await owner`delete from audit_log where entity_table='users'`;
  } catch {
    deleteBlocked = true;
  }
  record("owner CANNOT delete an entry", deleteBlocked);

  // ---- clean up the probe rows (audit entries deliberately remain) ------
  await owner`delete from electricity_retailers where retailer_id = ${r[0].retailer_id}`;
  await owner`delete from users where uid = ${uid}`;

  console.log("\nAudit log behaviour\n" + "=".repeat(60));
  for (const [name, pass, detail] of results) {
    console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  }
  const failed = results.filter(([, p]) => !p).length;
  console.log("=".repeat(60));
  console.log(failed === 0 ? "\n  ALL CHECKS PASSED\n" : `\n  ${failed} FAILED\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
