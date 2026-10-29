"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useSyncExternalStore } from "react";

import { T } from "@/lib/client/i18n";

/**
 * Whether projects and maintenance records show their warnings on screen: the red card, red edge and
 * red progress, "Late" and "Issue", the warning lines, the "Needs attention" banners and the urgent
 * line. A switch on the Projects and Maintenance pages, kept on this device; off unless turned on
 * (an A/B look since 29 Oct 2026).
 *
 * Only the screens change: the flags are still worked out, the "Needs attention" filters still work,
 * and alerts are still sent.
 */
const KEY = "gha.showWarnings";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
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

export function setShowWarnings(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage blocked (a private window): the switch still works until the page reloads.
  }
  for (const l of listeners) l();
}

/** Whether warnings show on this device. */
export function useShowWarnings(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Whether something flagged shows as flagged: only while warnings are switched on. */
export function useFlagged(): (attention: boolean | null | undefined) => boolean {
  const show = useShowWarnings();
  return (attention) => show && Boolean(attention);
}

/** The switch itself, beside a page's title. */
export function WarningsSwitch() {
  const show = useShowWarnings();
  return (
    <FormControlLabel
      control={<Switch size="small" checked={show} onChange={(e) => setShowWarnings(e.target.checked)} slotProps={{ input: { "data-testid": "warnings-switch" } as object }} />}
      label={<Typography variant="body2">{T("Show warnings")}</Typography>}
      sx={{ mr: 0, ml: 0 }}
    />
  );
}
