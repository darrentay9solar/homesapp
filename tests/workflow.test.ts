/**
 * GetApps (9 Solar Fintech): `npm run test:web`.
 *
 *   addMonths     a project's 10 months, as the server works them out (api/_lib/workflow.py add_months)
 *   inTab         the projects list's stage tabs, for a project with a workflow stage
 *   group filter  a group's projects narrowed by phase, stage, SP approval, timing and words
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addMonths, inTab, type ProjectRow } from "../lib/client/projects";
import { filterGroupProjects, type GroupProject, NO_FILTER } from "../lib/client/workflow";

describe("addMonths", () => {
  it("is the same day, 10 months on", () => assert.equal(addMonths("2026-01-15", 10), "2026-11-15"));
  it("crosses the year", () => assert.equal(addMonths("2026-05-02", 10), "2027-03-02"));
  it("keeps to the month's last day", () => assert.equal(addMonths("2026-05-31", 9), "2027-02-28"));
  it("goes back too", () => assert.equal(addMonths("2027-03-02", -10), "2026-05-02"));
});

describe("the stage tabs", () => {
  const p = (stage: string, complete = false, attention = false) => ({ stage, complete, attention, status: "in_progress" }) as unknown as ProjectRow;
  it("puts a project in its stage's tab", () => {
    assert.ok(inTab(p("electrical"), "electrical"));
    assert.ok(!inTab(p("electrical"), "mechanical"));
  });
  it("completed means the whole workflow is done", () => {
    assert.ok(inTab(p("complete", true), "completed"));
    assert.ok(!inTab(p("sp_turn_on"), "completed"));
  });
  it("keeps All and Attention", () => {
    assert.ok(inTab(p("pre_install"), "all"));
    assert.ok(inTab(p("pre_install", false, true), "attention"));
    assert.ok(!inTab(p("pre_install"), "attention"));
  });
  it("has no approval or handover for a workflow project", () => assert.ok(!inTab(p("pre_install"), "approval")));
});

describe("a group's filters", () => {
  const row = (id: number, over: Partial<GroupProject>): GroupProject => ({
    id, name: `Factory ${id}`, address: "1 Tuas Ave", postalCode: "639000", phaseId: 1, pm: "Wei Ming", stage: "mechanical",
    stageLabel: "Mechanical Installation", progress: 30, complete: false, lateDays: 0, startDate: null, endDate: null,
    sp: { cs1_application: true, pv1_letter: false }, ...over,
  }); // prettier-ignore
  const rows = [row(1, {}), row(2, { phaseId: 2, stage: "electrical", lateDays: 5 }), row(3, { phaseId: null, sp: { cs1_application: false }, name: "Loyang Plant" })];
  const ids = (f: Partial<typeof NO_FILTER>) => filterGroupProjects(rows, { ...NO_FILTER, ...f }).map((r) => r.id);
  it("shows everything without a filter", () => assert.deepEqual(ids({}), [1, 2, 3]));
  it("by phase, and without one", () => {
    assert.deepEqual(ids({ phase: "2" }), [2]);
    assert.deepEqual(ids({ phase: "none" }), [3]);
  });
  it("by stage", () => assert.deepEqual(ids({ stage: "mechanical" }), [1, 3]));
  it("by an SP approval done or not", () => {
    assert.deepEqual(ids({ sp: "cs1_application", spDone: "done" }), [1, 2]);
    assert.deepEqual(ids({ sp: "cs1_application", spDone: "not" }), [3]);
  });
  it("by timing", () => {
    assert.deepEqual(ids({ late: "late" }), [2]);
    assert.deepEqual(ids({ late: "ontime" }), [1, 3]);
  });
  it("by words, every one matching", () => assert.deepEqual(ids({ q: "loyang plant" }), [3]));
  it("combines them", () => assert.deepEqual(ids({ phase: "1", stage: "electrical" }), []));
});
