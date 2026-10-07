/**
 * The audit log's shapes and the pure logic behind its screens: labels,
 * values as people read them, the timeline's day-and-place grouping, a
 * person's sessions, and search. No React here, so it can be unit tested.
 */

import type { Role } from "./app-state";
import { locale, translate } from "./i18n";
import { matchesAll } from "./search";

export type Page = "projects" | "milestones" | "files" | "sites" | "signatures" | "people" | "groups";
export type LineState = "current" | "reverted" | "superseded" | "locked";

export type AuditChange = { field: string; from: unknown; to: unknown; state: LineState; note: string | null };
export type AuditActor = { uid: number | null; name: string; role: Role | null; roleLabel: string };
export type AuditLocation = { key: string; kind: "project" | "person" | "request" | "group" | "retailer" | "other"; id: number | null; label: string };

export type AuditEntry = {
  id: number;
  at: string;
  action: "insert" | "update" | "delete";
  table: string;
  page: Page;
  summary: string;
  actor: AuditActor | null;
  location: AuditLocation;
  changes: AuditChange[];
  revertsId: number | null;
  /** This entry brought back the state an earlier entry left (a value, or a deleted record). */
  restoresId: number | null;
  /** Why a revert or restore was made. Always present on those; never on ordinary edits. */
  reason: string | null;
  operationId: string | null;
  revertedBy: number[];
  lockedReason: string | null;
  /** Undoing the whole row: removing an added link, putting one back, or restoring a deleted record. */
  rowUndo: { verb: string; kind: ActionKind; state: "current" | "reverted" | "superseded" } | null;
};

export type ActionKind = "revert" | "restore_value" | "restore_record";
/** What a revert or restore acts on. */
export type ActionSpec = { kind: ActionKind; auditId: number; fields?: string[]; field?: string; withRelated?: boolean };
export type Effect = {
  table: string;
  action: AuditEntry["action"];
  summary: string;
  location: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
};
/** The dry run: exactly what would be written, what stops it, and what to know. */
export type Preview = { summary: string; blockers: string[]; warnings: string[]; effects: Effect[]; expect: number };

export type Version = {
  id: number;
  at: string;
  actor: { uid: number | null; name: string; role: Role | null };
  deleted: boolean;
  value: unknown;
  reason: string | null;
  revertsId: number | null;
  restoresId: number | null;
};
export type FieldHistory = {
  field: string;
  table: string;
  location: string;
  exists: boolean;
  current: unknown;
  lockedReason: string | null;
  versions: Version[];
  refs: Refs;
};

export const MIN_REASON = 10;

export type Refs = { users: Record<string, string>; groups: Record<string, string>; retailers: Record<string, string> };
export type AuditLog = { entries: AuditEntry[]; nextBefore: number | null; counts: Record<Page, number>; refs: Refs };

export type AuditPerson = {
  uid: number | null;
  name: string;
  role: Role | null;
  roleLabel: string;
  email: string | null;
  active: boolean | null;
  changes: number;
  places: number;
  lastAt: string;
  pages: Page[];
  reverts: number;
};

export const PAGES: Array<[Page, string]> = [
  ["projects", "Projects"],
  ["milestones", "Milestones"],
  ["files", "Files"],
  ["sites", "Site visits"],
  ["signatures", "Signatures"],
  ["people", "People"],
  ["groups", "Groups"],
];
export const PAGE_LABEL = Object.fromEntries(PAGES) as Record<Page, string>;

// ------------------------------------------------------------ labels

