"use client";

import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import IconButton from "@mui/material/IconButton";

import { T } from "@/lib/client/i18n";
import { useTheme } from "@/lib/client/theme";

/** The round sun/moon button on the account screens. `onGreen`: white, for a green header or panel. */
export function ThemeButton({ onGreen = false }: { onGreen?: boolean }) {
  const [theme, setTheme] = useTheme();
  return (
    <IconButton
      title={T("Switch theme")}
      aria-label={theme === "dark" ? T("Switch to light") : T("Switch to black")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      sx={{
        width: 40,
        height: 40,
        border: 1,
        borderColor: onGreen ? "rgba(255,255,255,0.4)" : "divider",
        color: onGreen ? "#fff" : "text.secondary",
        "&:hover": { bgcolor: onGreen ? "rgba(255,255,255,0.12)" : "action.hover" },
        "& svg": { fontSize: 19 },
      }}
    >
      {theme === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
    </IconButton>
  );
}
