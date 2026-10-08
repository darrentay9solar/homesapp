/**
 * Maps and check-in locations: `npm run test:web`.
 *
 *   distanceM       metres between two points
 *   formatDistance  "40 m", "1.2 km"
 *   awayText        "You're at this site" inside the check-in radius
 *   seenAgo         how old a check-in position is, and when it's stale
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { awayText, distanceM, formatDistance, seenAgo } from "../lib/client/location";

const SITE = { lat: 1.3521, lng: 103.8198 };
// 0.001 degrees of latitude is about 111 m.
const north = (m: number) => ({ lat: SITE.lat + m / 111_195, lng: SITE.lng });

describe("distanceM", () => {
  it("is zero at the same place", () => assert.equal(distanceM(SITE, SITE), 0));
  for (const m of [10, 100, 150, 1000, 25_000]) {
    it(`${m} m north measures ${m} m (within 0.5%)`, () => assert.ok(Math.abs(distanceM(SITE, north(m)) - m) <= m * 0.005, String(distanceM(SITE, north(m)))));
  }
  it("is the same both ways", () => assert.equal(distanceM(SITE, north(500)), distanceM(north(500), SITE)));
  it("east-west across Singapore is about 40 km", () => {
    const d = distanceM({ lat: 1.35, lng: 103.65 }, { lat: 1.35, lng: 104.01 });
    assert.ok(d > 39_000 && d < 41_000, String(d));
  });
});

describe("formatDistance and awayText", () => {
  const cases: Array<[number, string]> = [
    [0, "0 m"],
    [4, "0 m"],
    [44, "40 m"],
    [850, "850 m"],
    [999, "1000 m"],
    [1000, "1.0 km"],
    [1234, "1.2 km"],
    [9_960, "10.0 km"],
    [12_400, "12 km"],
  ];
  for (const [m, want] of cases) it(`${m} m reads "${want}"`, () => assert.equal(formatDistance(m), want));
  it("inside the radius says you're there", () => assert.equal(awayText(60, 100), "You're at this site"));
  it("on the radius counts as there", () => assert.equal(awayText(100, 100), "You're at this site"));
  it("outside says how far", () => assert.equal(awayText(140, 100), "140 m away"));
});

describe("seenAgo", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const cases: Array<[number, string, boolean]> = [
    [0, "Just now", false],
    [5, "5 min ago", false],
    [30, "30 min ago", false],
    [31, "31 min ago", true],
    [90, "2 h ago", true],
    [60 * 30, "1 d ago", true],
  ];
  for (const [m, text, stale] of cases) it(`${m} min → "${text}"${stale ? ", stale" : ""}`, () => assert.deepEqual(seenAgo(at(m), now), { text, stale }));
  it("a clock slightly ahead never goes negative", () => assert.equal(seenAgo(at(-2), now).text, "Just now"));
});
