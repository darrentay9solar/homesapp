"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { I, Logo, Wordmark } from "@/components/icons";
import { PhoneInput, splitPhone } from "@/components/phone-input";
import { ThemeButton } from "@/components/theme-button";
import { Pill, Sec, d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import type { Role } from "@/lib/client/app-state";

type MeState = {
  state: "active" | "deactivated" | "pending" | "rejected" | "no_account";
  request?: { requestedRole: Role; requestedRoleLabel: string; decisionNote: string | null; createdAt: string };
  clerk?: { fullName: string | null; email: string | null; phone: string | null };
  user?: { email: string };
};

const ROLES: Array<{ id: Role; label: string; desc: string; icon: (p: { size?: number }) => ReactNode }> = [
  { id: "homeowner", label: "Homeowner", desc: "Follow and approve my own installation", icon: I.home },
  { id: "contractor", label: "Contractor Admin", desc: "Fill in milestones for my company's projects", icon: I.doc },
  { id: "epc_team", label: "EPC Team", desc: "Site visits, GPS check-in and crew counts", icon: I.pin },
  { id: "project_manager", label: "Project Manager", desc: "9 Solar Home staff", icon: I.shield },
];

/**
 * Where anyone signed in to Clerk without an active account lands: ask for
 * one, see that the request is waiting, or learn it was declined.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { data: me, error, reload } = useApi<MeState>("/me");

  useEffect(() => {
    if (me?.state === "active") router.replace("/");
  }, [me, router]);

  return (
    <main className="login">
      <div className="top">
        <ThemeButton />
      </div>
      <div className="brand" style={{ paddingTop: 12, paddingBottom: 18 }}>
        <Logo size={52} />
        <Wordmark />
      </div>

      {error && <div className="err">{error.message}</div>}
      {!me && !error && <div className="panel skeleton" style={{ height: 420 }} />}

      {me?.state === "pending" && me.request && <Pending request={me.request} onRefresh={reload} />}
      {me?.state === "deactivated" && <Deactivated />}
      {(me?.state === "no_account" || me?.state === "rejected") && (
        <RequestForm me={me} onDone={reload} />
      )}

      {me && (
        <div className="foot">
          <span className="tiny" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            Signed in as {me.clerk?.email ?? me.user?.email}
          </span>
          <SignOutButton redirectUrl="/sign-in">
            <button className="btn g" style={{ height: 38, fontSize: 12.5, padding: "0 14px" }}>
              Sign out
            </button>
          </SignOutButton>
        </div>
      )}
    </main>
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
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // "+65" alone is just the country code — a number needs digits after it.
  const localDigits = splitPhone(form.contactNo).local.replace(/\D/g, "");
  const ready = role && form.fullName.trim().length >= 2 && localDigits.length >= 6;

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
      <h2>Request access</h2>
      <p className="lead">
        {me.state === "rejected"
          ? `Your last request wasn't approved${me.request?.decisionNote ? ` — “${me.request.decisionNote}”` : ""}. You can send a new one.`
          : "Tell us who you are. A 9 Solar Home project manager approves every account."}
      </p>

      <form className="panel" onSubmit={submit} noValidate>
        <Sec title="I am a" />
        <div className="roles" role="radiogroup" aria-label="Role">
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

        <Sec title="Your details" />
        <div className="fld">
          <label htmlFor="ob-name">
            Full name<span className="req">*</span>
          </label>
          <input id="ob-name" className="inp" value={form.fullName} onChange={set("fullName")} autoComplete="name" />
        </div>
        <div className="fld">
          <label htmlFor="ob-phone">
            Mobile<span className="req">*</span>
          </label>
          <PhoneInput
            id="ob-phone"
            value={form.contactNo}
            onChange={(v) => setForm((f) => ({ ...f, contactNo: v }))}
          />
          <div className="tiny" style={{ marginTop: 5 }}>
            Approval and project updates are sent here by WhatsApp.
          </div>
        </div>
        <div className="pair">
          <div className="fld">
            <label htmlFor="ob-postal">
              Postal code<span className="opt">Optional</span>
            </label>
            <input
              id="ob-postal"
              className="inp mono"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 digits"
              value={form.postalCode}
              onChange={set("postalCode")}
              autoComplete="postal-code"
            />
          </div>
          {role === "homeowner" && (
            <div className="fld">
              <label htmlFor="ob-ic">
                NRIC last 4<span className="opt">Optional</span>
              </label>
              <input
                id="ob-ic"
                className="inp mono"
                maxLength={4}
                placeholder="e.g. 567D"
                value={form.icLast4}
                onChange={set("icLast4")}
                autoComplete="off"
              />
            </div>
          )}
        </div>
        <div className="fld">
          <label htmlFor="ob-addr">
            Address<span className="opt">Optional</span>
          </label>
          <input
            id="ob-addr"
            className="inp"
            placeholder="Filled in from your postal code"
            value={form.address}
            onChange={set("address")}
            autoComplete="street-address"
          />
        </div>
        <div className="fld">
          <label htmlFor="ob-note">
            Note for the project manager<span className="opt">Optional</span>
          </label>
          <textarea
            id="ob-note"
            className="inp"
            maxLength={500}
            placeholder={role === "contractor" || role === "epc_team" ? "e.g. I'm with Apex Solar Contractors" : ""}
            value={form.note}
            onChange={set("note")}
          />
        </div>

        {err && <div className="err">{err}</div>}
        <button className="btn p full" disabled={!ready || busy}>
          {busy ? "Sending…" : "Request access"}
        </button>
        <div className="tiny" style={{ textAlign: "center", marginTop: 10 }}>
          {ready ? "We never ask for your full NRIC." : "Choose a role and enter your name and mobile."}
        </div>
      </form>
    </>
  );
}

function Pending({
  request,
  onRefresh,
}: {
  request: NonNullable<MeState["request"]>;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  return (
    <>
      <h2>Waiting for approval</h2>
      <p className="lead">A project manager will review your request. You&apos;ll get an email and a WhatsApp message.</p>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <span className="tiny">Requested role</span>
          <Pill tone="warn">{request.requestedRoleLabel}</Pill>
        </div>
        <div className="steps">
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
              <div className="d">Your projects appear here automatically</div>
            </div>
          </div>
        </div>
        <button
          className="btn g full"
          style={{ marginTop: 20 }}
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await onRefresh();
            setChecking(false);
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </>
  );
}

function Deactivated() {
  return (
    <>
      <h2>Account switched off</h2>
      <p className="lead">
        Your account has been deactivated. Contact your 9 Solar Home project manager if you think this is a mistake.
      </p>
    </>
  );
}
