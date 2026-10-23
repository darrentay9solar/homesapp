/**
 * DEVELOPMENT ONLY. Sample maintenance records for /dev-preview/maintenance and
 * the design check: an urgent system, an overdue check, one due soon, an
 * unassigned import, a mixed roof, a value buy, and handed-over projects.
 * Addresses are made up.
 */
import type { Check, MaintenanceDetail, MaintenanceList, MaintenanceSystem } from "@/lib/client/maintenance";

const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

const MANAGERS = [
  { uid: 1, name: "Wei Ming Tan" },
  { uid: 9, name: "Marcus Lim" },
];

/** Yearly checks from year 2 to `years` for a system turned on `on` days from today; `done`: {year: days from today}. */
function checks(on: number, years: number | null, done: Record<number, number> = {}): Check[] {
  const state = (due: number, d?: number): Check["state"] => (d !== undefined ? "done" : due < 0 ? "overdue" : due <= 30 ? "due_soon" : "scheduled");
  // The office's 6-month record first (done on the older systems), then the yearly checks.
  const six: Check = { key: "six_month", year: 0, label: "6-month check", due: day(on + 182), doneOn: on + 190 < 0 ? day(on + 190) : null, state: on + 190 < 0 ? "done" : "record" };
  return [
    six,
    ...Array.from({ length: Math.max(0, (years ?? 0) - 1) }, (_, i) => {
      const year = i + 2;
      const due = on + year * 365;
      return { key: `year_${year}` as const, year, label: `Year ${year} check`, due: day(due), doneOn: done[year] !== undefined ? day(done[year]) : null, state: state(due, done[year]) };
    }),
  ];
}

function system(id: number, over: Partial<MaintenanceSystem>, c: Check[]): MaintenanceSystem {
  const next = c.find((x) => x.state !== "done" && x.state !== "unscheduled" && x.state !== "record") ?? null;
  const s: MaintenanceSystem = {
    id,
    address: "1 Sample Road",
    postalCode: "123456",
    imported: true,
    project: null,
    pm: MANAGERS[0],
    homeowner: { uid: null, name: null, linked: false },
    contactNo: null,
    ppa: { kind: "ppa", years: 5 },
    plan: { years: 5, excludesFirstYear: false },
    panels: [{ count: 20, wp: 620 }],
    panelCount: 20,
    kwp: 12.4,
    phase: 1,
    inverters: ["SUN2000-10K-LC0"],
    turnedOn: day(-120),
    checkYears: 5,
    checks: c,
    next,
    roofAccess: false,
    urgent: false,
    urgentNote: null,
    notes: null,
    attention: false,
    updatedAt: new Date().toISOString(),
    ...over,
  };
  s.panelCount = s.panels.reduce((a, p) => a + p.count, 0);
  s.checkYears = s.plan?.years ?? s.ppa?.years ?? null;
  s.attention = s.urgent || c.some((x) => x.state === "overdue");
  return s;
}

