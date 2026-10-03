import Link from "next/link";
import { redirect } from "next/navigation";

import type { UserType } from "@/db/schema";
import { ROLE_LABEL, resolveAccount } from "@/lib/account";
import { sql } from "@/lib/db";

import { CreateUserForm, DecideRequestForm } from "./forms";

export const dynamic = "force-dynamic";

type RequestRow = {
  request_id: number;
  full_name: string;
  email: string;
  requested_type: UserType;
  contact_no: string | null;
  postal_code: string | null;
  address: string | null;
  note: string | null;
  created_at: Date;
};

type UserRow = {
  uid: number;
  full_name: string | null;
  email: string;
  user_type: UserType;
  active: boolean;
  linked: boolean;
  invited_at: Date | null;
};

const sgt = (d: Date) =>
  new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));

export default async function AdminUsersPage() {
  const account = await resolveAccount();
  if (account.state !== "active") redirect("/onboarding");
  if (account.user.userType !== "project_manager") redirect("/");

  const db = sql();
  const [requests, users] = (await Promise.all([
    db`select request_id, full_name, email, requested_type, contact_no, postal_code, address,
              note, created_at
         from account_requests where status = 'pending' order by created_at`,
    db`select uid, full_name, email, user_type, active, clerk_user_id is not null as linked, invited_at
         from users order by active desc, user_type, full_name`,
  ])) as [RequestRow[], UserRow[]];

  return (
    <main>
      <header>
        <p className="eyebrow">9 Solar Home · Project Manager</p>
        <h1>Accounts</h1>
        <p className="lead">
          Only project managers can create accounts. People who sign up by themselves wait here
          until you approve them.
        </p>
        <nav className="nav">
          <Link href="/">← Home</Link>
        </nav>
      </header>

      <section className="card">
        <h2>
          Waiting for approval{" "}
          <span className={requests.length ? "pill ok" : "pill"}>{requests.length}</span>
        </h2>
        {requests.length === 0 ? (
          <p className="hint">No one is waiting.</p>
        ) : (
          <div className="list">
            {requests.map((r) => (
              <article key={r.request_id} className="item">
                <h3>{r.full_name}</h3>
                <p>
                  {r.email}
                  {r.contact_no ? ` · ${r.contact_no}` : ""}
                </p>
                <p>
                  Asked for <strong>{ROLE_LABEL[r.requested_type]}</strong> · {sgt(r.created_at)}
                </p>
                {(r.address || r.postal_code) && (
                  <p>
                    {r.address ?? ""} {r.postal_code ? `(${r.postal_code})` : ""}
                  </p>
                )}
                {r.note && <p>“{r.note}”</p>}
                <DecideRequestForm requestId={r.request_id} requestedType={r.requested_type} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Create an account</h2>
        <p className="hint">
          They get an email and a WhatsApp message saying which role they have, with a link to set
          up their login.
        </p>
        <CreateUserForm />
      </section>

      <section className="card">
        <h2>Everyone</h2>
        <div className="list">
          {users.map((u) => (
            <article key={u.uid} className="item">
              <h3>
                {u.full_name ?? u.email}{" "}
                <span className={u.active ? "pill ok" : "pill"}>
                  {u.active ? ROLE_LABEL[u.user_type] : "Deactivated"}
                </span>
              </h3>
              <p>
                {u.email} ·{" "}
                {u.linked
                  ? "signed in"
                  : u.invited_at
                    ? `invited ${sgt(u.invited_at)}, not accepted yet`
                    : "no login yet"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
