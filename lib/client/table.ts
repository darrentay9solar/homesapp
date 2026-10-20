/**
 * Tables with Excel's filters (components/data-table.tsx): sort a column
 * either way, keep the rows whose text contains a word, between two numbers
 * or dates, or tick which values to show ("(Blanks)" for empty cells), on as
 * many columns at once as you like. What's left is what Download gives you.
 * No React, so it can be unit tested (tests/table.test.ts).
 */

export type ColType = "text" | "number" | "date";
/** A cell: text, a number, an ISO date ("2026-10-19", or a full ISO time), or empty. */
export type Cell = string | number | null | undefined;

export type Col<R> = {
  key: string;
  /** English; translated where it's shown. */
  label: string;
  type?: ColType;
  get: (r: R) => Cell;
};

/** One column's filter. Unset parts don't filter. */
export type ColFilter = {
  /** The values to keep (as cellText shows them; BLANK for empty cells). */
  values?: string[];
  contains?: string;
  /** Inclusive bounds: numbers as text, dates as YYYY-MM-DD. */
  min?: string;
  max?: string;
};
export type Filters = Record<string, ColFilter>;
export type Sort = { key: string; dir: "asc" | "desc" } | null;

export const BLANK = "(Blanks)";

const empty = (v: Cell): v is null | undefined | "" => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** A date cell's day: "2026-10-19T08:30:00+08:00" → "2026-10-19". */
export function dayOf(v: Cell): string | null {
  if (empty(v)) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(v));
  return m ? m[0] : null;
}

/** How a cell reads in a value list (and in the sheet when it's text). */
export function cellText(col: Pick<Col<unknown>, "type">, v: Cell): string {
  if (empty(v)) return BLANK;
  if (col.type === "date") return dayOf(v) ?? String(v);
  return String(v);
}

export function isActive(f: ColFilter | undefined): boolean {
  return Boolean(f && (f.values !== undefined || (f.contains ?? "").trim() || (f.min ?? "").trim() || (f.max ?? "").trim()));
}

export function activeCount(filters: Filters): number {
  return Object.values(filters).filter(isActive).length;
}

function passes<R>(col: Col<R>, f: ColFilter, r: R): boolean {
  const v = col.get(r);
  if (f.values !== undefined && !f.values.includes(cellText(col, v))) return false;
  const word = (f.contains ?? "").trim().toLowerCase();
  if (word && (empty(v) || !String(v).toLowerCase().includes(word))) return false;
  const min = (f.min ?? "").trim();
  const max = (f.max ?? "").trim();
  if (min || max) {
    if (empty(v)) return false;
    if (col.type === "number") {
      const n = Number(v);
      if (Number.isNaN(n) || (min && n < Number(min)) || (max && n > Number(max))) return false;
    } else {
      const d = col.type === "date" ? dayOf(v) : String(v);
      if (d === null || (min && d < min) || (max && d > max)) return false;
    }
  }
  return true;
}

function compare(type: ColType | undefined, a: Cell, b: Cell): number {
  // Empty cells go last whichever way, as in Excel.
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  if (type === "number") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** The rows every filter keeps, sorted. */
export function applyTable<R>(rows: R[], cols: Col<R>[], filters: Filters, sort: Sort): R[] {
  const on = cols.filter((c) => isActive(filters[c.key]));
  const kept = rows.filter((r) => on.every((c) => passes(c, filters[c.key], r)));
  const col = sort ? cols.find((c) => c.key === sort.key) : undefined;
  if (!sort || !col) return kept;
  const sign = sort.dir === "asc" ? 1 : -1;
  return kept
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = col.get(x.r);
      const b = col.get(y.r);
      if (empty(a) || empty(b)) return compare(col.type, a, b) || x.i - y.i;
      return sign * compare(col.type, a, b) || x.i - y.i;
    })
    .map((x) => x.r);
}

/**
 * The values a column's tick list offers: those in the rows the *other*
 * filters keep (as Excel does), sorted, with "(Blanks)" last.
 */
export function valuesFor<R>(rows: R[], cols: Col<R>[], filters: Filters, key: string): string[] {
  const col = cols.find((c) => c.key === key);
  if (!col) return [];
  const others = { ...filters };
  delete others[key];
  const seen = new Set(applyTable(rows, cols, others, null).map((r) => cellText(col, col.get(r))));
  const blank = seen.delete(BLANK);
  const list = [...seen].sort((a, b) => compare(col.type === "number" ? "number" : "text", col.type === "number" ? Number(a) : a, col.type === "number" ? Number(b) : b));
  return blank ? [...list, BLANK] : list;
}

/** The sheet for Download: the columns' labels, and each kept row's cells (numbers as numbers, dates as days). */
export function sheetOf<R>(rows: R[], cols: Col<R>[]): { head: string[]; rows: Array<Array<string | number | null>> } {
  return {
    head: cols.map((c) => c.label),
    rows: rows.map((r) =>
      cols.map((c) => {
        const v = c.get(r);
        if (empty(v)) return null;
        if (c.type === "number") return Number(v);
        if (c.type === "date") return dayOf(v);
        return String(v);
      })
    ),
  };
}
