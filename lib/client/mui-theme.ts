"use client";

import { createTheme } from "@mui/material/styles";

import type { Role } from "./app-state";
import { DESIGN } from "./design";

/**
 * The Material UI theme: 9 Solar Home green, Poppins, Black and Light.
 *
 * MUI drives the same `data-theme` attribute and the same saved setting
 * (localStorage "gha-theme") as the boot script in app/layout.tsx, so the
 * page paints in the right theme before React loads and the prototype's
 * hand-written CSS (sign-in screens) switches in step with MUI components.
 *
 * Sizes, rounding and colours come from the design template (design.ts).
 */

/** A colour per role, so lists of people read at a glance instead of in one tone. */
export const ROLE_COLOR: Record<Role, { light: string; dark: string }> = DESIGN.role;

const R = DESIGN.radius;
const H = DESIGN.height;

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data-theme" },
  // "Desktop" starts where the account screens split in two, so the whole
  // app changes layout at one width.
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: DESIGN.layout.desktopFrom, xl: 1536 } },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: DESIGN.green.light, dark: "#07734A", light: "#3DBA8A", contrastText: "#FFFFFF" },
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
        primary: { main: DESIGN.green.dark, dark: DESIGN.green.header, light: "#3DDC97", contrastText: "#00140C" },
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
    // Chinese characters fall back to the device's own Chinese font (Poppins has none).
    fontFamily: 'var(--font-poppins), "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
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
        root: ({ theme: t }) => ({
          borderRadius: R.button,
          // Disabled stays recognisably green (dimmed), as on the sign-up screens.
          "&.MuiButton-contained.MuiButton-colorPrimary.Mui-disabled": {
            backgroundColor: (t.vars ?? t).palette.primary.main,
            color: (t.vars ?? t).palette.primary.contrastText,
            opacity: 0.38,
          },
        }),
        sizeLarge: { minHeight: H.buttonLarge, borderRadius: R.buttonLarge, fontSize: "0.95rem" },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderRadius: R.card,
          border: `1px solid ${t.vars?.palette.divider ?? t.palette.divider}`,
          backgroundImage: "none",
        }),
      },
    },
    MuiCardActionArea: {
      styleOverrides: { root: { borderRadius: R.card } },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: R.chip },
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
        root: ({ theme: t }) => ({
          borderRadius: R.field,
          "&.Mui-error": {
            backgroundColor: t.vars ? `rgb(${t.vars.palette.error.mainChannel} / 0.1)` : "rgba(206,46,51,0.1)",
            ...t.applyStyles("dark", { backgroundColor: t.vars ? `rgb(${t.vars.palette.error.mainChannel} / 0.2)` : "rgba(240,115,111,0.2)" }),
            "& .MuiOutlinedInput-notchedOutline": { borderWidth: 2, borderColor: (t.vars ?? t).palette.error.main },
          },
        }),
        // 16px on phones: anything smaller makes iOS Safari zoom on focus.
        // 52px tall, the same as the account screens' fields.
        input: ({ ownerState }) => {
          const fixed = ownerState.size !== "small" && !ownerState.multiline;
          return {
            fontSize: 16,
            ...(fixed ? { paddingTop: 14.5, paddingBottom: 14.5 } : {}),
            // 15px text on larger screens; a little more padding keeps 52px.
            "@media (min-width: 768px)": { fontSize: 15, ...(fixed ? { paddingTop: 15.2, paddingBottom: 15.2 } : {}) },
          };
        },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: R.dialog }, paperFullScreen: { borderRadius: 0 } },
    },
    MuiInputLabel: {
      // Labels sitting on the border are green, as on the sign-up screens; red and bold when the field needs fixing.
      styleOverrides: {
        shrink: ({ theme: t }) => ({ color: (t.vars ?? t).palette.primary.main, fontWeight: 500 }),
        root: ({ theme: t }) => ({ "&.Mui-error": { color: (t.vars ?? t).palette.error.main, fontWeight: 700 } }),
      },
    },
    // A field that needs fixing can't be missed: a thick red border on a red-tinted box,
    // and the reason in a solid red bar right under it, bold, with a "!" mark.
    MuiFormHelperText: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          "&.Mui-error": {
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            margin: "6px 0 0",
            padding: "7px 10px",
            borderRadius: R.chip,
            backgroundColor: (t.vars ?? t).palette.error.main,
            color: (t.vars ?? t).palette.error.contrastText,
            fontWeight: 700,
            fontSize: 13,
            lineHeight: 1.4,
            "&::before": {
              content: '"!"',
              flex: "0 0 auto",
              width: 18,
              height: 18,
              marginTop: 0.5,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 800,
              backgroundColor: (t.vars ?? t).palette.error.contrastText,
              color: (t.vars ?? t).palette.error.main,
            },
          },
        }),
      },
    },
    MuiAlert: {
      // The summary above a form's button reads as firmly as the fields it points at.
      styleOverrides: {
        root: ({ theme: t, ownerState }) =>
          ownerState.severity === "error" && (ownerState.variant ?? "standard") === "standard" ? { fontWeight: 600, border: `1.5px solid ${(t.vars ?? t).palette.error.main}` } : {},
      },
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
      styleOverrides: { root: { borderRadius: R.listItem } },
    },
    // Loading placeholders take the shape of the card they stand in for.
    MuiSkeleton: {
      styleOverrides: { rounded: { borderRadius: R.card } },
    },
    // Segmented choices (Black/Light, Group/Individuals/Free text).
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: "none", fontWeight: 600 } },
    },
    MuiToggleButtonGroup: {
      styleOverrides: { root: { borderRadius: R.field } },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
});
