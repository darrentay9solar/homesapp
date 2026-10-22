/**
 * Solar monitoring, made up for the previews (/dev-preview/solar, /dev-preview/my-solar).
 * Never real customers or real FusionSolar plants: invented names and addresses only.
 */

import type { EnergySeries, Health, PlantDetail, PlantRow, SolarOverview, SolarReport } from "@/lib/client/solar";

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const sgDay = (offset = 0) => new Date(NOW + 8 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

const NAMES: Array<[string, Health, number, string | null]> = [
  ["7 Example Avenue", "normal", 15.2, "Jasmine Lee"],
  ["12 Sample Crescent", "normal", 12.8, "Daniel Ong"],
  ["3 Demo Hill Road", "faulty", 9.9, "Farah Ismail"],
  ["21 Preview Terrace", "normal", 18.4, "Aisha Rahman"],
  ["5 Placeholder Walk", "normal", 10.6, "Kumar Raj"],
  ["88 Specimen Park", "disconnected", 14.0, null],
  ["40 Mockup Lane", "normal", 16.5, "Grace Tan"],
  ["9 Fictional Grove", "normal", 11.2, "Benjamin Koh"],
  ["15 Sketch Close", "faulty", 13.3, "Lina Wong"],
  ["62 Draft Rise", "normal", 20.1, "Ethan Chua"],
];

function plantRow(i: number): PlantRow {
  const [name, health, kwp, homeowner] = NAMES[i];
  const today = health === "disconnected" ? 0 : Math.round(kwp * (health === "faulty" ? 1.1 : 3.4) * 100) / 100;
  const total = Math.round(kwp * 1250 * (1 + (i % 4) * 0.35));
  return {
    code: `NE=DEMO${100 + i}`,
    name,
    address: `${name}, Singapore ${460000 + i * 1111}`,
    capacityKwp: kwp,
    gridConnectedOn: sgDay(-200 - i * 37),
    health,
    live: health !== "disconnected",
    currentKw: health === "disconnected" ? null : Math.round(kwp * (health === "faulty" ? 0.08 : 0.31) * 100) / 100,
    todayKwh: today,
    monthKwh: Math.round(today * 21 * 10) / 10,
    totalKwh: total,
    specificYield: Math.round((today / kwp) * 100) / 100,
    todayRevenue: Math.round(today * 0.265 * 100) / 100,
    totalRevenue: Math.round(total * 0.265 * 100) / 100,
    rate: homeowner ? 0.265 : null,
    liveAt: health === "disconnected" ? iso(60 * 30) : iso(7),
    systemId: homeowner ? 201 + i : null,
    projectCode: homeowner ? `9SH${String(140 + i).padStart(4, "0")}` : null,
    homeowner,
    linkedBy: homeowner ? (i % 3 ? "address" : "person") : null,
  };
}

const PLANTS = NAMES.map((_, i) => plantRow(i));

export function mockSolarOverview(): SolarOverview {
  const sum = (k: keyof PlantRow) => Math.round(PLANTS.reduce((n, p) => n + ((p[k] as number | null) ?? 0), 0) * 100) / 100;
  const health = { normal: 0, faulty: 0, disconnected: 0, unknown: 0 };
  for (const p of PLANTS) health[p.health] += 1;
  return {
    connection: { connected: true, lastSync: iso(7) },
    kpis: { currentKw: sum("currentKw"), todayKwh: sum("todayKwh"), todayRevenue: sum("todayRevenue"), totalKwh: sum("totalKwh"), capacityKwp: sum("capacityKwp") },
    health,
    alarms: { critical: 0, major: 2, minor: 1, warning: 0 },
    plants: PLANTS,
    unlinked: PLANTS.filter((p) => p.systemId === null).length,
  };
}

export function mockPlant(code: string): PlantDetail {
  const p = PLANTS.find((x) => x.code === code) ?? PLANTS[0];
  const faulty = p.health === "faulty";
  return {
    ...p,
    yearKwh: Math.round((p.totalKwh ?? 0) * 0.62),
    benefits: { coalTons: Math.round((p.totalKwh ?? 0) * 0.4) / 1000, co2Tons: Math.round((p.totalKwh ?? 0) * 0.475) / 1000, trees: Math.round(((p.totalKwh ?? 0) * 0.475) / 18.3) },
    devices: [
      { name: "INV-1", serial: "HV2240012345", model: "SUN2000-10KTL-M1", currentKw: p.currentKw, todayKwh: p.todayKwh, totalKwh: p.totalKwh, state: faulty ? "fault" : "producing" },
    ],
    alarms: faulty
      ? [
          { level: "major", name: "Grid Overvoltage", device: "INV-1", cause: "The grid voltage is above the inverter's limit.", suggestion: "If it keeps happening, ask the grid operator to check the voltage.", raisedAt: iso(140), clearedAt: null },
          { level: "minor", name: "Low Insulation Resistance", device: "INV-1", cause: "Moisture on the strings after rain.", suggestion: "Usually clears as panels dry; check the cabling if it doesn't.", raisedAt: iso(60 * 50), clearedAt: iso(60 * 46) },
        ]
      : [],
    connection: { connected: true, lastSync: iso(7) },
  };
}

/** A day's output curve: nothing before 7am or after 7pm, its peak at 1pm. */
function hourly(kwp: number, h: number): number | null {
  if (h < 7 || h > 18) return 0;
  return Math.round(kwp * 0.62 * Math.sin(((h - 6.5) / 12.5) * Math.PI) * 100) / 100;
}

export function mockEnergy(search: URLSearchParams): EnergySeries {
  const period = (search.get("period") ?? "day") as EnergySeries["period"];
  const date = search.get("date") ?? sgDay();
  const kwp = 15.2;
  const [y, m] = date.split("-").map(Number);
  let points: EnergySeries["points"];
  if (period === "day") points = Array.from({ length: 24 }, (_, h) => ({ at: `${date}T${String(h).padStart(2, "0")}:00:00+08:00`, label: `${String(h).padStart(2, "0")}:00`, kwh: hourly(kwp, h), revenue: null }));
  else if (period === "month") {
    const days = new Date(y, m, 0).getDate();
    points = Array.from({ length: days }, (_, d) => ({ at: `${y}-${String(m).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`, label: String(d + 1).padStart(2, "0"), kwh: Math.round((48 + ((d * 37) % 23)) * 10) / 10, revenue: null }));
  } else if (period === "year") points = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((label, i) => ({ at: `${y}-${String(i + 1).padStart(2, "0")}-01`, label, kwh: Math.round(1400 + 300 * Math.sin(i / 2)), revenue: null }));
  else points = [y - 2, y - 1, y].map((yy, i) => ({ at: `${yy}-01-01`, label: String(yy), kwh: [9800, 17200, 14100][i], revenue: null }));
  for (const p of points) p.revenue = p.kwh === null ? null : Math.round(p.kwh * 0.265 * 100) / 100;
  const total = points.reduce((n, p) => n + (p.kwh ?? 0), 0);
  return { period, date, by: period === "day" ? "hour" : period === "month" ? "day" : period === "year" ? "month" : "year", points, totalKwh: Math.round(total * 1000) / 1000 };
}

export function mockReport(search: URLSearchParams): SolarReport {
  const by = (search.get("by") ?? "day") as SolarReport["by"];
  const rows =
    by === "hour"
      ? Array.from({ length: 24 }, (_, h) => ({ period: `${sgDay()} ${String(h).padStart(2, "0")}:00`, kwh: hourly(15.2, h) }))
      : by === "day"
        ? Array.from({ length: 31 }, (_, i) => ({ period: sgDay(i - 30), kwh: Math.round((48 + ((i * 37) % 23)) * 10) / 10 }))
        : Array.from({ length: 12 }, (_, i) => ({ period: `M${i + 1}`, kwh: Math.round(1400 + 300 * Math.sin(i / 2)) }));
  return { by, start: sgDay(-30), end: sgDay(), rows: rows.map((r) => ({ ...r, revenue: r.kwh === null ? null : Math.round(r.kwh * 0.265 * 100) / 100 })) };
}
