/**
 * Solar monitoring, made up for the previews (/dev-preview/solar, /dev-preview/my-solar).
 * Never real customers or real FusionSolar plants: invented names and addresses only.
 */

import type { DeviceHistory, DeviceReadings, EnergySeries, Health, PlantDetail, PlantRow, PowerSeries, SolarOverview, SolarReport } from "@/lib/client/solar";

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
    // Made-up places across Singapore, for the map.
    latitude: Math.round((1.3 + ((i * 37) % 11) * 0.012) * 1e4) / 1e4,
    longitude: Math.round((103.72 + ((i * 53) % 13) * 0.018) * 1e4) / 1e4,
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
    benefits: { coalTons: Math.round(sum("totalKwh") * 0.4) / 1000, co2Tons: Math.round(sum("totalKwh") * 0.475) / 1000, trees: Math.round((sum("totalKwh") * 0.475) / 18.3) },
    plants: PLANTS,
    unlinked: PLANTS.filter((p) => p.systemId === null).length,
  };
}

export function mockPlant(code: string): PlantDetail {
  const p = PLANTS.find((x) => x.code === code) ?? PLANTS[0];
  const faulty = p.health === "faulty";
  return {
    ...p,
    weather: {
      area: "Toa Payoh",
      forecast: p.health === "faulty" ? "Light Showers" : "Partly Cloudy (Day)",
      valid: "12 pm to 2 pm",
      temperatureC: 31.4,
      station: "Toa Payoh Lorong 4",
      at: iso(12),
      region: "central",
      next: [
        { start: `${sgDay()}T18:00:00+08:00`, end: `${sgDay(1)}T06:00:00+08:00`, forecast: "Cloudy" },
        { start: `${sgDay(1)}T06:00:00+08:00`, end: `${sgDay(1)}T12:00:00+08:00`, forecast: "Fair (Day)" },
        { start: `${sgDay(1)}T12:00:00+08:00`, end: `${sgDay(1)}T18:00:00+08:00`, forecast: "Thundery Showers" },
      ],
      today: { low: 25, high: 34 },
      outlook: [1, 2, 3, 4].map((d, i) => ({ date: sgDay(d), text: ["Thundery Showers", "Partly Cloudy (Day)", "Showers", "Fair (Day)"][i], summary: null, low: 24 + (i % 2), high: 32 + (i % 3) })),
    },
    yearKwh: Math.round((p.totalKwh ?? 0) * 0.62),
    benefits: { coalTons: Math.round((p.totalKwh ?? 0) * 0.4) / 1000, co2Tons: Math.round((p.totalKwh ?? 0) * 0.475) / 1000, trees: Math.round(((p.totalKwh ?? 0) * 0.475) / 18.3) },
    devices: [
      {
        id: 900100,
        name: "INV-1",
        kind: "inverter",
        serial: "HV2240012345",
        model: "SUN2000-10KTL-M1",
        softwareVersion: "V100R001C00SPC140",
        optimizers: null,
        currentKw: p.currentKw,
        todayKwh: p.todayKwh,
        totalKwh: p.totalKwh,
        state: p.live ? "producing" : "offline",
        liveAt: p.liveAt,
        readings: p.live ? mockReadings(p.currentKw ?? 0, faulty) : null,
      },
      { id: 950100, name: "Dongle-1", kind: "dongle", serial: "HD2241009876", model: "SDongleA-05", softwareVersion: "V100R001C00SPC127", optimizers: null, currentKw: null, todayKwh: null, totalKwh: null, state: null, liveAt: null, readings: null },
    ],
    alarms: faulty
      ? [
          { id: 9001, level: "major", name: "Output below expected", device: null, cause: "Making 0.79 kW against about 3.21 kW expected (25% of what similar plants are making now)", suggestion: "Check the inverter and its alarms; then look for shading, dirty panels, a tripped breaker or a faulty string (Devices, then the inverter's PV strings).", raisedAt: iso(35), clearedAt: null, source: "app" },
          { id: 9002, level: "major", name: "Grid Overvoltage", device: "INV-1", cause: "The grid voltage is above the inverter's limit.", suggestion: "If it keeps happening, ask the grid operator to check the voltage.", raisedAt: iso(140), clearedAt: null, acknowledged: { at: iso(90), by: "Wei Ming Tan", note: "Asked SP to check the voltage at the substation" } },
          { id: 9003, level: "minor", name: "Low Insulation Resistance", device: "INV-1", cause: "Moisture on the strings after rain.", suggestion: "Usually clears as panels dry; check the cabling if it doesn't.", raisedAt: iso(60 * 50), clearedAt: iso(60 * 46) },
        ]
      : [],
    connection: { connected: true, lastSync: iso(7) },
  };
}

