"use client";

import { useTheme } from "@/lib/client/theme";

import { I } from "./icons";

/** The round sun/moon button on the sign-in screen. */
export function ThemeButton() {
  const [theme, setTheme] = useTheme();
  return (
    <button
      className="icobtn"
      title="Switch theme"
      aria-label={theme === "dark" ? "Switch to light" : "Switch to black"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <I.sun /> : <I.moon />}
    </button>
  );
}

/** The Black / Light segmented control in Account → Appearance. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="themetoggle" role="radiogroup" aria-label="Appearance">
      <button className={theme === "dark" ? "on" : ""} role="radio" aria-checked={theme === "dark"} onClick={() => setTheme("dark")}>
        <I.moon />
        Black
      </button>
      <button className={theme === "light" ? "on" : ""} role="radio" aria-checked={theme === "light"} onClick={() => setTheme("light")}>
        <I.sun />
        Light
      </button>
    </div>
  );
}
