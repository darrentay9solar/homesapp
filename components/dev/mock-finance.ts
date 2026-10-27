/**
 * Payments, made up for the previews (/dev-preview/finance, /dev-preview/payments).
 * Never real customers: invented names and addresses only.
 */

import type { Invoice, MyPayments, Overview, Run, Settings } from "@/lib/client/finance";

const Y = new Date().getFullYear();
const ym = (m: number) => `${Y}-${String(m).padStart(2, "0")}-01`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export function asFinance(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("as") === "finance";
}

export function mockFinanceMe(base: Record<string, unknown>) {
  return { ...base, user: { uid: 9, fullName: "Grace Ong", email: "grace@example.com", role: "finance", roleLabel: "Admin", contactNo: "+65 9123 4500", address: null, postalCode: null, avatar: null } };
}

function inv(id: number, over: Partial<Invoice>): Invoice {
  return {
    id, number: `INV-${Y}-${String(id).padStart(5, "0")}`, kind: "monthly", status: "issued", state: "waiting",
    projectId: 101, systemId: 201, billTo: "Jasmine Lee", period: ym(9), issuedOn: day(-10), dueOn: day(4), paidOn: null,
    hasProof: false, proofAt: null, amount: "215.29", kwh: "812.40", rate: "0.2650", paidAmount: null, paidVia: null,
    paidRef: null, voidReason: null, billAddress: "7 Example Avenue, Singapore 466001", billEmail: "jasmine@example.com", proofNote: null,
    ...over,
  };  // prettier-ignore
}

const INVOICES: Invoice[] = [
  inv(42, {}),
  inv(41, { period: ym(8), status: "paid", state: "paid", paidOn: day(-35), paidAmount: "198.40", amount: "198.40", kwh: "748.68", issuedOn: day(-44), dueOn: day(-30), paidVia: "statement" }),
  inv(40, { period: ym(7), status: "issued", state: "overdue", amount: "231.05", kwh: "871.89", issuedOn: day(-75), dueOn: day(-61), hasProof: true, proofAt: day(-3) }),
  inv(12, { kind: "admin_fee", period: null, kwh: null, rate: null, amount: "3500.00", status: "paid", state: "paid", paidOn: day(-120), paidAmount: "3500.00", issuedOn: day(-130), dueOn: day(-116), paidVia: "manual" }),
  inv(43, { billTo: "Daniel Koh", systemId: 202, projectId: null, billAddress: "18 Sample Rise, Singapore 279900", amount: "142.10", kwh: "536.23" }),
];

export function mockInvoices(search: URLSearchParams): { invoices: Invoice[] } {
  const st = search.get("status");
  const q = (search.get("q") ?? "").toLowerCase();
  return {
    invoices: INVOICES.filter((i) => (!st || (st === "overdue" ? i.state === "overdue" : st === "proof" ? i.hasProof && i.status === "issued" : i.status === st)) && (!q || `${i.number} ${i.billTo}`.toLowerCase().includes(q))),
  };
}

export function mockInvoice(id: number, amounts: boolean): Invoice {
  const found = INVOICES.find((i) => i.id === id) ?? INVOICES[0];
  if (amounts) return found;
  const { amount: _a, kwh: _k, rate: _r, paidAmount: _p, ...rest } = found;
  return rest;
}

