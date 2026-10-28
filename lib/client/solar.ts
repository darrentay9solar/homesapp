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
  latitude?: number | null;
  longitude?: number | null;
  gridConnectedOn: string | null;
  health: Health;
  live: boolean;
  currentKw: number | null;
  todayKwh: number | null;
  monthKwh: number | null;
  totalKwh: number | null;
  /** Only where the plant has a meter. */
  feedInTodayKwh?: number | null;
  usedTodayKwh?: number | null;
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
  kpis: { currentKw: number | null; todayKwh: number | null; todayRevenue: number | null; totalKwh: number | null; capacityKwp: number | null; inverterRatedKw?: number | null };
  health: Record<Health, number>;
  alarms: Record<AlarmLevel, number>;
  /** Every plant's lifetime yield as coal, CO2 and trees. */
  benefits?: { coalTons: number | null; co2Tons: number | null; trees: number | null };
  plants: PlantRow[];
  unlinked: number;
};

/** source: FusionSolar's own alarm, or the app's output check (a plant making much less than similar plants). */
export type PlantAlarm = {
  id?: number;
  level: AlarmLevel;
  name: string;
  device: string | null;
  cause: string | null;
  suggestion: string | null;
  raisedAt: string;
  clearedAt: string | null;
  source?: "fusionsolar" | "app";
  /** A manager has seen it and noted what's being done (who and the note: staff only). */
  acknowledged?: { at: string; by: string | null; note: string | null } | null;
};
export type DeviceKind = "inverter" | "dongle" | "meter" | "battery" | "device";
export type DeviceState = "producing" | "standby" | "offline";
/** An inverter's live readings as FusionSolar shows them (only what it reports). */
export type DeviceReadings = {
  inverterState: number | null;
  reactiveKvar: number | null;
  powerFactor: number | null;
  efficiency: number | null;
  frequencyHz: number | null;
  temperatureC: number | null;
  inputKw: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  phases: Array<{ phase: string; voltage: number | null; current: number | null }>;
  lineVoltages: Array<{ between: string; voltage: number | null }>;
  strings: Array<{ n: number; voltage: number | null; current: number | null }>;
  mppts: Array<{ n: number; kwh: number | null }>;
  mpptTotalKwh: number | null;
};
export type PlantDevice = {
  id: number;
  name: string | null;
  kind: DeviceKind;
  serial: string | null;
  model: string | null;
  /** An inverter's rated AC power, from its model (SUN2000-10K… is 10 kW). */
  ratedKw?: number | null;
  softwareVersion: string | null;
  optimizers: number | null;
  currentKw: number | null;
  todayKwh: number | null;
  totalKwh: number | null;
  state: DeviceState | null;
  liveAt: string | null;
  readings: DeviceReadings | null;
};

/** Singapore's weather where the plant is (NEA): its area's 2-hour forecast and the nearest temperature. */
export type PlantWeather = {
  area: string | null;
  forecast: string | null;
  valid: string | null;
  temperatureC: number | null;
  station: string | null;
  at: string;
  /** NEA's 24-hour forecast for the plant's part of Singapore, and the 4-day outlook. */
  region?: "north" | "south" | "east" | "west" | "central";
  next?: Array<{ start: string; end: string; forecast: string }>;
  today?: { low: number | null; high: number | null } | null;
  outlook?: Array<{ date: string; text: string | null; summary: string | null; low: number | null; high: number | null }>;
};

export type PlantDetail = PlantRow & {
  weather?: PlantWeather | null;
  yearKwh: number | null;
  benefits: { coalTons: number | null; co2Tons: number | null; trees: number | null };
  devices: PlantDevice[];
  alarms: PlantAlarm[];
  connection: Connection;
};

export type EnergyPeriod = "day" | "month" | "year" | "lifetime";
export type EnergySeries = {
  period: EnergyPeriod;
  date: string;
  by: string;
  points: Array<{ at: string; label: string; kwh: number | null; revenue: number | null }>;
  totalKwh: number | null;
  /** The same period a year earlier, slot by slot, and the change on it in percent. */
  previous?: { date: string; totalKwh: number | null; kwh: Array<number | null>; change: number | null } | null;
};
export type ReportBy = "hour" | "day" | "month" | "year";
/** One of an inverter's readings every 5 minutes through a day, and which readings it has. */
export type DeviceHistory = { date: string; signals: string[]; signal: string | null; points: Array<{ label: string; value: number | null }> };

/** A reading's name and unit, as FusionSolar names it (pv3_u, a_i, temperature...). */
export function signalLabel(key: string): { label: string; unit: string } {
  const pv = key.match(/^pv(\d+)_([ui])$/);
  if (pv) return { label: pv[2] === "u" ? `PV${pv[1]} voltage` : `PV${pv[1]} current`, unit: pv[2] === "u" ? "V" : "A" };
  const phase = key.match(/^([abc])_([ui])$/);
  if (phase) return { label: `Phase ${phase[1].toUpperCase()} ${phase[2] === "u" ? "voltage" : "current"}`, unit: phase[2] === "u" ? "V" : "A" };
  const line = key.match(/^(ab|bc|ca)_u$/);
  if (line) return { label: `Voltage ${line[1].toUpperCase()}`, unit: "V" };
  const named: Record<string, { label: string; unit: string }> = {
    temperature: { label: "Inverter temperature", unit: "°C" },
    efficiency: { label: "Efficiency", unit: "%" },
    elec_freq: { label: "Grid frequency", unit: "Hz" },
    power_factor: { label: "Power factor", unit: "" },
    reactive_power: { label: "Reactive power", unit: "kvar" },
    mppt_power: { label: "Input power (DC)", unit: "kW" },
  };
  return named[key] ?? { label: key, unit: "" };
}

/** Power through a day: every 5 minutes (FusionSolar's curve), or by the hour for days older than 90. */
export type PowerSeries = {
  date: string;
  by: "5min" | "hour";
  points: Array<{ label: string; kw: number | null }>;
  peakKw: number | null;
  peakAt: string | null;
  latestKw: number | null;
};
export type SolarReport = {
  by: ReportBy;
  start: string;
  end: string;
  rows: Array<{ period: string; kwh: number | null; revenue: number | null; specificYield: number | null; co2Kg: number | null; coalKg: number | null }>;
};

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

export const KIND_LABEL: Record<DeviceKind, string> = { inverter: "Inverter", dongle: "WiFi dongle", meter: "Power meter", battery: "Battery", device: "Device" };
export const STATE_LABEL: Record<DeviceState, string> = { producing: "Producing", standby: "Standby", offline: "Offline" };

/** FusionSolar's inverter status codes, by group (its own words are longer: "Shutdown: input underpower"...). */
export function inverterStatus(code: number | null): string | null {
  if (code === null) return null;
  if (code === 512) return "Grid-connected";
  if (code >= 513 && code <= 515) return "Grid-connected, output limited";
  if (code >= 768 && code <= 776) return "Shut down";
  if (code === 40960) return "Standby: no sunlight";
  if (code >= 0 && code <= 3) return "Standby";
  if (code === 256) return "Starting";
  return null;
}

/** A reading with its unit: "231.4 V", "6.85 A", "98.69%". */
export function reading(v: number | null | undefined, unit: string, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return unit === "%" ? `${fmt(v, digits)}%` : unit ? `${fmt(v, digits)} ${unit}` : fmt(v, digits);
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
