/**
 * Solar monitoring (FusionSolar's figures, in the app): types for /solar and
 * /me/solar, and how its numbers are written (api/_routes/solar.py).
 */
import { locale } from "./i18n";

export type Health = "normal" | "faulty" | "disconnected" | "unknown";
export type AlarmLevel = "critical" | "major" | "minor" | "warning";

export type PlantRow = {
  code: string;
  name: string;
  address: string | null;
  capacityKwp: number | null;
  gridConnectedOn: string | null;
  health: Health;
  live: boolean;
  currentKw: number | null;
  todayKwh: number | null;
  monthKwh: number | null;
  totalKwh: number | null;
  specificYield: number | null;
  todayRevenue: number | null;
  totalRevenue: number | null;
  rate: number | null;
  liveAt: string | null;
  systemId: number | null;
  projectCode?: string | null;
  homeowner?: string | null;
  linkedBy?: "address" | "person" | null;
};

export type Connection = { connected: boolean; lastSync: string | null };

export type SolarOverview = {
  connection: Connection;
  kpis: { currentKw: number | null; todayKwh: number | null; todayRevenue: number | null; totalKwh: number | null; capacityKwp: number | null };
  health: Record<Health, number>;
  alarms: Record<AlarmLevel, number>;
  plants: PlantRow[];
  unlinked: number;
};

export type PlantAlarm = { level: AlarmLevel; name: string; device: string | null; cause: string | null; suggestion: string | null; raisedAt: string; clearedAt: string | null };
export type PlantDevice = { name: string | null; serial: string | null; model: string | null; currentKw: number | null; todayKwh: number | null; totalKwh: number | null; state: string | null };

export type PlantDetail = PlantRow & {
  yearKwh: number | null;
  benefits: { coalTons: number | null; co2Tons: number | null; trees: number | null };
  devices: PlantDevice[];
  alarms: PlantAlarm[];
  connection: Connection;
};

export type EnergyPeriod = "day" | "month" | "year" | "lifetime";
export type EnergySeries = { period: EnergyPeriod; date: string; by: string; points: Array<{ at: string; label: string; kwh: number | null; revenue: number | null }>; totalKwh: number | null };
export type ReportBy = "hour" | "day" | "month";
export type SolarReport = { by: ReportBy; start: string; end: string; rows: Array<{ period: string; kwh: number | null; revenue: number | null }> };

export const HEALTH: Array<[Health, string]> = [
  ["normal", "Normal"],
  ["faulty", "Faulty"],
  ["disconnected", "Disconnected"],
  ["unknown", "No data yet"],
];
export const HEALTH_LABEL: Record<Health, string> = Object.fromEntries(HEALTH) as Record<Health, string>;

export const LEVELS: Array<[AlarmLevel, string]> = [
  ["critical", "Critical"],
  ["major", "Major"],
  ["minor", "Minor"],
  ["warning", "Warning"],
];
export const LEVEL_LABEL: Record<AlarmLevel, string> = Object.fromEntries(LEVELS) as Record<AlarmLevel, string>;

function fmt(n: number, digits: number): string {
  return n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Power: "4.29 kW", or "461.3 kW", or "1.37 MW" from 1,000 kW. */
export function power(kw: number | null | undefined): string {
  if (kw === null || kw === undefined) return "—";
  return Math.abs(kw) >= 1000 ? `${fmt(kw / 1000, 2)} MW` : `${fmt(kw, kw < 100 ? 2 : 1)} kW`;
}

/** Energy: "14.55 kWh", or "618.46 MWh" from 10,000 kWh, or "1.20 GWh". */
export function energy(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return "—";
  const a = Math.abs(kwh);
  if (a >= 1_000_000) return `${fmt(kwh / 1_000_000, 2)} GWh`;
  if (a >= 10_000) return `${fmt(kwh / 1000, 2)} MWh`;
  return `${fmt(kwh, 2)} kWh`;
}

export function capacity(kwp: number | null | undefined): string {
  if (kwp === null || kwp === undefined) return "—";
  return kwp >= 1000 ? `${fmt(kwp / 1000, 2)} MWp` : `${fmt(kwp, kwp < 100 ? 2 : 1)} kWp`;
}

export function sgd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `S$${fmt(v, 2)}`;
}

/** The first and last day of a period, and the one before or after it, for the chart's arrows. */
export function shiftDate(day: string, period: EnergyPeriod, by: -1 | 1): string {
  const d = new Date(`${day}T12:00:00+08:00`);
  if (period === "day") d.setUTCDate(d.getUTCDate() + by);
  else if (period === "month") d.setUTCMonth(d.getUTCMonth() + by, 1);
  else if (period === "year") d.setUTCFullYear(d.getUTCFullYear() + by, 0, 1);
  return d.toISOString().slice(0, 10);
}

export function periodTitle(day: string, period: EnergyPeriod): string {
  const d = new Date(`${day}T12:00:00+08:00`);
  if (period === "day") return d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  if (period === "month") return d.toLocaleDateString(locale(), { month: "long", year: "numeric", timeZone: "Asia/Singapore" });
  if (period === "year") return String(d.getUTCFullYear());
  return "";
}
