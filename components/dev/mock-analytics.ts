/**
 * DEVELOPMENT ONLY. Sample dashboard data for /dev-preview/dashboard and the
 * design check: a year of a busy installer, so every chart has something to
 * draw. Shaped exactly like GET /analytics (api/_lib/analytics.py).
 */

const NAMES = [
  "Jalan Kayu Residence", "Sunbird Circle", "Hillcrest Villa", "Bedok Ria Terrace", "Seletar Hills Home",
  "Upper Thomson Corner", "Siglap Garden House", "Punggol Waterway Terrace", "Pasir Ris Garden", "Tampines Grove",
  "Serangoon Gardens Home", "Bukit Timah Hillside", "Clementi Park House", "Yishun Riverside", "Sembawang Hills",
  "Holland Grove Villa", "Katong Shophouse", "Woodlands Crescent", "Kovan Terrace", "Bishan Loft",
  "Changi Heights", "Toa Payoh Court", "Ang Mo Kio Corner", "Jurong Lakeside", "Marine Parade House",
  "Novena Mews", "Hougang Avenue Home", "Lorong Chuan Villa", "Teachers' Estate", "Opera Estate House",
];
const STATUS: Array<[string, string]> = [
  ["in_progress", "In Progress"], ["in_progress", "In Progress"], ["awaiting_homeowner", "Awaiting Homeowner"],
  ["draft", "Draft"], ["in_progress", "In Progress"], ["signed", "Signed — PM to Close"], ["closed", "Closed"],
  ["awaiting_signature", "Awaiting E-Sign"], ["in_progress", "In Progress"], ["homeowner_declined", "Homeowner Declined"],
  ["homeowner_approved", "Homeowner Approved"], ["pm_approved", "PM Approved"], ["closed", "Closed"], ["in_progress", "In Progress"],
  ["closed", "Closed"], ["in_progress", "In Progress"], ["closed", "Closed"], ["closed", "Closed"], ["in_progress", "In Progress"],
  ["closed", "Closed"], ["closed", "Closed"], ["in_progress", "In Progress"], ["closed", "Closed"], ["closed", "Closed"],
  ["in_progress", "In Progress"], ["closed", "Closed"], ["awaiting_homeowner", "Awaiting Homeowner"], ["closed", "Closed"],
  ["closed", "Closed"], ["closed", "Closed"],
];
const LATE = new Set([205, 209, 214]);
const NOSHOW = new Set([205]);

