"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { AuthField, AuthPhoneField, AuthShell, Mark } from "@/components/auth";
import { I } from "@/components/icons";
import { splitPhone } from "@/components/phone-input";
import { d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import type { Role } from "@/lib/client/app-state";

type MeState = {
  state: "active" | "deactivated" | "pending" | "rejected" | "no_account";
  request?: { requestedRole: Role; requestedRoleLabel: string; decisionNote: string | null; createdAt: string };
  clerk?: { fullName: string | null; email: string | null; phone: string | null };
  user?: { email: string };
};

const ROLES: Array<{ id: Role; label: string; desc: string; icon: (p: { size?: number }) => ReactNode }> = [
  { id: "homeowner", label: "Homeowner", desc: "My own installation", icon: I.home },
  { id: "contractor", label: "Contractor Admin", desc: "My company's projects", icon: I.doc },
  { id: "epc_team", label: "EPC Team", desc: "Site visits & check-in", icon: I.pin },
  { id: "project_manager", label: "Project Manager", desc: "9 Solar Home staff", icon: I.shield },
];

/**
 * Step 3 of self sign-up, in the same template as Create Account: ask for
 * a role, then wait for a project manager. Also where a declined or
 * deactivated person lands.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { data: me, error, reload } = useApi<MeState>("/me");

  useEffect(() => {
    if (me?.state === "active") router.replace("/");
  }, [me, router]);

  const title =
    me?.state === "pending" ? "Request Sent" : me?.state === "deactivated" ? "Account" : "Request Access";

  return (
    <AuthShell title={title} compact>
      {error && <div className="err">{error.message}</div>}
      {!me && !error && <div className="skeleton" style={{ height: 380, marginTop: 8 }} />}
      {me?.state === "pending" && me.request && <Pending request={me.request} onRefresh={reload} />}
      {me?.state === "deactivated" && <Deactivated />}
      {(me?.state === "no_account" || me?.state === "rejected") && <RequestForm me={me} onDone={reload} />}
      {me && (
        <div className="alt">
          Signed in as {me.clerk?.email ?? me.user?.email} ·{" "}
          <SignOutButton redirectUrl="/sign-in">
            <button type="button">Sign out</button>
          </SignOutButton>
        </div>
      )}
    </AuthShell>
  );
}

function RequestForm({ me, onDone }: { me: MeState; onDone: () => Promise<void> }) {
  const fetcher = useFetcher();
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState({
    fullName: me.clerk?.fullName ?? "",
    contactNo: me.clerk?.phone ?? "",
    postalCode: "",
    address: "",
    icLast4: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const mobileOk = splitPhone(form.contactNo).local.replace(/\D/g, "").length >= 6;
  const ready = role && form.fullName.trim().length >= 2 && mobileOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      await fetcher("/account-requests", { method: "POST", json: { ...form, role } });
      await onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Mark />
      <h2>Who are you?</h2>
      <p className="subtitle">
        {me.state === "rejected"
          ? `Your last request wasn't approved${me.request?.decisionNote ? ` — “${me.request.decisionNote}”` : ""}. You can send a new one.`
          : "A 9 Solar Home project manager approves every account."}
      </p>

      <form onSubmit={submit} noValidate>
        <div className="roles" role="radiogroup" aria-label="Role" style={{ marginBottom: 22 }}>
          {ROLES.map((r) => (
            <button
              type="button"
              key={r.id}
              role="radio"
              aria-checked={role === r.id}
              className={`rl ${role === r.id ? "on" : ""}`}
              onClick={() => setRole(r.id)}
            >
              <div className="r">
                <r.icon />
                {r.label}
              </div>
              <div className="e">{r.desc}</div>
            </button>
          ))}
        </div>

        <AuthField id="ob-name" label="Full name" icon={I.user} autoComplete="name" placeholder="e.g. Aisha Rahman" value={form.fullName} onChange={set("fullName")} />
        <AuthPhoneField id="ob-phone" value={form.contactNo} onChange={(v) => setForm((f) => ({ ...f, contactNo: v }))} />
        <AuthField
          id="ob-postal"
          label="Postal code (optional)"
          icon={I.pin}
          inputMode="numeric"
          maxLength={6}
          placeholder="6 digits — fills in your address"
          autoComplete="postal-code"
          value={form.postalCode}
          onChange={set("postalCode")}
        />
        <AuthField id="ob-addr" label="Address (optional)" icon={I.home} autoComplete="street-address" placeholder="Filled in from your postal code" value={form.address} onChange={set("address")} />
        {role === "homeowner" && (
          <AuthField id="ob-ic" label="NRIC last 4 (optional)" icon={I.shield} maxLength={4} placeholder="e.g. 567D" autoComplete="off" value={form.icLast4} onChange={set("icLast4")} />
        )}
        <AuthField
          id="ob-note"
          label="Note for the project manager (optional)"
          icon={I.pen}
          maxLength={500}
          placeholder={role === "contractor" || role === "epc_team" ? "e.g. I'm with Apex Solar Contractors" : "Anything we should know"}
          value={form.note}
          onChange={set("note")}
        />

        {err && <div className="err">{err}</div>}
        <button className="btn p full" disabled={!ready || busy}>
          {busy ? "Sending…" : "Request Access"}
        </button>
        <div className="rules" style={{ justifyContent: "center", marginTop: 12 }}>
          {ready ? "We never ask for your full NRIC." : "Choose a role and enter your name and mobile."}
        </div>
      </form>
    </>
  );
}

function Pending({ request, onRefresh }: { request: NonNullable<MeState["request"]>; onRefresh: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  return (
    <>
      <div className="badge">
        <I.clock size={32} />
      </div>
      <h2>Waiting for approval</h2>
      <p className="subtitle">
        You asked to join as <b>{request.requestedRoleLabel}</b>. We&apos;ll email and WhatsApp you as soon as a project manager decides.
      </p>
      <div className="steps" style={{ margin: "0 auto 24px", maxWidth: 320, width: "100%" }}>
        <div className="s done">
          <span className="b">
            <I.tick size={11} />
          </span>
          <div>
            <div className="t">Request sent</div>
            <div className="d">{d2s(request.createdAt)}</div>
          </div>
        </div>
        <div className="s now">
          <span className="b">2</span>
          <div>
            <div className="t">Project manager review</div>
            <div className="d">Usually within one working day</div>
          </div>
        </div>
        <div className="s">
          <span className="b">3</span>
          <div>
            <div className="t">Access granted</div>
            <div className="d">Your projects appear automatically</div>
          </div>
        </div>
      </div>
      <button
        className="btn p full"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await onRefresh();
          setChecking(false);
        }}
      >
        {checking ? "Checking…" : "Check Again"}
      </button>
    </>
  );
}

function Deactivated() {
  return (
    <>
      <div className="badge">
        <I.alert size={30} />
      </div>
      <h2>Account switched off</h2>
      <p className="subtitle">Your account has been deactivated. Contact your 9 Solar Home project manager if you think this is a mistake.</p>
    </>
  );
}
