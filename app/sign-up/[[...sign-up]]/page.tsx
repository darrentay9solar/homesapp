"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import Box from "@mui/material/Box";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  AuthAlt,
  AuthButton,
  AuthError,
  AuthField,
  AuthHeading,
  AuthPhoneField,
  AuthRules,
  AuthShell,
  AuthSubtitle,
  Mark,
  OtpInput,
  PASSWORD_MIN,
  PasswordField,
  PersonIcon,
  ResendCode,
  clerkField,
  clerkMessage,
} from "@/components/auth";
import { T } from "@/lib/client/i18n";
import { codeProblem, confirmProblem, mobileProblem } from "@/lib/client/rules";

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
  // Typed twice, so a slip of the finger can't lock them out of a new account.
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // What's still missing is said under each field once it's been left, and for every field once Create Account is tapped.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  // What Clerk refused, said under the field it's about, until that field changes.
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const leave = (f: string) => () => setTouched((t) => ({ ...t, [f]: true }));

  useEffect(() => {
    if (isSignedIn) router.replace("/");
  }, [isSignedIn, router]);

  const longEnough = password.length >= PASSWORD_MIN;
  const mobileOk = !mobileProblem(mobile);
  const emailOk = Boolean(ticket) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const matches = confirm.length > 0 && confirm === password;
  const ready = name.trim().length >= 2 && emailOk && mobileOk && longEnough && matches;
  const problem: Record<"name" | "email" | "mobile" | "password" | "confirm", string | null> = {
    name: name.trim().length >= 2 ? null : T("Enter your full name."),
    email: emailOk ? null : email.trim() ? T("That email doesn't look right. It should be like you@example.com.") : T("Enter your email."),
    mobile: mobileProblem(mobile),
    password: longEnough
      ? null
      : password
        ? T("The password needs at least {n} characters: {left} more to go.", { n: PASSWORD_MIN, left: PASSWORD_MIN - password.length })
        : T("Choose a password of at least {n} characters.", { n: PASSWORD_MIN }),
    confirm: confirmProblem(password, confirm),
  };
  // Until everything's right, Create Account says so above the button, and goes away once it is.
  const missing = tried && !ready ? T("Some details are missing or need fixing. See the fields marked in red.") : null;
  const shown = (f: keyof typeof problem) => ((tried || touched[f]) && problem[f]) || null;

  async function finish(to: string) {
    const { error } = await signUp.finalize({ navigate: () => router.push(to) });
    if (error) setErr(clerkMessage(error));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) {
      setTried(true);
      return;
    }
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
      return setErr(T("Your invitation needs another step. Contact your project manager."));
    }

    const created = await signUp.password({ emailAddress: email.trim(), password, username: usernameFor(email.trim()), ...extra });
    if (created.error) {
      const where = clerkField(created.error);
      if (where === "password" || where === "email") return setFieldErr({ [where]: clerkMessage(created.error) });
      return setErr(clerkMessage(created.error));
    }
    const sent = await signUp.verifications.sendEmailCode();
    if (sent.error) return setErr(clerkMessage(sent.error));
    setCode("");
    setStep("verify");
  }

  async function verify(value = code) {
    if (value.length < 6) return setErr(codeProblem(value));
    setErr(null);
    const { error } = await signUp.verifications.verifyEmailCode({ code: value });
    if (error) return setErr(clerkMessage(error));
    if (signUp.status === "complete") return finish("/onboarding");
    setErr(T("Almost there, but something is still missing. Please start again."));
  }

  if (step === "verify") {
    return (
      <AuthShell title="Email Verification" back={() => setStep("form")} compact>
        <AuthHeading>{T("Get your code")}</AuthHeading>
        <AuthSubtitle>{T("Enter the 6-digit code we sent to {email}.", { email: email.trim() })}</AuthSubtitle>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} />
        <AuthError>{err}</AuthError>
        <ResendCode onResend={async () => void (await signUp.verifications.sendEmailCode())} />
        <AuthButton disabled={busy} onClick={() => void verify()} sx={{ mt: 2.75 }}>
          {busy ? T("Checking…") : T("Verify and Proceed")}
        </AuthButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create Account" back="/sign-in" compact>
      <Mark />
      <AuthHeading>{ticket ? T("Set up your login") : T("Create your login")}</AuthHeading>
      <AuthSubtitle>{ticket ? T("9 Solar Home has invited you. Choose a password to finish.") : T("Invited by 9 Solar Home? Open the link in your invitation email instead.")}</AuthSubtitle>
      <form onSubmit={submit} noValidate>
        <AuthField id="su-name" label="Full name" icon={<PersonIcon />} placeholder="e.g. Aisha Rahman" value={name} onChange={(e) => setName(e.target.value)} onBlur={leave("name")} error={shown("name")} slotProps={{ htmlInput: { autoComplete: "name", "data-testid": "su-name" } }} />
        {!ticket && (
          <AuthField
            id="su-email"
            label="Email"
            icon={<MailOutlineRoundedIcon />}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErr((f) => ({ ...f, email: undefined }));
            }}
            onBlur={leave("email")}
            error={shown("email") ?? fieldErr.email ?? null}
            slotProps={{ htmlInput: { inputMode: "email", autoComplete: "email", "data-testid": "su-email" } }}
          />
        )}
        <AuthPhoneField id="su-mobile" value={mobile} onChange={setMobile} error={shown("mobile")} />
        <PasswordField
          id="su-password"
          label="Password"
          placeholder={T("At least {n} characters", { n: PASSWORD_MIN })}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErr((f) => ({ ...f, password: undefined }));
          }}
          onBlur={leave("password")}
          error={shown("password") ?? fieldErr.password ?? null}
          slotProps={{ htmlInput: { autoComplete: "new-password", "data-testid": "su-password" } }}
        />
        <PasswordField
          id="su-password2"
          label="Confirm password"
          placeholder={T("Type the same password again")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={leave("confirm")}
          error={shown("confirm")}
          slotProps={{ htmlInput: { autoComplete: "new-password", "data-testid": "su-password2" } }}
        />
        <AuthRules rules={[{ ok: longEnough, text: T("{n}+ characters", { n: PASSWORD_MIN }) }, { ok: matches, text: T("Passwords match") }, { text: T("A short sentence is easiest to remember.") }]} />
        {/* Clerk's bot protection renders its check here when needed. */}
        <Box id="clerk-captcha" sx={{ "&:empty": { display: "none" }, mb: 1.75 }} />
        <AuthError>{err ?? missing}</AuthError>
        <AuthButton disabled={busy} data-testid="create-account">{busy ? T("Creating…") : T("Create Account")}</AuthButton>
      </form>
      <AuthAlt>
        {T("Already have an account?")} <Link href="/sign-in">{T("Sign in")}</Link>
      </AuthAlt>
      <AuthAlt>
        {T("How we look after your data:")} <Link href="/privacy">{T("Privacy notice")}</Link>
      </AuthAlt>
    </AuthShell>
  );
}
