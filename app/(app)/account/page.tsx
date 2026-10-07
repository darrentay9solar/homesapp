"use client";

import { SignOutButton } from "@clerk/nextjs";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import { AvatarEditor } from "@/components/avatar";
import { NotificationsDialog } from "@/components/notification-settings";
import { EmailDialog, MobileDialog, NameDialog, PasswordDialog, PasswordIcon, RoleDialog, VerifiedNote } from "@/components/account-settings";

import { Field, ROLE_NAME, RoleChip, SettingRow } from "@/components/m";
import { Page } from "@/components/shell";
import { Heading, TopBar } from "@/components/topbar";
import { ACT_AS_KEY, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { type Lang, LANGS, locale, T, TR, useLang } from "@/lib/client/i18n";
import { DEFAULT_PREFS, summary } from "@/lib/client/prefs";
import { useTheme } from "@/lib/client/theme";

const ACCESS: Record<Role, string> = {
  homeowner: "View your own project only. Approve or decline the project and e-sign the handover certificate.",
  project_manager:
    "Full system administrator. Create projects, override any field, schedule EPC visits, manage accounts and close projects. Every action you take is written to the audit log.",
  contractor:
    "Fill and edit every milestone field for your contractor groups' projects, and schedule EPC site visits. No access to project creation or project details.",
  epc_team:
    "Everything the contractor admin can do — every milestone field and site scheduling — plus GPS check-in and check-out with crew counts.",
};

/** Your account, in the same design as a person's Profile in People. */
type Edit = "name" | "email" | "mobile" | "password" | "role" | "notifications" | null;

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "";
}

