"use client";

import { SignOutButton } from "@clerk/nextjs";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import ReportGmailerrorredRoundedIcon from "@mui/icons-material/ReportGmailerrorredRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SolarPowerOutlinedIcon from "@mui/icons-material/SolarPowerOutlined";
import WorkOutlineRoundedIcon from "@mui/icons-material/WorkOutlineRounded";
import Skeleton from "@mui/material/Skeleton";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthAlt, AuthBadge, AuthButton, AuthChoices, AuthError, AuthField, AuthHeading, AuthPhoneField, AuthRules, AuthShell, AuthSteps, AuthSubtitle, Mark, PersonIcon } from "@/components/auth";
import { splitPhone } from "@/components/phone-input";
import { d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import type { Role } from "@/lib/client/app-state";
import { currentLang, T, TR } from "@/lib/client/i18n";

type MeState = {
  state: "active" | "deactivated" | "pending" | "rejected" | "no_account";
  request?: { requestedRole: Role; requestedRoleLabel: string; decisionNote: string | null; createdAt: string };
  clerk?: { fullName: string | null; email: string | null; phone: string | null };
  user?: { email: string };
  disabled?: { reason: "manual" | "scheduled"; expiredOn: string | null; enableOn: string | null };
};

const ROLES: Array<{ value: Role; label: string; desc: string; icon: React.ReactNode }> = [
  { value: "homeowner", label: "Homeowner", desc: "My own installation", icon: <HomeOutlinedIcon /> },
  { value: "contractor", label: "Contractor Admin", desc: "My company's projects", icon: <WorkOutlineRoundedIcon /> },
  { value: "epc_team", label: "EPC Team", desc: "Site visits & check-in", icon: <SolarPowerOutlinedIcon /> },
  { value: "project_manager", label: "Project Manager", desc: "9 Solar Home staff", icon: <ShieldOutlinedIcon /> },
];

/**
 * Step 3 of self sign-up, in the same template as Create Account: ask for
 * a role, then wait for a project manager. Also where a declined, disabled
 * or expired person lands.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { data: me, error, reload } = useApi<MeState>("/me");

  useEffect(() => {
    if (me?.state === "active") router.replace("/");
  }, [me, router]);

  const title = me?.state === "pending" ? "Request Sent" : me?.state === "deactivated" ? "Account" : "Request Access";

  return (
    <AuthShell title={title} compact>
      <AuthError>{error?.message}</AuthError>
      {!me && !error && <Skeleton variant="rounded" height={380} sx={{ mt: 1 }} />}
      {me?.state === "pending" && me.request && <Pending request={me.request} onRefresh={reload} />}
      {me?.state === "deactivated" && <Deactivated disabled={me.disabled} />}
      {(me?.state === "no_account" || me?.state === "rejected") && <RequestForm me={me} onDone={reload} />}
      {me && (
        <AuthAlt>
          {T("Signed in as {email}", { email: me.clerk?.email ?? me.user?.email ?? "" })} ·{" "}
          <SignOutButton redirectUrl="/sign-in">
            <button type="button">{T("Sign out")}</button>
          </SignOutButton>
        </AuthAlt>
      )}
    </AuthShell>
  );
}

function RequestForm({ me, onDone }: { me: MeState; onDone: () => Promise<void> }) {
  const fetcher = useFetcher();
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState({ fullName: me.clerk?.fullName ?? "", contactNo: me.clerk?.phone ?? "", postalCode: "", address: "", icLast4: "", note: "" });
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
      await fetcher("/account-requests", { method: "POST", json: { ...form, role, language: currentLang() } });
      await onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const note = me.request?.decisionNote;
  return (
    <>
      <Mark />
      <AuthHeading>{T("Who are you?")}</AuthHeading>
      <AuthSubtitle>
        {me.state === "rejected"
          ? note
            ? T("Your last request wasn't approved — “{note}”. You can send a new one.", { note })
            : T("Your last request wasn't approved. You can send a new one.")
          : T("A 9 Solar Home project manager approves every account.")}
      </AuthSubtitle>

      <form onSubmit={submit} noValidate>
        <AuthChoices label="Role" value={role} onChange={setRole} options={ROLES} />
        <AuthField id="ob-name" label="Full name" icon={<PersonIcon />} placeholder="e.g. Aisha Rahman" value={form.fullName} onChange={set("fullName")} slotProps={{ htmlInput: { autoComplete: "name" } }} />
        <AuthPhoneField id="ob-phone" value={form.contactNo} onChange={(v) => setForm((f) => ({ ...f, contactNo: v }))} />
        <AuthField
          id="ob-postal"
          label="Postal code (optional)"
          icon={<PlaceOutlinedIcon />}
          placeholder="6 digits — fills in your address"
          value={form.postalCode}
          onChange={set("postalCode")}
          slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" } }}
        />
        <AuthField id="ob-addr" label="Address (optional)" icon={<HomeOutlinedIcon />} placeholder="Filled in from your postal code" value={form.address} onChange={set("address")} slotProps={{ htmlInput: { autoComplete: "street-address" } }} />
        {role === "homeowner" && (
          <>
            <AuthField id="ob-ic" label="NRIC last 4 (optional)" icon={<BadgeOutlinedIcon />} placeholder="e.g. 567D" value={form.icLast4} onChange={set("icLast4")} slotProps={{ htmlInput: { maxLength: 4, autoComplete: "off" } }} />
            <AuthRules rules={[{ text: T("We never ask for your full NRIC.") }]} />
          </>
        )}
        <AuthField
          id="ob-note"
          label="Note for the project manager (optional)"
          icon={<EditNoteRoundedIcon />}
          placeholder={role === "contractor" || role === "epc_team" ? "e.g. I'm with Apex Solar Contractors" : "Anything we should know"}
          value={form.note}
          onChange={set("note")}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        <AuthError>{err}</AuthError>
        <AuthButton disabled={!ready || busy}>{busy ? T("Sending…") : T("Request Access")}</AuthButton>
      </form>
    </>
  );
}

function Pending({ request, onRefresh }: { request: NonNullable<MeState["request"]>; onRefresh: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  return (
    <>
      <AuthBadge>
        <HourglassTopRoundedIcon />
      </AuthBadge>
      <AuthHeading>{T("Waiting for approval")}</AuthHeading>
      <AuthSubtitle>{T("You asked to join as {role}. We'll email and WhatsApp you as soon as a project manager decides.", { role: TR(request.requestedRoleLabel) })}</AuthSubtitle>
      <AuthSteps
        steps={[
          { state: "done", label: "Request sent", detail: d2s(request.createdAt) },
          { state: "now", label: "Project manager review", detail: "Usually within one working day" },
          { state: "next", label: "Access granted", detail: "Your projects appear automatically" },
        ]}
      />
      <AuthButton
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await onRefresh();
          setChecking(false);
        }}
      >
        {checking ? T("Checking…") : T("Check Again")}
      </AuthButton>
    </>
  );
}

function Deactivated({ disabled }: { disabled: MeState["disabled"] }) {
  const expired = disabled?.reason === "scheduled";
  return (
    <>
      <AuthBadge>{expired ? <EventBusyRoundedIcon /> : <ReportGmailerrorredRoundedIcon />}</AuthBadge>
      <AuthHeading>{expired ? T("Your account has expired") : T("Account switched off")}</AuthHeading>
      <AuthSubtitle>
        {expired && disabled?.expiredOn
          ? T("It reached its expiry date on {date}. Ask your 9 Solar Home project manager to extend it.", { date: d2s(disabled.expiredOn) })
          : disabled?.enableOn
            ? T("Your account is switched off until {date}, when it turns on again by itself.", { date: d2s(disabled.enableOn) })
            : T("Your account has been deactivated. Contact your 9 Solar Home project manager if you think this is a mistake.")}
      </AuthSubtitle>
    </>
  );
}
