import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterProjects, firstOpenSection, inTab, lockReason, matchesProject, planDates, type ProjectRow, showValue, sortProjects } from "../lib/client/projects";

let next = 1;
function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: next++,
    name: "Jalan Kayu Residence",
    address: "14 Jalan Kayu, Singapore 799463",
    postalCode: "799463",
    siteLocated: true,
    status: "in_progress",
    statusLabel: "In Progress",
    homeowner: { uid: 5, name: "Jasmine Lee", linked: true },
    contactNo: "+65 9123 4477",
    contractor: { type: "group", label: "Apex Solar Contractors", groupId: 1 },
    team: [
      { uid: 1, name: "Wei Ming Tan", role: "project_manager" },
      { uid: 4, name: "Ravi Kumar", role: "epc_team" },
    ],
    pm: { uid: 1, name: "Wei Ming Tan" },
    startDate: "2026-10-05",
    endDate: "2026-10-26",
    daysElapsed: 3,
    progress: 40,
    milestone: 1,
    currentMilestone: 2,
    groups: {},
    flags: [],
    attention: false,
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("dates", () => {
  it("fills a missing end three weeks after the start", () => {
    assert.deepEqual(planDates("2026-10-12", ""), { start: "2026-10-12", end: "2026-11-02", error: null });
  });
  it("fills a missing start three weeks before the end, across a month", () => {
    assert.deepEqual(planDates("", "2026-11-10"), { start: "2026-10-20", end: "2026-11-10", error: null });
  });
  it("keeps both when given, and flags an end before the start", () => {
    assert.equal(planDates("2026-10-12", "2026-12-01")?.end, "2026-12-01");
    assert.ok(planDates("2026-10-12", "2026-10-01")?.error);
  });
  it("needs at least one", () => {
    assert.equal(planDates("", ""), null);
  });
  it("crosses a year end", () => {
    assert.equal(planDates("2026-12-20", "")?.end, "2027-01-10");
  });
});

describe("tabs", () => {
  it("files each status under one tab", () => {
    assert.ok(inTab(project({ status: "awaiting_homeowner" }), "approval"));
    assert.ok(inTab(project({ status: "draft" }), "approval"));
    assert.ok(inTab(project({ status: "pm_approved" }), "active"));
    assert.ok(inTab(project({ status: "awaiting_signature" }), "handover"));
    assert.ok(inTab(project({ status: "closed" }), "closed"));
    assert.ok(!inTab(project({ status: "closed" }), "active"));
  });
  it("gathers anything late or with a no-show under Attention", () => {
    const red = project({ attention: true, flags: [{ kind: "overdue", text: "x" }] });
    assert.ok(inTab(red, "attention"));
    assert.ok(!inTab(project(), "attention"));
  });
});

describe("search", () => {
  const p = project();
  it("finds by name, address, postal code, homeowner, contractor, team and status", () => {
    for (const q of ["jalan", "kayu residence", "799463", "jasmine", "apex", "ravi", "in progress", "milestone 2", "4477"]) {
      assert.ok(matchesProject(p, q), q);
    }
  });
  it("needs every word", () => {
    assert.ok(matchesProject(p, "jalan apex"));
    assert.ok(!matchesProject(p, "jalan bedok"));
  });
  it("finds late projects and no-shows by everyday words", () => {
    const late = project({ attention: true, flags: [{ kind: "overdue", text: "Target end date passed 3 days ago" }] });
    const noShow = project({ attention: true, flags: [{ kind: "no_show", text: "No check-in" }] });
    assert.ok(matchesProject(late, "late"));
    assert.ok(matchesProject(noShow, "no-show"));
    assert.ok(!matchesProject(p, "late"));
    assert.ok(matchesProject(p, "on track"));
  });
  it("combines search with a tab", () => {
    const list = [project({ name: "Bedok Ria", status: "closed" }), project({ name: "Bedok North" })];
    assert.deepEqual(filterProjects(list, { query: "bedok", tab: "closed" }).map((x) => x.name), ["Bedok Ria"]);
  });
});

describe("order", () => {
  it("puts projects needing attention first and keeps the rest in order", () => {
    const a = project({ name: "A" });
    const b = project({ name: "B", attention: true });
    const c = project({ name: "C" });
    assert.deepEqual(sortProjects([a, b, c]).map((x) => x.name), ["B", "A", "C"]);
  });
});

describe("section locks", () => {
  it("keeps every section shut until the project is approved", () => {
    for (const status of ["draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"] as const) {
      assert.ok(lockReason({ status, milestone: 0 }, "pre1"), status);
    }
  });
  it("opens Milestone 1's sections on approval, then each milestone after the last", () => {
    const p = { status: "in_progress" as const, milestone: 0 };
    assert.equal(lockReason(p, "pre1"), null);
    assert.equal(lockReason(p, "m1"), null);
    assert.match(lockReason(p, "m2") ?? "", /Milestone 1/);
    assert.match(lockReason({ ...p, milestone: 1 }, "post") ?? "", /Milestone 2/);
    assert.equal(lockReason({ ...p, milestone: 1 }, "m2"), null);
    assert.equal(lockReason({ ...p, milestone: 2 }, "post"), null);
  });
});

describe("field values", () => {
  it("reads values the way the brief writes them", () => {
    assert.equal(showValue({ kind: "yesno", value: true, key: "waterproofing" }), "Yes");
    assert.equal(showValue({ kind: "yesno", value: false, key: "waterproofing" }), "No");
    assert.equal(showValue({ kind: "select", value: 2, key: "sp_application_status" }), "LEW submitted to SP");
    assert.equal(showValue({ kind: "retailer", value: { id: 1, name: "Geneco" }, key: "electricity_retailer_id" }), "Geneco");
    assert.equal(showValue({ kind: "date", value: "2026-10-16", key: "installation_end_date" }), "16 Oct 2026");
    assert.equal(showValue({ kind: "number", value: 610, key: "panel_capacity" }), "610 W");
    assert.equal(showValue({ kind: "text", value: null, key: "sales" }), "");
  });
  it("opens the earliest section that still needs work", () => {
    const s = (key: string, lockedReason: string | null, complete: boolean) =>
      ({ key, lockedReason, complete }) as unknown as Parameters<typeof firstOpenSection>[0][number];
    assert.equal(firstOpenSection([s("pre1", null, true), s("pre1b", null, false), s("m2", "x", false)]), "pre1b");
    assert.equal(firstOpenSection([s("pre1", "locked", false)]), null);
  });
});
