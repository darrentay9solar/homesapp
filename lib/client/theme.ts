"use client";

import { useColorScheme } from "@mui/material/styles";
import { useCallback } from "react";

/**
 * Black or Light, chosen in Account → Appearance and remembered per device.
 *
 * Material UI owns the setting (useColorScheme); it writes `data-theme` on
 * <html> and saves to localStorage "gha-theme". The inline boot script
 * below applies the saved choice before React loads, so the first paint is
 * already right.
 */

export type Theme = "dark" | "light";
const KEY = "gha-theme";

export function useTheme(): [Theme, (t: Theme) => void] {
  const { mode, setMode } = useColorScheme();
  const set = useCallback(
    (t: Theme) => {
      setMode(t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#ffffff" : "#08090a");
    },
    [setMode]
  );
  return [mode === "light" ? "light" : "dark", set];
}

/** Runs inline in <head>, before React, so the first paint is already right. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
