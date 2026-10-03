import { currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";

import { type AccountState, ROLE_LABEL, resolveAccount } from "@/lib/account";
import { checkAuth } from "@/lib/auth-check";
import { checkDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await checkDatabase();
  const auth = checkAuth();
  // The middleware already requires a session to reach this page, so a null
  // user here would mean Clerk is misconfigured rather than signed out.
  const user = auth.ok ? await currentUser() : null;

  // Signing in to Clerk is not the same as having an account. Anyone without
  // an active one is sent to request access — unless the database itself is
  // down, in which case this diagnostic page is exactly what is needed.
  let account: AccountState | null = null;
  if (db.ok && auth.ok) {
    account = await resolveAccount();
    if (account.state !== "active") redirect("/onboarding");
  }
  const me = account?.state === "active" ? account.user : null;
  const onVercel = Boolean(process.env.VERCEL);
  const env = process.env.VERCEL_ENV ?? "local";
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? null;

  return (
    <main>
      <header>
        <p className="eyebrow">9 Solar Home · GetHomeApps</p>
        <h1>Deployment health</h1>
        <p className="lead">
          Three links in the chain. All three have to be green before the real
          app is worth building on top.
        </p>
        {me && (
          <nav className="nav">
            <span className="pill ok">{ROLE_LABEL[me.userType]}</span>
            {me.userType === "project_manager" && <Link href="/admin/users">Accounts</Link>}
          </nav>
        )}
      </header>

      <section className="checks">
        <Check
          name="Next.js on Vercel"
          ok
          detail={
            onVercel
              ? `Running on Vercel · ${env}${branch ? ` · ${branch}` : ""}${commit ? ` · ${commit}` : ""}`
              : "Running locally (next dev) — not yet deployed"
          }
          note={onVercel ? undefined : "This turns green on Vercel once deployed."}
        />

        <Check
          name="GitHub → Vercel"
          ok={Boolean(commit)}
          detail={
            commit
              ? `Built from commit ${commit} on ${branch ?? "unknown branch"}`
              : "No commit metadata — this build did not come from a Git push"
          }
          note={
            commit
              ? undefined
              : "Locally this is expected. On Vercel it means the project is not linked to the repo."
          }
        />

        <Check
          name="Neon Postgres"
          ok={db.ok}
          detail={
            db.ok
              ? `${db.version} · ${db.latencyMs} ms`
              : db.error
          }
          note={db.ok ? undefined : db.hint}
        />

        <Check
          name="Clerk auth"
          ok={auth.ok}
          detail={
            auth.ok
              ? `${auth.instance} instance · ${auth.publishableKeyPrefix}… · signed in as ${
                  user?.primaryEmailAddress?.emailAddress ?? user?.id ?? "unknown"
                }`
              : auth.error
          }
          note={auth.ok ? undefined : auth.hint}
        />
      </section>

      {db.ok && (
        <section className="detail">
          <h2>Database</h2>
          <dl>
            <Row k="Database" v={db.database} />
            <Row k="Connected as" v={db.user} />
            <Row k="Server time" v={db.serverTime} />
            <Row k="Round trip" v={`${db.latencyMs} ms`} />
            <Row
              k="Tables in public"
              v={db.tables.length ? db.tables.join(", ") : "none yet — schema not created"}
            />
          </dl>
        </section>
      )}

      <footer>
        <p>
          Machine-readable version at <code>/api/health</code> — returns 503 when
          the database or auth is misconfigured, so an uptime monitor can watch
          it. It is the one route the middleware leaves public.
        </p>
        {user && (
          <p style={{ marginTop: 14 }}>
            <SignOutButton>
              <button type="button" className="signout">
                Sign out
              </button>
            </SignOutButton>
          </p>
        )}
      </footer>
    </main>
  );
}

function Check({
  name,
  ok,
  detail,
  note,
}: {
  name: string;
  ok: boolean;
  detail: string;
  note?: string;
}) {
  return (
    <article className={ok ? "check ok" : "check bad"}>
      <span className="dot" aria-hidden="true" />
      <div>
        <h2>
          {name} <span className="status">{ok ? "OK" : "FAILED"}</span>
        </h2>
        <p className="detail">{detail}</p>
        {note && <p className="note">{note}</p>}
      </div>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