export default function AccountPage() {
  const me = useMe();
  const { me: state, reloadMe, toast } = useApp();
  const fetcher = useFetcher();
  const [theme, setTheme] = useTheme();
  const { t, lang, setLang } = useLang();
  const [edit, setEdit] = useState<Edit>(null);
  if (!me) return null;
  const s = state?.settings;
  const change = (what: Edit, label = "Change") => (
    <Button size="small" variant="outlined" onClick={() => setEdit(what)} data-testid={`edit-${what}`}>
      {t(label)}
    </Button>
  );
  const chooseLang = async (l: Lang) => {
    setLang(l);
    try {
      await fetcher("/me/settings", { method: "PATCH", json: { language: l } });
      await reloadMe();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't save your settings."), "bad");
    }
  };
  const quiet = summary(s?.notificationPrefs ?? DEFAULT_PREFS);
  const quietLine = quiet.params?.time ? t(quiet.key, { time: when(quiet.params.time) }) : t(quiet.key, quiet.params);
  const withdraw = async () => {
    try {
      const r = await fetcher<{ message: string }>("/me/role-request", { method: "DELETE" });
      toast(r.message);
      await reloadMe();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't withdraw it."), "bad");
    }
  };
  return (
    <>
      <TopBar title={T("Account")} sub={TR(me.roleLabel)} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page narrow>
          <Card sx={{ p: 2.5, mt: 1, display: "flex", gap: 2, alignItems: "center" }}>
            <AvatarEditor name={me.fullName ?? me.email} role={me.role} src={me.avatar} base="/me" onChanged={reloadMe} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, fontSize: 18, color: "primary.main", overflowWrap: "anywhere" }}>{me.fullName ?? "—"}</Typography>
              <Box sx={{ mt: 0.5 }}>
                <RoleChip role={me.role} />
              </Box>
            </Box>
          </Card>

          <Heading title={T("Your details")} />
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<PersonOutlineRoundedIcon />} tint="#0E7490" label={T("Name")} sub={me.fullName ?? T("Not set")} right={change("name")} />
            <SettingRow icon={<MailOutlineRoundedIcon />} tint="#2563EB" label={T("Email")} sub={<Box sx={{ overflowWrap: "anywhere" }}>{t("{email} · used to sign in", { email: me.email })}</Box>} right={change("email")} />
            <SettingRow
              icon={<PhoneRoundedIcon />}
              tint="#0A9A63"
              label={T("Mobile")}
              sub={
                <>
                  {me.contactNo ?? t("Not on file")}
                  <VerifiedNote at={s?.mobileVerifiedAt} />
                </>
              }
              right={change("mobile", me.contactNo ? T("Change") : T("Add"))}
            />
          </Stack>

          <Heading title={T("Security")} />
          <SettingRow
            icon={<PasswordIcon />}
            tint="#BE185D"
            label={T("Password")}
            sub={s?.passwordChangedAt ? t("Last changed {date}", { date: when(s.passwordChangedAt) }) : "Change it with your current password, or reset it by email."}
            right={change("password")}
          />

          <Heading title={T("Settings")} />
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<TranslateRoundedIcon />} tint="#0E7490" label={T("Language")} sub={T("Screens, alerts and phone notifications.")}>
              <ToggleButtonGroup exclusive fullWidth value={lang} onChange={(_, v: Lang | null) => v && void chooseLang(v)} aria-label={t("Language")} sx={{ "& .MuiToggleButton-root": { py: 1 } }}>
                {LANGS.map((l) => (
                  <ToggleButton key={l.value} value={l.value} data-testid={`lang-${l.value}`}>
                    {l.native}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </SettingRow>
            <SettingRow icon={theme === "dark" ? <DarkModeRoundedIcon /> : <LightModeRoundedIcon />} tint="#7C3AED" label={T("Appearance")} sub={T("Light is easier to read on a rooftop in daylight; Black saves battery indoors.")}>
              <ToggleButtonGroup
                exclusive
                fullWidth
                value={theme}
                onChange={(_, v) => v && setTheme(v)}
                aria-label={t("Appearance")}
                sx={{ "& .MuiToggleButton-root": { gap: 1, py: 1 } }}
              >
                <ToggleButton value="dark">
                  <DarkModeRoundedIcon fontSize="small" /> {t("Black")}
                </ToggleButton>
                <ToggleButton value="light">
                  <LightModeRoundedIcon fontSize="small" /> {t("Light")}
                </ToggleButton>
              </ToggleButtonGroup>
            </SettingRow>
            <SettingRow icon={<NotificationsActiveRoundedIcon />} tint="#B45309" label={T("Notifications")} sub={quietLine} right={change("notifications", "Change")} />
          </Stack>

          <Heading title={T("Your access")} />
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<ShieldOutlinedIcon />} tint="#B45309" label={TR(me.roleLabel)} sub={ACCESS[me.role]} />
            {me.role !== "project_manager" &&
              (s?.roleRequest ? (
                <SettingRow
                  icon={<BadgeOutlinedIcon />}
                  tint="#B7791F"
                  label={t("Waiting: {role}", { role: s.roleRequest.roleLabel })}
                  sub={t("You asked on {date}. A project manager will review it.", { date: when(s.roleRequest.createdAt) })}
                  right={
                    <Button size="small" color="error" onClick={() => void withdraw()}>
                      {t("Withdraw")}
                    </Button>
                  }
                />
              ) : (
                <SettingRow icon={<BadgeOutlinedIcon />} tint="#6D28D9" label={T("Need a different role?")} sub={T("Ask a project manager to change it.")} right={change("role", "Ask")} />
              ))}
          </Stack>

          {me.role !== "homeowner" && (
            <>
              <Heading title={T("Your files")} />
              <SettingRow
                icon={<FolderOpenRoundedIcon />}
                tint="#0891B2"
                label={T("My Files")}
                sub={T("Every photo and document you've uploaded, on any project.")}
                right={
                  <Button size="small" variant="outlined" component={Link} href="/files">
                    {t("Open")}
                  </Button>
                }
              />
            </>
          )}

          {me.role === "project_manager" && <StorageCheck />}
          {me.role === "project_manager" && <ActAs />}

          <SignOutButton redirectUrl="/sign-in">
            <Button fullWidth size="large" variant="outlined" color="inherit" startIcon={<LogoutRoundedIcon />} sx={{ mt: 3 }}>
              {t("Sign out")}
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

type Storage = { mode: "r2" | "local" | null; environment: string; bucket: string | null; ok: boolean; problem: string | null };

/**
 * For a PM after setting up Cloudflare R2: one read request confirms this
 * deployment reaches the right bucket with a working key. Run from here, not
 * by opening the API address, so it carries a fresh sign-in.
 */
function StorageCheck() {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<Storage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setGot(await fetcher<Storage>("/storage/check"));
    } catch (e) {
      setGot(null);
      setError(e instanceof Error ? e.message : t("The check couldn't run."));
    } finally {
      setBusy(false);
    }
  };
  const env = got?.environment ?? "";
  const where = env === "laptop" ? t("This laptop") : t(env.charAt(0).toUpperCase() + env.slice(1));
  return (
    <>
      <Heading title={T("File storage")} />
      <SettingRow
        icon={<CloudOutlinedIcon />}
        tint="#F38020"
        label={T("Cloudflare R2")}
        sub={T("Where photos and documents are kept. The check reads from the bucket once; nothing is uploaded.")}
      >
        <Button fullWidth variant="outlined" disabled={busy} onClick={() => void run()} data-testid="storage-check">
          {busy ? t("Checking…") : got || error ? t("Check again") : t("Check file storage")}
        </Button>
        {got && (
          <Alert severity={got.ok ? "success" : "error"} sx={{ mt: 1.5 }} data-testid="storage-result">
            {got.ok
              ? got.mode === "r2"
                ? t("Working. {where} uses the {bucket} bucket.", { where, bucket: got.bucket })
                : t("Not using R2: files are saved on this laptop. Add the R2 settings to .env.local to use the dev bucket.")
              : t(got.problem ?? "")}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </SettingRow>
    </>
  );
}

type Person = { uid: number; fullName: string | null; email: string; role: Role };

/**
 * Development only: test the homeowner's and the crew's side of a project
 * with your own login. The API allows it only on a laptop, against a
 * database that isn't production; everywhere else this section is absent.
 */
function ActAs() {
  const me = useMe();
  const { t } = useLang();
  const { data } = useApi<{ allowed: boolean; people: Person[] }>("/dev/act-as");
  const [pick, setPick] = useState("");
  if (!data?.allowed) return null;
  const others = data.people.filter((p) => p.uid !== me?.uid);
  return (
    <>
      <Heading title={T("Test as another account")} />
      <SettingRow
        icon={<ScienceOutlinedIcon />}
        tint="#B7791F"
        label={T("Development only")}
        sub={T("See and do what a homeowner, contractor admin or EPC crew member would, without their login. A banner shows while it's on; changes are recorded as theirs.")}
      >
        <Stack direction="row" sx={{ gap: 1 }}>
          <Field select label={T("Act as")} value={pick} onChange={(e) => setPick(e.target.value)} icon={<PersonOutlineRoundedIcon />}>
            {others.map((p) => (
              <MenuItem key={p.uid} value={String(p.uid)}>
                {p.fullName ?? p.email} · {t(ROLE_NAME[p.role])}
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
            {t("Start")}
          </Button>
        </Stack>
      </SettingRow>
    </>
  );
}
