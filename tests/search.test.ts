/**
 * Every search in the app: `npm run test:web`.
 *
 *   Projects list      matchesProject / filterProjects
 *   People             filterPeople (more in people-search.test.ts)
 *   Audit timeline     matchesEntry
 *   Audit by person    matchesAuditPerson
 *   My Files           filterFiles
 *   Pickers            pickerFilter: homeowner, crew and retailer in forms
 *   Shared rules       matchesAll: words, case, accents, full-width, phone digits, punctuation
 *
 * Each table row is one case: a query, and exactly what it must find.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AuditEntry, matchesAuditPerson, matchesEntry } from "../lib/client/audit";
import { filterFiles, type MyFile, tabCounts } from "../lib/client/files";
import { filterPeople, type SearchablePerson } from "../lib/client/people-search";
import { filterProjects, type ProjectRow } from "../lib/client/projects";
import { matchesAll, pickerFilter } from "../lib/client/search";

// ------------------------------------------------------------------ shared rules

describe("shared rules", () => {
  const parts = ["Jalan Kayu Résidence", "+65 9123 4567", "Apex Solar Contractors", "Ｆｕｌｌ ｗｉｄｔｈ"];
  const cases: Array<[string, boolean]> = [
    ["", true],
    ["   ", true],
    ["jalan", true],
    ["JALAN", true],
    ["kayu jalan", true],
    ["jalan bedok", false],
    ["residence", true],
    ["résidence", true],
    ["RESIDÉNCE", true],
    ["91234567", true],
    ["9123 4567", true],
    ["+6591234567", true],
    ["4567", true],
    ["9999", false],
    ["\"apex\"", true],
    ["(apex),", true],
    ["full width", true],
    ["ｊａｌａｎ", true],
    ["sol", true],
    ["contractors.", true],
    ["z", false],
  ];
  for (const [q, want] of cases) {
    it(`${JSON.stringify(q)} → ${want ? "match" : "no match"}`, () => assert.equal(matchesAll(parts, q), want));
  }
  it("ignores empty parts", () => assert.equal(matchesAll([null, undefined, "", "Bedok"], "bedok"), true));
  it("a single digit isn't treated as a phone search", () => assert.equal(matchesAll(["+65 9123 4567"], "7"), true));
});

// ------------------------------------------------------------------ projects

let nextId = 1;
function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: nextId++,
    name: "Jalan Kayu Residence",
    address: "14 Jalan Kayu, Singapore 799463",
    postalCode: "799463",
    siteLocated: true,
    status: "in_progress",
    statusLabel: "In Progress",
    homeowner: { uid: 5, name: "Jasmine Lee", linked: true },
    contactNo: "+65 9123 4477",
    contractor: { type: "group", label: "Apex Solar Contractors", groupId: 1 },
    team: [
      { uid: 1, name: "Wei Ming Tan", role: "project_manager" },
      { uid: 4, name: "Ravi Kumar", role: "epc_team" },
    ],
    pm: { uid: 1, name: "Wei Ming Tan" },
    startDate: "2026-10-05",
    endDate: "2026-10-26",
    daysElapsed: 3,
    progress: 40,
    milestone: 1,
    currentMilestone: 2,
    groups: {},
    flags: [],
    attention: false,
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  } as ProjectRow;
}

const PROJECTS = {
  jalan: project(),
  sunbird: project({
    name: "Sunbird Circle",
    address: "8 Sunbird Circle, Singapore 488106",
    postalCode: "488106",
    status: "homeowner_approved",
    statusLabel: "PM to Approve",
    homeowner: { uid: 6, name: "Daniel Ong", linked: false },
    currentMilestone: 1,
  }),
  seletar: project({
    name: "Seletar Hills Home",
    address: "22 Seletar Hills Drive, Singapore 807001",
    postalCode: "807001",
    homeowner: { uid: 7, name: "Aisha Rahman", linked: true },
    attention: true,
    flags: [{ kind: "overdue" }, { kind: "no_show" }] as ProjectRow["flags"],
  }),
  punggol: project({
    name: "Punggol Waterway Terrace",
    address: "5 Punggol Walk, Singapore 828773",
    postalCode: "828773",
    status: "awaiting_signature",
    statusLabel: "Ready for Handover",
    homeowner: { uid: 8, name: "Kumar Raj", linked: true },
    contractor: { type: "group", label: "Kim Seng M&E Services", groupId: 2 },
    team: [{ uid: 3, name: "Priya Nair", role: "contractor" }],
    currentMilestone: 3,
  }),
  bedok: project({
    name: "Bedok Ria Terrace",
    address: "3 Bedok Ria, Singapore 469000",
    postalCode: "469000",
    status: "draft",
    statusLabel: "Draft",
    homeowner: { uid: null, name: "Marcus Teo", linked: false } as ProjectRow["homeowner"],
    contractor: { type: "text", label: "Northline Roofing" },
    team: [],
  }),
};
const ALL_PROJECTS = Object.values(PROJECTS);
const names = (list: ProjectRow[]) => list.map((p) => p.name).sort();

describe("projects list search", () => {
  const cases: Array<[string, ProjectRow[]]> = [
    ["", ALL_PROJECTS],
    ["jalan", [PROJECTS.jalan]],
    ["Jalan Kayu", [PROJECTS.jalan]],
    ["kayu jalan", [PROJECTS.jalan]],
    ["sunbird", [PROJECTS.sunbird]],
    ["terrace", [PROJECTS.punggol, PROJECTS.bedok]],
    ["488106", [PROJECTS.sunbird]],
    ["singapore 807001", [PROJECTS.seletar]],
    ["jasmine", [PROJECTS.jalan]],
    ["daniel ong", [PROJECTS.sunbird]],
    ["marcus", [PROJECTS.bedok]],
    ["apex", [PROJECTS.jalan, PROJECTS.sunbird, PROJECTS.seletar]],
    ["kim seng", [PROJECTS.punggol]],
    ["northline", [PROJECTS.bedok]],
    ["ravi", [PROJECTS.jalan, PROJECTS.sunbird, PROJECTS.seletar]],
    ["priya", [PROJECTS.punggol]],
    ["wei ming", [PROJECTS.jalan, PROJECTS.sunbird, PROJECTS.seletar]],
    ["draft", [PROJECTS.bedok]],
    ["handover", [PROJECTS.punggol]],
    ["pm to approve", [PROJECTS.sunbird]],
    ["ready for handover", [PROJECTS.punggol]],
    ["late", [PROJECTS.seletar]],
    ["no show", [PROJECTS.seletar]],
    ["red", [PROJECTS.seletar]],
    ["on track", [PROJECTS.jalan, PROJECTS.sunbird, PROJECTS.punggol, PROJECTS.bedok]],
    ["apex late", [PROJECTS.seletar]],
    ["JALAN", [PROJECTS.jalan]],
    ["  jalan   kayu  ", [PROJECTS.jalan]],
    ["jalan bedok", []],
    ["tampines", []],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" finds ${want.length ? names(want).join(", ") : "nothing"}`, () => {
      assert.deepEqual(names(filterProjects(ALL_PROJECTS, { query: q })), names(want));
    });
  }
  it("search and tab combine: 'apex' on the approval tab", () => {
    assert.deepEqual(names(filterProjects(ALL_PROJECTS, { query: "apex", tab: "approval" })), ["Sunbird Circle"]);
  });
  it("search and tab combine: 'terrace' on the handover tab", () => {
    assert.deepEqual(names(filterProjects(ALL_PROJECTS, { query: "terrace", tab: "handover" })), ["Punggol Waterway Terrace"]);
  });
});

// ------------------------------------------------------------------ people

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
const PEOPLE = [
  person({ fullName: "Wei Ming Tan", role: "project_manager", contactNo: "+65 9123 4567" }),
  person({ fullName: "Priya Nair", role: "contractor", contactNo: "+65 9001 2202", groupNames: ["Apex Solar Contractors"] }),
  person({ fullName: "Ravi Kumar", role: "epc_team", linked: false, invitedAt: "2026-10-01T00:00:00Z", groupNames: ["Apex Solar Contractors"] }),
  person({ fullName: "Zoë Lim", role: "homeowner", contactNo: "+65 8877 2210" }),
  person({ fullName: "Marcus Teo", role: "homeowner", active: false }),
];
const who = (l: SearchablePerson[]) => l.map((p) => p.fullName ?? "").sort();

describe("people search", () => {
  const cases: Array<[string, string[]]> = [
    ["", PEOPLE.map((p) => p.fullName ?? "")],
    ["priya", ["Priya Nair"]],
    ["zoe", ["Zoë Lim"]],
    ["ZOË", ["Zoë Lim"]],
    ["91234567", ["Wei Ming Tan"]],
    ["8877 2210", ["Zoë Lim"]],
    ["apex", ["Priya Nair", "Ravi Kumar"]],
    ["apex epc", ["Ravi Kumar"]],
    ["invited", ["Ravi Kumar"]],
    ["disabled", ["Marcus Teo"]],
    ["homeowner", ["Marcus Teo", "Zoë Lim"]],
    ["pm", ["Wei Ming Tan"]],
    ["priya@example.com", ["Priya Nair"]],
    ["kumar ravi", ["Ravi Kumar"]],
    ["nobody here", []],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" finds ${want.length ? want.join(", ") : "nobody"}`, () => assert.deepEqual(who(filterPeople(PEOPLE, { query: q })), want.sort()));
  }
  it("search with the role tab", () => assert.deepEqual(who(filterPeople(PEOPLE, { query: "apex", role: "contractor" })), ["Priya Nair"]));
  it("search with the status menu", () => assert.deepEqual(who(filterPeople(PEOPLE, { query: "", status: "disabled" })), ["Marcus Teo"]));
});

// ------------------------------------------------------------------ audit

let nextAudit = 1;
function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: nextAudit++,
    at: "2026-10-07T02:00:00Z",
    action: "update",
    table: "projects",
    page: "projects",
    summary: "Updated project details",
    actor: { uid: 1, name: "Wei Ming Tan", role: "project_manager", roleLabel: "Project Manager" },
    location: { key: "project:101", kind: "project", id: 101, label: "Jalan Kayu Residence" },
    changes: [{ field: "panel_quantity_actual", from: 18, to: 20, state: "current", note: null }],
    revertsId: null,
    restoresId: null,
    reason: null,
    operationId: null,
    revertedBy: [],
    lockedReason: null,
    rowUndo: null,
    ...over,
  } as AuditEntry;
}
const E = {
  panels: entry({}),
  upload: entry({
    table: "project_files",
    page: "files",
    summary: "Uploaded a file",
    actor: { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team" },
    changes: [{ field: "file_name", from: null, to: "Roof east.jpg", state: "current", note: null }],
  }),
  role: entry({
    table: "users",
    page: "people",
    summary: "Approved role change",
    location: { key: "person:3", kind: "person", id: 3, label: "Priya Nair" },
    changes: [{ field: "user_type", from: "contractor", to: "epc_team", state: "current", note: null }],
  }),
  checkin: entry({
    table: "site_check_ins",
    page: "sites",
    summary: "Checked in on site",
    actor: { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team" },
    location: { key: "project:103", kind: "project", id: 103, label: "Seletar Hills Home" },
    changes: [{ field: "crew_count_in", from: null, to: 4, state: "locked", note: null }],
  }),
  system: entry({ actor: null, summary: "Completed milestone 1", table: "project_milestones", page: "milestones", changes: [] }),
};
const ENTRIES = Object.values(E);
const found = (q: string) => ENTRIES.filter((e) => matchesEntry(e, q)).map((e) => e.summary).sort();

describe("audit timeline search", () => {
  const cases: Array<[string, AuditEntry[]]> = [
    ["", ENTRIES],
    ["ravi", [E.upload, E.checkin]],
    ["epc team", [E.upload, E.checkin, E.role]],
    ["wei ming", [E.panels, E.role]],
    ["jalan", [E.panels, E.upload, E.role, E.system].filter((e) => e.location.label.includes("Jalan"))],
    ["seletar", [E.checkin]],
    ["priya", [E.role]],
    ["uploaded", [E.upload]],
    ["roof east", [E.upload]],
    ["panel quantity", [E.panels]],
    ["20", [E.panels]],
    ["checked in", [E.checkin]],
    ["milestone", [E.system]],
    ["files", [E.upload]],
    ["sites", [E.checkin]],
    ["ravi jalan", [E.upload]],
    ["ravi bedok", []],
  ];
  for (const [q, want] of cases) {
    it(`"${q}"`, () => assert.deepEqual(found(q), want.map((e) => e.summary).sort()));
  }
});

describe("audit by-person search", () => {
  const p = { name: "Zoë Lim", email: "zoe@example.com", roleLabel: "Homeowner" };
  const cases: Array<[string, boolean]> = [
    ["", true],
    ["zoe", true],
    ["ZOË LIM", true],
    ["homeowner", true],
    ["zoe@example", true],
    ["lim homeowner", true],
    ["contractor", false],
    ["zoe contractor", false],
  ];
  for (const [q, want] of cases) it(`"${q}" → ${want}`, () => assert.equal(matchesAuditPerson(p, q), want));
  it("works without an email (system entries)", () => assert.equal(matchesAuditPerson({ name: "System", email: null, roleLabel: null }, "system"), true));
});

// ------------------------------------------------------------------ my files

const file = (o: Partial<MyFile> & { id: number; name: string }): MyFile => ({
  category: "panel_pictures",
  categoryLabel: "Panel pictures",
  projectId: 101,
  projectName: "Jalan Kayu Residence",
  contentType: "image/jpeg",
  kind: "photo",
  size: 1000,
  uploadedAt: "2026-10-07T02:00:00Z",
  removed: null,
  ...o,
});
const FILES = [
  file({ id: 1, name: "Roof east.jpg" }),
  file({ id: 2, name: "Inverter plate.png", category: "inverter_pictures", categoryLabel: "Inverter pictures", contentType: "image/png" }),
  file({ id: 3, name: "SP forms (signed).pdf", category: "sp_forms_signed", categoryLabel: "SP forms (signed)", contentType: "application/pdf", kind: "document", projectId: 102, projectName: "Sunbird Circle" }),
  file({ id: 4, name: "Facture café.pdf", category: "utility_bill", categoryLabel: "Utility bill", contentType: "application/pdf", kind: "document" }),
  file({ id: 5, name: "Blurry panels.jpg", removed: { at: "2026-10-07T03:00:00Z", by: "Wei Ming Tan" } }),
];
const ids = (l: MyFile[]) => l.map((f) => f.id).sort();

describe("my files search", () => {
  const cases: Array<[string, "all" | "photo" | "document" | "removed", number[]]> = [
    ["", "all", [1, 2, 3, 4]],
    ["", "photo", [1, 2]],
    ["", "document", [3, 4]],
    ["", "removed", [5]],
    ["roof", "all", [1]],
    ["jalan", "all", [1, 2, 4]],
    ["sunbird", "all", [3]],
    ["pdf", "all", [3, 4]],
    ["png", "all", [2]],
    ["photo", "all", [1, 2]],
    ["picture", "all", [1, 2]],
    ["document", "all", [3, 4]],
    ["inverter", "all", [2]],
    ["signed", "all", [3]],
    ["utility bill", "all", [4]],
    ["cafe", "all", [4]],
    ["CAFÉ", "all", [4]],
    ["jalan pdf", "all", [4]],
    ["jalan", "document", [4]],
    ["panels", "all", []],
    ["panels", "removed", [5]],
    ["blurry", "all", []],
    ["blurry", "removed", [5]],
    ["sunbird", "photo", []],
    ["nothing", "all", []],
  ];
  for (const [q, tab, want] of cases) {
    it(`"${q}" on ${tab} → [${want.join(", ")}]`, () => assert.deepEqual(ids(filterFiles(FILES, q, tab)), want));
  }
  it("counts each tab, keeping removed files apart", () => assert.deepEqual(tabCounts(FILES), { all: 4, photo: 2, document: 2, removed: 1 }));
});

// ------------------------------------------------------------------ pickers

describe("form pickers", () => {
  type Homeowner = { uid: number; name: string; email: string; contactNo: string | null };
  const homeowners: Homeowner[] = [
    { uid: 5, name: "Jasmine Lee", email: "jasmine.lee@gmail.com", contactNo: "+65 9123 4477" },
    { uid: 6, name: "Daniel Ong", email: "dong@outlook.sg", contactNo: "+65 8877 2210" },
    { uid: 7, name: "Zoë Tan", email: "zoe@example.com", contactNo: null },
  ];
  const byHomeowner = pickerFilter<Homeowner>((o) => [o.name, o.email, o.contactNo]);
  const hw: Array<[string, number[]]> = [
    ["", [5, 6, 7]],
    ["jas", [5]],
    ["lee jasmine", [5]],
    ["outlook", [6]],
    ["dong@", [6]],
    ["88772210", [6]],
    ["9123 4477", [5]],
    ["zoe", [7]],
    ["tan", [7]],
    ["nobody", []],
  ];
  for (const [q, want] of hw) {
    it(`homeowner "${q}" → [${want.join(", ")}]`, () => assert.deepEqual(byHomeowner(homeowners, { inputValue: q }).map((o) => o.uid), want));
  }

  type Crew = { uid: number; name: string; role: string };
  const ROLE: Record<string, string> = { contractor: "Contractor Admin", epc_team: "EPC Team" };
  const crew: Crew[] = [
    { uid: 3, name: "Priya Nair", role: "contractor" },
    { uid: 4, name: "Ravi Kumar", role: "epc_team" },
    { uid: 9, name: "Kelvin Lim", role: "epc_team" },
  ];
  const byCrew = pickerFilter<Crew>((o) => [o.name, ROLE[o.role]]);
  const cw: Array<[string, number[]]> = [
    ["", [3, 4, 9]],
    ["epc", [4, 9]],
    ["admin", [3]],
    ["kelvin", [9]],
    ["epc ravi", [4]],
    ["contractor kelvin", []],
  ];
  for (const [q, want] of cw) {
    it(`crew "${q}" → [${want.join(", ")}]`, () => assert.deepEqual(byCrew(crew, { inputValue: q }).map((o) => o.uid), want));
  }

  const retailers = [
    { id: 1, name: "SP Group" },
    { id: 2, name: "Geneco" },
    { id: 3, name: "Tuas Power Supply" },
    { id: 4, name: "Sembcorp Power" },
  ];
  const byRetailer = pickerFilter<{ id: number; name: string }>((o) => [o.name]);
  const rt: Array<[string, number[]]> = [
    ["", [1, 2, 3, 4]],
    ["sp", [1]],
    ["power", [3, 4]],
    ["GENECO", [2]],
    ["tuas supply", [3]],
    ["keppel", []],
  ];
  for (const [q, want] of rt) {
    it(`retailer "${q}" → [${want.join(", ")}]`, () => assert.deepEqual(byRetailer(retailers, { inputValue: q }).map((o) => o.id), want));
  }
});
