"use client";

import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import IconButton from "@mui/material/IconButton";

import { type Lang, T, useLang } from "@/lib/client/i18n";
import { useTheme } from "@/lib/client/theme";

/** Shared look: a 40px round button; `onGreen` makes it white, for a green header or panel. */
const round = (onGreen: boolean) => ({
  width: 40,
  height: 40,
  flex: "0 0 auto",
  border: 1,
  borderColor: onGreen ? "rgba(255,255,255,0.4)" : "divider",
  color: onGreen ? "#fff" : "text.secondary",
  "&:hover": { bgcolor: onGreen ? "rgba(255,255,255,0.12)" : "action.hover" },
  "& svg": { fontSize: 19 },
});

/** The round sun/moon button: one tap swaps Light and Black. */
export function ThemeButton({ onGreen = false }: { onGreen?: boolean }) {
  const [theme, setTheme] = useTheme();
  return (
    <IconButton
      title={T("Switch theme")}
      aria-label={theme === "dark" ? T("Switch to light") : T("Switch to black")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      data-testid="theme-button"
      sx={round(onGreen)}
    >
      {theme === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
    </IconButton>
  );
}

/**
 * The same round button for the language: one tap swaps English and 简体中文.
 * It shows the language you'd switch to ("中" in English, "EN" in Chinese).
 * `onChange` also saves it to the account when someone is signed in.
 */
export function LangButton({ onGreen = false, onChange }: { onGreen?: boolean; onChange?: (l: Lang) => void }) {
  const { lang, setLang } = useLang();
  const next: Lang = lang === "zh" ? "en" : "zh";
  return (
    <IconButton
      title={T("Switch language")}
      aria-label={next === "zh" ? "切换到中文 (Switch to Chinese)" : "Switch to English (切换到英文)"}
      onClick={() => {
        setLang(next);
        onChange?.(next);
      }}
      data-testid="lang-button"
      sx={{ ...round(onGreen), fontFamily: "inherit", fontWeight: 700, fontSize: next === "zh" ? 16 : 12.5, lineHeight: 1 }}
    >
      {next === "zh" ? "中" : "EN"}
    </IconButton>
  );
}
