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
