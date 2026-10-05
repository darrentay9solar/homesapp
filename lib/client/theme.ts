"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Black or Light, chosen in Account → Appearance and remembered per device.
 * The choice is applied before first paint by the inline script in
 * app/layout.tsx; this hook reads and changes it afterwards.
 */

export type Theme = "dark" | "light";
const KEY = "gha-theme";

function read(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

const listeners = new Set<() => void>();

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "dark" as Theme
  );

  const set = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode: the choice just won't persist */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", t === "light" ? "#ffffff" : "#08090a");
    listeners.forEach((l) => l());
  }, []);

  return [theme, set];
}

/** Runs inline in <head>, before React, so the first paint is already right. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