export function mockOverview(amounts: boolean): Overview {
  const now = new Date().getMonth() + 1;
  const months = Array.from({ length: 12 }, (_, i) => ym(i + 1));
  const cells = (paidTo: number, start = 1) =>
    months.map((_, i) => {
      const m = i + 1;
      if (m < start) return { state: "none" as const };
      if (m >= now) return { state: "later" as const };
      const state = m <= paidTo ? ("paid" as const) : m === now - 1 ? ("waiting" as const) : m === paidTo + 1 ? ("overdue" as const) : ("to_issue" as const);
      return { state, id: 40 + (m % 4), ...(amounts ? { amount: "215.29" } : {}) };
    });
  return {
    year: Y,
    months,
    amounts,
    systems: [
      { id: 201, projectId: 101, code: "9SH0101", name: "Jasmine Lee", address: "7 Example Avenue", turnedOn: `${Y - 1}-03-14`, rate: amounts ? "0.2650" : null, months: cells(now - 3) },
      { id: 202, projectId: null, code: "9SH0102", name: "Daniel Koh", address: "18 Sample Rise", turnedOn: `${Y}-04-02`, rate: amounts ? "0.2400" : null, months: cells(now - 2, 4) },
    ],
    projects: [
      { id: 101, code: "9SH0101", name: "Jalan Kayu Residence", homeowner: "Jasmine Lee", status: "in_progress", fee: { state: "paid", id: 12, ...(amounts ? { amount: "3500.00" } : {}) } },
      { id: 104, code: "9SH0104", name: "Bedok Ria Terrace", homeowner: "Marcus Tan", status: "signed", fee: { state: "waiting", id: 44, ...(amounts ? { amount: "3500.00" } : {}) } },
      { id: 107, code: "9SH0107", name: "Siglap Garden House", homeowner: "Priya Raman", status: "pm_approved", fee: { state: "to_issue" } },
    ],
    ...(amounts ? { totals: { issued: "12840.50", paid: "9122.30", outstanding: "3718.20", overdue: 1, proofs: 1 }, adminFee: "3500.00" } : {}),
  };
}

export function mockRun(month: string): Run {
  return {
    month: `${month}-01`,
    over: true,
    rows: [
      { systemId: 201, code: "9SH0101", name: "Jasmine Lee", address: "7 Example Avenue", rate: "0.2650", kwh: "812.40", amount: "215.29", invoice: null, problem: null },
      { systemId: 202, code: "9SH0102", name: "Daniel Koh", address: "18 Sample Rise", rate: "0.2400", kwh: null, amount: null, invoice: null, problem: null },
      { systemId: 203, code: "9SH0103", name: "Siew Ling Chua", address: "3 Placeholder Walk", rate: null, kwh: "640.00", amount: null, invoice: null, problem: "No rate per kWh in the client record." },
      { systemId: 204, code: "9SH0104", name: "Marcus Tan", address: "22 Demo Crescent", rate: "0.2500", kwh: "590.12", amount: "147.53", invoice: inv(45, { billTo: "Marcus Tan" }), problem: null },
    ],
  };
}

export const MOCK_SETTINGS: Settings = {
  companyName: "9 Solar Home",
  companyAddress: "10 Example Crescent\n#05-01\nSingapore 400000",
  companyUen: "202000000X",
  companyEmail: "billing@example.com",
  companyPhone: "+65 6000 0000",
  payNote: "Scan the QR with your banking app (PayNow) and put the invoice number as the reference.",
  invoiceTitle: "INVOICE",
  intro: null,
  footer: "Thank you for choosing solar.",
  terms: "Payment is due within 14 days of the invoice date.",
  adminFee: "3500.00",
  planYears: 8,
  dueDays: 14,
  accent: "#0B8A5A",
  show: { logo: true, qr: true, uen: true, kwh: true, terms: true },
  logo: null,
  qr: null,
};

export function mockMyPayments(): MyPayments {
  return { invoices: INVOICES.filter((i) => i.billTo === "Jasmine Lee"), owing: "446.34", overdue: 1, qr: null, payNote: MOCK_SETTINGS.payNote, company: "9 Solar Home" };
}

export function mockProjectPayments(amounts: boolean) {
  const strip = (i: Invoice) => (amounts ? i : mockInvoice(i.id, false));
  return { fee: strip(INVOICES[3]), feePaid: true, months: INVOICES.filter((i) => i.kind === "monthly" && i.billTo === "Jasmine Lee").map(strip) };
}

