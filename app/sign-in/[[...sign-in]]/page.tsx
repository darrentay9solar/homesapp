"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthField, AuthShell, Mark, OtpInput, PasswordField, ResendCode, clerkMessage, safeRedirect } from "@/components/auth";
import { I } from "@/components/icons";

/**
 * Sign in — the template's design, with Clerk doing the authentication
 * through its custom-flow API rather than its ready-made widget.
 */
export default function Page() {
  return (
    <Suspense>
      <SignInFlow />
    </Suspense>
  );
}

function SignInFlow() {
  const { signIn, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const dest = safeRedirect(params.get("redirect_url"));

  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const busy = fetchStatus === "fetching";

  useEffect(() => {
    if (isSignedIn) router.replace(dest);
  }, [isSignedIn, dest, router]);

  async function finishOrContinue() {
    if (signIn.status === "complete") {
      const { error } = await signIn.finalize({ navigate: () => router.push(dest) });
      if (error) setErr(clerkMessage(error));
      return;
    }
    // A new device, or two-step verification: Clerk asks for a code sent to
    // the account's email before trusting this browser.
    if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
      const { error } = await signIn.mfa.sendEmailCode();
      if (error) return setErr(clerkMessage(error));
      setCode("");
      setStep("code");
      return;
    }
    setErr("Your account needs another sign-in step we don't support yet. Contact your project manager.");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await signIn.password({ emailAddress: email.trim(), password });
    if (error) return setErr(clerkMessage(error));
    await finishOrContinue();
  }

  async function submitCode(value = code) {
    if (value.length < 6) return;
    setErr(null);
    const { error } = await signIn.mfa.verifyEmailCode({ code: value });
    if (error) return setErr(clerkMessage(error));
    await finishOrContinue();
  }

  if (step === "code") {
    return (
      <AuthShell title="Email Verification" back={() => setStep("start")}>
        <h2>Get your code</h2>
        <p className="subtitle">
          New device — enter the 6-digit code we sent to <b>{email}</b>.
        </p>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void submitCode(v)} />
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <ResendCode onResend={async () => void (await signIn.mfa.sendEmailCode())} />
        <button className="btn p full" disabled={busy || code.length < 6} onClick={() => void submitCode()}>
          {busy ? "Checking…" : "Verify and Proceed"}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign In">
      <Mark />
      <h2>Welcome back</h2>
      <p className="subtitle">Rooftop solar, tracked to the day.</p>
      <form onSubmit={submitPassword} noValidate>
        <AuthField
          id="si-email"
          label="Email"
          icon={I.mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          id="si-password"
          label="Password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div style={{ textAlign: "right", margin: "-8px 2px 18px" }}>
          {/* The typed email is carried over in sessionStorage, not the URL —
              addresses in URLs end up in history, logs and referrers. */}
          <Link
            className="textlink"
            style={{ fontSize: 12.5 }}
            href="/forgot-password"
            onClick={() => {
              try {
                sessionStorage.setItem("gha-email", email.trim());
              } catch {
                /* private mode: they just retype it */
              }
            }}
          >
            Forgot password?
          </Link>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn p full" disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
      <div className="alt">
        New here? <Link href="/sign-up">Create an account</Link>
      </div>
    </AuthShell>
  );
}
