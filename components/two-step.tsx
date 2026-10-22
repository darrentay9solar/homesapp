"use client";

import { useReverification, useUser } from "@clerk/nextjs";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import QRCode from "qrcode";
import { useState } from "react";

import { clerkMessage } from "@/components/auth";
import { Field, MDialog } from "@/components/m";
import { T } from "@/lib/client/i18n";
import { codeProblem } from "@/lib/client/rules";

type Step = "intro" | "scan" | "codes" | "manage";

/** The secret in groups of four, easier to type into an authenticator app by hand. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Two-step verification with an authenticator app (Google Authenticator,
 * Microsoft Authenticator, 1Password...), through Clerk: a code from the app
 * after the password at every sign-in (ISO 27001 A.8.5), and backup codes for
 * a lost phone. Required for staff where 9 Solar Home turns it on
 * (REQUIRE_STAFF_MFA, docs/iso/README.md).
 */
export function TwoStepDialog({ onClose }: { onClose: () => void }) {
  const { user } = useUser();
  const on = Boolean(user?.totpEnabled);
  const [step, setStep] = useState<Step>(on ? "manage" : "intro");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = useReverification(() => user!.createTOTP());
  const backup = useReverification(() => user!.createBackupCode());
  const disable = useReverification(() => user!.disableTOTP());

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(clerkMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const totp = await create();
      if (!totp?.uri || !totp.secret) throw new Error(T("Something went wrong. Please try again."));
      setSecret(totp.secret);
      setQr(await QRCode.toDataURL(totp.uri, { margin: 1, width: 220 }));
      setStep("scan");
    });

  const verify = () => {
    if (code.length < 6) return setErr(codeProblem(code));
    return run(async () => {
      await user!.verifyTOTP({ code });
      const b = await backup();
      setCodes(b?.codes ?? []);
      await user!.reload();
      setStep("codes");
    });
  };

  const newCodes = () =>
    run(async () => {
      const b = await backup();
      setCodes(b?.codes ?? []);
      setStep("codes");
    });

  const turnOff = () =>
    run(async () => {
      await disable();
      await user!.reload();
      onClose();
    });

  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  return (
    <MDialog
      title={T("Two-step verification")}
      heading={step === "codes" ? T("Keep your backup codes") : step === "manage" ? T("Two-step verification is on") : T("Add a code from your phone")}
      subtitle={
        step === "intro"
          ? T("After your password, you'll also enter a 6-digit code from an authenticator app on your phone, so a stolen password alone can't open your account.")
          : step === "scan"
            ? T("Open your authenticator app (Google Authenticator, Microsoft Authenticator or similar), add an account, and scan this code. Then enter the 6-digit code it shows.")
            : step === "codes"
              ? T("Each opens your account once if you lose your phone. Save them somewhere safe, such as your password manager; they won't be shown again.")
              : T("You enter a code from your authenticator app each time you sign in.")
      }
      onClose={onClose}
      maxWidth="xs"
    >
      <Box data-testid={`two-step-${step}`}>
        {step === "intro" && (
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={() => void start()} data-testid="two-step-start">
            {busy ? T("Preparing…") : T("Set up")}
          </Button>
        )}
        {step === "scan" && (
          <>
            {qr && <Box component="img" src={qr} alt={T("Code to scan with your authenticator app")} sx={{ width: 200, maxWidth: "100%", display: "block", mx: "auto", bgcolor: "#fff", borderRadius: 2, p: 1 }} />}
            <Typography variant="caption" component="p" sx={{ color: "text.secondary", textAlign: "center", mt: 1.5 }}>
              {T("Can't scan? Type this key into the app instead:")}
            </Typography>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "center", gap: 0.5, flexWrap: "wrap", mb: 2 }}>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 600, overflowWrap: "anywhere", textAlign: "center" }}>{grouped(secret)}</Typography>
              <Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={() => copy(secret)}>
                {T("Copy")}
              </Button>
            </Stack>
            <Field label={T("6-digit code")} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "one-time-code", "data-testid": "two-step-code" } }} />
            <Button variant="contained" size="large" fullWidth disabled={busy} onClick={() => void verify()} sx={{ mt: 2 }} data-testid="two-step-verify">
              {busy ? T("Checking…") : T("Turn on")}
            </Button>
          </>
        )}
        {step === "codes" && (
          <>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1, fontFamily: "monospace", fontWeight: 600, mb: 2 }} data-testid="two-step-codes">
              {codes.map((c) => (
                <Box key={c} sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", textAlign: "center" }}>
                  {c}
                </Box>
              ))}
            </Box>
            <Button fullWidth startIcon={<ContentCopyRoundedIcon />} onClick={() => copy(codes.join("\n"))} sx={{ mb: 1 }}>
              {T("Copy all")}
            </Button>
            <Button variant="contained" size="large" fullWidth onClick={onClose}>
              {T("I've saved them")}
            </Button>
          </>
        )}
        {step === "manage" && (
          <Stack sx={{ gap: 1 }}>
            <Button variant="outlined" size="large" fullWidth disabled={busy} onClick={() => void newCodes()}>
              {T("New backup codes")}
            </Button>
            <Button color="error" size="large" fullWidth disabled={busy} onClick={() => void turnOff()}>
              {T("Turn off")}
            </Button>
          </Stack>
        )}
        {err && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {err}
          </Alert>
        )}
      </Box>
    </MDialog>
  );
}
