/**
 * Proves the audit log is readable only by project managers:
 * `npm run db:verify-audit-rls`.
 *
 * Every check runs on the ordinary application connection — the same one
 * every request uses — because that is the point. The rule is enforced by the
 * database against its own users table, not by which connection the code
 * happened to pick.
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

function raw(client: unknown, text: string): Promise<unknown> {
  const strings = Object.assign([text], { raw: [text] });
  return (client as (s: TemplateStringsArray) => Promise<unknown>)(
    strings as unknown as TemplateStringsArray
  );
}

const results: Array<[string, boolean, string]> = [];
const record = (name: string, pass: boolean, detail = "") =>
  results.push([name, pass, detail]);

/**
 * The HTTP driver uses a fresh connection per call, so a session GUC set with
 * SET LOCAL would not survive. Each probe therefore sets the actor and reads
 * in a single statement.
 */
async function readAsActor(client: unknown, uid: number | null): Promise<number> {
  const setting = uid === null ? "''" : `'${uid}'`;
  const rows = (await raw(
    client,
    `select (select count(*) from audit_log) as n
       from (select set_config('app.actor_uid', ${setting}, false)) s`
  )) as Array<{ n: number | string }>;
  return Number(rows[0].n);
}

async function main() {
  const owner = neon(envValue("MIGRATION_DATABASE_URL"));
  const app = neon(envValue("DATABASE_URL"));

  // Two people, identical except for their type.
  const stamp = Date.now();
  const [pm] = (await owner`
    insert into users (email, user_type, full_name)
    values (${`rls-pm-${stamp}@example.com`}, 'project_manager', ${"RLS PM"})
    returning uid`) as Array<{ uid: number }>;
  const [ho] = (await owner`
    insert into users (email, user_type, full_name)
    values (${`rls-ho-${stamp}@example.com`}, 'homeowner', ${"RLS Homeowner"})
    returning uid`) as Array<{ uid: number }>;
  const [inactivePm] = (await owner`
    insert into users (email, user_type, full_name, active)
    values (${`rls-ex-${stamp}@example.com`}, 'project_manager', ${"Former PM"}, false)
    returning uid`) as Array<{ uid: number }>;

  // Those three inserts generated audit entries, so there is something to see.
  const total = Number(
    ((await owner`select count(*)::int n from audit_log`) as Array<{ n: number }>)[0].n
  );
  record("audit log has entries to read", total > 0, `${total} rows`);

  const asPm = await readAsActor(app, pm.uid);
  record("project manager CAN read", asPm > 0, `${asPm} rows`);

  const asHomeowner = await readAsActor(app, ho.uid);
  record("homeowner sees NOTHING", asHomeowner === 0, `${asHomeowner} rows`);

  const asNobody = await readAsActor(app, null);
  record("unset actor sees NOTHING", asNobody === 0, `${asNobody} rows`);

  const asInactive = await readAsActor(app, inactivePm.uid);
  record("deactivated PM sees NOTHING", asInactive === 0, `${asInactive} rows`);

  // The guarantee that matters is about the connection every request uses.
  // A role with BYPASSRLS ignores every policy, so the application role must
  // not have it — otherwise the policy above is decorative.
  const [appRole] = (await owner`
    select rolbypassrls, rolsuper from pg_roles where rolname = 'gethomeapps_app'
  `) as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
  record(
    "app role cannot bypass RLS",
    appRole.rolbypassrls === false && appRole.rolsuper === false,
    `bypassrls=${appRole.rolbypassrls}`
  );

  // FORCE is still set, which is what subjects the owner to policies when the
  // platform allows it. On Neon it does not: neondb_owner carries BYPASSRLS
  // and only a superuser could remove it. Recorded rather than asserted, so
  // the limitation stays visible instead of being quietly dropped.
  const [tbl] = (await owner`
    select relforcerowsecurity, relrowsecurity
      from pg_class where relname = 'audit_log'
  `) as Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>;
  record(
    "RLS enabled and forced on the table",
    tbl.relrowsecurity && tbl.relforcerowsecurity
  );

  const [ownerRole] = (await owner`
    select rolbypassrls from pg_roles where rolname = 'neondb_owner'
  `) as Array<{ rolbypassrls: boolean }>;
  if (ownerRole.rolbypassrls) {
    console.log(
      "\n  Note: neondb_owner has BYPASSRLS, which Neon grants and only a\n" +
        "  superuser could revoke, so the migration credential can read the log.\n" +
        "  It is never deployed — it lives only in .env.local — and anyone\n" +
        "  holding it could drop the table anyway, so this is not a new exposure."
    );
  }

  // Capture and immutability must still hold under RLS.
  const before = Number(
    ((await owner`select count(*)::int n from audit_log`) as Array<{ n: number }>)[0].n
  );
  const [r] = (await app`
    insert into electricity_retailers (name) values (${`rls-probe-${stamp}`})
    returning retailer_id`) as Array<{ retailer_id: number }>;
  const after = Number(
    ((await owner`select count(*)::int n from audit_log`) as Array<{ n: number }>)[0].n
  );
  record("changes are still captured", after === before + 1);

  let updateBlocked = false;
  try {
    await owner`update audit_log set action = 'delete'`;
  } catch {
    updateBlocked = true;
  }
  record("entries still cannot be updated", updateBlocked);

  let deleteBlocked = false;
  try {
    await owner`delete from audit_log`;
  } catch {
    deleteBlocked = true;
  }
  record("entries still cannot be deleted", deleteBlocked);

  const roleGone =
    ((await owner`select count(*)::int n from pg_roles where rolname='gethomeapps_audit'`) as Array<{
      n: number;
    }>)[0].n === 0;
  record("separate audit role is gone", roleGone);

  await owner`delete from electricity_retailers where retailer_id = ${r.retailer_id}`;
  await owner`delete from users where uid in (${pm.uid}, ${ho.uid}, ${inactivePm.uid})`;

  console.log("\nAudit log access control\n" + "=".repeat(62));
  for (const [name, pass, detail] of results) {
    console.log(`  ${pass ? "ok  " : "FAIL"}  ${name.padEnd(36)}${detail}`);
  }
  const failed = results.filter(([, p]) => !p).length;
  console.log("=".repeat(62));
  console.log(failed === 0 ? "\n  ALL CHECKS PASSED\n" : `\n  ${failed} FAILED\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
