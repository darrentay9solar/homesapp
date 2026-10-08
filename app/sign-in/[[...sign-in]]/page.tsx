"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import Box from "@mui/material/Box";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthAlt, AuthButton, AuthError, AuthField, AuthHeading, AuthLink, AuthShell, AuthSubtitle, Mark, OtpInput, PasswordField, ResendCode, clerkMessage, safeRedirect } from "@/components/auth";
import { DemoPicker } from "@/components/demo-picker";
import { DEMO_SITE } from "@/lib/client/demo";
import { T } from "@/lib/client/i18n";

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
    setErr(T("Your account needs another sign-in step we don't support yet. Contact your project manager."));
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
        <AuthHeading>{T("Get your code")}</AuthHeading>
        <AuthSubtitle>{T("New device — enter the 6-digit code we sent to {email}.", { email })}</AuthSubtitle>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void submitCode(v)} />
        <AuthError>{err}</AuthError>
        <ResendCode onResend={async () => void (await signIn.mfa.sendEmailCode())} />
        <AuthButton disabled={busy || code.length < 6} onClick={() => void submitCode()} sx={{ mt: 2.75 }}>
          {busy ? T("Checking…") : T("Verify and Proceed")}
        </AuthButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign In">
      <Mark />
      {DEMO_SITE && <DemoPicker />}
      <AuthHeading>{T("Welcome back")}</AuthHeading>
      <AuthSubtitle>{T("Rooftop solar, tracked to the day.")}</AuthSubtitle>
      <form onSubmit={submitPassword} noValidate>
        <AuthField
          id="si-email"
          label="Email"
          icon={<MailOutlineRoundedIcon />}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          slotProps={{ htmlInput: { inputMode: "email", autoComplete: "email" } }}
        />
        <PasswordField
          id="si-password"
          label="Password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          slotProps={{ htmlInput: { autoComplete: "current-password" } }}
        />
        <Box sx={{ textAlign: "right", mt: -1, mb: 2.25, mx: 0.25 }}>
          {/* The typed email is carried over in sessionStorage, not the URL —
              addresses in URLs end up in history, logs and referrers. */}
          <AuthLink
            href="/forgot-password"
            onClick={() => {
              try {
                sessionStorage.setItem("gha-email", email.trim());
              } catch {
                /* private mode: they just retype it */
              }
            }}
          >
            {T("Forgot password?")}
          </AuthLink>
        </Box>
        <AuthError>{err}</AuthError>
        <AuthButton disabled={busy || !email.trim() || !password}>{busy ? T("Signing in…") : T("Sign In")}</AuthButton>
      </form>
      <AuthAlt>
        {T("New here?")} <Link href="/sign-up">{T("Create an account")}</Link>
      </AuthAlt>
    </AuthShell>
  );
}
