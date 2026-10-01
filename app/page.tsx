import { checkDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await checkDatabase();
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
          the database is unreachable, so an uptime monitor can watch it.
        </p>
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