function iso(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function mockAnalytics(search: URLSearchParams) {
  const period = (search.get("period") ?? "90d") as "30d" | "90d" | "12m" | "all";
  const label = { "30d": "Last 30 days", "90d": "Last 90 days", "12m": "Last 12 months", all: "All time" }[period];
  const projects: Record<string, object> = {};
  NAMES.forEach((name, i) => {
    const id = 201 + i;
    const [status, statusLabel] = STATUS[i];
    const late = LATE.has(id);
    projects[id] = {
      id, name, status, statusLabel, pm: i % 3 === 2 ? "Marcus Lim" : "Charlotte Sim", homeowner: "Homeowner",
      progress: status === "closed" ? 100 : 20 + ((i * 17) % 75), endDate: iso(late ? -((i * 7) % 40) - 2 : 3 + ((i * 5) % 40)),
      daysLate: late ? ((i * 7) % 40) + 2 : 0, flags: late ? ["Target end date passed"] : [],
    };
  });
  const ids = (pred: (s: string, id: number) => boolean) => NAMES.map((_, i) => 201 + i).filter((id) => pred(STATUS[id - 201][0], id));
  const tile = (list: number[], delta?: number | null) => ({ count: list.length, ids: list, ...(delta !== undefined ? { delta } : {}) });
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - 11 + i, 1);
    return d.toISOString().slice(0, 7);
  });
  const n = period === "30d" ? 5 : 13;
  const weeks = Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - (n - 1 - i) * 7);
    return d.toISOString().slice(0, 10);
  });
  const cols = period === "30d" || period === "90d" ? weeks : months;
  const started = [3, 4, 2, 5, 6, 4, 7, 5, 6, 8, 6, 7, 5];
  const closed = [1, 2, 2, 3, 3, 4, 3, 5, 4, 4, 6, 5, 4];
  const counts = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((_, d) =>
    Array.from({ length: 15 }, (_, h) => (d === 6 ? 0 : Math.max(0, Math.round((d === 5 ? 1.2 : 3.4) * Math.exp(-(((h - 3) / 2.2) ** 2)) + ((d * 7 + h) % 3) - 1))))
  );
  const group = (rows: Array<[string, number, number, number]>) => rows.map(([l, c, k, cl]) => ({ label: l, count: c, kwp: k, closed: cl }));
  return {
    period: { key: period, label, from: null, to: iso(0) },
    tiles: {
      ongoing: tile(ids((s) => s === "in_progress" || s === "pm_approved")),
      late: tile([...LATE]),
      noShow: tile([...NOSHOW]),
      awaitingHomeowner: tile(ids((s) => s === "awaiting_homeowner" || s === "homeowner_declined")),
      awaitingPm: tile(ids((s) => s === "homeowner_approved")),
      handover: tile(ids((s) => s === "awaiting_signature" || s === "signed")),
      closed: tile(ids((s, id) => s === "closed" && id < 220), period === "all" ? null : 0.25),
      new: tile(ids((_, id) => id < 214), period === "all" ? null : 0.18),
    },
    pipeline: [
      ["draft", "Draft"], ["awaiting_homeowner", "Awaiting homeowner"], ["homeowner_declined", "Declined"], ["homeowner_approved", "PM to approve"],
      ["m0", "Approved, not started"], ["m1", "Working on Milestone 1"], ["m2", "Working on Milestone 2"], ["m3", "Working on Milestone 3"],
      ["awaiting_signature", "Awaiting e-sign"], ["signed", "Signed, to close"], ["closed", "Closed"],
    ].map(([key, l], i) => {
      const list = key === "m1" ? [201, 202, 214] : key === "m2" ? [205, 209, 216] : key === "m3" ? [219, 222, 225] : key === "m0" ? [212] : ids((s) => s === key);
      return { key, label: l, count: list.length, ids: list, i };
    }),
    trend: cols.map((c, i) => ({ label: c, started: started[i % started.length], closed: closed[i % closed.length] })),
    onTime: { closed: 14, onTime: 11, rate: 0.786 },
    delivery: {
      stages: [["homeowner", "Homeowner approval", 3.4, 18], ["pm", "PM approval", 1.2, 17], ["m1", "Milestone 1", 12.6, 16], ["m2", "Milestone 2", 9.1, 15],
        ["m3", "Milestone 3", 14.8, 14], ["sign", "Homeowner signs", 2.3, 14], ["close", "PM closes", 1.1, 14]].map(([key, l, a, n]) => ({ key, label: l, avgDays: a, n })),
      cycleDays: 46.2,
      cycleN: 14,
      aging: [["1–7 days", [214]], ["8–14 days", [209]], ["15–30 days", [205]], ["Over 30 days", []]].map(([l, list]) => ({ label: l, count: (list as number[]).length, ids: list })),
      dueSoon: [201, 202, 216],
      late: [205, 209, 214],
    },
    site: {
      visits: 64, attended: 59, missed: 5, attendance: 0.922, lateArrivals: 4, checkIns: 71, avgCrew: 3.6, upcoming: 9,
      heatmap: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], hours: Array.from({ length: 15 }, (_, h) => h + 6), counts },
      crews: [
        { name: "Apex Solar Contractors", projects: 18, ongoing: 7, late: 2, visits: 41, attended: 38, missed: 3, lateArrivals: 3, attendance: 0.927 },
        { name: "Kim Seng M&E Services", projects: 10, ongoing: 3, late: 1, visits: 21, attended: 19, missed: 2, lateArrivals: 1, attendance: 0.905 },
        { name: "Northline Roofing Pte Ltd", projects: 2, ongoing: 0, late: 0, visits: 2, attended: 2, missed: 0, lateArrivals: 0, attendance: 1 },
      ],
    },
    sales: {
      newProjects: { count: 13, delta: period === "all" ? null : 0.18 },
      installedKwp: 171.4, installedCount: 14, pipelineKwp: 196.2, avgKwp: 11.9,
      approval: { approved: 18, declined: 2, rate: 0.9, avgDays: 3.4 },
      trend: cols.map((c, i) => ({ label: c, count: started[i % started.length] })),
      byRegion: group([["North-East", 9, 108.6, 4], ["East", 8, 95.2, 5], ["Central", 6, 74.4, 3], ["West", 4, 47.1, 1], ["North", 3, 35.2, 1]]),
      byRetailer: group([["SP Group", 14, 168.3, 7], ["Geneco", 6, 70.2, 3], ["Keppel Electric", 4, 48.8, 2], ["Senoko Energy", 3, 36.1, 1], ["Not recorded", 3, 0, 1]]),
      bySales: group([["K. Chandra", 12, 146.1, 6], ["Mei Ling Goh", 10, 118.4, 5], ["Jason Lim", 6, 70.3, 3], ["Not recorded", 2, 0, 0]]),
      signups: { count: 11, delta: period === "all" ? null : -0.08, approved: 8, pending: 2, byRole: [{ label: "homeowner", count: 7 }, { label: "epc_team", count: 3 }, { label: "contractor", count: 1 }] },
    },
    team: [
      { uid: 15, name: "Charlotte Sim", projects: 20, ongoing: 6, late: 2, closed: 9, onTime: 0.778 },
      { uid: 16, name: "Marcus Lim", projects: 10, ongoing: 3, late: 1, closed: 5, onTime: 0.8 },
    ],
    projects,
    scope: { superadmin: true, pm: null, managers: [{ uid: 15, name: "Charlotte Sim" }, { uid: 16, name: "Marcus Lim" }] },
  };
}
