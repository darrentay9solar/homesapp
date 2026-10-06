/**
 * The Projects screens' shapes and the pure logic behind them: the list's
 * tabs and search, and Create Project's date rule. No React, so it can be
 * unit tested (tests/projects.test.ts).
 */

import type { Role } from "./app-state";
import { normalise, tokens } from "./people-search";

export type ProjectStatus =
  | "draft"
  | "awaiting_homeowner"
  | "homeowner_declined"
  | "homeowner_approved"
  | "pm_approved"
  | "in_progress"
  | "awaiting_signature"
  | "signed"
  | "closed";

export type Flag = { kind: "overdue" | "no_show"; text: string };
export type GroupState = { done: number; total: number; complete: boolean };

export type ProjectRow = {
  id: number;
  name: string;
  address: string;
  postalCode: string | null;
  siteLocated: boolean;
  status: ProjectStatus;
  statusLabel: string;
  homeowner: { uid: number | null; name: string | null; linked: boolean };
  contactNo: string | null;
  contractor: { type: "group" | "users" | "text"; label: string; groupId?: number };
  team: Array<{ uid: number; name: string | null; role: Role }>;
  pm: { uid: number | null; name: string | null };
  startDate: string | null;
  endDate: string | null;
  daysElapsed: number;
  progress: number;
  milestone: number;
  currentMilestone: number;
  groups: Record<string, GroupState>;
  flags: Flag[];
  attention: boolean;
  createdAt: string;
};

export type ProjectList = { projects: ProjectRow[]; canCreate: boolean; today: string };

export type Options = {
  homeowners: Array<{ uid: number; name: string; email: string; contactNo: string | null }>;
  crew: Array<{ uid: number; name: string; role: Role; roleLabel: string }>;
  groups: Array<{ id: number; name: string; members: number[] }>;
};

// ------------------------------------------------------------- statuses

export type Tone = "default" | "success" | "warning" | "error" | "info";
export const STATUS_TONE: Record<ProjectStatus, Tone> = {
  draft: "default",
  awaiting_homeowner: "warning",
  homeowner_declined: "error",
  homeowner_approved: "info",
  pm_approved: "success",
  in_progress: "success",
  awaiting_signature: "warning",
  signed: "info",
  closed: "default",
};

export type Tab = "all" | "attention" | "approval" | "active" | "handover" | "closed";
export const TABS: Array<[Tab, string]> = [
  ["all", "All"],
  ["attention", "Attention"],
  ["approval", "Approval"],
  ["active", "Active"],
  ["handover", "Handover"],
  ["closed", "Closed"],
];

const APPROVAL: ProjectStatus[] = ["draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"];
const ACTIVE: ProjectStatus[] = ["pm_approved", "in_progress"];
const HANDOVER: ProjectStatus[] = ["awaiting_signature", "signed"];

export function inTab(p: ProjectRow, tab: Tab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "attention":
      return p.attention;
    case "approval":
      return APPROVAL.includes(p.status);
    case "active":
      return ACTIVE.includes(p.status);
    case "handover":
      return HANDOVER.includes(p.status);
    case "closed":
      return p.status === "closed";
  }
}

// ---------------------------------------------------------------- search

/**
 * Every word must match something: the project's name, address or postal
 * code, the homeowner, the contractor, anyone on the team, the status, or
 * words like "late", "red" and "no-show" for projects needing attention.
 */
export function matchesProject(p: ProjectRow, query: string): boolean {
  const words = tokens(query);
  if (!words.length) return true;
  const hay = normalise(
    [
      p.name,
      p.address,
      p.postalCode ?? "",
      p.homeowner.name ?? "",
      p.contactNo ?? "",
      p.contractor.label,
      ...p.team.map((t) => t.name ?? ""),
      p.statusLabel,
      `milestone ${p.currentMilestone}`,
      ...(p.attention ? ["attention", "red", "issue"] : ["on time", "on track"]),
      ...p.flags.map((f) => (f.kind === "overdue" ? "late overdue" : "no-show no show missed")),
    ].join(" | ")
  );
  return words.every((w) => hay.includes(w));
}

export function filterProjects(list: ProjectRow[], f: { query?: string; tab?: Tab }): ProjectRow[] {
  return list.filter((p) => inTab(p, f.tab ?? "all") && matchesProject(p, f.query ?? ""));
}

/** Projects needing attention first, then the rest as they came (newest first). */
export function sortProjects(list: ProjectRow[]): ProjectRow[] {
  return [...list].sort((a, b) => Number(b.attention) - Number(a.attention));
}

// ------------------------------------------------------------------ dates