/** Column names as the screens call them. Anything missing falls back to "Sentence case". */
const FIELD_LABEL: Record<string, string> = {
  full_name: "Full name",
  user_type: "Role",
  contact_no: "Mobile",
  ic_last4: "NRIC last 4",
  email: "Email",
  address: "Address",
  postal_code: "Postal code",
  active: "Active",
  name: "Name",
  status: "Status",
  note: "Note",
  decision_note: "Decision note",
  requested_type: "Role asked for",
  granted_uid: "Account created",
  decided_by: "Decided by",
  user_id: "Person",
  group_id: "Group",
  added_by: "Added by",
  assigned_by: "Assigned by",
  project_manager_id: "Project manager",
  homeowner_id: "Homeowner",
  contractor_group_id: "Contractor group",
  contractor_text: "Contractor (text)",
  electricity_retailer_id: "Electricity retailer",
  panel_quantity_estimate: "Panel quantity (est.)",
  panel_quantity_actual: "Panel quantity (actual)",
  panel_capacity: "Panel capacity (W)",
  installation_start_date: "Installation start",
  installation_end_date: "Installation end",
  sp_application_status: "SP application",
  sp_submission_date: "SP submission date",
  pvl_received_date: "PVL received",
  pre_inspection_date: "Pre-inspection date",
  sp_appointment_letter_received_date: "SP appointment letter",
  meter_replacement_date: "Meter replacement",
  sp_turn_on_inspection_date: "SP turn-on inspection",
  scaffolding_removal: "Scaffolding removed",
  scaffolding_removal_date: "Scaffolding removal date",
  inverter_to_order: "Inverter to order",
  inverter_collected: "Inverter collected",
  inverter_date: "Inverter date",
  inverter_serial_number: "Inverter serial no.",
  inverter_commission_grid_connection: "Inverter commissioned",
  commission_date: "Commission date",
  rcb_breaker_replacement: "RCB breaker replaced",
  rcb_breaker_replacement_date: "RCB replacement date",
  retailer_contract_end_date: "Retailer contract end",
  fusion_solar_app_access: "FusionSolar access",
  confirmed_by_homeowner: "Confirmed by homeowner",
  waterproofing: "Waterproofing",
  create_group_chat: "Group chat created",
  current_stage: "Stage",
  site_lat: "Site latitude",
  site_lng: "Site longitude",
  check_in_radius_m: "Check-in radius (m)",
  scheduled_date: "Date",
  scheduled_time: "Time",
  works_note: "Works",
  crew_in: "Crew in",
  crew_out: "Crew out",
  checked_in_at: "Checked in",
  checked_out_at: "Checked out",
  distance_m: "Distance from site (m)",
  milestone_no: "Milestone",
  completed_at: "Completed",
  completed_by: "Completed by",
  file_name: "File name",
  category: "Category",
  size_bytes: "Size",
  uploaded_by: "Uploaded by",
  signed_by: "Signed by",
  signed_at: "Signed",
};

export function fieldLabel(field: string): string {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field];
  const words = field.replace(/_id$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ROLE_WORD: Record<string, string> = {
  homeowner: "Homeowner",
  contractor: "Contractor Admin",
  epc_team: "EPC Team",
  project_manager: "Project Manager",
};
const SP_STATUS: Record<number, string> = { 1: "Submitted to LEW", 2: "LEW submitted to SP", 3: "Not yet" };
const USER_REFS = new Set([
  "user_id", "homeowner_id", "project_manager_id", "invited_by", "decided_by", "granted_uid",
  "uploaded_by", "added_by", "assigned_by", "created_by", "completed_by", "signed_by",
]); // prettier-ignore

const sgDate = (d: Date, withTime: boolean) =>
  d
    .toLocaleString(locale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
      timeZone: "Asia/Singapore",
    })
    .replace(",", "");

/** A stored value the way a person would write it. Empty is shown as "empty", never as a blank. */
export function formatValue(field: string, v: unknown, refs?: Refs): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (v === "<redacted>") return "hidden";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (USER_REFS.has(field)) return refs?.users[String(v)] ?? `Person #${v}`;
    if (field === "group_id" || field === "contractor_group_id") return refs?.groups[String(v)] ?? `Group #${v}`;
    if (field === "electricity_retailer_id") return refs?.retailers[String(v)] ?? `Retailer #${v}`;
    if (field === "sp_application_status") return SP_STATUS[v] ?? String(v);
    if (field === "milestone_no") return `Milestone ${v}`;
    if (field === "size_bytes") return v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1024))} KB`;
    return v.toLocaleString(locale());
  }
  if (typeof v === "string") {
    if (field === "user_type" || field === "requested_type") return ROLE_WORD[v] ?? v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return sgDate(new Date(`${v}T00:00:00+08:00`), false);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return sgDate(new Date(v), true);
    if (field === "status") return v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");
    return v;
  }
  return JSON.stringify(v);
}

// ------------------------------------------------------------ timeline

const SG = "Asia/Singapore";
/** "2026-10-05" in Singapore time — the day an entry belongs to. */
export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: SG });
}

/** "Today", "Yesterday", or the weekday — the small line under the day number. */
export function dayName(key: string, now: Date = new Date()): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: SG });
  const yesterday = new Date(now.getTime() - 86_400_000).toLocaleDateString("en-CA", { timeZone: SG });
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T12:00:00+08:00`).toLocaleDateString(locale(), { weekday: "short", timeZone: SG });
}

export function dayMonth(key: string): { day: string; month: string } {
  const d = new Date(`${key}T12:00:00+08:00`);
  return {
    day: d.toLocaleDateString(locale(), { day: "numeric", timeZone: SG }),
    month: d.toLocaleDateString(locale(), { month: "short", timeZone: SG }),
  };
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: SG }).toUpperCase();
}

export type Contributor = { key: string; uid: number | null; name: string; role: Role | null; count: number };

/** Everything that happened in one place on one day — one card on the timeline. */
export type PlaceCard = {
  location: AuditLocation;
  entries: AuditEntry[];
  /** Who changed it, most active first. More than one is highlighted. */
  people: Contributor[];
  pages: Page[];
  latest: string;
};
export type Day = { key: string; cards: PlaceCard[]; count: number };

