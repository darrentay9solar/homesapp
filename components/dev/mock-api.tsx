"use client";

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

function answer(method: string, path: string): unknown {
  const key = `${method} ${path}`;
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
    const body = answer((init?.method ?? "GET").toUpperCase(), u.pathname.slice("/api/py".length));
    await new Promise((r) => setTimeout(r, 150));
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  (window as { __mockApi?: boolean }).__mockApi = true;
}

export function MockApi({ children }: { children: ReactNode }) {
  // Installed during the first render, before any child effect fetches.
  useState(install);
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
