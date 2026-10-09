"use client";

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { Page } from "@/components/shell";
import { GRID, Heading, TopBar } from "@/components/topbar";
import { checkPage, checkPickers, type Finding, type Kind } from "@/lib/client/design-check";
import { type Lang, LANG_COOKIE, translate } from "@/lib/client/i18n";

/**
 * DEVELOPMENT ONLY. Loads every screen in a frame at phone, tablet and
 * desktop width, in Black and in Light, in English and in Chinese, and
 * measures it against the design template. Every date and time field on a
 * screen must also open its picker when tapped anywhere on the field.
 * Anything listed is a place a screen doesn't match.
 *
 * `click` opens something first: "[data-testid=…]" (":last" for the last
 * match), or a button's English words (matched in the language being checked).
 * `opens` is false when the click doesn't open a dialog.
 */

const SCREENS: Array<{ name: string; path: string; kind: Kind; click?: string; opens?: boolean }> = [
  { name: "Sign In", path: "/sign-in", kind: "auth" },
  { name: "Create Account", path: "/sign-up", kind: "auth" },
  { name: "Forgot Password", path: "/forgot-password", kind: "auth" },
  { name: "Request Access", path: "/dev-preview/onboarding", kind: "auth" },
  { name: "Demo sign-in", path: "/dev-preview/demo", kind: "auth" },
  { name: "Projects", path: "/dev-preview/projects", kind: "app" },
  { name: "Project page · fields", path: "/dev-preview/projects/101", kind: "app" },
  { name: "Project page · approval", path: "/dev-preview/projects/103", kind: "app" },
  { name: "Project page · sign", path: "/dev-preview/projects/105", kind: "app" },
  { name: "Project page · signed", path: "/dev-preview/projects/106", kind: "app" },
  { name: "Project page · closed", path: "/dev-preview/projects/107", kind: "app" },
  { name: "Project page · details", path: "/dev-preview/projects/101?tab=details", kind: "app" },
  { name: "Project page · site visits", path: "/dev-preview/projects/101?tab=visits", kind: "app" },
  { name: "Edit Project dialog", path: "/dev-preview/projects/101?tab=details", kind: "app", click: "Edit" },
  { name: "People", path: "/dev-preview/people", kind: "app" },
  { name: "People · groups", path: "/dev-preview/people?tab=groups", kind: "app" },
  { name: "People · requests", path: "/dev-preview/people?tab=requests", kind: "app" },
  { name: "People · map", path: "/dev-preview/people?tab=map", kind: "app" },
  { name: "Audit", path: "/dev-preview/audit", kind: "app" },
  { name: "Account", path: "/dev-preview/account", kind: "app" },
  { name: "Account · security", path: "/dev-preview/account?tab=security", kind: "app" },
  { name: "Account · settings", path: "/dev-preview/account?tab=settings", kind: "app" },
  { name: "Account · access", path: "/dev-preview/account?tab=access", kind: "app" },
  { name: "Alerts", path: "/dev-preview/alerts", kind: "app" },
  { name: "Sites", path: "/dev-preview/sites", kind: "app" },
  { name: "Check Out dialog", path: "/dev-preview/sites", kind: "app", click: "Check Out" },
  { name: "Sites · due today", path: "/dev-preview/sites?tab=today", kind: "app" },
  { name: "Schedule Visit dialog", path: "/dev-preview/projects/101?tab=visits", kind: "app", click: "Schedule visit" },
  { name: "My Files", path: "/dev-preview/files", kind: "app" },
  { name: "Change Mobile dialog", path: "/dev-preview/account", kind: "app", click: "[data-testid=edit-mobile]" },
  { name: "Change Password dialog", path: "/dev-preview/account?tab=security", kind: "app", click: "[data-testid=edit-password]" },
  { name: "Change Email dialog", path: "/dev-preview/account", kind: "app", click: "[data-testid=edit-email]" },
  { name: "Role Change review", path: "/dev-preview/people?tab=requests", kind: "app", click: "[data-testid=role-review]" },
  { name: "Account Request review", path: "/dev-preview/people?tab=requests", kind: "app", click: "[data-testid=request-review]" },
  { name: "Person dialog · schedule", path: "/dev-preview/people", kind: "app", click: "[data-testid=person-card]:last" },
  { name: "Notifications dialog", path: "/dev-preview/account?tab=settings", kind: "app", click: "[data-testid=edit-notifications]" },
  { name: "Everyone's files", path: "/dev-preview/files", kind: "app", click: "[data-testid=files-scope]", opens: false },
  { name: "Template", path: "/dev-preview/template", kind: "app" },
  // Dialogs only exist once opened: these press the button first.
  { name: "Create Project dialog", path: "/dev-preview/projects", kind: "app", click: "Create project" },
  { name: "New Account dialog", path: "/dev-preview/people", kind: "app", click: "New account" },
  { name: "Template · maps", path: "/dev-preview/template?tab=maps", kind: "app" },
  { name: "Dialog template", path: "/dev-preview/template?tab=dialog", kind: "app", click: "Open the dialog template" },
  { name: "Sign Certificate dialog", path: "/dev-preview/projects/105", kind: "app", click: "Review & sign" },
  { name: "Close Project dialog", path: "/dev-preview/projects/106", kind: "app", click: "Close project" },
];
const SIZES: Array<[string, number, number]> = [
  ["Phone", 375, 812],
  ["Tablet", 820, 1180],
  ["Desktop", 1440, 900],
];
const THEMES = ["dark", "light"] as const;
const LANGS: Lang[] = ["en", "zh"];

