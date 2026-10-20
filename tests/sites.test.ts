import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type CheckIn, describeCheckIn, describeFix, getFix, hhmm, locationProblem, MAX_ACCURACY_M, siteLog, visitDay } from "../lib/client/sites";

const base: CheckIn = {
  id: 1,
  visitId: 2,
  by: { uid: 4, name: "Ravi Kumar" },
  inAt: "2026-10-12T00:52:00Z", // 08:52 in Singapore
  crewIn: 4,
  distance: 38.4,
  outAt: null,
  crewOut: null,
  outDistance: null,
};

describe("fix quality", () => {
  it("accepts a fix of the limit or better", () => {
    assert.deepEqual(describeFix({ lat: 1, lng: 1, accuracy: 12.4 }), { text: "Location found · accurate to 12 m", good: true });
    assert.equal(describeFix({ lat: 1, lng: 1, accuracy: MAX_ACCURACY_M }).good, true);
  });
  it("warns when the fix is too rough to count", () => {
    const d = describeFix({ lat: 1, lng: 1, accuracy: 120 });
    assert.equal(d.good, false);
    assert.match(d.text, /±120 m/);
  });
  it("matches the database's limit", () => {
    assert.equal(MAX_ACCURACY_M, 50);
  });
});

describe("location problems", () => {
  it("says what to do for each reason", () => {
    assert.match(locationProblem(1), /Allow location/);
    assert.match(locationProblem(2), /isn't available/);
    assert.match(locationProblem(3), /open sky/);
    assert.match(locationProblem(null), /phone with GPS/);
  });
  it("refuses plainly where there's no geolocation at all", async () => {
    await assert.rejects(getFix(), /phone with GPS/);
  });
});

describe("wording", () => {
  it("uses Singapore time whatever the device says", () => {
    assert.equal(hhmm("2026-10-12T00:52:00Z"), "08:52");
    assert.equal(hhmm("2026-10-12T15:30:00Z"), "23:30");
  });
  it("names the day of a visit", () => {
    assert.equal(visitDay("2026-10-12"), "Mon, 12 Oct");
  });
  it("describes a check-in still on site, and one that's left", () => {
    assert.equal(describeCheckIn(base), "Ravi Kumar in 08:52 (4 crew, 38 m) · still on site");
    assert.equal(
      describeCheckIn({ ...base, outAt: "2026-10-12T08:30:00Z", crewOut: 3 }),
      "Ravi Kumar in 08:52 (4 crew, 38 m) · out 16:30 (3 still on site)"
    );
  });
});

describe("site log", () => {
  const c = (id: number, inAt: string, outAt: string | null, visitId: number | null = null): CheckIn => ({
    id,
    visitId,
    by: { uid: 4, name: "Ravi Kumar" },
    inAt,
    crewIn: 4,
    distance: 12.4,
    outAt,
    crewOut: outAt ? 0 : null,
    outDistance: null,
  });
  const log = siteLog({
    visits: [
      { id: 1, date: "2026-10-12", time: "09:00", note: "Scaffolding", by: null, state: "attended", checkIns: [c(10, "2026-10-12T08:55:00+08:00", "2026-10-12T17:25:00+08:00", 1)] },
      { id: 2, date: "2026-10-13", time: "09:00", note: "Panels", by: null, state: "attended", checkIns: [c(11, "2026-10-13T10:20:00+08:00", "2026-10-13T16:00:00+08:00", 2)] },
      { id: 3, date: "2026-10-14", time: null, note: null, by: null, state: "missed", checkIns: [] },
      { id: 4, date: "2026-10-30", time: "08:30", note: "Inverter", by: null, state: "upcoming", checkIns: [] },
    ],
    unscheduled: [c(12, "2026-10-15T23:30:00Z", null)],
  });
  it("newest day first", () => assert.deepEqual(log.map((r) => r.day), ["2026-10-30", "2026-10-16", "2026-10-14", "2026-10-13", "2026-10-12"]));
  it("a day's check-in reads in Singapore time, with its hours", () =>
    assert.deepEqual(log.find((r) => r.key === "c10"), { key: "c10", day: "2026-10-12", scheduled: "09:00", works: "Scaffolding", who: "Ravi Kumar", inAt: "08:55", outAt: "17:25", hours: 8.5, crewIn: 4, crewOut: 0, metres: 12, status: "On time" }));
  it("an hour or more after the start is late", () => assert.equal(log.find((r) => r.key === "c11")?.status, "Late"));
  it("a past visit nobody checked in for", () => assert.equal(log.find((r) => r.key === "v3")?.status, "No check-in"));
  it("a visit still to come", () => assert.equal(log.find((r) => r.key === "v4")?.status, "Upcoming"));
  it("a check-in on a day with no visit, still on site, on its Singapore day", () =>
    assert.deepEqual([log[1].key, log[1].status, log[1].day, log[1].inAt, log[1].hours], ["c12", "Still on site", "2026-10-16", "07:30", null]));
});