const SYSTEMS: MaintenanceSystem[] = [
  system(201, { address: "7 Example Avenue", postalCode: "466001", ppa: { kind: "ppa", years: 7 }, plan: { years: 7, excludesFirstYear: true }, panels: [{ count: 23, wp: 635 }, { count: 3, wp: 620 }], kwp: 16.465, inverters: ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"], turnedOn: day(-763), urgent: true, urgentNote: "Poor generation: need to check" }, checks(-763, 7)),
  system(202, { address: "88 Showcase Road", postalCode: "288001", pm: MANAGERS[1], ppa: { kind: "ppa", years: 8 }, plan: { years: 8, excludesFirstYear: true }, panels: [{ count: 62, wp: 620 }], kwp: 38.44, phase: 3, inverters: ["SUN2000-17KTL-MB0", "SUN2000-17KTL-MB0"], turnedOn: day(-738) }, checks(-738, 8)),
  system(203, { address: "30 Demo Crescent", postalCode: "558001", pm: { uid: null, name: null }, ppa: { kind: "value_buy", years: null }, plan: { years: 3, excludesFirstYear: false }, panels: [{ count: 38, wp: 620 }], kwp: 23.56, phase: 3, inverters: ["SUN2000-25KTL-M5"], turnedOn: day(-713) }, checks(-713, 3)),
  system(204, { address: "Siglap Garden House", postalCode: "456000", imported: false, project: { id: 107, name: "Siglap Garden House", status: "maintenance" }, homeowner: { uid: 4, name: "Grace Tan", linked: true }, contactNo: "+65 9668 2031", ppa: null, plan: null, turnedOn: day(-40), roofAccess: null }, checks(-40, null)),
  // Imported from the lists, with its record project: fields still to fill on both.
  system(205, { address: "41 Preview Walk", postalCode: "486001", turnedOn: day(-1200), project: { id: 109, name: "41 Preview Walk", status: "maintenance" }, roofAccess: null, toFill: { system: ["Homeowner", "Contact number", "Roof access"], project: 21 } }, checks(-1200, 5, { 2: -466 })),
  system(206, { address: "3 Trial Lane", postalCode: "809001", pm: { uid: null, name: null }, plan: { years: 5, excludesFirstYear: true }, panels: [{ count: 18, wp: 640 }], kwp: 11.52, inverters: ["SUN2000-12K-MB0"], turnedOn: day(-60) }, checks(-60, 5)),
  system(207, { address: "Kovan Terrace", postalCode: "548000", imported: false, project: { id: 108, name: "Kovan Terrace", status: "maintenance" }, homeowner: { uid: 5, name: "Kumar Raj", linked: true }, turnedOn: day(-1130) }, checks(-1130, 3, { 2: -397, 3: -30 })),
];

export function mockMaintenance(): MaintenanceList {
  return { systems: SYSTEMS, today: day(0), canAssign: true, managers: MANAGERS };
}

export function mockSystem(id: number): MaintenanceDetail {
  const s = SYSTEMS.find((x) => x.id === id) ?? SYSTEMS[0];
  return {
    system: s,
    project: s.project ? { id: s.project.id, name: s.project.name, signedAt: new Date(Date.now() - 45 * DAY).toISOString(), closedAt: new Date(Date.now() - 40 * DAY).toISOString(), certificate: "#" } : null,
    canEdit: true,
    canAssign: true,
    canBook: true,
    canStart: true,
    // One system has maintenance under way (started by its manager; the homeowner has been told).
    maintenance:
      s.id === 201
        ? { id: 41, checkKey: "year_3", label: "Year 3 check", status: "started", note: "Inverter fan noisy at the last visit", startedAt: new Date(Date.now() - 2 * DAY).toISOString(), finishedAt: null, visit: null }
        : null,
    bookWith: [5],
    managers: MANAGERS,
    ...mockRecord(),
  };
}

const month = (back: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10);
};

/** The project list's client record for a sample system (made-up people). */
export function mockRecord() {
  return {
    record: {
      projectCode: "9SH0101", salutation: "Ms", email: "jasmine@example.com", signedOn: month(9), salesperson: "Mei Ling Goh",
      referrer: "K. Chandra", plan: "Smart Green", ratePerKwh: 0.19, epc: "Apex Solar Contractors", inverterSerials: ["HV2310049871"],
      dongleSerials: ["DG7Q2201"], installationStart: month(7), installationEnd: month(7), billingPeriod: "Full Calendar Month",
    },
    output: {
      estMonthlyKwh: 1300,
      months: [5, 4, 3, 2, 1].map((b, i) => ({ month: month(b), kwh: [1180, 1265.5, 1342, 1298.25, 1220][i] })),
      total: 6305.75,
      ofEstimate: 0.97,
    },
    billing: [{ month: month(2), period: "18 Jul – 17 Aug 2026" }, { month: month(1), period: "Full Calendar Month" }],
    feedback: [{ id: 1, body: "Very happy with how tidy the installation was.", at: new Date().toISOString() }],
    warranties: [{ model: "SUN2000-10KTL-MAP0", known: true, years: 10, until: "2036-03-01", priceExGst: 2091, priceInclGst: 2279.19 }],
  };
}

/** A handed-over project's Maintenance tab: its system, with the 6-month visit asked for. */
export function mockProjectMaintenance(pid: number): MaintenanceDetail {
  const s = SYSTEMS.find((x) => x.project?.id === pid) ?? SYSTEMS[3];
  const start = `${day(5)}T09:00:00+08:00`;
  const end = `${day(5)}T11:00:00+08:00`;
  // The homeowner's view: no check schedule; the maintenance their manager started, its visit, the last one done.
  return {
    ...mockSystem(s.id),
    system: { ...s, checks: [], next: null, notes: null, attention: false },
    canEdit: false,
    canAssign: false,
    canBook: false,
    canStart: false,
    bookWith: [],
    maintenance: { id: 42, checkKey: null, label: "Maintenance", status: "started", note: null, startedAt: new Date(Date.now() - 3 * DAY).toISOString(), finishedAt: null, visit: { meetingId: 305, startsAt: start, endsAt: end, agreed: false } },
    lastMaintained: new Date(Date.now() - 380 * DAY).toISOString(),
  };
}
