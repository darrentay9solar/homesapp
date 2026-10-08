"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";

import { useApi } from "./api";
import { currentLang, type Lang, T, translate, useLang } from "./i18n";
import type { Prefs } from "./prefs";
import { registration, setBadge } from "./push";

export type Role = "homeowner" | "project_manager" | "contractor" | "epc_team" | "superadmin";

/** Project managers and the superadmin: People, Audit, Everyone's files, creating projects. */
export function isAdmin(role: Role | null | undefined): boolean {
  return role === "project_manager" || role === "superadmin";
}

/** The roles an account can be given in the app: a superadmin gives any; a project manager every one but project manager. Superadmin is never given in the app. */
export function grantableRoles(by: Role | null | undefined): Role[] {
  const all: Role[] = ["homeowner", "contractor", "epc_team", "project_manager"];
  return by === "superadmin" ? all : all.filter((r) => r !== "project_manager");
}

/** Whether `by` may change an account that has role `target` (People → Profile). */
export function canManage(by: Role | null | undefined, target: Role): boolean {
  if (target === "superadmin") return false;
  if (target === "project_manager") return by === "superadmin";
  return isAdmin(by);
}

export type Me = {
  state: "active" | "deactivated" | "pending" | "rejected" | "no_account";
  user?: {
    uid: number;
    fullName: string | null;
    email: string;
    role: Role;
    roleLabel: string;
    contactNo: string | null;
    address: string | null;
    postalCode: string | null;
    avatar?: string | null;
  };
  unread?: number;
  /** Account settings: verified steps and any role request waiting for a PM. */
  settings?: {
    language: Lang;
    notificationPrefs: Prefs;
    /** Sharing this person's location with project managers (their own choice). */
    shareLocation?: boolean;
    mobileVerifiedAt: string | null;
    passwordChangedAt: string | null;
    roleRequest: { role: Role; roleLabel: string; reason: string | null; createdAt: string } | null;
  };
  /** A disabled account: expired on its date, or disabled by a PM (and maybe re-enabling on a date). */
  disabled?: { reason: "manual" | "scheduled"; expiredOn: string | null; enableOn: string | null };
  /** Development only: a project manager testing as this account. */
  actingAs?: { byName: string | null; byUid: number };
  /** The demonstration site: a visitor trying the app as this sample person. */
  demo?: boolean;
};

type Ctx = {
  me: Me | null;
  reloadMe: () => Promise<void>;
  toast: (message: string, tone?: "ok" | "bad") => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside <AppProvider>");
  return ctx;
}

/** The signed-in user, for screens inside the app shell. Always active here. */
export function useMe() {
  const { me } = useApp();
  return me?.user ?? null;
}

/**
 * Loads who is signed in and keeps anyone without an active account out of
 * the app shell — they go to /onboarding to request access or wait.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, error, reload } = useApi<Me>("/me");
  const [toastMsg, setToastMsg] = useState<{ m: string; tone: "ok" | "bad"; key: number } | null>(null);

  useEffect(() => {
    if (data && data.state !== "active") router.replace("/onboarding");
  }, [data, router]);

  const { lang, setLang } = useLang();
  const accountLang = data?.settings?.language;
  useEffect(() => {
    if (accountLang && accountLang !== lang && !data?.actingAs) setLang(accountLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the account's choice changes
  }, [accountLang]);

  const toast = useCallback((m: string, tone: "ok" | "bad" = "ok") => {
    // Server messages arrive in English; toasts show in the person's language.
    setToastMsg({ m: translate(m, currentLang()), tone, key: Date.now() });
  }, []);

  // Phone notifications: the service worker tells open windows about each
  // alert; the unread count, the Alerts screen and the icon badge follow.
  const active = data?.state === "active";
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void registration();
    const onMessage = (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === "alert") {
        void reload();
        window.dispatchEvent(new Event("gha-alert"));
      } else if (e.data?.type === "open" && e.data.url?.startsWith("/")) {
        router.push(e.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    // Coming back to the app (e.g. after reading a notification elsewhere) refreshes the count.
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, reload, router]);
  useEffect(() => {
    if (typeof data?.unread === "number") setBadge(data.unread);
  }, [data?.unread]);

  if (error) {
    return (
      <Box component="main" sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3, bgcolor: "background.default" }}>
        <Card sx={{ p: 4, maxWidth: 420, textAlign: "center" }}>
          <Typography sx={{ fontWeight: 600 }}>{T("Couldn't load your account")}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
            {error.message}
          </Typography>
          <Button variant="outlined" sx={{ mt: 2.5 }} onClick={() => void reload()}>
            {T("Try again")}
          </Button>
        </Card>
      </Box>
    );
  }

  return (
    <AppCtx.Provider value={{ me: data, reloadMe: reload, toast }}>
      {data?.state === "active" ? children : <Splash />}
      <Snackbar
        key={toastMsg?.key}
        open={Boolean(toastMsg)}
        autoHideDuration={toastMsg?.tone === "bad" ? 6000 : 4500}
        onClose={(_, reason) => reason !== "clickaway" && setToastMsg(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ bottom: { xs: "calc(80px + env(safe-area-inset-bottom))", lg: 24 } }}
      >
        <Alert
          severity={toastMsg?.tone === "bad" ? "error" : "success"}
          variant="filled"
          onClose={() => setToastMsg(null)}
          sx={{ width: "100%", maxWidth: 520 }}
        >
          {toastMsg?.m}
        </Alert>
      </Snackbar>
    </AppCtx.Provider>
  );
}

function Splash() {
  return <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }} aria-busy="true" />;
}
