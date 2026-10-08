"use client";

import { SignOutButton } from "@clerk/nextjs";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import { EmailDialog, MobileDialog, NameDialog, PasswordDialog, PasswordIcon, RoleDialog, VerifiedNote } from "@/components/account-settings";
import { AvatarEditor } from "@/components/avatar";
import { lastShared } from "@/components/location-sharer";
import { Field, ROLE_NAME, RoleChip, SettingRow } from "@/components/m";
import { NotificationsDialog } from "@/components/notification-settings";
import { Page } from "@/components/shell";
import { LangButton, ThemeButton } from "@/components/theme-button";
import { SegTabs, TopBar } from "@/components/topbar";
import { ago } from "@/components/ui";
import { ACCESS } from "@/lib/client/access";
import { ACT_AS_KEY, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { type Lang, locale, T, TR, useLang } from "@/lib/client/i18n";
import { DEFAULT_PREFS, summary } from "@/lib/client/prefs";
import { getFix } from "@/lib/client/sites";
import { useTab } from "@/lib/client/tabs";
import { useTheme } from "@/lib/client/theme";

type Edit = "name" | "email" | "mobile" | "password" | "role" | "notifications" | null;
type Tab = "profile" | "security" | "settings" | "access";
const TABS: Array<[Tab, string]> = [
  ["profile", "Profile"],
  ["security", "Security"],
  ["settings", "Settings"],
  ["access", "Access"],
];

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "";
}

/** Your account, in tabs: who you are, signing in, how the app behaves for you, and what you may do. */
export default function AccountPage() {
  const me = useMe();
  const [tab, setTab] = useTab<Tab>(["profile", "security", "settings", "access"], "profile");
  const [edit, setEdit] = useState<Edit>(null);
  if (!me) return null;
  const change = (what: Edit, label = "Change") => (
    <Button size="small" variant="outlined" onClick={() => setEdit(what)} data-testid={`edit-${what}`}>
      {T(label)}
    </Button>
  );
  return (
    <>
      <TopBar title={T("Account")} sub={TR(me.roleLabel)} tabs={<SegTabs label={T("Account")} value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page narrow>
          <Stack sx={{ gap: 1.25, mt: 1 }} data-testid={`account-${tab}`}>
            {tab === "profile" && <ProfileTab change={change} />}
            {tab === "security" && <SecurityTab change={change} />}
            {tab === "settings" && <SettingsTab change={change} />}
            {tab === "access" && <AccessTab change={change} />}
          </Stack>

          <SignOutButton redirectUrl="/sign-in">
            <Button fullWidth size="large" variant="outlined" color="inherit" startIcon={<LogoutRoundedIcon />} sx={{ mt: 3 }}>
              {T("Sign out")}
            </Button>
          </SignOutButton>
          <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.secondary", mt: 2 }}>
            {T("GetHomeApps · 9 Solar Home · 九太阳家")}
          </Typography>
        </Page>
      </Box>
      {edit === "name" && <NameDialog current={me.fullName ?? ""} onClose={() => setEdit(null)} />}
      {edit === "email" && <EmailDialog current={me.email} onClose={() => setEdit(null)} />}
      {edit === "mobile" && <MobileDialog current={me.contactNo} onClose={() => setEdit(null)} />}
      {edit === "password" && <PasswordDialog onClose={() => setEdit(null)} />}
      {edit === "role" && <RoleDialog current={me.role} onClose={() => setEdit(null)} />}
      {edit === "notifications" && <NotificationsDialog onClose={() => setEdit(null)} />}
    </>
  );
}

type Change = (what: Edit, label?: string) => React.ReactNode;

function ProfileTab({ change }: { change: Change }) {
  const me = useMe()!;
  const { me: state, reloadMe } = useApp();
  const s = state?.settings;
  return (
    <>
      <Card sx={{ p: 2.5, display: "flex", gap: 2, alignItems: "center" }}>
        <AvatarEditor name={me.fullName ?? me.email} role={me.role} src={me.avatar} base="/me" onChanged={reloadMe} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 18, color: "primary.main", overflowWrap: "anywhere" }}>{me.fullName ?? "—"}</Typography>
          <Box sx={{ mt: 0.5 }}>
            <RoleChip role={me.role} />
          </Box>
        </Box>
      </Card>
      <SettingRow icon={<PersonOutlineRoundedIcon />} tint="#0E7490" label={T("Name")} sub={me.fullName ?? T("Not set")} right={change("name")} />
      <SettingRow icon={<MailOutlineRoundedIcon />} tint="#2563EB" label={T("Email")} sub={<Box sx={{ overflowWrap: "anywhere" }}>{T("{email} · used to sign in", { email: me.email })}</Box>} right={change("email")} />
      <SettingRow
        icon={<PhoneRoundedIcon />}
        tint="#0A9A63"
        label={T("Mobile")}
        sub={
          <>
            {me.contactNo ?? T("Not on file")}
            <VerifiedNote at={s?.mobileVerifiedAt} />
          </>
        }
        right={change("mobile", me.contactNo ? "Change" : "Add")}
      />
      {me.role !== "homeowner" && (
        <SettingRow
          icon={<FolderOpenRoundedIcon />}
          tint="#0891B2"
          label={T("My Files")}
          sub={T("Every photo and document you've uploaded, on any project.")}
          right={
            <Button size="small" variant="outlined" component={Link} href="/files">
              {T("Open")}
            </Button>
          }
        />
      )}
    </>
  );
}

