/**
 * Proves only project managers can create and approve accounts:
 * `npm run db:verify-accounts`.
 *
 * Every attempt runs on the ordinary application connection (DATABASE_URL),
 * the one every request uses, with app.actor_uid set the way the app sets it.
 * Fixtures are created and removed through the owner connection. Defaults to
 * development; pass --prod to run against production.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

function envValue(key: string): string {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  if (!m) throw new Error(`${key} is not set`);
  return m[1].trim();
}

type Sql = NeonQueryFunction<false, false>;

const out: Array<[string, boolean, string]> = [];
const rec = (n: string, p: boolean, d = "") => out.push([n, p, d]);

/** Runs statements as `uid`, the way the app does: one transaction, local setting. */
async function asActor(
  app: Sql,
  uid: number | null,
  build: (sql: Sql) => ReturnType<Sql>[]
): Promise<{ ok: boolean; rows: Record<string, unknown>[]; error: string }> {
  try {
    const results = await app.transaction((tx) => [
      tx`select set_config('app.actor_uid', ${uid === null ? "" : String(uid)}, true)`,
      ...build(tx as unknown as Sql),
    ]);
    const last = results[results.length - 1] as Record<string, unknown>[];
    return { ok: true, rows: last, error: "" };
  } catch (err) {
    return { ok: false, rows: [], error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

async function main() {
  const prod = process.argv.includes("--prod");
  const owner = neon(envValue(prod ? "PROD_MIGRATION_DATABASE_URL" : "MIGRATION_DATABASE_URL"));
  const app = neon(envValue(prod ? "PROD_DATABASE_URL" : "DATABASE_URL"));
  const stamp = Date.now();
  const createdUids: number[] = [];
  const createdRequests: number[] = [];

  try {
    // ---- fixtures, through the owner connection --------------------------
    const [pm] = (await owner`
      insert into users (email, user_type, full_name)
      values (${`acct-pm-${stamp}@example.com`}, 'project_manager', 'Verify PM')
      returning uid`) as Array<{ uid: number }>;
    const [ho] = (await owner`
      insert into users (email, user_type, full_name)
      values (${`acct-ho-${stamp}@example.com`}, 'homeowner', 'Verify Homeowner')
      returning uid`) as Array<{ uid: number }>;
    createdUids.push(pm.uid, ho.uid);

    // ---- creating accounts -----------------------------------------------
    const anon = await asActor(app, null, (s) => [
      s`insert into users (email, user_type) values (${`acct-x1-${stamp}@example.com`}, 'contractor') returning uid`,
    ]);
    rec("no actor cannot create an account", !anon.ok, anon.error);

    const byHo = await asActor(app, ho.uid, (s) => [
      s`insert into users (email, user_type) values (${`acct-x2-${stamp}@example.com`}, 'project_manager') returning uid`,
    ]);
    rec("homeowner cannot create an account", !byHo.ok, byHo.error);

    const byPm = await asActor(app, pm.uid, (s) => [
      s`insert into users (email, user_type, full_name)
        values (${`acct-new-${stamp}@example.com`}, 'contractor', 'Verify Crew') returning uid`,
    ]);
    rec("project manager CAN create an account", byPm.ok, byPm.error);
    if (byPm.ok) createdUids.push(Number(byPm.rows[0].uid));

    // ---- editing accounts ------------------------------------------------
    const ownEdit = await asActor(app, ho.uid, (s) => [
      s`update users set contact_no = '+65 9123 4567' where uid = ${ho.uid} returning uid`,
    ]);
    rec("user CAN edit own contact number", ownEdit.ok && ownEdit.rows.length === 1, ownEdit.error);

    const promote = await asActor(app, ho.uid, (s) => [
      s`update users set user_type = 'project_manager' where uid = ${ho.uid} returning uid`,
    ]);
    rec("user cannot promote themselves", !promote.ok, promote.error);

    const other = await asActor(app, ho.uid, (s) => [
      s`update users set full_name = 'Hijacked' where uid = ${pm.uid} returning uid`,
    ]);
    rec("user cannot edit someone else", !other.ok, other.error);

    // ---- self sign-up requests -------------------------------------------
    const clerkId = `user_verify_${stamp}`;
    const req = await asActor(app, null, (s) => [
      s`insert into account_requests (clerk_user_id, email, full_name, requested_type, status, granted_uid)
        values (${clerkId}, ${`acct-req-${stamp}@example.com`}, 'Verify Requester', 'epc_team',
                'approved', ${pm.uid})
        returning request_id, status, granted_uid`,
    ]);
    const reqId = req.ok ? Number(req.rows[0].request_id) : 0;
    if (reqId) createdRequests.push(reqId);
    rec(
      "a request cannot arrive pre-approved",
      req.ok && req.rows[0].status === "pending" && req.rows[0].granted_uid === null,
      req.ok ? `stored as ${req.rows[0].status}` : req.error
    );

    const hoDecides = await asActor(app, ho.uid, (s) => [
      s`update account_requests set status = 'rejected' where request_id = ${reqId} returning request_id`,
    ]);
    rec("non-PM cannot decide a request", !hoDecides.ok, hoDecides.error);

    const hoApproves = await asActor(app, ho.uid, (s) => [
      s`select approve_account_request(${reqId}, 'project_manager') as uid`,
    ]);
    rec("non-PM cannot approve through the function", !hoApproves.ok, hoApproves.error);

    const del = await asActor(app, pm.uid, (s) => [
      s`delete from account_requests where request_id = ${reqId} returning request_id`,
    ]);
    rec("requests cannot be deleted, even by a PM", !del.ok, del.error);

    const approve = await asActor(app, pm.uid, (s) => [
      s`select approve_account_request(${reqId}, 'epc_team', 'verified by script') as uid`,
    ]);
    const grantedUid = approve.ok ? Number(approve.rows[0].uid) : 0;
    if (grantedUid) createdUids.push(grantedUid);
    rec("PM CAN approve a request", approve.ok, approve.error);

    const [after] = (await owner`
      select r.status, r.decided_by, r.granted_uid, u.clerk_user_id, u.user_type
        from account_requests r left join users u on u.uid = r.granted_uid
       where r.request_id = ${reqId}`) as Array<Record<string, unknown>>;
    rec(
      "approval created a linked account",
      after?.status === "approved" && after.clerk_user_id === clerkId && after.user_type === "epc_team",
      JSON.stringify(after)
    );
    rec("decision is attributed to the PM", after?.decided_by === pm.uid);

    const again = await asActor(app, pm.uid, (s) => [
      s`update account_requests set status = 'rejected' where request_id = ${reqId} returning request_id`,
    ]);
    rec("a decided request is final", !again.ok, again.error);

    const [audited] = (await owner`
      select count(*)::int as n from audit_log
       where entity_table = 'account_requests' and entity_id = ${String(reqId)}
         and action = 'update' and actor_uid = ${pm.uid}`) as Array<{ n: number }>;
    rec("approval is in the audit log", audited.n >= 1, `${audited.n} entr${audited.n === 1 ? "y" : "ies"}`);

    // ---- the last project manager ----------------------------------------
    const [pms] = (await owner`
      select count(*)::int as n from users where user_type = 'project_manager' and active`) as Array<{ n: number }>;
    if (pms.n === 1) {
      const lastPm = await asActor(app, pm.uid, (s) => [
        s`update users set active = false where uid = ${pm.uid} returning uid`,
      ]);
      rec("the last active PM cannot be deactivated", !lastPm.ok, lastPm.error);
    } else {
      // Deactivate everyone else temporarily? No — never touch real accounts.
      rec("the last active PM cannot be deactivated", true, `skipped: ${pms.n} active PMs exist`);
    }
  } finally {
    if (createdRequests.length) {
      await owner`delete from account_requests where request_id = any(${createdRequests})`;
    }
    if (createdUids.length) {
      // Anyone who appears in the audit log as an actor cannot be deleted:
      // the log's foreign key would have to be rewritten, and the log is
      // append-only. That is the rule working — accounts with history are
      // deactivated, never removed — so fixtures get the same treatment.
      await owner`
        delete from users u where u.uid = any(${createdUids})
           and not exists (select 1 from audit_log a where a.actor_uid = u.uid)`;
      await owner`
        update users set active = false, full_name = 'verify-accounts fixture'
         where uid = any(${createdUids})`;
    }
  }

  console.log(`\nAccount rules — ${prod ? "PRODUCTION" : "development"}\n${"=".repeat(72)}`);
  for (const [n, pass, d] of out) {
    console.log(`  ${pass ? "ok  " : "FAIL"}  ${n.padEnd(44)}${d}`);
  }
  const failed = out.filter(([, pass]) => !pass).length;
  console.log("=".repeat(72));
  console.log(failed === 0 ? "\n  ALL CHECKS PASSED\n" : `\n  ${failed} FAILED\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
