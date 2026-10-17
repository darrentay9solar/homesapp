/**
 * Personal data (PDPA): `npm run test:web`.
 *
 *   version   the app and the server name the same privacy notice
 *   asking    who is asked to agree, and when
 *   notice    every word of the notice and the agreement is in Chinese too
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import zh from "../api/_lib/i18n/zh.json";
import { needsPrivacyAgreement, PRIVACY_VERSION } from "../lib/client/privacy";

const ROOT = join(__dirname, "..");

describe("the privacy notice's version", () => {
  it("is the same in the app and on the server", () => {
    const server = readFileSync(join(ROOT, "api/_lib/privacy.py"), "utf8");
    assert.equal(/^VERSION = "([^"]+)"/m.exec(server)?.[1], PRIVACY_VERSION);
  });
  it("is a date", () => assert.match(PRIVACY_VERSION, /^\d{4}-\d{2}-\d{2}$/));
  it("is what sample people agreed to in the seed", () => {
    const seed = readFileSync(join(ROOT, "scripts/reset_and_seed.py"), "utf8");
    const versions = [...seed.matchAll(/now\(\), '(\d{4}-\d{2}-\d{2})'\)/g)].map((m) => m[1]);
    assert.ok(versions.length >= 2);
    for (const v of versions) assert.equal(v, PRIVACY_VERSION);
  });
});

describe("who is asked to agree", () => {
  it("someone who never agreed", () => assert.equal(needsPrivacyAgreement({ version: null, current: PRIVACY_VERSION }), true));
  it("someone who agreed to an older notice", () => assert.equal(needsPrivacyAgreement({ version: "2020-01-01", current: PRIVACY_VERSION }), true));
  it("not someone who agreed to this one", () => assert.equal(needsPrivacyAgreement({ version: PRIVACY_VERSION, current: PRIVACY_VERSION }), false));
  it("not while it isn't known (a preview, or still loading)", () => assert.equal(needsPrivacyAgreement(undefined), false));
});

describe("the notice in Chinese", () => {
  it("has every phrase of the notice page", () => {
    const page = readFileSync(join(ROOT, "app/privacy/page.tsx"), "utf8");
    const keys = [...page.matchAll(/T\("((?:[^"\\]|\\.)+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 30, String(keys.length));
    assert.deepEqual(keys.filter((k) => !(k in (zh as Record<string, string>))), []);
  });
});
