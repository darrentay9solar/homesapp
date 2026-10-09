/** The dashboard's data (GET /analytics, api/_lib/analytics.py) and how its numbers read. */

import { locale, T } from "./i18n";
import type { ProjectStatus } from "./projects";

export type Period = "30d" | "90d" | "12m" | "all";
export const PERIODS: Array<[Period, string]> = [
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["12m", "Last 12 months"],
  ["all", "All time"],
];

export type TileKey = "ongoing" | "late" | "noShow" | "awaitingHomeowner" | "awaitingPm" | "handover" | "closed" | "new";
export type Tile = { count: number; ids: number[]; delta?: number | null };
export type Bar = { key?: string; label: string; count: number; ids?: number[] };
export type Group = { label: string; count: number; kwp: number; closed: number };
export type MiniProject = {
  id: number;
  name: string;
  status: ProjectStatus;
  statusLabel: string;
  pm: string | null;
  homeowner: string | null;
  progress: number;
  endDate: string | null;
  daysLate: number;
  flags: string[];
};
export type Crew = { name: string; projects: number; ongoing: number; late: number; visits: number; attended: number; missed: number; lateArrivals: number; attendance: number | null };
export type Manager = { uid: number; name: string; projects: number; ongoing: number; late: number; closed: number; onTime: number | null };

export type Analytics = {
  period: { key: Period; label: string; from: string | null; to: string };
  tiles: Record<TileKey, Tile>;
  pipeline: Array<Bar & { key: string; ids: number[] }>;
  trend: Array<{ label: string; started: number; closed: number }>;
  onTime: { closed: number; onTime: number; rate: number | null };
  delivery: {
    stages: Array<{ key: string; label: string; avgDays: number | null; n: number }>;
    cycleDays: number | null;
    cycleN: number;
    aging: Array<Bar & { ids: number[] }>;
    dueSoon: number[];
    late: number[];
  };
  site: {
    visits: number;
    attended: number;
    missed: number;
    attendance: number | null;
    lateArrivals: number;
    checkIns: number;
    avgCrew: number | null;
    upcoming: number;
    heatmap: { days: string[]; hours: number[]; counts: number[][] };
    crews: Crew[];
  };
  sales: {
    newProjects: { count: number; delta: number | null };
    installedKwp: number;
    installedCount: number;
    pipelineKwp: number;
    avgKwp: number | null;
    approval: { approved: number; declined: number; rate: number | null; avgDays: number | null };
    trend: Array<{ label: string; count: number }>;
    byRegion: Group[];
    byRetailer: Group[];
    bySales: Group[];
    signups: { count: number; delta: number | null; approved: number; pending: number; byRole: Bar[] };
  };
  team: Manager[] | null;
  projects: Record<string, MiniProject>;
  scope: { superadmin: boolean; pm: number | null; managers: Array<{ uid: number; name: string }> };
};

/** 1,284 · 12.9K, in the reader's language. */
export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, notation: Math.abs(n) >= 10000 ? "compact" : "standard" }).format(n);
}

/** 0.873 → "87%". */
export function pct(r: number | null | undefined): string {
  return r === null || r === undefined ? "—" : `${Math.round(r * 100)}%`;
}

export function kwp(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : T("{n} kWp", { n: num(n, n < 100 ? 1 : 0) });
}

export function days(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n === 1 ? T("1 day") : T("{n} days", { n: num(n, n < 10 ? 1 : 0) });
}

/** A trend column's name: "Mar" for a month ("2026-03"), "7 Sep" for a week ("2026-09-07"). */
export function bucketLabel(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) return new Date(`${key}-01T00:00:00+08:00`).toLocaleDateString(locale(), { month: "short", timeZone: "Asia/Singapore" });
  return new Date(`${key}T00:00:00+08:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "Asia/Singapore" });
}

/** "+12% vs the previous 90 days": up is good for these figures. */
export function deltaText(d: number | null | undefined, period: Period): { text: string; up: boolean } | null {
  if (d === null || d === undefined || period === "all") return null;
  const label = { "30d": "the previous 30 days", "90d": "the previous 90 days", "12m": "the previous 12 months" }[period];
  const n = Math.round(d * 100);
  return { text: T("{change} vs {period}", { change: `${n > 0 ? "+" : ""}${n}%`, period: T(label) }), up: n >= 0 };
}

/** Nice round axis ticks from 0 to at least max: 0, 5, 10, 15. */
export function ticks(max: number, count = 4, whole = true): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // Counts of projects and visits are whole numbers: no "0.5" on the axis.
  if (whole) step = Math.max(1, Math.round(step));
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 100) / 100);
  return out.length > 1 ? out : [0, step];
}