type Result = { screen: string; size: string; theme: string; lang: Lang; findings: Finding[] };

function setLangCookie(l: Lang) {
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
}

async function until(test: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return test();
}

async function measure(path: string, kind: Kind, w: number, h: number, lang: Lang, click?: string, opens = true): Promise<Finding[]> {
  const f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${w + 50}px;top:0;width:${w}px;height:${h}px;border:0;pointer-events:none`;
  f.src = path;
  document.body.appendChild(f);
  try {
    await new Promise<void>((res) => (f.onload = () => res()));
    const doc = f.contentDocument!;
    // Wait until the screen has really drawn: its frame is there and nothing
    // is still a loading placeholder. A busy dev server can take a while.
    // Only what's showing counts: Next keeps a hidden copy of a nearby page drawn.
    const seen = (sel: string) => [...doc.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0);
    const ready = () =>
      kind === "auth" ? seen("[data-auth=content] > *") : seen("header h1") && seen("nav, .MuiBottomNavigation-root") && !seen(".MuiSkeleton-root");
    if (!(await until(ready, 20000))) return [{ rule: "Page loads", detail: "didn't finish drawing in 20 seconds" }];
    await new Promise((r) => setTimeout(r, 500)); // fonts and transitions settle
    if (click) {
      const words = translate(click, lang);
      const short = translate("New", lang);
      // Only what's showing: Next keeps a hidden copy of a nearby page drawn.
      const shown = (sel: string) => [...doc.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getClientRects().length > 0);
      const find = () => {
        // "[data-testid=…]" picks one button when several say the same thing ("Change").
        if (click.startsWith("[")) {
          const all = shown(click.replace(/:last$/, ""));
          return click.endsWith(":last") ? all[all.length - 1] : all[0];
        }
        return (
          shown("button").find((b) => (b.textContent ?? "").includes(words)) ??
          // On phones "New account" reads "New".
          shown("header button").find((b) => (b.textContent ?? "").trim() === short)
        );
      };
      await until(() => Boolean(find()), 8000);
      find()?.click();
      if (opens) {
        if (!(await until(() => Boolean(doc.querySelector(".MuiDialog-paper")), 8000))) return [{ rule: "Dialog opens", detail: `couldn't open "${click}"` }];
        await new Promise((r) => setTimeout(r, 700)); // the slide-in finishes
      } else {
        await new Promise((r) => setTimeout(r, 1500));
        await until(() => !seen(".MuiSkeleton-root"), 8000);
      }
    }
    return [...checkPage(f.contentWindow!, kind), ...checkPickers(f.contentWindow!)];
  } catch (err) {
    return [{ rule: "Page loads", detail: String(err) }];
  } finally {
    f.remove();
  }
}

