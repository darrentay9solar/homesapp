/**
 * Maintenance, as people read it: `npm run test:web`.
 *
 *   wording   a system's contract and hardware, as the project listing words them, in English and Chinese
 *   tabs      Attention, Due soon, Unassigned, Checks done
 *   search    addresses, inverters, the contract, and words like "urgent" and "overdue"
 *   order     urgent, then overdue, then the soonest check
 *   dates     the checks count months as the listing does
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addMonths,
  type Check,
  filterSystems,
  inMTab,
  inverterText,
  kwpText,
  type MaintenanceSystem,
  matchesSystem,
  panelText,
  phaseText,
  planText,
  ppaText,
  sgToday,
  sortSystems,
} from "../lib/client/maintenance";

function check(key: Check["key"], state: Check["state"], due: string | null = "2027-01-01"): Check {
  return { key, label: key === "six_month" ? "6-month check" : "1-year check", due, doneOn: state === "done" ? "2026-10-01" : null, state };
}

function system(over: Partial<MaintenanceSystem> = {}): MaintenanceSystem {
  const checks = over.checks ?? [check("six_month", "scheduled", "2026-11-26"), check("one_year", "scheduled", "2027-05-26")];
  return {
    id: 1,
    address: "23 Lorong Example",
    postalCode: "358791",
    imported: true,
    project: null,
    pm: { uid: 7, name: "Marcus Lim" },
    homeowner: { uid: null, name: null, linked: false },
    contactNo: null,
    ppa: { kind: "ppa", years: 5 },
    plan: { years: 5, excludesFirstYear: false },
    panels: [{ count: 22, wp: 620 }],
    panelCount: 22,
    kwp: 13.64,
    phase: 1,
    inverters: ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"],
    turnedOn: "2026-05-26",
    next: checks.find((c) => c.state !== "done" && c.state !== "unscheduled") ?? null,
    roofAccess: false,
    urgent: false,
    urgentNote: null,
    notes: null,
    attention: false,
    updatedAt: "2026-10-09T00:00:00Z",
    ...over,
    checks,
  };
}

describe("wording", () => {
  it("a PPA", () => assert.equal(ppaText(system(), "en"), "5-year PPA"));
  it("a value buy", () => assert.equal(ppaText(system({ ppa: { kind: "value_buy", years: null } }), "en"), "Value buy"));
  it("no contract recorded", () => assert.equal(ppaText(system({ ppa: null }), "en"), null));
  it("a free plan", () => assert.equal(planText(system(), "en"), "Free for 5 years"));
  it("a plan after the first year", () => assert.equal(planText(system({ plan: { years: 7, excludesFirstYear: true } }), "en"), "7 years excluding 1st year"));
  it("in Chinese", () => {
    assert.equal(ppaText(system(), "zh"), "5年购电协议");
    assert.equal(planText(system({ plan: { years: 7, excludesFirstYear: true } }), "zh"), "7年（不含第1年）");
    assert.equal(phaseText(3, "zh"), "三相");
  });
  it("single- and 3-phase", () => {
    assert.equal(phaseText(1, "en"), "Single-phase");
    assert.equal(phaseText(3, "en"), "3-phase");
    assert.equal(phaseText(null, "en"), null);
  });
  it("one kind of panel", () => assert.equal(panelText([{ count: 22, wp: 620 }], "en"), "22 × 620 Wp"));
  it("a mixed roof", () => assert.equal(panelText([{ count: 23, wp: 635 }, { count: 3, wp: 620 }], "en"), "23 × 635 Wp + 3 × 620 Wp"));
  it("panels without a wattage", () => assert.equal(panelText([{ count: 12, wp: null }], "en"), "12 panels"));
  it("no panels", () => assert.equal(panelText([], "en"), null));
  it("two of the same inverter", () => assert.equal(inverterText(["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"]), "2 × SUN2000-5KTL-L1"));
  it("two different inverters, in order", () => assert.equal(inverterText(["SUN2000-5KTL-L1", "SUN2000-10K-LC0"]), "SUN2000-5KTL-L1 + SUN2000-10K-LC0"));
  it("capacity", () => {
    assert.equal(kwpText(16.465), "16.465 kWp");
    assert.equal(kwpText(12.4), "12.4 kWp");
    assert.equal(kwpText(null), null);
  });
});

describe("tabs", () => {
  const urgent = system({ id: 2, urgent: true, attention: true });
  const overdue = system({ id: 3, attention: true, checks: [check("six_month", "overdue"), check("one_year", "scheduled")] });
  const soon = system({ id: 4, checks: [check("six_month", "due_soon"), check("one_year", "scheduled")] });
  const free = system({ id: 5, pm: { uid: null, name: null } });
  const done = system({ id: 6, checks: [check("six_month", "done"), check("one_year", "done")] });
  const all = [urgent, overdue, soon, free, done];
  const ids = (tab: Parameters<typeof inMTab>[1]) => all.filter((s) => inMTab(s, tab)).map((s) => s.id);
  it("Attention: urgent or overdue", () => assert.deepEqual(ids("attention"), [2, 3]));
  it("Due soon", () => assert.deepEqual(ids("due"), [4]));
  it("Unassigned", () => assert.deepEqual(ids("unassigned"), [5]));
  it("Checks done", () => assert.deepEqual(ids("done"), [6]));
  it("All", () => assert.equal(ids("all").length, 5));
});

describe("search", () => {
  const s = system({ urgent: true, urgentNote: "Poor generation: need to check", attention: true });
  for (const q of ["lorong", "358791", "sun2000-5ktl", "13.64", "5-year", "free for 5", "single", "1p", "urgent", "poor generation", "marcus", "紧急"]) {
    it(`finds it by "${q}"`, () => assert.ok(matchesSystem(s, q)));
  }
  it("every word must match", () => assert.ok(!matchesSystem(s, "lorong 3-phase")));
  it("unassigned finds systems with no manager", () => {
    assert.ok(matchesSystem(system({ pm: { uid: null, name: null } }), "unassigned"));
    assert.ok(!matchesSystem(system(), "unassigned"));
  });
  it("overdue finds an overdue check", () => assert.ok(matchesSystem(system({ checks: [check("six_month", "overdue"), check("one_year", "scheduled")] }), "overdue")));
  it("search and tab together", () => {
    const list = [system({ id: 1, address: "1 Bedok Walk", pm: { uid: null, name: null } }), system({ id: 2, address: "2 Bedok Walk" })];
    assert.deepEqual(filterSystems(list, { query: "bedok", tab: "unassigned" }).map((x) => x.id), [1]);
  });
});

describe("order", () => {
  it("urgent, then overdue, then the soonest check, then the address", () => {
    const list = [
      system({ id: 1, address: "B", checks: [check("six_month", "scheduled", "2027-03-01"), check("one_year", "scheduled", "2027-09-01")] }),
      system({ id: 2, address: "A", checks: [check("six_month", "scheduled", "2027-03-01"), check("one_year", "scheduled", "2027-09-01")] }),
      system({ id: 3, checks: [check("six_month", "overdue", "2026-09-01"), check("one_year", "scheduled")] }),
      system({ id: 4, urgent: true }),
      system({ id: 5, checks: [check("six_month", "due_soon", "2026-10-20"), check("one_year", "scheduled")] }),
    ];
    assert.deepEqual(sortSystems(list).map((s) => s.id), [4, 3, 5, 2, 1]);
  });
});

describe("dates", () => {
  const cases: Array<[string, number, string]> = [
    ["2026-05-26", 6, "2026-11-26"],
    ["2025-12-31", 6, "2026-06-30"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2026-01-12", 12, "2027-01-12"],
  ];
  for (const [d, n, want] of cases) it(`${d} + ${n} months is ${want}`, () => assert.equal(addMonths(d, n), want));
  it("today in Singapore", () => assert.equal(sgToday(new Date("2026-10-08T17:30:00Z")), "2026-10-09"));
});
