"use client";

import { createTheme } from "@mui/material/styles";

import type { Role } from "./app-state";

/**
 * The Material UI theme: 9 Solar Home green, Poppins, Black and Light.
 *
 * MUI drives the same `data-theme` attribute and the same saved setting
 * (localStorage "gha-theme") as the boot script in app/layout.tsx, so the
 * page paints in the right theme before React loads and the prototype's
 * hand-written CSS (sign-in screens) switches in step with MUI components.
 */

/** A colour per role, so lists of people read at a glance instead of in one tone. */
export const ROLE_COLOR: Record<Role, { light: string; dark: string }> = {
  homeowner: { light: "#2563EB", dark: "#60A5FA" },
  contractor: { light: "#B45309", dark: "#FBBF24" },
  epc_team: { light: "#7C3AED", dark: "#A78BFA" },
  project_manager: { light: "#0A9A63", dark: "#3DDC97" },
};

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data-theme" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#0A9A63", dark: "#07734A", light: "#3DBA8A", contrastText: "#FFFFFF" },
        secondary: { main: "#2563EB" },
        success: { main: "#0A9A63" },
        warning: { main: "#B7791F" },
        error: { main: "#CE2E33" },
        info: { main: "#2A6FBF" },
        background: { default: "#F3F6F4", paper: "#FFFFFF" },
        text: { primary: "#0A0F0C", secondary: "#5B655F" },
        divider: "rgba(0,0,0,0.08)",
      },
    },
    dark: {
      palette: {
        primary: { main: "#16C47F", dark: "#0E7F53", light: "#3DDC97", contrastText: "#00140C" },
        secondary: { main: "#60A5FA" },
        success: { main: "#16C47F" },
        warning: { main: "#E0A23A" },
        error: { main: "#F0736F" },
        info: { main: "#4C9AE8" },
        background: { default: "#050606", paper: "#111314" },
        text: { primary: "#F4F6F5", secondary: "#9AA29E" },
        divider: "rgba(255,255,255,0.09)",
      },
    },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'var(--font-poppins), "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif',
    h4: { fontWeight: 600, letterSpacing: "-0.02em" },
    h5: { fontWeight: 600, letterSpacing: "-0.015em" },
    h6: { fontWeight: 600, letterSpacing: "-0.01em" },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
    overline: { fontWeight: 600, letterSpacing: "0.14em", fontSize: "0.68rem" },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 12 },
        sizeLarge: { minHeight: 48, fontSize: "0.95rem" },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderRadius: 18,
          border: `1px solid ${t.vars?.palette.divider ?? t.palette.divider}`,
          backgroundImage: "none",
        }),
      },
    },
    MuiCardActionArea: {
      styleOverrides: { root: { borderRadius: 18 } },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 8 },
        sizeSmall: { height: 24, fontSize: "0.72rem" },
      },
    },
    MuiAvatar: {
      styleOverrides: { root: { fontWeight: 600, fontSize: "0.9rem" } },
    },
    MuiTextField: {
      defaultProps: { fullWidth: true },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 12 },
        // 16px on phones: anything smaller makes iOS Safari zoom on focus.
        input: { fontSize: 16, "@media (min-width: 768px)": { fontSize: 15 } },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 22 }, paperFullScreen: { borderRadius: 0 } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: { minWidth: 0, "& .MuiBottomNavigationAction-label": { fontSize: "0.68rem", fontWeight: 500 } },
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
});