export default function DesignCheckPage() {
  // For checking the checker from the console: __checkPage(frame.contentWindow, "app").
  useEffect(() => {
    (window as unknown as { __checkPage: typeof checkPage }).__checkPage = checkPage;
  }, []);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const total = SCREENS.length * SIZES.length * THEMES.length * LANGS.length;

  async function run() {
    setRunning(true);
    setResults([]);
    setDone(0);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("gha-theme");
    } catch {
      /* storage blocked */
    }
    const lang0: Lang = /(?:^|;\s*)gha-lang=zh\b/.test(document.cookie) ? "zh" : "en";
    const out: Result[] = [];
    for (const lang of LANGS) {
      setLangCookie(lang);
      for (const theme of THEMES) {
        try {
          localStorage.setItem("gha-theme", theme);
          localStorage.setItem("mui-mode", theme);
        } catch {
          /* storage blocked */
        }
        // ?only=signed checks just the screens whose name contains "signed".
        const only = new URLSearchParams(window.location.search).get("only")?.toLowerCase();
        const screens = only ? SCREENS.filter((s) => s.name.toLowerCase().includes(only)) : SCREENS;
        const jobs = screens.flatMap((s) => SIZES.map(([size, w, h]) => ({ s, size, w, h })));
        // A few at a time: fast, without starving the page of CPU.
        for (let i = 0; i < jobs.length; i += 4) {
          const batch = await Promise.all(
            jobs.slice(i, i + 4).map(async ({ s, size, w, h }) => ({ screen: s.name, size, theme, lang, findings: await measure(s.path, s.kind, w, h, lang, s.click, s.opens) }))
          );
          out.push(...batch);
          setResults([...out]);
          setDone(out.length);
        }
      }
    }
    setLangCookie(lang0);
    try {
      if (saved) {
        localStorage.setItem("gha-theme", saved);
        localStorage.setItem("mui-mode", saved);
      }
    } catch {
      /* storage blocked */
    }
    (window as unknown as { __designCheck: Result[] }).__designCheck = out;
    setRunning(false);
  }

  const failing = results.filter((r) => r.findings.length);
  const byScreen = SCREENS.map((s) => ({ s, rows: results.filter((r) => r.screen === s.name) })).filter((x) => x.rows.length);

  return (
    <>
      <TopBar
        title="Design check"
        sub="Every screen against the template"
        action={
          <Button onClick={() => void run()} disabled={running} startIcon={<PlayArrowRoundedIcon />} sx={{ color: "#073f2b", bgcolor: "#fff", px: 2, height: 36, "&:hover": { bgcolor: "#eafff4" } }}>
            {running ? "Checking…" : "Run check"}
          </Button>
        }
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
            {SCREENS.length} screens × phone, tablet and desktop × Black and Light × English and Chinese = {total} checks. Rules come from docs/design/TEMPLATE.md; numbers from lib/client/design.ts.
          </Typography>
          {running && <LinearProgress variant="determinate" value={(done / total) * 100} sx={{ mt: 2, height: 6, borderRadius: 3 }} />}
          {!running && results.length === total && (
            <Alert severity={failing.length ? "error" : "success"} sx={{ mt: 2 }} data-testid="design-check-summary">
              {failing.length ? `${failing.length} of ${total} checks found something that doesn't match.` : `All ${total} checks match the template.`}
            </Alert>
          )}

          {byScreen.length > 0 && <Heading title="Screens" count={byScreen.length} />}
          <Box sx={GRID}>
            {byScreen.map(({ s, rows }) => {
              const bad = rows.filter((r) => r.findings.length);
              return (
                <Card key={s.name} sx={{ p: 2 }} data-testid="design-check-screen">
                  <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                    {bad.length ? <ErrorOutlineRoundedIcon color="error" /> : <CheckCircleRoundedIcon color="success" />}
                    <Typography sx={{ fontWeight: 600, flex: 1 }}>{s.name}</Typography>
                    <Chip size="small" label={s.kind === "auth" ? "Account screen" : "App screen"} variant="outlined" />
                  </Stack>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {s.path} · {rows.length - bad.length} of {rows.length} match
                  </Typography>
                  {bad.map((r) => (
                    <Box key={`${r.size}${r.theme}${r.lang}`} sx={{ mt: 1.25 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {r.size} · {r.theme === "dark" ? "Black" : "Light"} · {r.lang === "zh" ? "中文" : "English"}
                      </Typography>
                      {r.findings.map((f, i) => (
                        <Typography key={i} variant="body2" sx={{ color: "error.main", fontSize: 13 }}>
                          {f.rule}: {f.detail}
                        </Typography>
                      ))}
                    </Box>
                  ))}
                </Card>
              );
            })}
          </Box>
        </Page>
      </Box>
    </>
  );
}
