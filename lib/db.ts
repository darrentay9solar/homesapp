import { neon } from "@neondatabase/serverless";

/**
 * Neon's serverless driver talks over HTTP, so it works inside Vercel's edge
 * and serverless functions where a normal TCP pool cannot survive between
 * invocations. A pooled `postgres://` URL from Neon is what you want here.
 */

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Locally, put it in web/.env.local; on Vercel, " +
        "set it under Project → Settings → Environment Variables (the Neon " +
        "integration usually adds it for you)."
    );
    this.name = "MissingDatabaseUrlError";
  }
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") throw new MissingDatabaseUrlError();
  return url;
}

export function sql() {
  return neon(databaseUrl());
}

/** Everything the health page needs to prove the chain actually works. */
export type DbCheck =
  | {
      ok: true;
      version: string;
      database: string;
      user: string;
      serverTime: string;
      latencyMs: number;
      /** Tables already present in the public schema. Empty on a fresh Neon DB. */
      tables: string[];
    }
  | { ok: false; error: string; hint: string };

export async function checkDatabase(): Promise<DbCheck> {
  const started = Date.now();
  try {
    const db = sql();

    const [info] = (await db`
      select version() as version,
             current_database() as database,
             current_user as "user",
             now() as server_time
    `) as Array<{
      version: string;
      database: string;
      user: string;
      server_time: string;
    }>;

    const tableRows = (await db`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
       order by table_name
    `) as Array<{ table_name: string }>;

    return {
      ok: true,
      // The full version string is a paragraph; the first clause is the useful part.
      version: info.version.split(" on ")[0],
      database: info.database,
      user: info.user,
      serverTime: new Date(info.server_time).toISOString(),
      latencyMs: Date.now() - started,
      tables: tableRows.map((r) => r.table_name),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, hint: hintFor(message) };
  }
}

/** Turns the common Neon/Postgres failures into something actionable. */
function hintFor(message: string): string {
  const m = message.toLowerCase();
  if (message.includes("DATABASE_URL is not set")) {
    return "Add the connection string to web/.env.local (local) or Vercel's environment variables (deployed).";
  }
  if (m.includes("password authentication failed")) {
    return "The password in DATABASE_URL is wrong. Reset the role password in the Neon console and copy the string again.";
  }
  if (m.includes("does not exist") && m.includes("database")) {
    return "The database name in the URL does not exist on this Neon project. Check the branch and database in the Neon console.";
  }
  if (m.includes("enotfound") || m.includes("getaddrinfo")) {
    return "The host in DATABASE_URL could not be resolved. Check for a typo, and that the Neon project has not been deleted.";
  }
  if (m.includes("timeout") || m.includes("econnrefused")) {
    return "Could not reach Neon. If the compute is suspended it should wake on its own — retry once. Otherwise check your network or firewall.";
  }
  if (m.includes("ssl") || m.includes("certificate")) {
    return "Neon requires TLS. Make sure the URL ends with ?sslmode=require.";
  }
  if (m.includes("fetch failed")) {
    return "The HTTP driver could not reach Neon. Confirm the URL is the pooled connection string from the Neon dashboard.";
  }
  return "Copy the connection string again from the Neon dashboard — use the pooled 'postgres://' URL, including ?sslmode=require.";
}