function SecurityTab({ change }: { change: Change }) {
  const { me: state } = useApp();
  const s = state?.settings;
  return (
    <SettingRow
      icon={<PasswordIcon />}
      tint="#BE185D"
      label={T("Password")}
      sub={s?.passwordChangedAt ? T("Last changed {date}", { date: when(s.passwordChangedAt) }) : T("Change it with your current password, or reset it by email.")}
      right={change("password")}
    />
  );
}

function SettingsTab({ change }: { change: Change }) {
  const me = useMe()!;
  const { me: state, reloadMe, toast } = useApp();
  const fetcher = useFetcher();
  const [theme] = useTheme();
  const { lang } = useLang();
  const s = state?.settings;
  const saveLang = async (l: Lang) => {
    try {
      await fetcher("/me/settings", { method: "PATCH", json: { language: l } });
      await reloadMe();
    } catch (e) {
      toast(e instanceof Error ? e.message : T("Couldn't save your settings."), "bad");
    }
  };
  const quiet = summary(s?.notificationPrefs ?? DEFAULT_PREFS);
  const quietLine = quiet.params?.time ? T(quiet.key, { time: when(quiet.params.time) }) : T(quiet.key, quiet.params);
  return (
    <>
      <SettingRow icon={<TranslateRoundedIcon />} tint="#0E7490" label={T("Language")} sub={lang === "zh" ? "简体中文 · Chinese" : "English · 英文"} right={<LangButton onChange={(l) => void saveLang(l)} />} />
      <SettingRow
        icon={theme === "dark" ? <DarkModeRoundedIcon /> : <LightModeRoundedIcon />}
        tint="#7C3AED"
        label={T("Appearance")}
        sub={theme === "dark" ? T("Black · saves battery indoors") : T("Light · easier to read on a rooftop")}
        right={<ThemeButton />}
      />
      <SettingRow icon={<NotificationsActiveRoundedIcon />} tint="#B45309" label={T("Notifications")} sub={quietLine} right={change("notifications", "Change")} />
      <ShareLocation />
      {me.role === "project_manager" && <StorageCheck />}
      {me.role === "project_manager" && <ActAs />}
    </>
  );
}

/**
 * Share my location: the person's own choice. Turning it on asks the phone
 * for permission first, so it's never on without the phone agreeing.
 */
function ShareLocation() {
  const { me: state, reloadMe, toast } = useApp();
  const fetcher = useFetcher();
  const [busy, setBusy] = useState(false);
  const on = Boolean(state?.settings?.shareLocation);
  const sent = lastShared();
  const set = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) await getFix(15_000);
      const r = await fetcher<{ message: string }>("/me/settings", { method: "PATCH", json: { shareLocation: next } });
      toast(r.message);
      await reloadMe();
    } catch (e) {
      toast(e instanceof Error ? e.message : T("Couldn't save your settings."), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow
      icon={<MyLocationRoundedIcon />}
      tint="#2563EB"
      label={T("Share my location")}
      sub={
        on
          ? `${T("Project managers can see where you are while GetHomeApps is open on this phone.")}${sent ? ` ${T("Last sent {when}.", { when: ago(new Date(sent).toISOString()) })}` : ""}`
          : T("Off. Project managers can't see where you are.")
      }
      right={<Switch checked={on} disabled={busy} onChange={(e) => void set(e.target.checked)} slotProps={{ input: { "aria-label": T("Share my location") } }} data-testid="share-location" />}
    />
  );
}

