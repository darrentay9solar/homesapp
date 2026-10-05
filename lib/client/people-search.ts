/**
 * Search and filtering for the People screen. Pure functions, no React, so
 * they can be tested directly (tests/people-search.test.ts).
 *
 * How a query narrows the list:
 *  - Every word must match something about the person (AND), so
 *    "apex epc" finds EPC crew in Apex Solar Contractors.
 *  - A word can match: name, email, phone, role (with everyday synonyms:
 *    "pm", "admin", "crew", "owner"…), contractor group, or status
 *    ("invited", "disabled", "active").
 *  - Case, accents and extra spaces don't matter ("zoe" finds "Zoë").
 *  - Numbers are matched against the phone's digits however they're
 *    typed: "+65 9123 4567", "91234567", "9123 4567" and "4567" all work.
 */

export type Role = "homeowner" | "project_manager" | "contractor" | "epc_team";
export type Status = "active" | "invited" | "disabled";

export type SearchablePerson = {
  fullName: string | null;
  email: string;
  contactNo: string | null;
  role: Role;
  active: boolean;
  linked: boolean;
  invitedAt: string | null;
  /** Names of the contractor groups they belong to. */
  groupNames: string[];
};

export const ROLE_WORDS: Record<Role, string[]> = {
  homeowner: ["homeowner", "home owner", "owner", "resident", "customer", "client"],
  contractor: ["contractor admin", "contractor", "admin", "subcontractor"],
  epc_team: ["epc team", "epc", "crew", "installer", "technician", "site team"],
  project_manager: ["project manager", "pm", "manager", "staff"],
};

export const STATUS_WORDS: Record<Status, string[]> = {
  active: ["active", "enabled", "signed in"],
  invited: ["invited", "invite", "pending", "not signed in"],
  disabled: ["disabled", "deactivated", "inactive", "blocked"],
};

export function statusOf(p: Pick<SearchablePerson, "active" | "linked" | "invitedAt">): Status {
  if (!p.active) return "disabled";
  if (!p.linked && p.invitedAt) return "invited";
  return "active";
}

/** Lower-case, accents removed, whitespace collapsed. */
export function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Words of a query; quotes and stray punctuation around words are ignored. */
export function tokens(query: string): string[] {
  return normalise(query)
    .split(" ")
    .map((t) => t.replace(/^["'(]+|["'),.;]+$/g, ""))
    .filter(Boolean);
}

/** Does one word of the query match this person? */
function tokenMatches(token: string, p: SearchablePerson, haystack: string, phoneDigits: string): boolean {
  // A number (possibly with + or -): compare digits to the phone's digits.
  if (/^\+?[\d-]+$/.test(token)) {
    const d = digitsOf(token);
    if (d.length >= 2 && phoneDigits.includes(d)) return true;
  }
  return haystack.includes(token);
}

function haystackFor(p: SearchablePerson): string {
  const status = statusOf(p);
  return normalise(
    [
      p.fullName ?? "",
      p.email,
      p.contactNo ?? "",
      ...ROLE_WORDS[p.role],
      ...p.groupNames,
      ...STATUS_WORDS[status],
    ].join(" | ")
  );
}

export function matchesPerson(p: SearchablePerson, query: string): boolean {
  const words = tokens(query);
  if (words.length === 0) return true;
  const haystack = haystackFor(p);
  const phoneDigits = digitsOf(p.contactNo ?? "");
  return words.every((w) => tokenMatches(w, p, haystack, phoneDigits));
}

export type PeopleFilter = { query?: string; role?: Role | "all"; status?: Status | "all" };

export function filterPeople<T extends SearchablePerson>(list: T[], f: PeopleFilter): T[] {
  return list.filter(
    (p) =>
      (!f.role || f.role === "all" || p.role === f.role) &&
      (!f.status || f.status === "all" || statusOf(p) === f.status) &&
      matchesPerson(p, f.query ?? "")
  );
}
