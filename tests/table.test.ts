/**
 * Tables with Excel's filters (lib/client/table.ts): `npm run test:web`.
 *
 *   values    tick which values to keep; empty cells are "(Blanks)"; the list follows the other filters
 *   contains  a word anywhere in the cell, any case
 *   ranges    numbers and dates between two bounds, inclusive; a date with a time counts by its day
 *   sort      either way, empty cells last, ties keep their order
 *   sheet     Download gets the kept rows, numbers as numbers and dates as days
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeCount, applyTable, BLANK, type Col, sheetOf, valuesFor } from "../lib/client/table";

type P = { name: string; status: string; kwp: number | null; done: string | null };
const ROWS: P[] = [
  { name: "Jalan Kayu", status: "In Progress", kwp: 12.4, done: null },
  { name: "Siglap Garden", status: "Handed Over", kwp: 9.3, done: "2026-03-10T15:00:00+08:00" },
  { name: "Kovan Terrace", status: "Handed Over", kwp: null, done: "2026-06-30" },
  { name: "Bedok Walk", status: "Completed", kwp: 20, done: "2026-07-01" },
];
const COLS: Col<P>[] = [
  { key: "name", label: "Project", get: (r) => r.name },
  { key: "status", label: "Status", get: (r) => r.status },
  { key: "kwp", label: "kWp", type: "number", get: (r) => r.kwp },
  { key: "done", label: "Handed over", type: "date", get: (r) => r.done },
];
const names = (rows: P[]) => rows.map((r) => r.name);

describe("values", () => {
  it("keeps the ticked values", () => assert.deepEqual(names(applyTable(ROWS, COLS, { status: { values: ["Handed Over"] } }, null)), ["Siglap Garden", "Kovan Terrace"]));
  it("an empty tick list keeps nothing", () => assert.deepEqual(applyTable(ROWS, COLS, { status: { values: [] } }, null), []));
  it("(Blanks) keeps empty cells", () => assert.deepEqual(names(applyTable(ROWS, COLS, { kwp: { values: [BLANK] } }, null)), ["Kovan Terrace"]));
  it("lists a column's values, numbers in order, blanks last", () => assert.deepEqual(valuesFor(ROWS, COLS, {}, "kwp"), ["9.3", "12.4", "20", BLANK]));
  it("lists what the other filters leave", () => assert.deepEqual(valuesFor(ROWS, COLS, { status: { values: ["Handed Over"] } }, "kwp"), ["9.3", BLANK]));
  it("a date column lists days", () => assert.deepEqual(valuesFor(ROWS, COLS, {}, "done"), ["2026-03-10", "2026-06-30", "2026-07-01", BLANK]));
});

describe("contains", () => {
  it("finds a word anywhere, any case", () => assert.deepEqual(names(applyTable(ROWS, COLS, { name: { contains: "GARDEN" } }, null)), ["Siglap Garden"]));
  it("filters on several columns at once", () => assert.deepEqual(names(applyTable(ROWS, COLS, { name: { contains: "a" }, status: { values: ["Completed"] } }, null)), ["Bedok Walk"]));
  it("counts the columns filtered", () => assert.equal(activeCount({ name: { contains: " " }, status: { values: ["x"] }, kwp: {} }), 1));
});

describe("ranges", () => {
  it("numbers between two bounds, inclusive", () => assert.deepEqual(names(applyTable(ROWS, COLS, { kwp: { min: "9.3", max: "12.4" } }, null)), ["Jalan Kayu", "Siglap Garden"]));
  it("handed over between two dates (the auditor's question)", () => assert.deepEqual(names(applyTable(ROWS, COLS, { done: { min: "2026-03-10", max: "2026-06-30" } }, null)), ["Siglap Garden", "Kovan Terrace"]));
  it("only a start date", () => assert.deepEqual(names(applyTable(ROWS, COLS, { done: { min: "2026-06-30" } }, null)), ["Kovan Terrace", "Bedok Walk"]));
  it("an empty cell is outside any range", () => assert.ok(!names(applyTable(ROWS, COLS, { done: { max: "2030-01-01" } }, null)).includes("Jalan Kayu")));
});

describe("sort", () => {
  it("smallest first, empty last", () => assert.deepEqual(names(applyTable(ROWS, COLS, {}, { key: "kwp", dir: "asc" })), ["Siglap Garden", "Jalan Kayu", "Bedok Walk", "Kovan Terrace"]));
  it("largest first, empty still last", () => assert.deepEqual(names(applyTable(ROWS, COLS, {}, { key: "kwp", dir: "desc" })), ["Bedok Walk", "Jalan Kayu", "Siglap Garden", "Kovan Terrace"]));
  it("Z to A", () => assert.deepEqual(names(applyTable(ROWS, COLS, {}, { key: "name", dir: "desc" })), ["Siglap Garden", "Kovan Terrace", "Jalan Kayu", "Bedok Walk"]));
  it("ties keep their order", () => assert.deepEqual(names(applyTable(ROWS, COLS, {}, { key: "status", dir: "asc" })), ["Bedok Walk", "Siglap Garden", "Kovan Terrace", "Jalan Kayu"]));
});

describe("sheet", () => {
  it("is the kept rows, typed", () =>
    assert.deepEqual(sheetOf(applyTable(ROWS, COLS, { status: { values: ["Handed Over"] } }, null), COLS), {
      head: ["Project", "Status", "kWp", "Handed over"],
      rows: [
        ["Siglap Garden", "Handed Over", 9.3, "2026-03-10"],
        ["Kovan Terrace", "Handed Over", null, "2026-06-30"],
      ],
    }));
});
