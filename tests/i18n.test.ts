/**
 * English / Chinese: `npm run test:web`.
 *
 *   translate    server text: exact phrases, {placeholder} patterns, nesting
 *   interpolate  the app's own T("…") keys with values
 *   dictionary   api/_lib/i18n/zh.json is well formed, and every T("…") key
 *                in the app has a translation
 *   dates        locale() follows the language
 *   prefs        pausing, quiet hours, the settings line
 *   search       Chinese words find the same things English ones do
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import zh from "../api/_lib/i18n/zh.json";
import { filterFiles, type MyFile } from "../lib/client/files";
import { interpolate, locale, translate } from "../lib/client/i18n";
import { filterPeople, type SearchablePerson } from "../lib/client/people-search";
import { DEFAULT_PREFS, inQuietHours, isPaused, pauseUntil, type Prefs, summary } from "../lib/client/prefs";
import { filterProjects, type ProjectRow } from "../lib/client/projects";

const DICT = zh as Record<string, string>;
const ROOT = join(__dirname, "..");

describe("translate: text from the server", () => {
  const cases: Array<[string, string]> = [
    // Exact phrases
    ["Projects", "项目"],
    ["No such project, or it isn't one of yours.", "没有这个项目，或者它不属于您。"],
    // A pattern, with a phrase inside it translated too (the role) and a name left alone
    ["Priya Nair is now EPC Team.", "Priya Nair 现在是EPC 团队。"],
    ["Asked to become Project Manager", "申请成为项目经理"],
    // Names and numbers pass through
    ["Running late · Seletar Hills Home", "迟到 · Seletar Hills Home"],
    ["Target end date passed 19 days ago", "目标结束日期已过 19 天"],
    ["That code isn't right. 2 tries left.", "验证码不正确。还剩 2 次机会。"],
    // Patterns inside patterns: the delivery report after a People message
    ["Created Aisha Tan as Homeowner. Email sent · WhatsApp sent", "已创建 Aisha Tan，角色为屋主。电子邮件已发送 · WhatsApp 已发送"],
    // A longer, more specific pattern wins over "{a} · {b}"
    ["Milestone 1 complete · Jalan Kayu", "里程碑 1 已完成 · Jalan Kayu"],
    // Keys with characters that mean something in a regular expression
    ["Panel Capacity (W)", "光伏板容量（W）"],
    ["Decline Aisha's request?", "拒绝 Aisha 的申请？"],
  ];
  for (const [en, out] of cases) it(en, () => assert.equal(translate(en, "zh"), out));

  it("leaves anything it doesn't know in English", () => {
    assert.equal(translate("Hillcrest Villa", "zh"), "Hillcrest Villa");
    assert.equal(translate("Something nobody wrote down", "zh"), "Something nobody wrote down");
  });
  it("leaves English alone", () => assert.equal(translate("Projects", "en"), "Projects"));
  it("handles empty values", () => {
    assert.equal(translate("", "zh"), "");
    assert.equal(translate(null, "zh"), "");
    assert.equal(translate(undefined, "zh"), "");
  });
});

describe("interpolate: the app's own words", () => {
  it("fills in values", () => assert.equal(interpolate("Checked in {time} with {n} crew", { time: "09:12", n: 3 }, "zh"), "09:12 签到，3 名施工人员"));
  it("translates a value that is itself a phrase", () => assert.equal(interpolate("Approve as {role}", { role: "Homeowner" }, "zh"), "批准为屋主"));
  it("keeps English in English", () => assert.equal(interpolate("Approve as {role}", { role: "Homeowner" }, "en"), "Approve as Homeowner"));
  it("an untranslated key stays English, values still filled", () => assert.equal(interpolate("No such key {n}", { n: 4 }, "zh"), "No such key 4"));
  it("a missing value is left empty", () => assert.equal(interpolate("Requested {when}", {}, "en"), "Requested "));
});

describe("the dictionary", () => {
  const entries = Object.entries(DICT);
  it("has well over a thousand phrases", () => assert.ok(entries.length > 1200, String(entries.length)));
  it("has no empty translations", () => assert.deepEqual(entries.filter(([, v]) => !v.trim()).map(([k]) => k), []));
  it("keeps every {placeholder} in the Chinese", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.deepEqual(entries.filter(([k, v]) => names(k) !== names(v)).map(([k]) => k), []);
  });
  it("is actually Chinese", () => {
    // Brand names, acronyms and pure patterns may stay as they are; sentences may not.
    const latinOnly = entries.filter(([k, v]) => k.split(" ").length > 3 && !/[一-鿿]/.test(v)).map(([k]) => k);
    assert.deepEqual(latinOnly, []);
  });

  it("covers every T(\"…\") key in the app", () => {
    const BRAND = new Set(["9 SOLAR HOME · 九太阳家", "GETHOMEAPPS", "GetHomeApps · 9 Solar Home · 九太阳家", "name@example.com", "…"]);
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== "dev-preview" && f !== "node_modules") walk(p);
        } else if (/\.tsx?$/.test(f)) {
          for (const m of readFileSync(p, "utf8").matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)) {
            const k = m[1].replace(/\\"/g, '"');
            if (!DICT[k] && !BRAND.has(k)) missing.push(`${k}  (${p.slice(ROOT.length + 1)})`);
          }
        }
      }
    };
    for (const d of ["app", "components", "lib/client"]) walk(join(ROOT, d));
    assert.deepEqual(missing, []);
  });
});

describe("dates follow the language", () => {
  it("English", () => assert.equal(locale("en"), "en-SG"));
  it("Chinese", () => assert.equal(locale("zh"), "zh-SG"));
  it("a Chinese date reads in Chinese", () => {
    const s = new Date("2026-10-07T12:00:00+08:00").toLocaleDateString(locale("zh"), { day: "numeric", month: "short", timeZone: "Asia/Singapore" });
    assert.match(s, /10月7日|10月 7日/);
  });
});

describe("notification preferences", () => {
  const P = (o: Partial<Prefs>): Prefs => ({ ...DEFAULT_PREFS, ...o });
  // 2026-10-07 14:30 in Singapore
  const now = new Date("2026-10-07T06:30:00Z");

  it("pause for an hour", () => assert.equal(pauseUntil("1h", now), "2026-10-07T07:30:00.000Z"));
  it("pause until 8 am tomorrow, Singapore time", () => assert.equal(pauseUntil("morning", now), "2026-10-08T00:00:00.000Z"));
  it("pause until 8 am tomorrow, just before midnight", () => assert.equal(pauseUntil("morning", new Date("2026-10-07T15:59:00Z")), "2026-10-08T00:00:00.000Z"));
  it("pause until 8 am tomorrow, just after midnight", () => assert.equal(pauseUntil("morning", new Date("2026-10-07T16:01:00Z")), "2026-10-09T00:00:00.000Z"));
  it("resume clears the pause", () => assert.equal(pauseUntil("off", now), null));
  it("a past pause no longer counts", () => assert.equal(isPaused(P({ pausedUntil: "2026-10-07T06:00:00Z" }), now), false));

  const quiet = P({ quiet: { on: true, from: "22:00", to: "07:00" } });
  const at = (sgTime: string) => new Date(`2026-10-07T${sgTime}:00+08:00`);
  for (const [t, inside] of [["21:59", false], ["22:00", true], ["23:30", true], ["03:00", true], ["06:59", true], ["07:00", false], ["12:00", false]] as const) {
    it(`overnight quiet hours at ${t}: ${inside ? "quiet" : "not quiet"}`, () => assert.equal(inQuietHours(quiet, at(t)), inside));
  }
  it("daytime quiet hours", () => {
    const day = P({ quiet: { on: true, from: "13:00", to: "15:00" } });
    assert.equal(inQuietHours(day, at("14:00")), true);
    assert.equal(inQuietHours(day, at("15:00")), false);
  });
  it("quiet hours switched off", () => assert.equal(inQuietHours(P({ quiet: { on: false, from: "00:00", to: "23:59" } }), at("12:00")), false));

  it("the settings line: paused first", () => assert.equal(summary(P({ pausedUntil: "2026-10-07T08:00:00Z", quiet: { on: true, from: "22:00", to: "07:00" } }), now).key, "Paused until {time}"));
  it("the settings line: everything off", () => assert.equal(summary(P({ channels: { push: false, email: false, mobile: false } }), now).key, "Phone, email and WhatsApp are off; alerts stay in the app"));
  it("the settings line: quiet hours", () => assert.deepEqual(summary(quiet, now), { key: "Quiet from {from} to {to}", params: { from: "22:00", to: "07:00" } }));
  it("the settings line: muted kinds", () => assert.deepEqual(summary(P({ mute: ["visits", "people"] }), now), { key: "{n} kinds of alert silenced", params: { n: "2" } }));
  it("the settings line: everything on", () => assert.equal(summary(DEFAULT_PREFS, now).key, "Everything on"));
  it("every settings line has a translation", () => {
    for (const k of ["Paused until {time}", "Phone, email and WhatsApp are off; alerts stay in the app", "Quiet from {from} to {to}", "{n} kinds of alert silenced", "Everything on"]) assert.ok(DICT[k], k);
  });
});

describe("search works in Chinese too", () => {
  const person = (o: Partial<SearchablePerson> & { fullName: string }): SearchablePerson => ({
    email: `${o.fullName.split(" ")[0].toLowerCase()}@example.com`,
    contactNo: null,
    role: "homeowner",
    active: true,
    linked: true,
    invitedAt: null,
    groupNames: [],
    ...o,
  });
  const people = [
    person({ fullName: "Jasmine Lee" }),
    person({ fullName: "Ravi Kumar", role: "epc_team", disableOn: "2026-12-31" }),
    person({ fullName: "Marcus Teo", active: false, disabledReason: "scheduled", disableOn: "2026-10-01" }),
    person({ fullName: "Wei Ming Tan", role: "project_manager" }),
  ];
  const names = (q: string) => filterPeople(people, { query: q }).map((p) => p.fullName);
  it("屋主 finds homeowners", () => assert.deepEqual(names("屋主"), ["Jasmine Lee", "Marcus Teo"]));
  it("项目经理 finds project managers", () => assert.deepEqual(names("项目经理"), ["Wei Ming Tan"]));
  it("施工队 finds the EPC crew", () => assert.deepEqual(names("施工队"), ["Ravi Kumar"]));
  it("已到期 finds expired accounts (the label on screen)", () => assert.deepEqual(names("已到期"), ["Marcus Teo"]));
  it("活跃 finds active accounts (the label on screen)", () => assert.deepEqual(names("活跃 屋主"), ["Jasmine Lee"]));

  const project = (o: Partial<ProjectRow> & { name: string }) =>
    ({
      id: 1,
      address: "1 Sample Road",
      postalCode: "123456",
      status: "in_progress",
      statusLabel: "In Progress",
      homeowner: { uid: 5, name: "Jasmine Lee", linked: true },
      contactNo: null,
      contractor: { type: "group", label: "Apex Solar", groupId: 1 },
      team: [],
      currentMilestone: 2,
      milestone: 1,
      flags: [],
      attention: false,
      ...o,
    }) as unknown as ProjectRow;
  const projects = [
    project({ name: "Jalan Kayu" }),
    project({ name: "Sunbird Circle", attention: true, flags: [{ kind: "overdue", text: "Target end date passed 19 days ago" }] as ProjectRow["flags"] }),
    project({ name: "Hillcrest", status: "draft", statusLabel: "Draft", currentMilestone: 1 }),
  ];
  const found = (q: string) => filterProjects(projects, { query: q }).map((p) => p.name);
  it("迟到 finds late projects", () => assert.deepEqual(found("迟到"), ["Sunbird Circle"]));
  it("草稿 finds drafts by their Chinese status", () => assert.deepEqual(found("草稿"), ["Hillcrest"]));
  it("里程碑2 finds projects on Milestone 2", () => assert.deepEqual(found("里程碑2"), ["Jalan Kayu", "Sunbird Circle"]));

  const file = (o: Partial<MyFile> & { name: string }) =>
    ({ id: 1, category: "utility_bill", categoryLabel: "Utility Bill", projectId: 1, projectName: "Jalan Kayu", contentType: "application/pdf", kind: "document", size: 1000, uploadedAt: "2026-10-01T00:00:00Z", removed: null, ...o }) as MyFile;
  const files = [file({ name: "bill.pdf" }), file({ name: "roof.jpg", kind: "photo", contentType: "image/jpeg", category: "panel_pictures", categoryLabel: "Installed Panel Pictures" })];
  const fileNames = (q: string) => filterFiles(files, q, "all").map((f) => f.name);
  it("照片 finds photos", () => assert.deepEqual(fileNames("照片"), ["roof.jpg"]));
  it("文件 finds documents", () => assert.deepEqual(fileNames("文件"), ["bill.pdf"]));
  it("水电账单 finds the utility bill by its Chinese slot name", () => assert.deepEqual(fileNames("水电账单"), ["bill.pdf"]));
});
