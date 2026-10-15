/**
 * Payments, worked out on the device: `npm run test:web`.
 *
 *   money     amounts read as Singapore dollars, exactly (no float rounding)
 *   amounts   kWh x rate to the cent, half a cent up, as the API works it out (2,000 cases)
 *   months    the month to invoice now, and month names
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lastMonth, money, monthlyAmount } from "../lib/client/finance";

describe("money", () => {
  it("reads like Singapore dollars", () => {
    assert.equal(money("3500"), "S$3,500.00");
    assert.equal(money("1234567.891"), "S$1,234,567.89");
    assert.equal(money("0.995"), "S$1.00");
    assert.equal(money("-12.4"), "-S$12.40");
    assert.equal(money(null), "S$0.00");
    assert.equal(money(215.29), "S$215.29");
  });
});

describe("amounts", () => {
  it("matches the API's sums", () => {
    assert.equal(monthlyAmount("812.40", "0.2650"), "215.29");
    assert.equal(monthlyAmount("1", "0.0050"), "0.01");
    assert.equal(monthlyAmount("1", "0.0049"), "0.00");
    assert.equal(monthlyAmount("abc", "0.2"), null);
    assert.equal(monthlyAmount("1.234", "0.2"), null, "kWh to two places");
  });
  it("2,000 cases against whole-number arithmetic", () => {
    let seed = 4300;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const kwhC = next(5_000_000);
      const rateT = next(10_000);
      const cents = Math.floor((kwhC * rateT + 5000) / 10000);
      const kwh = `${Math.floor(kwhC / 100)}.${String(kwhC % 100).padStart(2, "0")}`;
      const rate = `${Math.floor(rateT / 10000)}.${String(rateT % 10000).padStart(4, "0")}`;
      assert.equal(monthlyAmount(kwh, rate), `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`, `${kwh} x ${rate}`);
    }
  });
});

describe("months", () => {
  it("invoices the month that's over", () => {
    assert.equal(lastMonth("2026-10-15"), "2026-09");
    assert.equal(lastMonth("2027-01-02"), "2026-12");
  });
});
