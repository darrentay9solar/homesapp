/** The Alerts screen and phone notifications in the browser: `npm run test:web`. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AlertRow, filterAlerts, groupByDay, safeLink } from "../lib/client/alerts";
import { deviceSupport, keyBytes } from "../lib/client/push";

let n = 1;
const alert = (o: Partial<AlertRow> & { createdAt: string }): AlertRow => ({
  id: n++,
  kind: "milestone_complete",
  kindLabel: "Milestone",
  title: "Milestone 1 complete",
  body: null,
  link: "/projects/1",
  projectId: 1,
  projectName: "Jalan Kayu Residence",
  read: false,
  urgent: false,
  ...o,
});

describe("grouping by day (Singapore time)", () => {
  const now = new Date("2026-10-07T10:00:00+08:00");
  const list = [
    alert({ createdAt: "2026-10-07T09:00:00+08:00" }),
    alert({ createdAt: "2026-10-07T00:10:00+08:00" }),
    alert({ createdAt: "2026-10-06T23:50:00+08:00" }),
    alert({ createdAt: "2026-10-03T12:00:00+08:00" }),
  ];
  const groups = groupByDay(list, now);
  it("labels today and yesterday in words", () => assert.deepEqual(groups.slice(0, 2).map((g) => g.label), ["Today", "Yesterday"]));
  it("a minute after midnight in Singapore is today, though it's yesterday in UTC", () => assert.equal(groups[0].alerts.length, 2));
  it("older days get their date", () => assert.match(groups[2].label, /Saturday.*3 Oct/));
  it("newest day first", () => assert.equal(groups.length, 3));
});

describe("filters", () => {
  const list = [alert({ createdAt: "2026-10-07T01:00:00Z", read: true }), alert({ createdAt: "2026-10-07T02:00:00Z" }), alert({ createdAt: "2026-10-07T03:00:00Z", urgent: true, read: true })];
  it("all", () => assert.equal(filterAlerts(list, "all").length, 3));
  it("unread", () => assert.equal(filterAlerts(list, "unread").length, 1));
  it("running late, read or not", () => assert.equal(filterAlerts(list, "late").length, 1));
});

describe("links", () => {
  const cases: Array<[string | null, string]> = [
    ["/projects/7#site-visits", "/projects/7#site-visits"],
    ["/people", "/people"],
    ["https://evil.example", "/alerts"],
    ["//evil.example/x", "/alerts"],
    ["javascript:alert(1)", "/alerts"],
    ["", "/alerts"],
    [null, "/alerts"],
  ];
  for (const [given, want] of cases) it(`${JSON.stringify(given)} → ${want}`, () => assert.equal(safeLink(given), want));
});

describe("can this device get notifications?", () => {
  const all = { hasSW: true, hasPush: true, hasNotification: true };
  const cases: Array<[string, Parameters<typeof deviceSupport>[0], string]> = [
    ["Android Chrome", { ua: "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile", standalone: false, ...all }, "ok"],
    ["iPhone Safari tab", { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", standalone: false, ...all }, "needs-install"],
    ["iPhone from the Home Screen", { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", standalone: true, ...all }, "ok"],
    ["iPad Safari tab", { ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", standalone: false, ...all }, "needs-install"],
    ["old iPhone at the Home Screen without push", { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)", standalone: true, hasSW: true, hasPush: false, hasNotification: false }, "unsupported"],
    ["desktop Chrome", { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", standalone: false, ...all }, "ok"],
    ["no service workers", { ua: "Mozilla/5.0 (Windows NT 10.0)", standalone: false, hasSW: false, hasPush: false, hasNotification: true }, "unsupported"],
  ];
  for (const [name, env, want] of cases) it(name, () => assert.equal(deviceSupport(env), want));
});

describe("the server's public key as bytes", () => {
  it("decodes base64url (no padding, - and _) to the 65-byte key", () => {
    const key = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const bytes = keyBytes(key);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 4);
    assert.equal(Buffer.from(bytes).toString("base64url"), key);
  });
});
