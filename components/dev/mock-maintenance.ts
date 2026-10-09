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

function checks(six: number, year: number, sixDone?: number, yearDone?: number): Check[] {
  const state = (due: number, done?: number): Check["state"] => (done !== undefined ? "done" : due < 0 ? "overdue" : due <= 30 ? "due_soon" : "scheduled");
  return [
    { key: "six_month", label: "6-month check", due: day(six), doneOn: sixDone !== undefined ? day(sixDone) : null, state: state(six, sixDone) },
    { key: "one_year", label: "1-year check", due: day(year), doneOn: yearDone !== undefined ? day(yearDone) : null, state: state(year, yearDone) },
  ];
}

function system(id: number, over: Partial<MaintenanceSystem>, c: Check[]): MaintenanceSystem {
  const next = c.find((x) => x.state !== "done" && x.state !== "unscheduled") ?? null;
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
  s.attention = s.urgent || c.some((x) => x.state === "overdue");
  return s;
}

const SYSTEMS: MaintenanceSystem[] = [
  system(201, { address: "7 Example Avenue", postalCode: "466001", ppa: { kind: "ppa", years: 7 }, plan: { years: 7, excludesFirstYear: true }, panels: [{ count: 23, wp: 635 }, { count: 3, wp: 620 }], kwp: 16.465, inverters: ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"], turnedOn: day(-215), urgent: true, urgentNote: "Poor generation: need to check" }, checks(-33, 150)),
  system(202, { address: "88 Showcase Road", postalCode: "288001", pm: MANAGERS[1], ppa: { kind: "ppa", years: 8 }, plan: { years: 8, excludesFirstYear: true }, panels: [{ count: 62, wp: 620 }], kwp: 38.44, phase: 3, inverters: ["SUN2000-17KTL-MB0", "SUN2000-17KTL-MB0"], turnedOn: day(-190) }, checks(-8, 175)),
  system(203, { address: "30 Demo Crescent", postalCode: "558001", pm: { uid: null, name: null }, ppa: { kind: "value_buy", years: null }, plan: { years: 3, excludesFirstYear: false }, panels: [{ count: 38, wp: 620 }], kwp: 23.56, phase: 3, inverters: ["SUN2000-25KTL-M5"], turnedOn: day(-165) }, checks(17, 200)),
  system(204, { address: "Siglap Garden House", postalCode: "456000", imported: false, project: { id: 107, name: "Siglap Garden House", status: "closed" }, homeowner: { uid: 4, name: "Grace Tan", linked: true }, contactNo: "+65 9668 2031", ppa: null, plan: null, turnedOn: day(-40), roofAccess: null }, checks(143, 325)),
  system(205, { address: "41 Preview Walk", postalCode: "486001", turnedOn: day(-290) }, checks(-107, 75, -103)),
  system(206, { address: "3 Trial Lane", postalCode: "809001", pm: { uid: null, name: null }, plan: { years: 5, excludesFirstYear: true }, panels: [{ count: 18, wp: 640 }], kwp: 11.52, inverters: ["SUN2000-12K-MB0"], turnedOn: day(-60) }, checks(122, 305)),
  system(207, { address: "Kovan Terrace", postalCode: "548000", imported: false, project: { id: 108, name: "Kovan Terrace", status: "closed" }, homeowner: { uid: 5, name: "Kumar Raj", linked: true }, turnedOn: day(-400) }, checks(-217, -35, -214, -30)),
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
    managers: MANAGERS,
  };
}
