"use client";

import { useSignIn } from "@clerk/nextjs";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthBadge, AuthButton, AuthError, AuthField, AuthHeading, AuthRules, AuthShell, AuthSubtitle, OtpInput, PASSWORD_MIN, PasswordField, ResendCode, clerkMessage } from "@/components/auth";
import { T } from "@/lib/client/i18n";

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
      const c = (error as { errors?: Array<{ code?: string }> }).errors?.[0]?.code ?? (error as { code?: string }).code;
      if (c === "form_identifier_not_found") {
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
    if (unknown) return setErr(T("That code isn't right. Check the email and try again."));
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: value });
    if (error) return setErr(clerkMessage(error));
    if (signIn.status === "needs_new_password") setStep("password");
    else setErr(T("Something went wrong. Please start again."));
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
    else setErr(T("Your password was changed, but signing in needs another step. Please sign in again."));
  }

  async function finish() {
    const { error } = await signIn.finalize({ navigate: () => router.push("/") });
    if (error) router.push("/sign-in");
  }

  if (step === "done") {
    return (
      <AuthShell title="All Set">
        <AuthBadge>
          <CheckRoundedIcon />
        </AuthBadge>
        <AuthHeading>{T("Password updated")}</AuthHeading>
        <AuthSubtitle>{T("You're signed in. Other devices using the old password have been signed out.")}</AuthSubtitle>
        <AuthButton disabled={busy} onClick={() => void finish()}>
          {T("Continue to GetHomeApps")}
        </AuthButton>
      </AuthShell>
    );
  }

  if (step === "password") {
    return (
      <AuthShell title="Reset Password" back={() => setStep("code")}>
        <AuthHeading>{T("Enter new password")}</AuthHeading>
        <AuthSubtitle>{T("Your new password must be different from previously used passwords.")}</AuthSubtitle>
        <form onSubmit={save} noValidate>
          <PasswordField id="fp-pw" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} slotProps={{ htmlInput: { autoComplete: "new-password" } }} />
          <PasswordField id="fp-pw2" label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} slotProps={{ htmlInput: { autoComplete: "new-password" } }} />
          <AuthRules rules={[{ ok: longEnough, text: T("{n}+ characters", { n: PASSWORD_MIN }) }, { ok: matches, text: T("Passwords match") }]} />
          <AuthError>{err}</AuthError>
          <AuthButton disabled={busy || !longEnough || !matches}>{busy ? T("Saving…") : T("Continue")}</AuthButton>
        </form>
      </AuthShell>
    );
  }

  if (step === "code") {
    return (
      <AuthShell title="Email Verification" back={() => setStep("email")}>
        <AuthHeading>{T("Get your code")}</AuthHeading>
        <AuthSubtitle>{T("If an account uses {email}, we've sent it a 6-digit code.", { email: email.trim() })}</AuthSubtitle>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} />
        <AuthError>{err}</AuthError>
        <ResendCode onResend={async () => void (unknown || (await signIn.resetPasswordEmailCode.sendCode()))} />
        <AuthButton disabled={busy || code.length < 6} onClick={() => void verify()} sx={{ mt: 2.75 }}>
          {busy ? T("Checking…") : T("Verify and Proceed")}
        </AuthButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot Password" back="/sign-in">
      <AuthHeading>{T("Your email address")}</AuthHeading>
      <AuthSubtitle>{T("Enter the email address associated with your account.")}</AuthSubtitle>
      <form onSubmit={sendCode} noValidate>
        <AuthField
          id="fp-email"
          label="Email"
          icon={<MailOutlineRoundedIcon />}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          slotProps={{ htmlInput: { inputMode: "email", autoComplete: "email" } }}
        />
        <AuthError>{err}</AuthError>
        <AuthButton disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>{busy ? T("Sending…") : T("Send Code")}</AuthButton>
      </form>
    </AuthShell>
  );
}
