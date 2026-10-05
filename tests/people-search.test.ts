/**
 * People search: `npm run test:web`.
 *
 * Covers every way a project manager might look someone up — name, email,
 * phone typed any way, role (and everyday words for it), contractor group,
 * account status — and combinations of them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterPeople, matchesPerson, type SearchablePerson, statusOf } from "../lib/client/people-search";

const P = (o: Partial<SearchablePerson> & { fullName: string }): SearchablePerson => ({
  email: `${o.fullName.split(" ")[0].toLowerCase()}@example.com`,
  contactNo: null,
  role: "homeowner",
  active: true,
  linked: true,
  invitedAt: null,
  groupNames: [],
  ...o,
});

const PEOPLE: SearchablePerson[] = [
  P({ fullName: "Wei Ming Tan", email: "weiming@9solarhome.sg", role: "project_manager", contactNo: "+65 9123 4567" }),
  P({ fullName: "Charlotte Sim", role: "project_manager", contactNo: "+65 9001 2201" }),
  P({
    fullName: "Priya Nair",
    email: "Priya.Nair@ApexSolar.sg",
    role: "contractor",
    contactNo: "+65 9001 2202",
    groupNames: ["Apex Solar Contractors", "Kim Seng M&E Services"],
  }),
  P({
    fullName: "Ravi Kumar",
    role: "epc_team",
    contactNo: "+65 9001 2203",
    linked: false,
    invitedAt: "2026-10-01T02:00:00Z",
    groupNames: ["Apex Solar Contractors"],
  }),
  P({ fullName: "Jasmine Lee", contactNo: "+65 9123 4477" }),
  P({ fullName: "Daniel Ong", contactNo: "8877 2210", linked: false, invitedAt: "2026-10-04T02:00:00Z" }),
  P({ fullName: "Marcus Teo", active: false, contactNo: "+60 12-345 6789" }),
  P({ fullName: "Zoë O'Brien", email: "zoe.obrien@gmail.com" }),
];

const names = (q: string, extra: Parameters<typeof filterPeople>[1] = {}) =>
  filterPeople(PEOPLE, { query: q, ...extra }).map((p) => p.fullName);

describe("name", () => {
  it("full name", () => assert.deepEqual(names("Priya Nair"), ["Priya Nair"]));
  it("first name only", () => assert.deepEqual(names("ravi"), ["Ravi Kumar"]));
  it("surname only", () => assert.deepEqual(names("ONG"), ["Daniel Ong"]));
  it("partial", () => assert.deepEqual(names("char"), ["Charlotte Sim"]));
  it("words in any order", () => assert.deepEqual(names("nair priya"), ["Priya Nair"]));
  it("ignores case and extra spaces", () => assert.deepEqual(names("   wei    MING  "), ["Wei Ming Tan"]));
  it("ignores accents", () => assert.deepEqual(names("zoe"), ["Zoë O'Brien"]));
  it("apostrophes", () => assert.deepEqual(names("o'brien"), ["Zoë O'Brien"]));
});

describe("email", () => {
  it("full address, any case", () => assert.deepEqual(names("priya.nair@apexsolar.sg"), ["Priya Nair"]));
  it("local part", () => assert.deepEqual(names("weiming"), ["Wei Ming Tan"]));
  it("domain", () => assert.deepEqual(names("@gmail.com"), ["Zoë O'Brien"]));
  it("company domain", () => assert.deepEqual(names("9solarhome.sg"), ["Wei Ming Tan"]));
});

describe("phone", () => {
  it("as stored", () => assert.deepEqual(names("+65 9123 4567"), ["Wei Ming Tan"]));
  it("without spaces", () => assert.deepEqual(names("91234567"), ["Wei Ming Tan"]));
  it("with country code, no spaces", () => assert.deepEqual(names("+6591234567"), ["Wei Ming Tan"]));
  it("last four digits", () => assert.deepEqual(names("4477"), ["Jasmine Lee"]));
  it("shared prefix finds everyone with it", () =>
    assert.deepEqual(names("9001"), ["Charlotte Sim", "Priya Nair", "Ravi Kumar"]));
  it("number stored without +65", () => assert.deepEqual(names("88772210"), ["Daniel Ong"]));
  it("non-Singapore number as stored, dashes and all", () => assert.deepEqual(names("+60 12-345 6789"), ["Marcus Teo"]));
  it("country code alone", () => assert.deepEqual(names("+60"), ["Marcus Teo"]));
  it("digits match across spaces (12345 is inside 9123 4567)", () =>
    assert.deepEqual(names("12345"), ["Wei Ming Tan", "Marcus Teo"]));
  it("digits that match nobody", () => assert.deepEqual(names("5555"), []));
});

describe("role", () => {
  it("homeowner", () => assert.deepEqual(names("homeowner"), ["Jasmine Lee", "Daniel Ong", "Marcus Teo", "Zoë O'Brien"]));
  it("pm", () => assert.deepEqual(names("pm"), ["Wei Ming Tan", "Charlotte Sim"]));
  it("project manager (two words)", () => assert.deepEqual(names("project manager"), ["Wei Ming Tan", "Charlotte Sim"]));
  it("epc", () => assert.deepEqual(names("epc"), ["Ravi Kumar"]));
  it("crew means EPC", () => assert.deepEqual(names("crew"), ["Ravi Kumar"]));
  it("admin means contractor admin", () => assert.deepEqual(names("admin"), ["Priya Nair"]));
});

describe("contractor group", () => {
  it("group name", () => assert.deepEqual(names("apex"), ["Priya Nair", "Ravi Kumar"]));
  it("second group", () => assert.deepEqual(names("kim seng"), ["Priya Nair"]));
  it("group with ampersand", () => assert.deepEqual(names("m&e"), ["Priya Nair"]));
});

describe("status", () => {
  it("statusOf", () => {
    assert.equal(statusOf(PEOPLE[3]), "invited");
    assert.equal(statusOf(PEOPLE[6]), "disabled");
    assert.equal(statusOf(PEOPLE[0]), "active");
  });
  it("invited", () => assert.deepEqual(names("invited"), ["Ravi Kumar", "Daniel Ong"]));
  it("disabled", () => assert.deepEqual(names("disabled"), ["Marcus Teo"]));
  it("deactivated means disabled", () => assert.deepEqual(names("deactivated"), ["Marcus Teo"]));
});

describe("combinations narrow down (every word must match)", () => {
  it("group + role", () => assert.deepEqual(names("apex epc"), ["Ravi Kumar"]));
  it("status + role", () => assert.deepEqual(names("invited homeowner"), ["Daniel Ong"]));
  it("name + group", () => assert.deepEqual(names("priya apex"), ["Priya Nair"]));
  it("contradiction finds nobody", () => assert.deepEqual(names("jasmine apex"), []));
  it("role tab + query", () => assert.deepEqual(names("9001", { role: "project_manager" }), ["Charlotte Sim"]));
  it("status filter + query", () => assert.deepEqual(names("apex", { status: "invited" }), ["Ravi Kumar"]));
});

describe("edge cases", () => {
  it("empty query returns everyone", () => assert.equal(names("").length, PEOPLE.length));
  it("whitespace query returns everyone", () => assert.equal(names("   ").length, PEOPLE.length));
  it("regex characters don't crash", () => {
    for (const q of ["(", "[", "*", "\\", "+", "?", ".*"]) assert.doesNotThrow(() => names(q));
  });
  it("nonsense matches nobody", () => assert.deepEqual(names("zzzz"), []));
  it("person with no name or phone", () =>
    assert.equal(matchesPerson({ ...PEOPLE[0], fullName: null, contactNo: null }, "weiming"), true));
});
