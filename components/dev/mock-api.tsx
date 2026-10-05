"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { AppShell } from "@/components/shell";
import { AppProvider } from "@/lib/client/app-state";

/**
 * DEVELOPMENT ONLY. Renders real screens against sample data, without
 * signing in, so layouts can be checked in a browser that has no session.
 * /api/py/* calls are answered from FIXTURES below; nothing reaches the
 * database or the Python API. app/dev-preview refuses to render in
 * production.
 */

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const FIXTURES: Record<string, unknown> = {
  "GET /me": {
    state: "active",
    unread: 2,
    user: {
      uid: 1,
      fullName: "Wei Ming Tan",
      email: "weiming@example.com",
      role: "project_manager",
      roleLabel: "Project Manager",
      contactNo: "+65 9123 4567",
      address: null,
      postalCode: null,
    },
  },
  "GET /people": {
    me: 1,
    groups: [
      { id: 1, name: "Apex Solar Contractors", members: [3, 4], projects: 3 },
      { id: 2, name: "Kim Seng M&E Services", members: [3], projects: 1 },
      { id: 3, name: "Northline Roofing", members: [], projects: 0 },
    ],
    requests: [
      {
        id: 11, fullName: "Aisha Rahman", email: "aisha@example.com", role: "homeowner", roleLabel: "Homeowner",
        contactNo: "+65 9123 4567", address: "53 Ang Mo Kio Ave 3", postalCode: "569933",
        note: "Referred by K. Chandra", createdAt: iso(120),
      },
      {
        id: 12, fullName: "Kelvin Lim", email: "kelvin@example.com", role: "epc_team", roleLabel: "EPC Team",
        contactNo: "+65 8222 1100", address: null, postalCode: null, note: "I'm with Apex Solar", createdAt: iso(1500),
      },
    ],
    users: [
      { uid: 1, fullName: "Wei Ming Tan", email: "weiming@example.com", role: "project_manager", roleLabel: "Project Manager", contactNo: "+65 9123 4567", active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 2, fullName: "Charlotte Sim", email: "charlotte@example.com", role: "project_manager", roleLabel: "Project Manager", contactNo: "+65 9001 2201", active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 3, fullName: "Priya Nair", email: "priya@example.com", role: "contractor", roleLabel: "Contractor Admin", contactNo: "+65 9001 2202", active: true, linked: true, invitedAt: null, groups: [1, 2] },
      { uid: 4, fullName: "Ravi Kumar", email: "ravi@example.com", role: "epc_team", roleLabel: "EPC Team", contactNo: "+65 9001 2203", active: true, linked: false, invitedAt: iso(3000), groups: [1] },
      { uid: 5, fullName: "Jasmine Lee", email: "jasmine@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 9123 4477", active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 6, fullName: "Daniel Ong", email: "daniel@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 8877 2210", active: true, linked: false, invitedAt: iso(600), groups: [] },
      { uid: 7, fullName: "Farah Ismail", email: "farah@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: null, active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 8, fullName: "Marcus Teo", email: "marcus@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 9330 5521", active: false, linked: true, invitedAt: null, groups: [] },
    ],
  },
};

// ------------------------------------------------------------ audit

type Line = [field: string, from: unknown, to: unknown, state?: string, note?: string];
const WEI = { uid: 1, name: "Wei Ming Tan", role: "project_manager", roleLabel: "Project Manager" };
const CHARLOTTE = { uid: 2, name: "Charlotte Sim", role: "project_manager", roleLabel: "Project Manager" };
const PRIYA = { uid: 3, name: "Priya Nair", role: "contractor", roleLabel: "Contractor Admin" };
const RAVI = { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team" };
const JALAN = { key: "project:101", kind: "project", id: 101, label: "Jalan Kayu Residence" };
const BEDOK = { key: "project:104", kind: "project", id: 104, label: "Bedok Ria Terrace" };

function ae(
  id: number,
  minsAgo: number,
  actor: object | null,
  action: string,
  table: string,
  page: string,
  summary: string,
  location: object,
  lines: Line[],
  extra: Record<string, unknown> = {}
) {
  const locked = typeof extra.lockedReason === "string";
  return {
    id,
    at: iso(minsAgo),
    action,
    table,
    page,
    summary,
    actor,
    location,
    changes: lines.map(([field, from, to, state, note]) => ({
      field,
      from,
      to,
      state: state ?? (locked ? "locked" : "current"),
      note: note ?? (locked ? extra.lockedReason : null),
    })),
    revertsId: null,
    revertedBy: [],
    lockedReason: null,
    linkState: null,
    ...extra,
  };
}

const AUDIT_ENTRIES = [
  ae(432, 25, WEI, "update", "projects", "projects", "Updated project details", JALAN, [["panel_quantity_actual", 20, 18]], { revertsId: 412 }),
  ae(431, 40, PRIYA, "update", "projects", "projects", "Updated project details", JALAN, [
    ["sp_application_status", 3, 1],
    ["sp_submission_date", null, "2026-10-05"],
  ]),
  ae(430, 180, RAVI, "insert", "site_check_ins", "sites", "Checked in on site", JALAN, [
    ["crew_in", null, 4],
    ["distance_m", null, 38],
    ["checked_in_at", null, iso(180)],
  ], { lockedReason: "GPS check-ins are site evidence and can't be edited." }),
  ae(429, 300, WEI, "update", "users", "people", "Updated account", { key: "person:5", kind: "person", id: 5, label: "Jasmine Lee" }, [
    ["contact_no", "+65 9123 4400", "+65 9123 4477"],
  ]),
  ae(428, 360, WEI, "insert", "contractor_group_members", "groups", "Added Ravi Kumar", { key: "group:1", kind: "group", id: 1, label: "Apex Solar Contractors" }, [
    ["user_id", null, 4],
    ["added_by", null, 1],
  ], { linkState: "current" }),
  ae(427, 362, WEI, "update", "account_requests", "people", "Approved access request", { key: "request:12", kind: "request", id: 12, label: "Access request · Kelvin Lim" }, [
    ["status", "pending", "approved"],
    ["granted_uid", null, 4],
  ], { lockedReason: "Decisions on access requests are final." }),
  ae(412, 1500, PRIYA, "update", "projects", "projects", "Updated project details", JALAN, [
    ["panel_quantity_actual", 18, 20, "reverted", "Reverted by Wei Ming Tan"],
    ["inverter_serial_number", null, "HW-SUN2000-10KTL-88231"],
  ], { revertedBy: [432] }),
  ae(411, 1560, RAVI, "update", "projects", "projects", "Updated project details", JALAN, [
    ["scaffolding_removal", false, true],
    ["scaffolding_removal_date", null, "2026-10-04"],
  ]),
  ae(410, 1620, RAVI, "insert", "project_files", "files", "Uploaded a file", BEDOK, [
    ["file_name", null, "SP_Form_signed.pdf"],
    ["category", null, "sp_forms"],
    ["size_bytes", null, 845000],
  ], { lockedReason: "Something created can't be un-created from here." }),
  ae(409, 2900, CHARLOTTE, "update", "projects", "milestones", "Updated milestone 2", BEDOK, [
    ["installation_end_date", "2026-10-10", "2026-10-17", "superseded", "Changed again by Priya Nair since"],
  ]),
  ae(408, 2880, PRIYA, "update", "projects", "milestones", "Updated milestone 2", BEDOK, [["installation_end_date", "2026-10-17", "2026-10-20"]]),
  ae(407, 4400, CHARLOTTE, "update", "users", "people", "Updated account", { key: "person:8", kind: "person", id: 8, label: "Marcus Teo" }, [["active", true, false]]),
  ae(406, 5900, null, "insert", "contractor_groups", "groups", "Created group", { key: "group:3", kind: "group", id: 3, label: "Northline Roofing" }, [
    ["name", null, "Northline Roofing"],
  ], { lockedReason: "To undo a new group, delete it in People → Groups." }),
].sort((a, b) => b.at.localeCompare(a.at));

const AUDIT_REFS = {
  users: { "1": "Wei Ming Tan", "2": "Charlotte Sim", "3": "Priya Nair", "4": "Ravi Kumar" },
  groups: { "1": "Apex Solar Contractors" },
  retailers: {},
};

function auditLog(search: URLSearchParams) {
  const uid = search.get("uid");
  const system = search.get("system") === "true";
  const page = search.get("page");
  const mine = AUDIT_ENTRIES.filter((e) =>
    uid ? (e.actor as { uid?: number } | null)?.uid === Number(uid) : system ? e.actor === null : true
  );
  const counts: Record<string, number> = { projects: 0, milestones: 0, files: 0, sites: 0, signatures: 0, people: 0, groups: 0 };
  for (const e of mine) counts[e.page] += 1;
  return { entries: mine.filter((e) => !page || e.page === page), nextBefore: null, counts, refs: AUDIT_REFS };
}

function auditPeople() {
  const by = new Map<string, { actor: typeof WEI | null; list: typeof AUDIT_ENTRIES }>();
  for (const e of AUDIT_ENTRIES) {
    const a = e.actor as typeof WEI | null;
    const k = a ? String(a.uid) : "system";
    const v = by.get(k) ?? { actor: a, list: [] };
    v.list.push(e);
    by.set(k, v);
  }
  return [...by.values()].map(({ actor, list }) => ({
    uid: actor?.uid ?? null,
    name: actor?.name ?? "Outside the app",
    role: actor?.role ?? null,
    roleLabel: actor?.roleLabel ?? "Scripts & console",
    email: actor ? `${actor.name.split(" ")[0].toLowerCase()}@example.com` : null,
    active: actor ? true : null,
    changes: list.length,
    places: new Set(list.map((e) => (e.location as { key: string }).key)).size,
    lastAt: list[0].at,
    pages: [...new Set(list.map((e) => e.page))],
    reverts: list.filter((e) => e.revertsId).length,
  }));
}

function answer(method: string, path: string, search: URLSearchParams = new URLSearchParams()): unknown {
  const key = `${method} ${path}`;
  if (key === "GET /audit") return auditLog(search);
  if (key === "GET /audit/people") return auditPeople();
  // /dev-preview/onboarding?as=pending shows the waiting screen instead.
  if (key === "GET /me" && window.location.pathname.startsWith("/dev-preview/onboarding")) {
    const as = new URLSearchParams(window.location.search).get("as");
    if (as === "pending") {
      return { state: "pending", request: { requestedRole: "homeowner", requestedRoleLabel: "Homeowner", decisionNote: null, createdAt: iso(30) }, clerk: { fullName: "Aisha Rahman", email: "aisha@example.com", phone: "+65 9123 4567" } };
    }
    return { state: "no_account", clerk: { fullName: "Aisha Rahman", email: "aisha@example.com", phone: "+65 9123 4567" } };
  }
  if (key in FIXTURES) return FIXTURES[key];
  if (/^GET \/people\/\d+\/projects$/.test(key)) {
    return [
      { id: 101, name: "Jalan Kayu Residence", status: "in_progress" },
      { id: 104, name: "Bedok Ria Terrace", status: "awaiting_sign" },
    ];
  }
  if (method !== "GET") return { message: `Preview only — ${method} ${path} was not sent.` };
  return {};
}

function install() {
  if (typeof window === "undefined" || (window as { __mockApi?: boolean }).__mockApi) return;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, window.location.origin);
    if (!u.pathname.startsWith("/api/py/")) return real(input, init);
    const body = answer((init?.method ?? "GET").toUpperCase(), u.pathname.slice("/api/py".length), u.searchParams);
    await new Promise((r) => setTimeout(r, 150));
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  (window as { __mockApi?: boolean }).__mockApi = true;
}

export function MockApi({ children }: { children: ReactNode }) {
  // Installed during the first render, before any child effect fetches.
  useState(install);
  const pathname = usePathname();
  // The sign-up screens stand alone, outside the signed-in app shell.
  if (pathname.startsWith("/dev-preview/onboarding")) return <>{children}</>;
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
