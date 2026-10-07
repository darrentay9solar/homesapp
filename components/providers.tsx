"use client";

import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";

import { type Lang, LangProvider } from "@/lib/client/i18n";
import { theme } from "@/lib/client/mui-theme";

/**
 * Material UI for the whole app. modeStorageKey/defaultMode match the boot
 * script in app/layout.tsx, so MUI and the first paint agree on Black/Light.
 */
export function Providers({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <LangProvider initial={lang}>
      <ThemeProvider theme={theme} modeStorageKey="gha-theme" defaultMode="dark" disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </LangProvider>
  );
}
