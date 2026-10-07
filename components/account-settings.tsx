"use client";

import { useClerk, useReverification, useUser } from "@clerk/nextjs";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PinRoundedIcon from "@mui/icons-material/PinRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { clerkMessage, PASSWORD_MIN } from "@/components/auth";
import { Field, MDialog, PhoneField, ROLE_NAME } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { type Role, useApp } from "@/lib/client/app-state";

import { T, TR } from "@/lib/client/i18n";
/** Runs one step: shows the server's message, or keeps the error on screen. */
function useStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function step<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : clerkMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, step };
}

function Actions({ children }: { children: React.ReactNode }) {
  return <Stack sx={{ gap: 1, mt: 3 }}>{children}</Stack>;
}

function CodeField({ value, onChange, label = "6-digit code" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field
      label={label}
      icon={<PinRoundedIcon />}
      value={value}
      autoFocus
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "one-time-code", "aria-label": label, style: { letterSpacing: "0.3em", fontWeight: 700 } } }}
    />
  );
}

// ------------------------------------------------------------------ name

export function NameDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const fetcher = useFetcher();
  const { reloadMe, toast } = useApp();
  const { busy, error, step } = useStep();
  const [name, setName] = useState(current);
  const ok = name.trim().length >= 2 && name.trim() !== current;
  return (
    <MDialog title={T("Your Name")} heading={T("Change your name")} subtitle={T("This is how you appear to everyone on your projects.")} onClose={onClose} maxWidth="xs">
      <Field label={T("Full name")} icon={<PersonOutlineRoundedIcon />} value={name} autoFocus onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} />
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Actions>
        <Button
          size="large"
          variant="contained"
          disabled={!ok || busy}
          onClick={async () => {
            const r = await step(() => fetcher<{ message: string }>("/me/name", { method: "PATCH", json: { fullName: name } }));
            if (r) {
              toast(r.message);
              await reloadMe();
              onClose();
            }
          }}
        >
          {busy ? T("Saving…") : T("Save")}
        </Button>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Actions>
    </MDialog>
  );
}

// ------------------------------------------------------------------ email

/**
 * The sign-in email lives in Clerk. Clerk emails a code to the new address;
 * once it's verified it becomes the primary one, the old one is removed, and
 * the app adopts it (the server re-checks with Clerk).
 */
export function EmailDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const { user } = useUser();
  const fetcher = useFetcher();
  const { reloadMe, toast } = useApp();
  const { busy, error, step } = useStep();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const create = useReverification((address: string) => user!.createEmailAddress({ email: address }));
  const makePrimary = useReverification((id: string) => user!.update({ primaryEmailAddressId: id }));
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().toLowerCase() !== current.toLowerCase();

  async function send() {
    const r = await step(async () => {
      if (!user) throw new Error("Please sign in again first.");
      // A half-finished earlier attempt with the same address is reused, not duplicated.
      const existing = user.emailAddresses.find((e) => e.emailAddress.toLowerCase() === email.trim().toLowerCase());
      const address = existing ?? (await create(email.trim()));
      await address.prepareVerification({ strategy: "email_code" });
      return address.id;
    });
    if (r) setPendingId(r);
  }

  async function confirm() {
    const done = await step(async () => {
      const address = user!.emailAddresses.find((e) => e.id === pendingId);
      if (!address) throw new Error("Start again: that address is no longer waiting for a code.");
      const verified = await address.attemptVerification({ code });
      if (verified.verification.status !== "verified") throw new Error("That code isn't right. Check the email and try again.");
      await makePrimary(verified.id);
      await user!.reload();
      for (const old of user!.emailAddresses.filter((e) => e.id !== verified.id)) await old.destroy();
      return fetcher<{ message: string }>("/me/email/sync", { method: "POST" });
    });
    if (done) {
      toast(done.message);
      await reloadMe();
      onClose();
    }
  }

  return (
    <MDialog
      title={T("Your Email")}
      heading={pendingId ? T("Check your inbox") : T("Change your email")}
      subtitle={pendingId ? T("We sent a 6-digit code to {email}. It's valid for 10 minutes.", { email: email.trim() }) : T("You sign in with {email}. We'll email a code to the new address to confirm it's yours.", { email: current })}
      onClose={onClose}
      maxWidth="xs"
    >
      {!pendingId ? (
        <Field label={T("New email")} type="email" icon={<MailOutlineRoundedIcon />} value={email} autoFocus onChange={(e) => setEmail(e.target.value)} slotProps={{ htmlInput: { autoComplete: "email" } }} />
      ) : (
        <CodeField value={code} onChange={setCode} />
      )}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Actions>
        {!pendingId ? (
          <Button size="large" variant="contained" disabled={!ok || busy} onClick={() => void send()}>
            {busy ? T("Sending…") : T("Send code")}
          </Button>
        ) : (
          <>
            <Button size="large" variant="contained" disabled={code.length !== 6 || busy} onClick={() => void confirm()}>
              {busy ? T("Confirming…") : T("Confirm new email")}
            </Button>
            <Button size="large" disabled={busy} onClick={() => void send()}>
              {T("Send the code again")}
            </Button>
          </>
        )}
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Actions>
    </MDialog>
  );
}