/** The check before admin fees go out: each still to invoice, as its invoice will read. */
export function mockAdminFees() {
  const issued = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const row = { amount: "3500.00", issuedOn: issued, dueOn: due, problem: null };
  return {
    rows: [
      { ...row, projectId: 107, code: "9SH0107", name: "Siglap Garden House", status: "pm_approved", billTo: "Priya Raman", billAddress: "22 Example Walk, Singapore 455001", billEmail: "priya@example.com" },
      { ...row, projectId: 110, code: "9SH0110", name: "Tampines Corner Terrace", status: "signed", billTo: "Wei Ling Ong", billAddress: "5 Sample Close, Singapore 529001", billEmail: null },
    ],
  };
}

/** The business in figures, made up (a small fleet in its first year), for the KPI page's preview. */
export function mockKpis() {
  const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const systems = [2, 2, 3, 5, 8, 11, 15, 20, 26, 31, 36, 40];
  const rows = months.map((month, i) => {
    const kwh = systems[i] * 1480 + i * 37;
    return { month, kwh, amount: Math.round(kwh * 0.2 * 100) / 100, systems: systems[i] };
  });
  const last = rows[rows.length - 1];
  return {
    asOf: "2026-10-27",
    portfolio: { systems: 41, byPlan: [{ plan: "Example Plan", n: 41 }], kwp: 512.4, kwpKnown: 41, inProgress: 18, newIn12Months: 39, kwpNewIn12Months: 488.1, firstOn: "2025-10-06" },
    generation: {
      lifetimeKwh: 268_430,
      lifetimePlants: 44,
      lastMonth: last.month,
      lastMonthKwh: last.kwh,
      twelveMonthKwh: rows.reduce((a, r) => a + r.kwh, 0),
      specificYield: { value: 3.84, kwh: last.kwh, kwp: 512.4, days: 30, systems: 40 },
      vsEstimate: { pct: 96.2, actualKwh: 57_120, estimatedKwh: 59_376, systems: 39 },
    },
    revenue: {
      lastMonth: { month: last.month, amount: last.amount, kwh: last.kwh, systems: 40, noRate: 0 },
      runRate: { fromLastMonth: Math.round(last.amount * 12 * 100) / 100, fromThreeMonths: Math.round(((rows[9].amount + rows[10].amount + rows[11].amount) / 3) * 12 * 100) / 100, months: months.slice(-3) },
      contracted: { amount: 845_200, systems: 40, monthsLeft: 3264, avgYearsLeft: 6.8, byActual: 31, byEstimate: 9, defaultYears: 8 },
      adminFees: { fee: 3500, toCome: 18, toComeAmount: 63_000, issued: 23, paid: 21 },
      invoices: { count: 214, monthly: 191, issued: 128_400.5, paid: 119_870.25, outstanding: 8530.25, overdue: 1210.4, overdueCount: 3, collectedPct: 93.4 },
      months: rows,
    },
    customers: { avgRate: 0.2, spWithGst: 31.16, spFrom: "2026-10-01", cheaperPct: 35.8, saved12Months: 27_940, savedKwh: 251_380, co2Tons: 127.5, trees: 6967, co2PerKwh: 0.475, kgPerTree: 18.3 },
    operations: { plants: 44, health: { normal: 41, faulty: 2, disconnected: 1, unknown: 0 }, normalPct: 93.2, alarms: { critical: 0, major: 2, minor: 1, warning: 2 }, monitored: 40, lastSync: new Date(Date.now() - 6 * 60_000).toISOString() },
    checks: [
      { key: "term_differs", n: 6, codes: ["9SH0103", "9SH0108", "9SH0112", "9SH0115", "9SH0121", "9SH0130"], years: 8 },
      { key: "own_period", n: 2, codes: ["9SH0104", "9SH0119"] },
      { key: "unlinked_plants", n: 4, codes: [] },
      { key: "kwh_differs", n: 7, codes: [] },
    ],
  };
}