export const SPAN_DAYS = 21;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Create Project's rule: give a start or an end (or both); a missing one is
 * three weeks from the other. Mirrors the server, so the form can show the
 * date that will be used before it's sent.
 */
export function planDates(start: string, end: string): { start: string; end: string; error: string | null } | null {
  if (!start && !end) return null;
  const s = start || addDays(end, -SPAN_DAYS);
  const e = end || addDays(start, SPAN_DAYS);
  return { start: s, end: e, error: e < s ? "The end date can't be before the start date." : null };
}

// -------------------------------------------------------------- sections

/** The brief's field sections, in order. Milestone 1 is the first three. */
export const SECTIONS: Array<{ key: string; name: string; sub: string; milestone: 1 | 2 | 3 }> = [
  { key: "pre1", name: "Before Milestone 1", sub: "Admin / EPC · utilities & SP application", milestone: 1 },
  { key: "pre1b", name: "Pre-end of Milestone 1", sub: "Admin · survey, panels & inverter", milestone: 1 },
  { key: "m1", name: "Milestone 1", sub: "Installation & scaffolding removal", milestone: 1 },
  { key: "m2", name: "Milestone 2", sub: "Inverter commissioning & grid", milestone: 2 },
  { key: "m3", name: "Milestone 3", sub: "Inspection & appointment letter", milestone: 3 },
  { key: "post", name: "Post Milestone 3", sub: "Closing documents & handover", milestone: 3 },
];

const BEFORE_APPROVAL: ProjectStatus[] = ["draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"];

/**
 * Why a section can't be filled in yet, or null if it can. From the brief:
 * nothing until the homeowner and a PM have approved; then each milestone's
 * fields only once the previous milestone is complete.
 */
export function lockReason(p: Pick<ProjectRow, "status" | "milestone">, section: string): string | null {
  if (BEFORE_APPROVAL.includes(p.status)) return "Opens once the homeowner and a project manager have approved the project.";
  const s = SECTIONS.find((x) => x.key === section);
  if (!s) return null;
  if (s.milestone === 2 && p.milestone < 1) return "Opens once Milestone 1 is complete.";
  if (s.milestone === 3 && p.milestone < 2) return "Opens once Milestone 2 is complete.";
  return null;
}

// ---------------------------------------------------------- milestone fields

export type FieldKind = "text" | "number" | "date" | "yesno" | "select" | "file" | "photos" | "retailer" | "homeowner" | "auto";
export type StoredFile = { id: number; name: string; type: string | null; size: number | null; at: string; by: string | null };

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  note: string | null;
  /** False while its condition doesn't hold ("if No, specify the date"). */
  shown: boolean;
  filled: boolean;
  value: unknown;
  files: StoredFile[] | null;
  /** Why it can't be changed by you right now, or null if it can. */
  lockedReason: string | null;
};

export type Section = {
  key: string;
  name: string;
  sub: string;
  milestone: 1 | 2 | 3;
  lockedReason: string | null;
  done: number;
  total: number;
  complete: boolean;
  fields: FieldDef[];
};

export type ProjectFields = {
  relation: "pm" | "crew" | "homeowner";
  sections: Section[];
  milestoneReached: number;
  recordedMilestones: number[];
  retailers: Array<{ id: number; name: string }>;
  storage: "r2" | "local" | null;
  actions: { approve: boolean; decline: boolean; remind: boolean; editDetails: boolean; reopen: number[] };
};

export const SP_STATUS: Record<number, string> = { 1: "Submitted to LEW", 2: "LEW submitted to SP", 3: "Not yet" };

/** A field's value as a sentence fragment, for read-only display. */
export function showValue(f: Pick<FieldDef, "kind" | "value" | "key">): string {
  const v = f.value;
  if (v === null || v === undefined || v === "") return "";
  if (f.kind === "yesno") return v ? "Yes" : "No";
  if (f.kind === "select") return SP_STATUS[Number(v)] ?? String(v);
  if (f.kind === "retailer") return (v as { name: string }).name;
  if (f.kind === "date" && typeof v === "string") {
    return new Date(`${v}T00:00:00+08:00`).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  }
  if (f.kind === "number" && f.key === "panel_capacity") return `${Number(v).toLocaleString("en-SG")} W`;
  if (f.kind === "number") return Number(v).toLocaleString("en-SG");
  return String(v);
}

/** The section to open first: the earliest one that's open and not yet complete. */
export function firstOpenSection(sections: Section[]): string | null {
  return sections.find((s) => !s.lockedReason && !s.complete)?.key ?? null;
}
