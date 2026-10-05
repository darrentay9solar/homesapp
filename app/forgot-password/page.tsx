"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthField, AuthShell, OtpInput, PASSWORD_MIN, PasswordField, ResendCode, clerkMessage } from "@/components/auth";
import { I } from "@/components/icons";

type Step = "email" | "code" | "password" | "done";

/**
 * Forgot password: email → 6-digit code → new password → done.
 *
 * Whether an account exists for the email is never revealed: an unknown
 * address goes to the code screen exactly like a known one, so the form
 * can't be used to find out who has an account.
 */
export default function ForgotPasswordPage() {
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();
  const busy = fetchStatus === "fetching";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const carried = sessionStorage.getItem("gha-email");
      if (carried) {
        sessionStorage.removeItem("gha-email");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage
        setEmail(carried);
      }
    } catch {
      /* storage blocked */
    }
  }, []);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    const { error } = await signIn.create({ identifier: email.trim() });
    if (error) {
      const code = (error as { errors?: Array<{ code?: string }> }).errors?.[0]?.code ?? (error as { code?: string }).code;
      if (code === "form_identifier_not_found") {
        setUnknown(true);
        setStep("code");
        return;
      }
      return setErr(clerkMessage(error));
    }
    setUnknown(false);
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) return setErr(clerkMessage(sent.error));
    setCode("");
    setStep("code");
  }

  async function verify(value = code) {
    if (value.length < 6) return;
    setErr(null);
    if (unknown) return setErr("That code isn't right. Check the email and try again.");
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: value });
    if (error) return setErr(clerkMessage(error));
    if (signIn.status === "needs_new_password") setStep("password");
    else setErr("Something went wrong. Please start again.");
  }

  const longEnough = password.length >= PASSWORD_MIN;
  const matches = password.length > 0 && password === confirm;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!longEnough || !matches) return;
    setErr(null);
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });
    if (error) return setErr(clerkMessage(error));
    if (signIn.status === "complete") setStep("done");
    else setErr("Your password was changed, but signing in needs another step. Please sign in again.");
  }

  async function finish() {
    const { error } = await signIn.finalize({ navigate: () => router.push("/") });
    if (error) router.push("/sign-in");
  }

  if (step === "done") {
    return (
      <AuthShell title="All Set">
        <div className="badge">
          <I.tick size={34} />
        </div>
        <h2>Password updated</h2>
        <p className="subtitle">You&apos;re signed in. Other devices using the old password have been signed out.</p>
        <button className="btn p full" disabled={busy} onClick={() => void finish()}>
          Continue to GetHomeApps
        </button>
      </AuthShell>
    );
  }

  if (step === "password") {
    return (
      <AuthShell title="Reset Password" back={() => setStep("code")}>
        <h2>Enter new password</h2>
        <p className="subtitle">Your new password must be different from previously used passwords.</p>
        <form onSubmit={save} noValidate>
          <PasswordField
            id="fp-pw"
            label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordField
            id="fp-pw2"
            label="Confirm password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="rules" aria-live="polite">
            <span className={longEnough ? "ok" : ""}>
              {longEnough ? "✓" : "•"} {PASSWORD_MIN}+ characters
            </span>
            <span className={matches ? "ok" : ""}>{matches ? "✓" : "•"} Passwords match</span>
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn p full" disabled={busy || !longEnough || !matches}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </form>
      </AuthShell>
    );
  }

  if (step === "code") {
    return (
      <AuthShell title="Email Verification" back={() => setStep("email")}>
        <h2>Get your code</h2>
        <p className="subtitle">
          If an account uses <b>{email.trim()}</b>, we&apos;ve sent it a 6-digit code.
        </p>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} />
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <ResendCode onResend={async () => void (unknown || (await signIn.resetPasswordEmailCode.sendCode()))} />
        <button className="btn p full" disabled={busy || code.length < 6} onClick={() => void verify()}>
          {busy ? "Checking…" : "Verify and Proceed"}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot Password" back="/sign-in">
      <h2>Your email address</h2>
      <p className="subtitle">Enter the email address associated with your account.</p>
      <form onSubmit={sendCode} noValidate>
        <AuthField
          id="fp-email"
          label="Email"
          icon={I.mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {err && <div className="err">{err}</div>}
        <button className="btn p full" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
          {busy ? "Sending…" : "Send Code"}
        </button>
      </form>
    </AuthShell>
  );
}