/** An inverter's live readings, made up: four strings on two MPPTs, three phases. */
function mockReadings(kw: number, faulty: boolean): DeviceReadings {
  const amps = Math.round(((kw * 1000) / (3 * 231)) * 100) / 100;
  const volts = [512.4, 509.8, 498.2, 501.7];
  // Each string carries a quarter of the power; on the faulty plant, string 3 hardly any.
  const share = faulty ? [0.32, 0.32, 0.04, 0.32] : [0.25, 0.25, 0.25, 0.25];
  return {
    inverterState: 512,
    reactiveKvar: 0.001,
    powerFactor: 1,
    efficiency: faulty ? 96.2 : 98.4,
    frequencyHz: 49.98,
    temperatureC: 47.3,
    inputKw: Math.round(kw * 1.02 * 1000) / 1000,
    startedAt: iso(60 * 6),
    stoppedAt: iso(60 * 19),
    phases: ["A", "B", "C"].map((phase, i) => ({ phase, voltage: [231.4, 232.1, 230.8][i], current: amps })),
    lineVoltages: [
      { between: "AB", voltage: 400.6 },
      { between: "BC", voltage: 401.2 },
      { between: "CA", voltage: 399.9 },
    ],
    strings: volts.map((voltage, i) => ({ n: i + 1, voltage, current: Math.round(((kw * 1020 * share[i]) / voltage) * 100) / 100 })),
    mppts: [
      { n: 1, kwh: 9840.27 },
      { n: 2, kwh: 9512.6 },
    ],
    mpptTotalKwh: 19352.87,
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
  // A year before: a little less, slot by slot (none for lifetime).
  const before = points.map((p) => (p.kwh === null ? null : Math.round(p.kwh * 0.92 * 10) / 10));
  const beforeTotal = before.reduce<number>((n, v) => n + (v ?? 0), 0);
  const previous = period === "lifetime" ? null : { date: `${y - 1}${date.slice(4)}`, totalKwh: Math.round(beforeTotal * 1000) / 1000, kwh: before, change: Math.round((total / beforeTotal - 1) * 1000) / 10 };
  return { period, date, by: period === "day" ? "hour" : period === "month" ? "day" : period === "year" ? "month" : "year", points, totalKwh: Math.round(total * 1000) / 1000, previous };
}

/** Power every 5 minutes through a day: a sunny curve with passing clouds, up to now for today. */
export function mockPower(search: URLSearchParams, kwp = 15.2): PowerSeries {
  const date = search.get("date") ?? sgDay();
  const nowSg = new Date(NOW + 8 * 3600_000);
  const isToday = date === sgDay();
  const minutesNow = nowSg.getUTCHours() * 60 + nowSg.getUTCMinutes();
  const points = Array.from({ length: 288 }, (_, i) => {
    const m = i * 5;
    const label = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if ((isToday && m > minutesNow) || m < 6 * 60 + 45 || m > 19 * 60) return { label, kw: null };
    const sun = Math.max(0, Math.sin(((m - 405) / 735) * Math.PI));
    const cloud = 0.9 + 0.1 * Math.sin(i * 0.23) * Math.cos(i * 0.07);
    return { label, kw: Math.round(kwp * 0.72 * sun * cloud * 1000) / 1000 };
  });
  const known = points.filter((p) => p.kw !== null);
  const peak = known.reduce<{ label: string; kw: number | null } | null>((a, p) => (!a || (p.kw ?? 0) > (a.kw ?? 0) ? p : a), null);
  return { date, by: "5min", points, peakKw: peak?.kw ?? null, peakAt: peak?.label ?? null, latestKw: isToday && known.length ? known[known.length - 1].kw : null };
}

/** One of an inverter's readings through a day (made up from the same sunny curve). */
export function mockDeviceHistory(search: URLSearchParams): DeviceHistory {
  const power = mockPower(search);
  const signals = ["temperature", "efficiency", "elec_freq", "a_u", "a_i", "pv1_u", "pv1_i", "pv2_u", "pv2_i"];
  const signal = search.get("signal") && signals.includes(search.get("signal")!) ? search.get("signal")! : "temperature";
  const at = (kw: number | null): number | null => {
    if (kw === null) return null;
    const share = kw / 10.9;
    const v: Record<string, number> = { temperature: 31 + 22 * share, efficiency: 96 + 2.5 * share, elec_freq: 49.98, a_u: 231 + share, a_i: (kw * 1000) / 3 / 231, pv1_u: 470 + 45 * share, pv1_i: (kw * 500) / 500, pv2_u: 465 + 44 * share, pv2_i: (kw * 495) / 500 };
    return Math.round(v[signal] * 100) / 100;
  };
  return { date: power.date, signals, signal, points: power.points.map((p) => ({ label: p.label, value: at(p.kw) })) };
}

export function mockReport(search: URLSearchParams): SolarReport {
  const by = (search.get("by") ?? "day") as SolarReport["by"];
  const rows =
    by === "hour"
      ? Array.from({ length: 24 }, (_, h) => ({ period: `${sgDay()} ${String(h).padStart(2, "0")}:00`, kwh: hourly(15.2, h) }))
      : by === "day"
        ? Array.from({ length: 31 }, (_, i) => ({ period: sgDay(i - 30), kwh: Math.round((48 + ((i * 37) % 23)) * 10) / 10 }))
        : by === "month"
          ? Array.from({ length: 12 }, (_, i) => ({ period: `M${i + 1}`, kwh: Math.round(1400 + 300 * Math.sin(i / 2)) }))
          : [2024, 2025, 2026].map((y, i) => ({ period: String(y), kwh: [9800, 17200, 14100][i] }));
  return {
    by,
    start: sgDay(-30),
    end: sgDay(),
    rows: rows.map((r) => ({
      ...r,
      revenue: r.kwh === null ? null : Math.round(r.kwh * 0.265 * 100) / 100,
      specificYield: r.kwh === null ? null : Math.round((r.kwh / 15.2) * 1000) / 1000,
      co2Kg: r.kwh === null ? null : Math.round(r.kwh * 0.475 * 10) / 10,
      coalKg: r.kwh === null ? null : Math.round(r.kwh * 0.4 * 10) / 10,
    })),
  };
}

/** SP Power: SP Group's tariff this quarter, its parts, 8 years of months, and (a homeowner) their own solar. */
export function mockTariffs(homeowner: boolean, search?: URLSearchParams) {
  type M = { month: string; withoutGst: number; withGst: number; selling: number | null; energy: number | null; network: number | null; mss: number | null; marketAdmin: number | null; partsFrom: "sp" | "ema" | null; source: string };
  const history: M[] = [];
  const now = new Date(NOW + 8 * 3600_000);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (let i = 101; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const q = Math.floor(i / 3);
    const without = r2(27.4 + 2.6 * Math.sin(q / 2.2) + (q % 4) * 0.35);
    const gst = d.getUTCFullYear() <= 2022 ? 1.07 : d.getUTCFullYear() === 2023 ? 1.08 : 1.09;
    // Parts: SP's quarters for the last three years; EMA's years before; none in between.
    const parts = i < 36 || i > 60;
    const network = parts ? (i < 36 ? 6.1 + (q % 3) * 0.15 : 5.4) : null;
    history.push({
      month: d.toISOString().slice(0, 7),
      withoutGst: without,
      withGst: r2(without * gst),
      selling: network !== null ? r2(without - network) : null,
      energy: network !== null ? r2(without - network - 0.31) : null,
      network,
      mss: parts ? 0.23 : null,
      marketAdmin: parts ? 0.08 : null,
      partsFrom: parts ? (i < 36 ? "sp" : "ema") : null,
      source: i < 36 ? "sp_group" : "data_gov_sg",
    });
  }
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const summary = (ms: M[]) => ({
    months: ms.length,
    from: ms[0]?.month ?? null,
    to: ms[ms.length - 1]?.month ?? null,
    withGst: avg(ms.map((m) => m.withGst)),
    withoutGst: avg(ms.map((m) => m.withoutGst)),
    selling: avg(ms.map((m) => m.selling)),
    energy: avg(ms.map((m) => m.energy)),
    network: avg(ms.map((m) => m.network)),
    mss: avg(ms.map((m) => m.mss)),
    marketAdmin: avg(ms.map((m) => m.marketAdmin)),
    partsMonths: ms.filter((m) => m.network !== null).length,
  });
  const last = history[history.length - 1];
  const q0 = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const q1 = new Date(Date.UTC(q0.getUTCFullYear(), q0.getUTCMonth() + 3, 0));
  const from = search?.get("from");
  const to = search?.get("to");
  const on = search?.get("on");
  const last12 = history.slice(-12);
  return {
    current: {
      startsOn: q0.toISOString().slice(0, 10),
      endsOn: q1.toISOString().slice(0, 10),
      withGst: last.withGst,
      withoutGst: last.withoutGst,
      buying: last.withGst,
      selling: last.selling,
      parts: { energy: last.energy, network: last.network, mss: 0.23, marketAdmin: 0.08 },
      gstRate: 9,
      checkedAt: iso(180),
    },
    history,
    average12: { ...summary(last12), sellingMonths: last12.filter((m) => m.selling !== null).length },
    average8y: summary(history.slice(-96)),
    ...(from || to ? { range: summary(history.filter((m) => m.month >= (from ?? "2000-01").slice(0, 7) && m.month <= (to ?? "2100-01").slice(0, 7))) } : {}),
    ...(on ? { on: (() => { const m = history.find((x) => x.month === on.slice(0, 7)); return m ? { ...m, date: on } : null; })() } : {}),
    mine: homeowner ? { rateCents: 22, monthKwh: 1032.4, savedSgd: Math.round(1032.4 * (last.withGst - 22)) / 100, cheaperCents: r2(last.withGst - 22) } : null,
    source: { sp: "https://www.spgroup.com.sg/our-services/utilities/tariff-information", history: "https://data.gov.sg/datasets/d_61eac3cdb086814af485dcc682b75ae9/view", parts: "https://data.gov.sg/datasets/d_b0b8f7a72f94e983fe42038b9aa4a464/view" },
  };
}
