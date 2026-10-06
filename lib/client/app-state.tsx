"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";

import { useApi } from "./api";

export type Role = "homeowner" | "project_manager" | "contractor" | "epc_team";

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
  };
  unread?: number;
  /** Development only: a project manager testing as this account. */
  actingAs?: { byName: string | null; byUid: number };
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

  const toast = useCallback((m: string, tone: "ok" | "bad" = "ok") => {
    setToastMsg({ m, tone, key: Date.now() });
  }, []);

  if (error) {
    return (
      <main className="login">
        <div className="empty">
          Couldn&apos;t load your account: {error.message}
          <div style={{ marginTop: 14 }}>
            <button className="btn g" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        </div>
      </main>
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
  return <div style={{ minHeight: "100dvh", background: "var(--surface)" }} aria-busy="true" />;
}