function AccessTab({ change }: { change: Change }) {
  const me = useMe()!;
  const { me: state, reloadMe, toast } = useApp();
  const fetcher = useFetcher();
  const s = state?.settings;
  const a = ACCESS[me.role];
  const withdraw = async () => {
    try {
      const r = await fetcher<{ message: string }>("/me/role-request", { method: "DELETE" });
      toast(r.message);
      await reloadMe();
    } catch (e) {
      toast(e instanceof Error ? e.message : T("Couldn't withdraw it."), "bad");
    }
  };
  const point = (text: string, yes: boolean) => (
    <Stack key={text} component="li" direction="row" sx={{ gap: 1.25, alignItems: "flex-start", py: 0.75 }}>
      {yes ? <CheckCircleRoundedIcon sx={{ fontSize: 20, color: "primary.main", mt: "1px" }} /> : <BlockRoundedIcon sx={{ fontSize: 20, color: "text.disabled", mt: "1px" }} />}
      <Typography variant="body2" sx={{ color: yes ? "text.primary" : "text.secondary", lineHeight: 1.5 }}>
        {T(text)}
      </Typography>
    </Stack>
  );
  return (
    <>
      <Card sx={{ p: 2.25 }} data-testid="access-points">
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, mb: 1 }}>
          <ShieldOutlinedIcon sx={{ color: "warning.main" }} />
          <Typography sx={{ fontWeight: 600, fontSize: 16 }}>{T("As {role} you can:", { role: TR(me.roleLabel) })}</Typography>
        </Stack>
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
          {a.yes.map((x) => point(x, true))}
        </Box>
        {a.no.length > 0 && (
          <>
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1.25, mb: 0.25, fontWeight: 600 }}>
              {T("You can't:")}
            </Typography>
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
              {a.no.map((x) => point(x, false))}
            </Box>
          </>
        )}
      </Card>
      {me.role !== "project_manager" &&
        (s?.roleRequest ? (
          <SettingRow
            icon={<BadgeOutlinedIcon />}
            tint="#B7791F"
            label={T("Waiting: {role}", { role: s.roleRequest.roleLabel })}
            sub={T("You asked on {date}. A project manager will review it.", { date: when(s.roleRequest.createdAt) })}
            right={
              <Button size="small" color="error" onClick={() => void withdraw()}>
                {T("Withdraw")}
              </Button>
            }
          />
        ) : (
          <SettingRow icon={<BadgeOutlinedIcon />} tint="#6D28D9" label={T("Need a different role?")} sub={T("Ask a project manager to change it.")} right={change("role", "Ask")} />
        ))}
    </>
  );
}

/**
 * Project managers only: is file storage working? One read request; the
 * answer is just online or offline (details are for whoever sets it up, in
 * the server's logs and docs/r2.md).
 */
function StorageCheck() {
  const fetcher = useFetcher();
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await fetcher<{ ok: boolean; mode: string | null }>("/storage/check");
      setOk(r.ok);
    } catch {
      setOk(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow
      icon={<CloudOutlinedIcon />}
      tint="#F38020"
      label={T("File storage")}
      sub={T("Where photos and documents are kept.")}
      right={
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void run()} data-testid="storage-check">
          {busy ? T("Checking…") : T("Check")}
        </Button>
      }
    >
      {ok !== null && (
        <Alert severity={ok ? "success" : "error"} data-testid="storage-result">
          {ok ? T("File storage online") : T("File storage offline")}
        </Alert>
      )}
    </SettingRow>
  );
}

type Person = { uid: number; fullName: string | null; email: string; role: Role };

/**
 * Development only: test the homeowner's and the crew's side of a project
 * with your own login. The API allows it only on a laptop, against a
 * database that isn't production; everywhere else this row is absent.
 */
function ActAs() {
  const me = useMe();
  const { data } = useApi<{ allowed: boolean; people: Person[] }>("/dev/act-as");
  const [pick, setPick] = useState("");
  if (!data?.allowed) return null;
  const others = data.people.filter((p) => p.uid !== me?.uid);
  return (
    <SettingRow
      icon={<ScienceOutlinedIcon />}
      tint="#B7791F"
      label={T("Test as another account")}
      sub={T("See and do what a homeowner, contractor admin or EPC crew member would, without their login. A banner shows while it's on; changes are recorded as theirs.")}
    >
      <Stack direction="row" sx={{ gap: 1 }}>
        <Field select label={T("Act as")} value={pick} onChange={(e) => setPick(e.target.value)} icon={<PersonOutlineRoundedIcon />}>
          {others.map((p) => (
            <MenuItem key={p.uid} value={String(p.uid)}>
              {p.fullName ?? p.email} · {T(ROLE_NAME[p.role])}
            </MenuItem>
          ))}
        </Field>
        <Button
          variant="contained"
          disabled={!pick}
          sx={{ flex: "0 0 auto", minWidth: 96 }}
          onClick={() => {
            try {
              sessionStorage.setItem(ACT_AS_KEY, pick);
            } catch {
              /* storage blocked */
            }
            // A full reload on purpose: every screen must start again as them.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/";
          }}
        >
          {T("Start")}
        </Button>
      </Stack>
    </SettingRow>
  );
}
