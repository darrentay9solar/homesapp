import { NextResponse } from "next/server";

import { checkAuth } from "@/lib/auth-check";
import { checkDatabase } from "@/lib/db";

/**
 * Machine-readable half of the smoke test, so CI or a uptime check can hit it.
 * Never cached — a cached health check tells you how things were, not how they are.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const db = await checkDatabase();
  const auth = checkAuth();

  const body = {
    ok: db.ok && auth.ok,
    checkedAt: new Date().toISOString(),
    runtime: {
      // Set by Vercel at build/run time; absent locally, which is itself useful.
      onVercel: Boolean(process.env.VERCEL),
      environment: process.env.VERCEL_ENV ?? "local",
      region: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      node: process.version,
    },
    database: db,
    auth,
  };

  // 503 on failure so an uptime monitor treats it as down rather than fine.
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
