/**
 * Payments: the shapes /finance, /payments and /invoices return, and the
 * pure logic behind the screens (tests/finance.test.ts).
 *
 * The one plan: an admin fee (paid before the handover), then every month
 * kWh x the contract's rate for 8 years from the month the system was turned
 * on. Admin (finance) and superadmins issue invoices and mark them paid;
 * project managers see only whether each month was issued and paid.
 */

import { currentLang, type Lang, locale } from "./i18n";

export type InvoiceState = "waiting" | "overdue" | "paid" | "void";
export type CellState = InvoiceState | "to_issue" | "later" | "none";

export type Invoice = {
  id: number;
  number: string;
  kind: "admin_fee" | "monthly";
  status: "issued" | "paid" | "void";
  state: InvoiceState;
  projectId: number | null;
  systemId: number | null;
  billTo: string;
  period: string | null;
  issuedOn: string;
  dueOn: string;
  paidOn: string | null;
  hasProof: boolean;
  proofAt: string | null;
  // Not for project managers:
  amount?: string;
  kwh?: string | null;
  rate?: string | null;
  paidAmount?: string | null;
  paidVia?: "manual" | "statement" | null;
  paidRef?: string | null;
  voidReason?: string | null;
  billAddress?: string | null;
  billEmail?: string | null;
  proofNote?: string | null;
};

export type Cell = { state: CellState; id?: number; amount?: string };
export type SystemRow = { id: number; projectId: number | null; code: string | null; name: string | null; address: string; turnedOn: string | null; rate: string | null; months: Cell[] };
export type ProjectRow = { id: number; code: string | null; name: string; homeowner: string | null; status: string; fee: Cell };
export type Overview = {
  year: number;
  months: string[];
  systems: SystemRow[];
  projects: ProjectRow[];
  amounts: boolean;
  totals?: { issued: string; paid: string; outstanding: string; overdue: number; proofs: number };
  adminFee?: string;
};
export type RunRow = { systemId: number; code: string | null; name: string | null; address: string; rate: string | null; kwh: string | null; amount: string | null; invoice: Invoice | null; problem: string | null };
export type Run = { month: string; rows: RunRow[]; over: boolean };
export type StatementLine = { date: string; amount: string; words: string; invoiceId: number | null; number: string | null; result: "match" | "amount differs" | "already paid" | "no invoice number" };
export type Settings = {
  companyName: string;
  companyAddress: string | null;
  companyUen: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  payNote: string;
  invoiceTitle: string;
  intro: string | null;
  footer: string | null;
  terms: string | null;
  adminFee: string;
  planYears: number;
  dueDays: number;
  accent: string;
  show: { logo: boolean; qr: boolean; uen: boolean; kwh: boolean; terms: boolean };
  logo: string | null;
  qr: string | null;
};
export type MyPayments = { invoices: Invoice[]; owing: string; overdue: number; qr: string | null; payNote: string; company: string };

/** "S$1,234.50" from an amount the API sends as text (exact cents, no float rounding on the way). */
export function money(v: string | number | null | undefined): string {
  const s = typeof v === "number" ? v.toFixed(2) : (v ?? "0");
  const neg = s.trim().startsWith("-");
  const [whole, frac = ""] = s.replace(/^-/, "").trim().split(".");
  const cents = (frac + "00").slice(0, 2);
  const roundUp = (frac[2] ?? "0") >= "5";
  let w = BigInt(whole || "0");
  let c = Number(cents) + (roundUp ? 1 : 0);
  if (c >= 100) {
    w += BigInt(1);
    c -= 100;
  }
  const grouped = w.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}S$${grouped}.${String(c).padStart(2, "0")}`;
}

/** kWh x rate, to the cent, half a cent up: as the API works it out (integer arithmetic, no float drift). */
export function monthlyAmount(kwh: string, rate: string): string | null {
  const k = /^\s*(\d+)(?:\.(\d{0,2}))?\s*$/.exec(kwh);
  const r = /^\s*(\d+)(?:\.(\d{0,4}))?\s*$/.exec(rate);
  if (!k || !r) return null;
  const kk = BigInt(k[1] + (k[2] ?? "").padEnd(2, "0")); // hundredths of a kWh
  const rr = BigInt(r[1] + (r[2] ?? "").padEnd(4, "0")); // ten-thousandths of a dollar
  const tiny = kk * rr; // millionths of a dollar
  const cents = (tiny + BigInt(5000)) / BigInt(10000);
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** "October 2026" from "2026-10-01". */
export function monthName(day: string, lang: Lang = currentLang()): string {
  return new Intl.DateTimeFormat(locale(lang), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

/** "Oct" from "2026-10-01", for a month's column. */
export function monthShort(day: string, lang: Lang = currentLang()): string {
  return new Intl.DateTimeFormat(locale(lang), { month: "short", timeZone: "UTC" }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

/** "14 Oct 2026". */
export function dateText(day: string | null, lang: Lang = currentLang()): string {
  if (!day) return "—";
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

/** "2026-09": the last month that's over, the one to invoice now. */
export function lastMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const STATE_LABEL: Record<CellState, string> = {
  waiting: "Issued",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
  to_issue: "Not issued",
  later: "Not yet",
  none: "—",
};
export const STATE_TONE: Record<CellState, "success" | "warning" | "error" | "default" | "info"> = {
  paid: "success",
  waiting: "info",
  overdue: "error",
  void: "default",
  to_issue: "warning",
  later: "default",
  none: "default",
};

export const RESULT_LABEL: Record<StatementLine["result"], string> = {
  match: "Pays it",
  "amount differs": "Amount differs",
  "already paid": "Already paid",
  "no invoice number": "No invoice number",
};

/** What an invoice is for, in words. */
export function invoiceWhat(inv: Pick<Invoice, "kind" | "period">, lang: Lang = currentLang()): [string, Record<string, string>] {
  return inv.kind === "admin_fee" ? ["Admin fee", {}] : ["Solar power, {month}", { month: monthName(inv.period ?? "", lang) }];
}

/** A bank statement file, as text: the browser reads it (CSV), the API matches it. */
export async function readStatement(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error("That statement is too large. Export a month at a time.");
  return file.text();
}

/**
 * A picture for the invoice (logo or QR) as a JPEG, as the PDF needs it: drawn
 * on white (a transparent PNG would turn black), at most 1200px across.
 */
export async function toJpeg(file: File, most = 1200): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file isn't a picture."));
      i.src = url;
    });
    const scale = Math.min(1, most / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = c.getContext("2d");
    if (!g) throw new Error("This browser can't prepare the picture.");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't prepare the picture."))), "image/jpeg", 0.92));
  } finally {
    URL.revokeObjectURL(url);
  }
}