function contributorKey(a: AuditActor | null): string {
  return a ? (a.uid !== null ? `u${a.uid}` : `n${a.name}`) : "system";
}

export function contributors(entries: AuditEntry[]): Contributor[] {
  const by = new Map<string, Contributor>();
  for (const e of entries) {
    const key = contributorKey(e.actor);
    const c = by.get(key) ?? { key, uid: e.actor?.uid ?? null, name: e.actor?.name ?? "Outside the app", role: e.actor?.role ?? null, count: 0 };
    c.count += 1;
    by.set(key, c);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Newest day first; within a day, the place changed most recently first. */
export function groupTimeline(entries: AuditEntry[]): Day[] {
  const days = new Map<string, Map<string, AuditEntry[]>>();
  for (const e of entries) {
    const d = dayKey(e.at);
    const places = days.get(d) ?? new Map<string, AuditEntry[]>();
    const list = places.get(e.location.key) ?? [];
    list.push(e);
    places.set(e.location.key, list);
    days.set(d, places);
  }
  const byNewest = (a: AuditEntry, b: AuditEntry) => b.at.localeCompare(a.at) || b.id - a.id;
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, places]) => {
      const cards = [...places.values()]
        .map((list) => {
          list.sort(byNewest);
          return {
            location: list[0].location,
            entries: list,
            people: contributors(list),
            pages: [...new Set(list.map((e) => e.page))],
            latest: list[0].at,
          };
        })
        .sort((a, b) => b.latest.localeCompare(a.latest));
      return { key, cards, count: cards.reduce((n, c) => n + c.entries.length, 0) };
    });
}

/**
 * One person's activity as sessions: back-to-back changes to the same place
 * within half an hour read as one piece of work ("Updated Jalan Kayu
 * Residence" with its edits underneath), as in an activity log.
 */
export type Session = { location: AuditLocation; entries: AuditEntry[]; start: string; end: string };

export function groupSessions(entries: AuditEntry[], gapMinutes = 30): Session[] {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const out: Session[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    const gap = last ? (new Date(last.start).getTime() - new Date(e.at).getTime()) / 60_000 : Infinity;
    if (last && last.location.key === e.location.key && gap <= gapMinutes && dayKey(last.start) === dayKey(e.at)) {
      last.entries.push(e);
      last.start = e.at;
    } else {
      out.push({ location: e.location, entries: [e], start: e.at, end: e.at });
    }
  }
  return out;
}

// ------------------------------------------------------------ search

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Every word must appear somewhere in the entry: who, where, what, the page,
 * a field's name, or a value before or after.
 */
export function matchesEntry(e: AuditEntry, query: string, refs?: Refs): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(
    [
      e.actor?.name,
      e.actor?.roleLabel,
      e.location.label,
      e.summary,
      PAGE_LABEL[e.page],
      e.page, // "sites" finds Site visits, matching the app's Sites tab
      ...e.changes.flatMap((c) => [fieldLabel(c.field), formatValue(c.field, c.from, refs), formatValue(c.field, c.to, refs)]),
    ]
      // The same words in Chinese, so a search works in either language.
      .flatMap((x) => (x ? [x, translate(x, "zh")] : []))
      .filter(Boolean)
      .join(" \u0001 ")
  );
  return words.every((w) => hay.includes(w));
}

/** Whether anything in this entry can still be put back. */
export function canRevert(e: AuditEntry): boolean {
  if (e.rowUndo) return e.rowUndo.state === "current";
  return e.changes.some((c) => c.state === "current");
}

/** What the undo button does, in words. */
export function revertVerb(e: AuditEntry): string {
  return e.rowUndo?.verb ?? "Revert";
}

/** A reason good enough to keep with the change. */
export function reasonOk(reason: string): boolean {
  return reason.trim().length >= MIN_REASON;
}

/**
 * The versions of a field, newest first, with the one it holds now marked.
 * Deletions stay in the list so the history reads truthfully, but can't be
 * restored as a value.
 */
export function versionList(h: FieldHistory): Array<Version & { current: boolean; restorable: boolean }> {
  let currentMarked = false;
  return h.versions.map((v) => {
    const isCurrent = !currentMarked && h.exists && !v.deleted && JSON.stringify(v.value) === JSON.stringify(h.current);
    if (isCurrent) currentMarked = true;
    return { ...v, current: isCurrent, restorable: !v.deleted && !isCurrent && h.exists && !h.lockedReason };
  });
}

/** The audit log's "By person" search: name, email or role. */
export function matchesAuditPerson(p: { name: string; email?: string | null; roleLabel?: string | null }, query: string): boolean {
  return matchesAll([p.name, p.email, p.roleLabel, translate(p.roleLabel, "zh")], query);
}
