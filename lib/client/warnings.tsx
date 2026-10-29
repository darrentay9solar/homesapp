"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useEffect, useSyncExternalStore } from "react";

import { useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { T } from "@/lib/client/i18n";

/**
 * Whether projects and maintenance records show their warnings on screen: the red card, red edge and
 * red progress, "Late" and "Issue", the warning lines, the "Needs attention" banners and the urgent
 * line. A switch on the Projects and Maintenance pages; off unless turned on (an A/B look since
 * 29 Oct 2026).
 *
 * Its last position is kept with the person's account (users.show_warnings, migration 0060), so it's
 * the same on every device they sign in on; this device keeps a copy so the page opens the right way
 * at once. Only the screens change: the flags are still worked out, the "Needs attention" filters
 * still work, and alerts are still sent.
 */
const KEY = "gha.showWarnings";
const listeners = new Set<() => void>();
// Flipped here and not yet saved to the account: the account's older answer mustn't flip it back.
let pending: boolean | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function keep(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage blocked (a private window): the account still has it.
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab flipping it changes this one too.
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether warnings show: the account's choice, as this device last knew it. */
export function useShowWarnings(): boolean {
  const { me } = useApp();
  const account = me?.settings?.showWarnings;
  useEffect(() => {
    if (typeof account !== "boolean") return;
    if (pending !== null) {
      if (account === pending) pending = null;
      return;
    }
    if (account !== read()) keep(account);
  }, [account]);
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Whether something flagged shows as flagged: only while warnings are switched on. */
export function useFlagged(): (attention: boolean | null | undefined) => boolean {
  const show = useShowWarnings();
  return (attention) => show && Boolean(attention);
}

/** The switch itself, beside a page's heading. Its position is saved to the account as it's flipped. */
export function WarningsSwitch() {
  const show = useShowWarnings();
  const { me, reloadMe } = useApp();
  const fetcher = useFetcher();
  const flip = (on: boolean) => {
    keep(on);
    // Acting as someone else (or in the demo): this device only, never their account.
    if (me?.actingAs) return;
    pending = on;
    void fetcher("/me/settings", { method: "PATCH", json: { showWarnings: on } }).then(
      () => reloadMe(),
      () => undefined,
    );
  };
  return (
    <FormControlLabel
      control={<Switch size="small" checked={show} onChange={(e) => flip(e.target.checked)} slotProps={{ input: { "data-testid": "warnings-switch" } as object }} />}
      label={<Typography variant="body2">{T("Show warnings")}</Typography>}
      sx={{ mr: 0, ml: 0 }}
    />
  );
}
