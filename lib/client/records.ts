/**
 * The client record from 9 Solar Home's project list (migration 0038), as
 * the maintenance and project pages show it to project managers.
 */

export type Warranty = { model: string; known: boolean; years: number | null; until: string | null; priceExGst: number | null; priceInclGst: number | null };
export type Feedback = { id: number; body: string; at: string };

export type SystemRecord = {
  projectCode: string | null;
  salutation: string | null;
  email: string | null;
  signedOn: string | null;
  salesperson: string | null;
  referrer: string | null;
  plan: string | null;
  ratePerKwh: number | null;
  epc: string | null;
  inverterSerials: string[];
  dongleSerials: string[];
  installationStart: string | null;
  installationEnd: string | null;
  billingPeriod: string | null;
};

export type Output = { estMonthlyKwh: number | null; months: Array<{ month: string; kwh: number }>; total: number; ofEstimate: number | null };

/** What the system page gets for managers, beside the system itself. */
export type SystemExtras = { record: SystemRecord; output: Output; billing: Array<{ month: string; period: string }>; feedback: Feedback[]; warranties: Warranty[] };

export type ProjectRecord = {
  record: {
    projectCode: string | null;
    salutation: string | null;
    email: string | null;
    signedOn: string | null;
    salesperson: string | null;
    referrer: string | null;
    plan: string | null;
    ratePerKwh: number | null;
    ppa: { kind: string; years: number | null } | null;
    phase: number | null;
    dongleSerial: string | null;
    note: string | null;
  };
  feedback: Feedback[];
  warranties: Warranty[];
};

/** "$0.19 per kWh". */
export function rateText(r: number | null): string | null {
  return r === null ? null : `$${r.toFixed(r * 100 === Math.round(r * 100) ? 2 : 4)}`;
}

/** "$1,275.30". */
export function money(n: number | null): string | null {
  return n === null ? null : `$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whether anything in the record is filled in (a system made in the app has none of it). */
export function hasRecord(r: Partial<SystemRecord> | null | undefined): boolean {
  if (!r) return false;
  return Object.values(r).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ""));
}
