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
import { checkPage, type Finding, type Kind } from "@/lib/client/design-check";

/**
 * DEVELOPMENT ONLY. Loads every screen in a frame at phone, tablet and
 * desktop width, in Black and in Light, and measures it against the design
 * template. Anything listed is a place a screen doesn't match.
 */

const SCREENS: Array<{ name: string; path: string; kind: Kind; click?: string }> = [
  { name: "Sign In", path: "/sign-in", kind: "auth" },
  { name: "Create Account", path: "/sign-up", kind: "auth" },
  { name: "Forgot Password", path: "/forgot-password", kind: "auth" },
  { name: "Request Access", path: "/dev-preview/onboarding", kind: "auth" },
  { name: "Projects", path: "/dev-preview/projects", kind: "app" },
  { name: "Project page", path: "/dev-preview/projects/101", kind: "app" },
  { name: "People", path: "/dev-preview/people", kind: "app" },
  { name: "Audit", path: "/dev-preview/audit", kind: "app" },
  { name: "Account", path: "/dev-preview/account", kind: "app" },
  { name: "Alerts", path: "/dev-preview/alerts", kind: "app" },
  { name: "Sites", path: "/dev-preview/sites", kind: "app" },
  { name: "Template", path: "/dev-preview/template", kind: "app" },
  // Dialogs only exist once opened: these press the button first.
  { name: "Create Project dialog", path: "/dev-preview/projects", kind: "app", click: "Create project" },
  { name: "New Account dialog", path: "/dev-preview/people", kind: "app", click: "New account" },
  { name: "Dialog template", path: "/dev-preview/template", kind: "app", click: "Open the dialog template" },
];
const SIZES: Array<[string, number, number]> = [
  ["Phone", 375, 812],
  ["Tablet", 820, 1180],
  ["Desktop", 1440, 900],
];
const THEMES = ["dark", "light"] as const;

type Result = { screen: string; size: string; theme: string; findings: Finding[] };

async function until(test: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return test();
}

async function measure(path: string, kind: Kind, w: number, h: number, click?: string): Promise<Finding[]> {
  const f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${w + 50}px;top:0;width:${w}px;height:${h}px;border:0;pointer-events:none`;
  f.src = path;
  document.body.appendChild(f);
  try {
    await new Promise<void>((res) => (f.onload = () => res()));
    const doc = f.contentDocument!;
    // Wait until the screen has really drawn: its frame is there and nothing
    // is still a loading placeholder. A busy dev server can take a while.
    const ready = () =>
      kind === "auth"
        ? Boolean(doc.querySelector(".auth .content > *"))
        : Boolean(doc.querySelector("header h1") && doc.querySelector("nav[aria-label=Main], .MuiBottomNavigation-root") && !doc.querySelector(".MuiSkeleton-root"));
    if (!(await until(ready, 20000))) return [{ rule: "Page loads", detail: "didn't finish drawing in 20 seconds" }];
    await new Promise((r) => setTimeout(r, 500)); // fonts and transitions settle
    if (click) {
      const find = () =>
        [...doc.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes(click)) ??
        // On phones "New account" reads "New".
        [...doc.querySelectorAll<HTMLButtonElement>("header button")].find((b) => /^\s*New\s*$/.test(b.textContent ?? ""));
      await until(() => Boolean(find()), 8000);
      find()?.click();
      if (!(await until(() => Boolean(doc.querySelector(".MuiDialog-paper")), 8000))) return [{ rule: "Dialog opens", detail: `couldn't open "${click}"` }];
      await new Promise((r) => setTimeout(r, 700)); // the slide-in finishes
    }
    return checkPage(f.contentWindow!, kind);
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
  const total = SCREENS.length * SIZES.length * THEMES.length;

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
    const out: Result[] = [];
    for (const theme of THEMES) {
      try {
        localStorage.setItem("gha-theme", theme);
        localStorage.setItem("mui-mode", theme);
      } catch {
        /* storage blocked */
      }
      const jobs = SCREENS.flatMap((s) => SIZES.map(([size, w, h]) => ({ s, size, w, h })));
      // A few at a time: fast, without starving the page of CPU.
      for (let i = 0; i < jobs.length; i += 4) {
        const batch = await Promise.all(
          jobs.slice(i, i + 4).map(async ({ s, size, w, h }) => ({ screen: s.name, size, theme, findings: await measure(s.path, s.kind, w, h, s.click) }))
        );
        out.push(...batch);
        setResults([...out]);
        setDone(out.length);
      }
    }
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
            {SCREENS.length} screens × phone, tablet and desktop × Black and Light = {total} checks. Rules come from docs/design/TEMPLATE.md; numbers from lib/client/design.ts.
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
                    <Box key={`${r.size}${r.theme}`} sx={{ mt: 1.25 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {r.size} · {r.theme === "dark" ? "Black" : "Light"}
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
