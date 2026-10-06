import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type CheckIn, describeCheckIn, describeFix, getFix, hhmm, locationProblem, MAX_ACCURACY_M, visitDay } from "../lib/client/sites";

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
