/**
 * The demo site's cookie: `npm run test:web`. The sample person a visitor picked
 * must be read back exactly, or every request reaches the server unsigned.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDemoCookie } from "../lib/client/demo";

describe("readDemoCookie", () => {
  const cases: Array<[string | null | undefined, string | null]> = [
    ["gha-demo=5", "5"],
    ["gha-lang=en; gha-demo=12", "12"],
    ["gha-demo=7; gha-lang=zh", "7"],
    ["a=1;gha-demo=42;b=2", "42"],
    ["gha-lang=en", null],
    ["gha-demo=", null],
    ["gha-demo=abc", null],
    ["gha-demo=5x", null],
    ["xgha-demo=5", null],
    ["", null],
    [null, null],
    [undefined, null],
  ];
  for (const [cookie, want] of cases) it(`${JSON.stringify(cookie)} → ${want}`, () => assert.equal(readDemoCookie(cookie), want));
});
