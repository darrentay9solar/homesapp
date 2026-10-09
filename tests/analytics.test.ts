/**
 * The dashboard's numbers as people read them: `npm run test:web`.
 *
 *   ticks       axis steps are round, whole for counts, and reach the top value
 *   pct, num    87%, 1,284, 12K, and a dash when there's no value
 *   deltaText   "+18% vs the previous 90 days", nothing for all time
 *   bucketLabel a month or a week as a column's name
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketLabel, days, deltaText, kwp, num, pct, ticks } from "../lib/client/analytics";

describe("ticks", () => {
  const cases: Array<[number, number[]]> = [
    [0, [0, 1]],
    [1, [0, 1]],
    [3, [0, 1, 2, 3]],
    [8, [0, 2, 4, 6, 8]],
    [9, [0, 3, 6, 9]],
    [14, [0, 5, 10, 15]],
    [40, [0, 10, 20, 30, 40]],
    [97, [0, 25, 50, 75, 100]],
    [1234, [0, 500, 1000, 1500]],
  ];
  for (const [max, want] of cases) it(`up to ${max}: ${want.join(", ")}`, () => assert.deepEqual(ticks(max), want));
  for (const max of [2, 5, 7, 11, 23, 61, 150, 999]) {
    it(`${max}: whole, rising, from 0 and reaching it`, () => {
      const t = ticks(max);
      assert.equal(t[0], 0);
      assert.ok(t[t.length - 1] >= max);
      assert.ok(t.every((v, i) => Number.isInteger(v) && (i === 0 || v > t[i - 1])));
      assert.ok(t.length <= 6);
    });
  }
});

describe("numbers", () => {
  it("a share", () => assert.equal(pct(0.873), "87%"));
  it("no share", () => assert.equal(pct(null), "—"));
  it("a count", () => assert.equal(num(1284), "1,284"));
  it("a big count is compact", () => assert.equal(num(12900), "13K"));
  it("no count", () => assert.equal(num(undefined), "—"));
  it("capacity", () => assert.equal(kwp(12.2), "12.2 kWp"));
  it("days", () => assert.equal(days(1), "1 day"));
  it("days with a fraction", () => assert.equal(days(3.4), "3.4 days"));
  it("no days", () => assert.equal(days(null), "—"));
});

describe("change against the previous period", () => {
  it("up", () => assert.deepEqual(deltaText(0.18, "90d"), { text: "+18% vs the previous 90 days", up: true }));
  it("down", () => assert.deepEqual(deltaText(-0.5, "30d"), { text: "-50% vs the previous 30 days", up: false }));
  it("flat counts as up", () => assert.equal(deltaText(0, "12m")?.up, true));
  it("nothing for all time", () => assert.equal(deltaText(0.4, "all"), null));
  it("nothing to compare", () => assert.equal(deltaText(null, "90d"), null));
});

describe("column names", () => {
  it("a month", () => assert.equal(bucketLabel("2026-03"), "Mar"));
  it("a week", () => assert.equal(bucketLabel("2026-09-07"), "7 Sept"));
});
