"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { I } from "@/components/icons";

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
  const [toastMsg, setToastMsg] = useState<{ m: string; tone: "ok" | "bad" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data && data.state !== "active") router.replace("/onboarding");
  }, [data, router]);

  const toast = useCallback((m: string, tone: "ok" | "bad" = "ok") => {
    setToastMsg({ m, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3200);
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
      {toastMsg && (
        <div className={`toast ${toastMsg.tone === "bad" ? "bad" : ""}`} role="status">
          {toastMsg.tone === "bad" ? <I.alert size={17} /> : <I.bolt size={17} />}
          <span>{toastMsg.m}</span>
        </div>
      )}
    </AppCtx.Provider>
  );
}

function Splash() {
  return <div style={{ minHeight: "100dvh", background: "var(--surface)" }} aria-busy="true" />;
}
