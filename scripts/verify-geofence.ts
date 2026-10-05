/**
 * Proves the 100 m geofence is enforced by the database: `npm run db:verify-geofence`.
 *
 * Every attempt here goes straight to Postgres, bypassing any application
 * validation — which is the point. A crew member's phone controls the
 * coordinates it reports, so a check that only runs in the app is advisory.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

import { distanceMetres } from "../lib/geo";
import { geocode } from "../lib/onemap";

function envValue(key: string): string {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  if (!m) throw new Error(`${key} is not set`);
  return m[1].trim();
}

const out: Array<[string, boolean, string]> = [];
const rec = (n: string, p: boolean, d = "") => out.push([n, p, d]);

/** Moves a number of metres north of a point, for building test fixtures. */
function metresNorth(lat: number, metres: number): number {
  return lat + metres / 111_320;
}

async function main() {
  const sql = neon(envValue("TEST_MIGRATION_DATABASE_URL"));
  const stamp = Date.now();

  // ---- geocode a real address through OneMap ---------------------------
  const geo = await geocode("569933"); // AMK Hub — a stable, unambiguous postal code
  rec(
    "OneMap resolves a postal code",
    Number.isFinite(geo.lat) && Number.isFinite(geo.lng),
    `${geo.address} (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)})`
  );

  const [u] = (await sql`
    insert into users (email, user_type, full_name)
    values (${`geo-${stamp}@example.com`}, 'epc_team', ${"Crew Lead"}) returning uid
  `) as Array<{ uid: number }>;
  // Only one open check-in per person per site is allowed, so each accepted
  // attempt below that is not checked out needs its own crew member.
  const [u2] = (await sql`
    insert into users (email, user_type, full_name)
    values (${`geo2-${stamp}@example.com`}, 'contractor', ${"Second Crew"}) returning uid
  `) as Array<{ uid: number }>;

  const [p] = (await sql`
    insert into projects (address, postal_code, site_lat, site_lng,
                          geocoded_address, geocode_source, geocoded_at)
    values (${geo.address}, ${geo.postalCode}, ${geo.lat}, ${geo.lng},
            ${geo.address}, 'onemap', now())
    returning project_id, check_in_radius_m
  `) as Array<{ project_id: number; check_in_radius_m: number }>;
  rec("radius defaults to 100 m", p.check_in_radius_m === 100, `${p.check_in_radius_m} m`);

  const attempt = async (
    label: string,
    lat: number | null,
    lng: number | null,
    accuracy: number | null,
    userId: number = u.uid
  ) => {
    try {
      const rows = (await sql`
        insert into site_check_ins (project_id, user_id, crew_in, lat, lng, accuracy_m)
        values (${p.project_id}, ${userId}, 4, ${lat}, ${lng}, ${accuracy})
        returning check_in_id, distance_m
      `) as Array<{ check_in_id: number; distance_m: number }>;
      return { ok: true, id: rows[0].check_in_id, distance: rows[0].distance_m, error: "" };
    } catch (err) {
      return {
        ok: false,
        id: 0,
        distance: 0,
        error: err instanceof Error ? err.message.split("\n")[0] : String(err),
      };
    }
  };

  // ---- inside the fence -------------------------------------------------
  const near = { lat: metresNorth(geo.lat, 40), lng: geo.lng };
  const inside = await attempt("40 m away", near.lat, near.lng, 8);
  rec(
    "40 m away is ACCEPTED",
    inside.ok,
    inside.ok ? `recorded ${inside.distance?.toFixed(1)} m` : inside.error
  );
  rec(
    "measured distance is stored",
    inside.ok && Math.abs((inside.distance ?? 0) - 40) < 3,
    `${inside.distance?.toFixed(1)} m vs 40 m expected`
  );

  // ---- outside the fence ------------------------------------------------
  const far = { lat: metresNorth(geo.lat, 250), lng: geo.lng };
  const outside = await attempt("250 m away", far.lat, far.lng, 8);
  rec("250 m away is BLOCKED", !outside.ok, outside.error);
  rec(
    "crew sees the GPS wording, not a distance",
    !outside.ok && /not receiving GPS signal/.test(outside.error) && !/250/.test(outside.error),
    outside.error
  );

  // Just over the line, to confirm the boundary is where it should be.
  const justOut = await attempt("105 m away", metresNorth(geo.lat, 105), geo.lng, 8);
  rec("105 m away is BLOCKED", !justOut.ok);
  const justIn = await attempt("95 m away", metresNorth(geo.lat, 95), geo.lng, 8, u2.uid);
  rec("95 m away is ACCEPTED", justIn.ok, justIn.ok ? `${justIn.distance?.toFixed(1)} m` : justIn.error);

  // ---- weak or missing fixes -------------------------------------------
  const weak = await attempt("poor accuracy", near.lat, near.lng, 180);
  rec("±180 m accuracy is BLOCKED", !weak.ok, weak.error);
  const noCoords = await attempt("no coordinates", null, null, null);
  rec("missing coordinates are BLOCKED", !noCoords.ok);

  // ---- a site with no verified location --------------------------------
  const [bare] = (await sql`
    insert into projects (address) values (${"Unknown site"}) returning project_id
  `) as Array<{ project_id: number }>;
  let bareBlocked = false;
  let bareMsg = "";
  try {
    await sql`
      insert into site_check_ins (project_id, user_id, crew_in, lat, lng, accuracy_m)
      values (${bare.project_id}, ${u.uid}, 2, ${geo.lat}, ${geo.lng}, 8)`;
  } catch (err) {
    bareBlocked = true;
    bareMsg = err instanceof Error ? err.message.split("\n")[0] : String(err);
  }
  rec("un-geocoded site refuses check-in", bareBlocked, bareMsg);

  // ---- check-out is verified independently ------------------------------
  let checkoutFarBlocked = false;
  try {
    await sql`
      update site_check_ins
         set checked_out_at = now(), crew_out = 4,
             checkout_lat = ${far.lat}, checkout_lng = ${far.lng}, checkout_accuracy_m = 8
       where check_in_id = ${inside.id}`;
  } catch {
    checkoutFarBlocked = true;
  }
  rec("check-out 250 m away is BLOCKED", checkoutFarBlocked);

  let checkoutNearOk = false;
  let checkoutDist: number | null = null;
  try {
    const rows = (await sql`
      update site_check_ins
         set checked_out_at = now(), crew_out = 4,
             checkout_lat = ${near.lat}, checkout_lng = ${near.lng}, checkout_accuracy_m = 8
       where check_in_id = ${inside.id}
       returning checkout_distance_m`) as Array<{ checkout_distance_m: number }>;
    checkoutNearOk = true;
    checkoutDist = rows[0].checkout_distance_m;
  } catch {
    /* reported below */
  }
  rec("check-out on site is ACCEPTED", checkoutNearOk, checkoutDist ? `${checkoutDist.toFixed(1)} m` : "");

  // ---- tampering after the fact (migration 0013) ------------------------
  const refused = async (q: Promise<unknown>) => {
    try {
      await q;
      return { refused: false, msg: "" };
    } catch (err) {
      return { refused: true, msg: err instanceof Error ? err.message.split("\n")[0] : String(err) };
    }
  };

  const moveCheckout = await refused(sql`
    update site_check_ins set checked_out_at = now() - interval '3 hours'
     where check_in_id = ${inside.id}`);
  rec("completed check-out cannot be moved", moveCheckout.refused, moveCheckout.msg);

  const moveCheckIn = await refused(sql`
    update site_check_ins set lat = ${far.lat} where check_in_id = ${justIn.id}`);
  rec("check-in location cannot be edited", moveCheckIn.refused, moveCheckIn.msg);

  const crewFix = await refused(sql`
    update site_check_ins set crew_in = 5 where check_in_id = ${justIn.id}`);
  rec("crew count CAN be corrected", !crewFix.refused, crewFix.msg);

  const double = await attempt("second open check-in", near.lat, near.lng, 8, u2.uid);
  rec("second open check-in is BLOCKED", !double.ok, double.error);

  // A phone that claims it arrived at 6 am. The database's clock wins.
  const [backdated] = (await sql`
    insert into site_check_ins (project_id, user_id, crew_in, lat, lng, accuracy_m, checked_in_at)
    values (${p.project_id}, ${u.uid}, 3, ${near.lat}, ${near.lng}, 8, now() - interval '5 hours')
    returning check_in_id, extract(epoch from (now() - checked_in_at))::int as age_s
  `) as Array<{ check_in_id: number; age_s: number }>;
  rec("client-supplied time is ignored", backdated.age_s < 60, `${backdated.age_s}s old`);

  const preCheckedOut = await refused(sql`
    insert into site_check_ins (project_id, user_id, crew_in, lat, lng, accuracy_m,
                                checked_out_at, crew_out, checkout_lat, checkout_lng, checkout_accuracy_m)
    values (${p.project_id}, ${u2.uid}, 3, ${near.lat}, ${near.lng}, 8,
            now(), 3, ${far.lat}, ${far.lng}, 8)`);
  rec("insert already checked out is BLOCKED", preCheckedOut.refused, preCheckedOut.msg);

  // ---- a new postal code clears the old fence ---------------------------
  const [moved] = (await sql`
    update projects set postal_code = '560123' where project_id = ${p.project_id}
    returning site_lat, geocoded_at`) as Array<{ site_lat: number | null; geocoded_at: string | null }>;
  rec(
    "postal change clears stale coordinates",
    moved.site_lat === null && moved.geocoded_at === null
  );

  // ---- the two implementations agree ------------------------------------
  const tsDistance = distanceMetres(geo.lat, geo.lng, near.lat, near.lng);
  rec(
    "TypeScript and SQL distances agree",
    Math.abs(tsDistance - (inside.distance ?? 0)) < 0.5,
    `ts ${tsDistance.toFixed(2)} m vs sql ${inside.distance?.toFixed(2)} m`
  );

  await sql`delete from projects where project_id in (${p.project_id}, ${bare.project_id})`;
  await sql`delete from users where uid in (${u.uid}, ${u2.uid})`;

  console.log("\nGeofence enforcement\n" + "=".repeat(72));
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
