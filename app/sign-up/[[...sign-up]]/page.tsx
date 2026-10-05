"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  AuthField,
  AuthPhoneField,
  AuthShell,
  Mark,
  OtpInput,
  PASSWORD_MIN,
  PasswordField,
  ResendCode,
  clerkMessage,
} from "@/components/auth";
import { I } from "@/components/icons";
import { splitPhone } from "@/components/phone-input";

/**
 * Create an account. Two ways in:
 *
 *  - Invited by a project manager: the link carries a Clerk invitation
 *    ticket. The email is already proven by the invitation, so there is no
 *    code step, and the account (with its role) is waiting for them.
 *  - On their own: name, email, mobile, password → email code → then
 *    /onboarding to ask for a role, which a PM must approve.
 */
export default function Page() {
  return (
    <Suspense>
      <SignUpFlow />
    </Suspense>
  );
}

/**
 * The Clerk instance requires a username, which nobody here needs: people
 * sign in with their email. One is made from the email so the field is
 * satisfied without asking.
 */
function usernameFor(email: string): string {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "user";
  return `${base.length < 4 ? `${base}user` : base}_${Math.random().toString(36).slice(2, 7)}`;
}

function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? { firstName: parts[0], lastName: parts.slice(1).join(" ") } : { firstName: parts[0] };
}

function SignUpFlow() {
  const { signUp, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const ticket = useSearchParams().get("__clerk_ticket");
  const busy = fetchStatus === "fetching";

  const [step, setStep] = useState<"form" | "verify">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isSignedIn) router.replace("/");
  }, [isSignedIn, router]);

  const longEnough = password.length >= PASSWORD_MIN;
  const mobileOk = splitPhone(mobile).local.replace(/\D/g, "").length >= 6;
  const ready =
    name.trim().length >= 2 && (ticket || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) && mobileOk && longEnough;

  async function finish(to: string) {
    const { error } = await signUp.finalize({ navigate: () => router.push(to) });
    if (error) setErr(clerkMessage(error));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setErr(null);
    // The mobile rides along in Clerk's sign-up metadata; the request-access
    // screen picks it up so nobody types it twice.
    const extra = { ...splitName(name), unsafeMetadata: { mobile } };

    if (ticket) {
      const t = await signUp.ticket({ ticket, ...extra });
      if (t.error) return setErr(clerkMessage(t.error));
      const p = await signUp.password({ password, username: usernameFor(signUp.emailAddress ?? "user") });
      if (p.error) return setErr(clerkMessage(p.error));
      if (signUp.status === "complete") return finish("/");
      return setErr("Your invitation needs another step. Contact your project manager.");
    }

    const created = await signUp.password({
      emailAddress: email.trim(),
      password,
      username: usernameFor(email.trim()),
      ...extra,
    });
    if (created.error) return setErr(clerkMessage(created.error));
    const sent = await signUp.verifications.sendEmailCode();
    if (sent.error) return setErr(clerkMessage(sent.error));
    setCode("");
    setStep("verify");
  }

  async function verify(value = code) {
    if (value.length < 6) return;
    setErr(null);
    const { error } = await signUp.verifications.verifyEmailCode({ code: value });
    if (error) return setErr(clerkMessage(error));
    if (signUp.status === "complete") return finish("/onboarding");
    setErr("Almost there, but something is still missing. Please start again.");
  }

  if (step === "verify") {
    return (
      <AuthShell title="Email Verification" back={() => setStep("form")} compact>
        <h2>Get your code</h2>
        <p className="subtitle">
          Enter the 6-digit code we sent to <b>{email.trim()}</b>.
        </p>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} />
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <ResendCode onResend={async () => void (await signUp.verifications.sendEmailCode())} />
        <button className="btn p full" disabled={busy || code.length < 6} onClick={() => void verify()}>
          {busy ? "Checking…" : "Verify and Proceed"}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create Account" back="/sign-in" compact>
      <Mark />
      <h2>{ticket ? "Set up your login" : "Create your login"}</h2>
      <p className="subtitle">
        {ticket
          ? "9 Solar Home has invited you. Choose a password to finish."
          : "Invited by 9 Solar Home? Open the link in your invitation email instead."}
      </p>
      <form onSubmit={submit} noValidate>
        <AuthField
          id="su-name"
          label="Full name"
          icon={I.user}
          autoComplete="name"
          placeholder="e.g. Aisha Rahman"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {!ticket && (
          <AuthField
            id="su-email"
            label="Email"
            icon={I.mail}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <AuthPhoneField id="su-mobile" value={mobile} onChange={setMobile} />
        <PasswordField
          id="su-password"
          label="Password"
          autoComplete="new-password"
          placeholder={`At least ${PASSWORD_MIN} characters`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="rules" aria-live="polite">
          <span className={longEnough ? "ok" : ""}>
            {longEnough ? "✓" : "•"} {PASSWORD_MIN}+ characters
          </span>
          <span>A short sentence is easiest to remember.</span>
        </div>
        {/* Clerk's bot protection renders its check here when needed. */}
        <div id="clerk-captcha" />
        {err && <div className="err">{err}</div>}
        <button className="btn p full" disabled={busy || !ready}>
          {busy ? "Creating…" : "Create Account"}
        </button>
      </form>
      <div className="alt">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </div>
    </AuthShell>
  );
}