// ------------------------------------------------------------------ mobile

type Sent = { sentBy: "whatsapp" | "sms" | "dev"; to: string; message: string; devCode?: string };

/** A code by WhatsApp (SMS if WhatsApp can't deliver, or on request) to the new number. */
export function MobileDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const fetcher = useFetcher();
  const { reloadMe, toast } = useApp();
  const { busy, error, step } = useStep();
  const [number, setNumber] = useState(current ?? "+65 ");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const digits = number.replace(/\D/g, "");
  const ok = digits.length >= 8 && number !== current;

  async function send(channel: "auto" | "sms") {
    const r = await step(() => fetcher<Sent>("/me/mobile/send", { method: "POST", json: { number, channel } }));
    if (r) {
      setSent(r);
      setCode("");
      setWait(30);
    }
  }

  async function verify() {
    const r = await step(() => fetcher<{ message: string }>("/me/mobile/verify", { method: "POST", json: { code } }));
    if (r) {
      toast(r.message);
      await reloadMe();
      onClose();
    }
  }

  return (
    <MDialog
      title={T("Your Mobile")}
      heading={sent ? T("Enter the code") : T("Change your mobile")}
      subtitle={sent ? (sent.sentBy === "whatsapp" ? T("We sent a 6-digit code to {to} on WhatsApp. It's valid for 10 minutes.", { to: sent.to }) : sent.sentBy === "sms" ? T("We sent a 6-digit code to {to} by SMS. It's valid for 10 minutes.", { to: sent.to }) : T("Here's the code for {to}. It's valid for 10 minutes.", { to: sent.to })) : T("We'll send a code to the new number by WhatsApp (or SMS) to confirm it's yours.")}
      onClose={onClose}
      maxWidth="xs"
    >
      {!sent ? <PhoneField label={T("New mobile")} value={number} onChange={setNumber} /> : <CodeField value={code} onChange={setCode} />}
      {sent?.devCode && (
        <Alert severity="info" sx={{ mt: 2 }} data-testid="dev-code">
          Development only: WhatsApp and SMS aren&apos;t set up, so here&apos;s the code: <b>{sent.devCode}</b>
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Actions>
        {!sent ? (
          <Button size="large" variant="contained" disabled={!ok || busy} onClick={() => void send("auto")}>
            {busy ? T("Sending…") : T("Send code")}
          </Button>
        ) : (
          <>
            <Button size="large" variant="contained" disabled={code.length !== 6 || busy} onClick={() => void verify()}>
              {busy ? T("Checking…") : T("Confirm new number")}
            </Button>
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button fullWidth disabled={busy || wait > 0} onClick={() => void send("auto")}>
                {wait > 0 ? T("Resend in {n}s", { n: wait }) : T("Resend code")}
              </Button>
              <Button fullWidth disabled={busy || wait > 0} onClick={() => void send("sms")}>
                {T("Send by SMS instead")}
              </Button>
            </Stack>
          </>
        )}
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Actions>
    </MDialog>
  );
}

// ---------------------------------------------------------------- password

function PasswordInput({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field
      label={label}
      type={show ? "text" : "password"}
      icon={<LockOutlinedIcon />}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        htmlInput: { autoComplete },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label={show ? T("Hide password") : T("Show password")} onClick={() => setShow((s) => !s)} edge="end">
                {show ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/**
 * Old password, then the new one twice. Clerk checks the old one and signs
 * out every other device. Forgotten it? Sign out and use Forgot password,
 * which emails a code that only works from that inbox.
 */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const fetcher = useFetcher();
  const { reloadMe, toast } = useApp();
  const { busy, error, step } = useStep();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const change = useReverification((p: { currentPassword: string; newPassword: string }) => user!.updatePassword({ ...p, signOutOfOtherSessions: true }));
  const long = f.next.length >= PASSWORD_MIN;
  const same = f.next === f.again;
  const ok = f.current.length > 0 && long && same && f.next !== f.current;

  return (
    <MDialog title={T("Your Password")} heading={T("Change your password")} subtitle={T("Enter your current password, then the new one twice. You'll stay signed in here; other devices are signed out.")} onClose={onClose} maxWidth="xs">
      <Stack sx={{ gap: 2.5 }}>
        <PasswordInput label={T("Current password")} value={f.current} onChange={(v) => setF((x) => ({ ...x, current: v }))} autoComplete="current-password" />
        <PasswordInput label={T("New password")} value={f.next} onChange={(v) => setF((x) => ({ ...x, next: v }))} autoComplete="new-password" />
        <PasswordInput label={T("New password again")} value={f.again} onChange={(v) => setF((x) => ({ ...x, again: v }))} autoComplete="new-password" />
      </Stack>
      <Typography variant="caption" component="div" sx={{ mt: 1.5, color: f.next && !long ? "error.main" : "text.secondary" }}>
        {T("At least {n} characters. A short sentence is easiest to remember.", { n: PASSWORD_MIN })}
        {f.again && !same ? ` ${T("The two new passwords don't match.")}` : ""}
      </Typography>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Actions>
        <Button
          size="large"
          variant="contained"
          disabled={!ok || busy}
          onClick={async () => {
            const r = await step(async () => {
              if (!user) throw new Error("Please sign in again first.");
              await change({ currentPassword: f.current, newPassword: f.next });
              return fetcher<{ message: string }>("/me/password-changed", { method: "POST" });
            });
            if (r) {
              toast(r.message);
              await reloadMe();
              onClose();
            }
          }}
        >
          {busy ? T("Changing…") : T("Change password")}
        </Button>
        <Button size="large" disabled={busy} onClick={() => void signOut({ redirectUrl: "/forgot-password" })}>
          {T("Forgot it? Reset by email")}
        </Button>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Actions>
    </MDialog>
  );
}

// -------------------------------------------------------------------- role

export function RoleDialog({ current, onClose }: { current: Role; onClose: () => void }) {
  const fetcher = useFetcher();
  const { reloadMe, toast } = useApp();
  const { busy, error, step } = useStep();
  const options = (Object.keys(ROLE_NAME) as Role[]).filter((r) => r !== current && r !== "project_manager");
  const [role, setRole] = useState<Role>(options[0]);
  const [reason, setReason] = useState("");
  return (
    <MDialog title={T("Your Role")} heading={T("Ask for a different role")} subtitle={T("A project manager reviews it, the same way new accounts are approved. You keep your current role until then.")} onClose={onClose} maxWidth="xs">
      <Stack sx={{ gap: 2.5 }}>
        <Field select label={T("Role you need")} icon={<BadgeRoundedIcon />} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {options.map((r) => (
            <MenuItem key={r} value={r}>
              {TR(ROLE_NAME[r])}
            </MenuItem>
          ))}
        </Field>
        <Field label={T("Why you need it")} icon={<ChatBubbleOutlineRoundedIcon />} multiline minRows={3} placeholder={T("e.g. I've moved from the office to the EPC crew at Apex.")} value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Actions>
        <Button
          size="large"
          variant="contained"
          disabled={reason.trim().length < 5 || busy}
          onClick={async () => {
            const r = await step(() => fetcher<{ message: string }>("/me/role-request", { method: "POST", json: { role, reason } }));
            if (r) {
              toast(r.message);
              await reloadMe();
              onClose();
            }
          }}
        >
          {busy ? T("Sending…") : T("Send request")}
        </Button>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Actions>
    </MDialog>
  );
}

/** The password row's icon, re-exported so the page doesn't import icons it shows once. */
export const PasswordIcon = KeyRoundedIcon;

export function VerifiedNote({ at }: { at: string | null | undefined }) {
  if (!at) return null;
  return (
    <Box component="span" sx={{ color: "success.main", fontWeight: 600 }}>
      {" "}
      · {T("Verified")}
    </Box>
  );
}
