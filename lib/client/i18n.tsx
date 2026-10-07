"use client";

/**
 * English or Simplified Chinese, everywhere.
 *
 * One dictionary, api/_lib/i18n/zh.json, shared with the server (which uses
 * it for phone notifications and emails). Keys are the English text:
 *
 *   t("Change your name")                         the app's own words
 *   t("Checked in at {time}", { time: "09:12" })  with values filled in
 *   tr(serverMessage)                             a message from the server, matched
 *                                                 against patterns like "{name} is now {role}."
 *
 * Anything without a translation stays in English rather than disappearing.
 * The choice lives in a cookie (so the first paint is already right), in the
 * person's account (so it follows them to another phone), and on <html lang>.
 */

import { createContext, Fragment, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import zh from "@/api/_lib/i18n/zh.json";

export type Lang = "en" | "zh";
export const LANGS: Array<{ value: Lang; label: string; native: string }> = [
  { value: "en", label: "English", native: "English" },
  { value: "zh", label: "Chinese (Simplified)", native: "简体中文" },
];
export const LANG_COOKIE = "gha-lang";

const EXACT = zh as Record<string, string>;
// Placeholders that are always one word (a count, a number): they never swallow
// the rest of a line, so "Milestone {n}" can't match "Milestone 2 complete · …".
// Kept the same as ONE_WORD in api/_lib/i18n.py.
const ONE_WORD = new Set(["n", "n2", "days", "left", "wait", "mins", "mins2", "crew", "m", "shown", "used", "outcomes", "fields", "MAX_BYTES", "CODE_MINUTES", "pid", "code"]);
type Pattern = { rx: RegExp; zh: string; names: string[]; fixed: number };
let PATTERNS: Pattern[] | null = null;

function patterns(): Pattern[] {
  if (PATTERNS) return PATTERNS;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  PATTERNS = Object.entries(EXACT)
    .filter(([en, z]) => z && /\{\w+\}/.test(en))
    .map(([en, z]) => {
      const names = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const parts = en.split(/\{\w+\}/);
      const rx = parts.map((p, i) => esc(p) + (i < names.length ? (ONE_WORD.has(names[i]) ? "(\\S+?)" : "([\\s\\S]+?)") : "")).join("");
      return { rx: new RegExp(`^${rx}$`), zh: z, names, fixed: parts.join("").length };
    })
    // The most specific first: the most fixed words ("Running late · {p}" before
    // "{x} · {y}"), then the fewest blanks.
    .sort((a, b) => b.fixed - a.fixed || a.names.length - b.names.length);
  return PATTERNS;
}

/** Text from outside the app's own code (the server), in `lang`. */
export function translate(text: string | null | undefined, lang: Lang): string {
  if (!text) return text ?? "";
  if (lang !== "zh") return text;
  if (EXACT[text]) return EXACT[text];
  for (const p of patterns()) {
    const m = p.rx.exec(text);
    if (m) return p.names.reduce((out, n, i) => out.replace(`{${n}}`, translate(m[i + 1], lang)), p.zh);
  }
  return text;
}

type Params = Record<string, string | number | null | undefined>;

/** The app's own text: the English key in `lang`, with values filled in (and translated if they're phrases). */
export function interpolate(key: string, params: Params | undefined, lang: Lang): string {
  const base = lang === "zh" ? EXACT[key] || key : key;
  if (!params) return base;
  return base.replace(/\{(\w+)\}/g, (all, n: string) => {
    const v = params[n];
    if (v === null || v === undefined) return "";
    return typeof v === "number" ? String(v) : translate(v, lang);
  });
}

// For code outside React (toasts, error messages, date helpers): the cookie
// as the page loads, then whatever the person picks.
let current: Lang = typeof document !== "undefined" && /(?:^|;\s*)gha-lang=zh\b/.test(document.cookie) ? "zh" : "en";
export function currentLang(): Lang {
  return current;
}
/** The date/number locale for the current language. */
export function locale(lang: Lang = current): string {
  return lang === "zh" ? "zh-SG" : "en-SG";
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Params) => string;
  tr: (text: string | null | undefined) => string;
};

const LangCtx = createContext<Ctx>({
  lang: "en",
  setLang: () => undefined,
  t: (k, p) => interpolate(k, p, "en"),
  tr: (s) => s ?? "",
});

export function readLangCookie(cookie: string | undefined | null): Lang {
  return /(?:^|;\s*)gha-lang=zh\b/.test(cookie ?? "") ? "zh" : "en";
}

export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-Hans-SG" : "en-SG";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    current = l;
    setLangState(l);
    try {
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
    } catch {
      /* cookies blocked: it still works for this visit */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t: (k, p) => interpolate(k, p, lang), tr: (s) => translate(s, lang) }),
    [lang, setLang]
  );
  // Keyed on the language: switching redraws the app once, so every T("…")
  // anywhere (not only in components that read the context) shows the new one.
  return (
    <LangCtx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangCtx.Provider>
  );
}

export function useLang(): Ctx {
  return useContext(LangCtx);
}

/** Shorthand for the common case. */
export function useT() {
  return useContext(LangCtx).t;
}

/**
 * The app's own words, in the current language, usable anywhere (components,
 * label tables, helpers). The app redraws when the language changes, so these
 * always match it.
 */
export function T(key: string, params?: Params): string {
  return interpolate(key, params, current);
}

/** Text from the server (messages, labels, alert titles), in the current language. */
export function TR(text: string | null | undefined): string {
  return translate(text, current);
}
