/**
 * Maintenance: the shapes GET /maintenance returns and the pure logic behind
 * the page: its tabs, search, and how a system's contract and hardware read.
 * No React, so it can be unit tested (tests/maintenance.test.ts).
 */

import { currentLang, interpolate, type Lang } from "./i18n";
import { normalise, tokens } from "./people-search";

export type CheckKey = "six_month" | "one_year";
export type CheckState = "done" | "overdue" | "due_soon" | "scheduled" | "unscheduled";
export type Check = { key: CheckKey; label: string; due: string | null; doneOn: string | null; state: CheckState };
export type PanelSet = { count: number; wp: number | null };

export type MaintenanceSystem = {
  id: number;
  address: string;
  postalCode: string | null;
  imported: boolean;
  project: { id: number; name: string | null; status: string | null } | null;
  pm: { uid: number | null; name: string | null };
  homeowner: { uid: number | null; name: string | null; linked: boolean };
  contactNo: string | null;
  ppa: { kind: "ppa" | "value_buy"; years: number | null } | null;
  plan: { years: number; excludesFirstYear: boolean } | null;
  panels: PanelSet[];
  panelCount: number;
  kwp: number | null;
  phase: 1 | 3 | null;
  inverters: string[];
  turnedOn: string | null;
  checks: Check[];
  next: Check | null;
  roofAccess: boolean | null;
  urgent: boolean;
  urgentNote: string | null;
  notes: string | null;
  attention: boolean;
  updatedAt: string;
};

export type Manager = { uid: number; name: string };
export type MaintenanceList = { systems: MaintenanceSystem[]; today: string; canAssign: boolean; managers: Manager[] };
export type MaintenanceDetail = {
  system: MaintenanceSystem;
  project: { id: number; name: string | null; signedAt: string | null; closedAt: string | null; certificate: string | null } | null;
  canEdit: boolean;
  canAssign: boolean;
  managers: Manager[];
};

// ------------------------------------------------------------- how it reads

/** "5-year PPA", "Value buy". */
export function ppaText(s: Pick<MaintenanceSystem, "ppa">, lang: Lang = currentLang()): string | null {
  if (!s.ppa) return null;
  if (s.ppa.kind === "value_buy") return interpolate("Value buy", undefined, lang);
  return interpolate("{n}-year PPA", { n: s.ppa.years ?? 0 }, lang);
}

/** "Free for 5 years", "7 years excluding 1st year": as the project listing words it. */
export function planText(s: Pick<MaintenanceSystem, "plan">, lang: Lang = currentLang()): string | null {
  if (!s.plan) return null;
  return interpolate(s.plan.excludesFirstYear ? "{n} years excluding 1st year" : "Free for {n} years", { n: s.plan.years }, lang);
}

export function phaseText(phase: 1 | 3 | null, lang: Lang = currentLang()): string | null {
  return phase === 1 ? interpolate("Single-phase", undefined, lang) : phase === 3 ? interpolate("3-phase", undefined, lang) : null;
}

/** "22 × 620 Wp", or "23 × 635 Wp + 3 × 620 Wp" for a mixed roof. */
export function panelText(panels: PanelSet[], lang: Lang = currentLang()): string | null {
  if (!panels.length) return null;
  return panels.map((p) => (p.wp ? `${p.count} × ${p.wp} Wp` : interpolate("{n} panels", { n: p.count }, lang))).join(" + ");
}

/** "2 × SUN2000-5KTL-L1", "SUN2000-5KTL-L1 + SUN2000-10K-LC0": repeats counted, order kept. */
export function inverterText(models: string[]): string | null {
  if (!models.length) return null;
  const counts = new Map<string, number>();
  for (const m of models) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([m, n]) => (n > 1 ? `${n} × ${m}` : m)).join(" + ");
}

export function kwpText(kwp: number | null): string | null {
  if (kwp === null) return null;
  return `${kwp.toLocaleString("en-SG", { maximumFractionDigits: 3 })} kWp`;
}

// --------------------------------------------------------------------- tabs

export type MTab = "all" | "attention" | "due" | "unassigned" | "done";
export const MTABS: Array<[MTab, string]> = [
  ["all", "All"],
  ["attention", "Attention"],
  ["due", "Due soon"],
  ["unassigned", "Unassigned"],
  ["done", "Checks done"],
];

export function inMTab(s: MaintenanceSystem, tab: MTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "attention":
      return s.attention;
    case "due":
      return s.next?.state === "due_soon";
    case "unassigned":
      return s.pm.uid === null;
    case "done":
      return s.checks.length > 0 && s.checks.every((c) => c.state === "done");
  }
}

/**
 * Every word must match something: the address or postal code, the homeowner,
 * the manager, the inverter or panels, the contract, or words like "urgent",
 * "overdue" and "unassigned".
 */
export function matchesSystem(s: MaintenanceSystem, query: string): boolean {
  const words = tokens(query);
  if (!words.length) return true;
  const overdue = s.checks.some((c) => c.state === "overdue");
  const hay = normalise(
    [
      s.address,
      s.postalCode ?? "",
      s.homeowner.name ?? "",
      s.contactNo ?? "",
      s.pm.name ?? "unassigned 未分配",
      s.project?.name ?? "",
      ...s.inverters,
      panelText(s.panels) ?? "",
      kwpText(s.kwp) ?? "",
      ppaText(s) ?? "",
      planText(s) ?? "",
      s.ppa?.kind === "value_buy" ? "value buy" : s.ppa ? `ppa ${s.ppa.years} years` : "",
      phaseText(s.phase) ?? "",
      s.phase === 1 ? "single 1p 单相" : s.phase === 3 ? "three 3p 三相" : "",
      s.urgent ? `urgent 紧急 ${s.urgentNote ?? ""}` : "",
      overdue ? "overdue late 逾期" : "",
      s.next?.state === "due_soon" ? "due soon 即将到期" : "",
    ].join(" | ")
  );
  return words.every((w) => hay.includes(w));
}

export function filterSystems(list: MaintenanceSystem[], f: { query?: string; tab?: MTab }): MaintenanceSystem[] {
  return list.filter((s) => inMTab(s, f.tab ?? "all") && matchesSystem(s, f.query ?? ""));
}

/** Urgent first, then overdue, then by when the next check is due (soonest first), then by address. */
export function sortSystems(list: MaintenanceSystem[]): MaintenanceSystem[] {
  const rank = (s: MaintenanceSystem) => (s.urgent ? 0 : s.checks.some((c) => c.state === "overdue") ? 1 : 2);
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || (a.next?.due ?? "9999").localeCompare(b.next?.due ?? "9999") || a.address.localeCompare(b.address)
  );
}

// -------------------------------------------------------------------- dates

/** "2025-12-31" plus 6 months is "2026-06-30": the month's last day when it's shorter, as the listing does. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + n;
  const year = y + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Today in Singapore, as YYYY-MM-DD. */
export function sgToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}
