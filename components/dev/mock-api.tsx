"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { AppShell } from "@/components/shell";
import { AppProvider } from "@/lib/client/app-state";
import { currentLang } from "@/lib/client/i18n";

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
      avatar: null,
    },
    settings: {
      mobileVerifiedAt: iso(60 * 24 * 12),
      passwordChangedAt: iso(60 * 24 * 40),
      roleRequest: null,
      language: "en",
      shareLocation: false,
      notificationPrefs: { pausedUntil: null, quiet: { on: true, from: "22:00", to: "07:00" }, urgent: true, mute: [], channels: { push: true, email: true, mobile: true } },
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
    roleRequests: [
      {
        id: 21, uid: 3, fullName: "Priya Nair", email: "priya@example.com", contactNo: "+65 9001 2202",
        from: "contractor", fromLabel: "Contractor Admin", role: "epc_team", roleLabel: "EPC Team",
        reason: "I'm moving to the Apex EPC crew from next month.", createdAt: iso(45),
      },
    ],
    users: [
      { uid: 1, fullName: "Wei Ming Tan", email: "weiming@example.com", role: "project_manager", roleLabel: "Project Manager", contactNo: "+65 9123 4567", active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 2, fullName: "Charlotte Sim", email: "charlotte@example.com", role: "project_manager", roleLabel: "Project Manager", contactNo: "+65 9001 2201", active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 3, fullName: "Priya Nair", email: "priya@example.com", role: "contractor", roleLabel: "Contractor Admin", contactNo: "+65 9001 2202", active: true, linked: true, invitedAt: null, groups: [1, 2] },
      { uid: 4, fullName: "Ravi Kumar", email: "ravi@example.com", role: "epc_team", roleLabel: "EPC Team", contactNo: "+65 9001 2203", active: true, linked: false, invitedAt: iso(3000), groups: [1], disableOn: day(30) },
      { uid: 5, fullName: "Jasmine Lee", email: "jasmine@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 9123 4477", active: true, linked: true, invitedAt: null, groups: [] },
      { uid: 6, fullName: "Daniel Ong", email: "daniel@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 8877 2210", active: true, linked: false, invitedAt: iso(600), groups: [] },
      { uid: 7, fullName: "Farah Ismail", email: "farah@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: null, active: true, linked: true, invitedAt: null, groups: [], disabledReason: null },
      { uid: 8, fullName: "Marcus Teo", email: "marcus@example.com", role: "homeowner", roleLabel: "Homeowner", contactNo: "+65 9330 5521", active: false, linked: true, invitedAt: null, groups: [], disableOn: day(-3), disabledReason: "scheduled" },
    ],
  },
};

// ------------------------------------------------------------ alerts

const ALERTS = [
  { id: 9001, kind: "visit_missed", kindLabel: "Running late", title: "Running late · Seletar Hills Home", body: "The EPC crew was due today at 09:00 and hasn't checked in an hour later.", link: "/projects/103#site-visits", projectId: 103, projectName: "Seletar Hills Home", createdAt: iso(12), read: false, urgent: true },
  { id: 9002, kind: "role_request", kindLabel: "People", title: "Role change request", body: "Priya Nair asked to change from Contractor Admin to EPC Team.", link: "/people", projectId: null, projectName: null, createdAt: iso(45), read: false, urgent: false },
  { id: 9003, kind: "milestone_complete", kindLabel: "Milestone", title: "Milestone 1 complete · Jalan Kayu Residence", body: "Panels installed and scaffolding removed. The SP application has been submitted.", link: "/projects/101", projectId: 101, projectName: "Jalan Kayu Residence", createdAt: iso(180), read: true, urgent: false },
  { id: 9004, kind: "approval_request", kindLabel: "Approval", title: "Approve Sunbird Circle", body: "Daniel Ong approved the project. Approve it to start the work.", link: "/projects/102", projectId: 102, projectName: "Sunbird Circle", createdAt: iso(60 * 26), read: true, urgent: false },
  { id: 9005, kind: "crew_arrived_late", kindLabel: "Running late", title: "Crew arrived 1 h 20 min late · Jalan Kayu Residence", body: "Ravi Kumar checked in at 10:20 for the 09:00 visit, with 4 crew.", link: "/projects/101#site-visits", projectId: 101, projectName: "Jalan Kayu Residence", createdAt: iso(60 * 27), read: true, urgent: true },
];

// ------------------------------------------------------------ my files

const MY_FILES = {
  files: [
    { id: 901, name: "Roof east (panels).jpg", category: "panel_pictures", categoryLabel: "Installed Panel Pictures", projectId: 101, projectName: "Jalan Kayu Residence", contentType: "image/jpeg", kind: "photo", size: 2_840_112, uploadedAt: iso(55), removed: null },
    { id: 902, name: "Inverter serial plate.jpg", category: "inverter_pictures", categoryLabel: "Installed Inverter Pictures", projectId: 101, projectName: "Jalan Kayu Residence", contentType: "image/jpeg", kind: "photo", size: 1_920_400, uploadedAt: iso(70), removed: null },
    { id: 903, name: "SP forms (signed).pdf", category: "sp_forms_signed", categoryLabel: "SP Forms Signed by Homeowner", projectId: 102, projectName: "Sunbird Circle", contentType: "application/pdf", kind: "document", size: 412_880, uploadedAt: iso(60 * 26), removed: null },
    { id: 904, name: "Utility bill June.pdf", category: "utility_bill", categoryLabel: "Utility Bill", projectId: 105, projectName: "Punggol Waterway Terrace", contentType: "application/pdf", kind: "document", size: 228_004, uploadedAt: iso(60 * 24 * 9), removed: null },
    { id: 905, name: "Panels blurry.jpg", category: "panel_pictures", categoryLabel: "Installed Panel Pictures", projectId: 101, projectName: "Jalan Kayu Residence", contentType: "image/jpeg", kind: "photo", size: 2_100_000, uploadedAt: iso(60 * 30), removed: { at: iso(60 * 29), by: "Wei Ming Tan" } },
  ],
};

// ------------------------------------------------------------ everyone's files (PMs)

const UPLOADERS = {
  priya: { uid: 3, name: "Priya Nair", role: "contractor", avatar: null },
  ravi: { uid: 4, name: "Ravi Kumar", role: "epc_team", avatar: null },
  wei: { uid: 1, name: "Wei Ming Tan", role: "project_manager", avatar: null },
  daniel: { uid: 6, name: "Daniel Ong", role: "homeowner", avatar: null },
};
const ALL_FILES = [
  { id: 1201, name: "Roof east (panels).jpg", category: "panel_pictures", categoryLabel: "Installed Panel Pictures", projectId: 101, projectName: "Jalan Kayu Residence", contentType: "image/jpeg", kind: "photo", size: 2_840_112, uploadedAt: iso(55), removed: null, uploader: UPLOADERS.ravi },
  { id: 1202, name: "Inverter serial plate.jpg", category: "inverter_pictures", categoryLabel: "Installed Inverter Pictures", projectId: 101, projectName: "Jalan Kayu Residence", contentType: "image/jpeg", kind: "photo", size: 1_920_400, uploadedAt: iso(70), removed: null, uploader: UPLOADERS.ravi },
  { id: 1203, name: "SP forms (signed).pdf", category: "sp_forms_signed", categoryLabel: "SP Forms Signed by Homeowner", projectId: 102, projectName: "Sunbird Circle", contentType: "application/pdf", kind: "document", size: 412_880, uploadedAt: iso(60 * 26), removed: null, uploader: UPLOADERS.priya },
  { id: 1204, name: "Utility bill June.pdf", category: "utility_bill", categoryLabel: "Utility Bill", projectId: 105, projectName: "Punggol Waterway Terrace", contentType: "application/pdf", kind: "document", size: 228_004, uploadedAt: iso(60 * 24 * 9), removed: null, uploader: UPLOADERS.daniel },
  { id: 1205, name: "PVL letter.pdf", category: "pvl_letter", categoryLabel: "PVL Letter", projectId: 102, projectName: "Sunbird Circle", contentType: "application/pdf", kind: "document", size: 310_220, uploadedAt: iso(60 * 24 * 12), removed: null, uploader: UPLOADERS.wei },
];

function allFiles(search: URLSearchParams) {
  const words = (search.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const kind = search.get("kind") ?? "all";
  const list = ALL_FILES.filter(
    (f) =>
      (kind === "all" || (kind === "image" ? f.kind === "photo" : f.kind === "document")) &&
      words.every((w) => [f.name, f.projectName, f.categoryLabel, f.uploader.name].join(" ").toLowerCase().includes(w))
  );
  return {
    files: list,
    more: false,
    counts: { image: ALL_FILES.filter((f) => f.kind === "photo").length, document: ALL_FILES.filter((f) => f.kind === "document").length },
  };
}

// ------------------------------------------------------------ demo site

const DEMO_PEOPLE = {
  people: [
    { uid: 2, name: "Charlotte Sim", role: "project_manager", roleLabel: "Project Manager", avatar: null, about: null },
    { uid: 3, name: "Priya Nair", role: "contractor", roleLabel: "Contractor Admin", avatar: null, about: "Apex Solar Contractors, Kim Seng M&E Services" },
    { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team", avatar: null, about: "Apex Solar Contractors" },
    { uid: 5, name: "Jasmine Lee", role: "homeowner", roleLabel: "Homeowner", avatar: null, about: "Jalan Kayu Residence" },
    { uid: 6, name: "Daniel Ong", role: "homeowner", roleLabel: "Homeowner", avatar: null, about: "Sunbird Circle" },
  ],
};

// ------------------------------------------------------------ locations

const LOCATIONS = {
  me: 1,
  people: [
    { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team", avatar: null, sharing: true, location: { lat: 1.3962, lng: 103.8734, accuracy: 11, at: iso(3) } },
    { uid: 3, name: "Priya Nair", role: "contractor", roleLabel: "Contractor Admin", avatar: null, sharing: true, location: { lat: 1.3329, lng: 103.7436, accuracy: 25, at: iso(95) } },
    { uid: 2, name: "Charlotte Sim", role: "project_manager", roleLabel: "Project Manager", avatar: null, sharing: false, location: null },
    { uid: 5, name: "Jasmine Lee", role: "homeowner", roleLabel: "Homeowner", avatar: null, sharing: false, location: null },
    { uid: 6, name: "Daniel Ong", role: "homeowner", roleLabel: "Homeowner", avatar: null, sharing: false, location: null },
    { uid: 7, name: "Farah Ismail", role: "homeowner", roleLabel: "Homeowner", avatar: null, sharing: false, location: null },
  ],
};

/**
 * The preview's account is in whatever language this page is already in, so
 * it never switches the page itself (the design check flips the cookie for
 * its frames while it runs; its own page must stay put).
 */
function me() {
  const m = FIXTURES["GET /me"] as { settings: Record<string, unknown> };
  return { ...m, settings: { ...m.settings, language: currentLang() } };
}

// ------------------------------------------------------------ projects

function day(offset: number) {
  return new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
}
const G = (done: number, total: number) => ({ done, total, complete: done === total });
const TEAM_APEX = [
  { uid: 1, name: "Wei Ming Tan", role: "project_manager" },
  { uid: 3, name: "Priya Nair", role: "contractor" },
  { uid: 4, name: "Ravi Kumar", role: "epc_team" },
];

function proj(id: number, over: Record<string, unknown>) {
  return {
    id,
    name: "Project",
    address: "Singapore",
    postalCode: "569933",
    siteLocated: true,
    status: "in_progress",
    statusLabel: "In Progress",
    homeowner: { uid: 5, name: "Jasmine Lee", linked: true },
    contactNo: "+65 9123 4477",
    contractor: { type: "group", label: "Apex Solar Contractors", groupId: 1 },
    team: [...TEAM_APEX, { uid: 5, name: "Jasmine Lee", role: "homeowner" }],
    pm: { uid: 1, name: "Wei Ming Tan" },
    startDate: day(-10),
    endDate: day(11),
    daysElapsed: 10,
    progress: 0,
    milestone: 0,
    currentMilestone: 1,
    groups: { pre1: G(0, 8), pre1b: G(0, 11), m1: G(0, 5), m2: G(0, 4), m3: G(0, 4), post: G(0, 5) },
    flags: [],
    attention: false,
    createdAt: iso(14_400),
    ...over,
  };
}

const PROJECTS = [
  proj(101, {
    name: "Jalan Kayu Residence",
    address: "14 Jalan Kayu, Singapore 799463",
    postalCode: "799463",
    progress: 62,
    milestone: 1,
    currentMilestone: 2,
    groups: { pre1: G(8, 8), pre1b: G(11, 11), m1: G(5, 5), m2: G(2, 4), m3: G(0, 4), post: G(0, 5) },
  }),
  proj(102, {
    name: "Sunbird Circle",
    address: "8 Sunbird Circle, Singapore 488106",
    postalCode: "488106",
    homeowner: { uid: 6, name: "Daniel Ong", linked: true },
    contactNo: "+65 8877 2210",
    team: [...TEAM_APEX, { uid: 6, name: "Daniel Ong", role: "homeowner" }],
    startDate: day(-40),
    endDate: day(-19),
    daysElapsed: 40,
    progress: 81,
    milestone: 2,
    currentMilestone: 3,
    groups: { pre1: G(8, 8), pre1b: G(11, 11), m1: G(5, 5), m2: G(4, 4), m3: G(2, 4), post: G(1, 5) },
    attention: true,
    flags: [
      { kind: "overdue", text: "Target end date passed 19 days ago" },
      { kind: "no_show", text: `No check-in for the EPC visit on ${day(-2)}, 09:00 (Pre-inspection rectification)` },
    ],
  }),
  proj(103, {
    name: "Hillcrest Villa",
    address: "27 Hillcrest Road, Singapore 289000",
    postalCode: "289000",
    status: "awaiting_homeowner",
    statusLabel: "Awaiting Homeowner",
    homeowner: { uid: 7, name: "Farah Ismail", linked: true },
    contactNo: "+65 9004 1188",
    contractor: { type: "group", label: "Kim Seng M&E Services", groupId: 2 },
    team: [
      { uid: 1, name: "Wei Ming Tan", role: "project_manager" },
      { uid: 7, name: "Farah Ismail", role: "homeowner" },
      { uid: 3, name: "Priya Nair", role: "contractor" },
    ],
    startDate: day(5),
    endDate: day(26),
    daysElapsed: 0,
  }),
  proj(104, {
    name: "Bedok Ria Terrace",
    address: "3 Bedok Ria, Singapore 469000",
    postalCode: "469000",
    status: "draft",
    statusLabel: "Draft",
    homeowner: { uid: null, name: "Marcus Teo", linked: false },
    contactNo: "+65 9330 5521",
    contractor: { type: "text", label: "Northline Roofing Pte Ltd" },
    team: [{ uid: 1, name: "Wei Ming Tan", role: "project_manager" }],
    siteLocated: false,
    startDate: day(12),
    endDate: day(33),
    daysElapsed: 0,
  }),
];

const PROJECT_OPTIONS = {
  homeowners: [
    { uid: 5, name: "Jasmine Lee", email: "jasmine@example.com", contactNo: "+65 9123 4477" },
    { uid: 6, name: "Daniel Ong", email: "daniel@example.com", contactNo: "+65 8877 2210" },
    { uid: 7, name: "Farah Ismail", email: "farah@example.com", contactNo: null },
  ],
  crew: [
    { uid: 3, name: "Priya Nair", role: "contractor", roleLabel: "Contractor Admin" },
    { uid: 4, name: "Ravi Kumar", role: "epc_team", roleLabel: "EPC Team" },
  ],
  groups: [
    { id: 1, name: "Apex Solar Contractors", members: [3, 4] },
    { id: 2, name: "Kim Seng M&E Services", members: [3] },
  ],
};


// ------------------------------------------------------ project fields
// Generated from api/_lib/project_fields.py, so the preview shows the real list.

const FIELD_DEFS: Array<[string, string, string, string, boolean, string | null]> = [["utility_bill", "Utility Bill", "pre1", "file", true, null], ["electricity_retailer_id", "Current Electricity Retailer", "pre1", "retailer", true, null], ["retailer_contract_end_date", "Retailer Contract End Date", "pre1", "date", true, "Required because the retailer is not SP."], ["moc_change", "MOC Change (if applicable)", "pre1", "file", false, null], ["gst_proof", "GST Proof", "pre1", "file", true, null], ["homeowner.ic_last4", "Homeowner's IC — Last 4", "pre1", "homeowner", true, null], ["homeowner.email", "Homeowner's Email Address", "pre1", "homeowner", true, null], ["sp_forms_signed", "SP Forms Signed by Homeowner", "pre1", "file", true, null], ["sp_application_status", "SP Application Status", "pre1", "select", true, null], ["sales", "Sales", "pre1b", "text", true, null], ["waterproofing", "Roof Assessment — Waterproofing Required?", "pre1b", "yesno", true, null], ["create_group_chat", "Create Group Chat", "pre1b", "yesno", true, null], ["panel_quantity_estimate", "Panel Quantity (Est.)", "pre1b", "number", true, null], ["panel_capacity", "Panel Capacity (W)", "pre1b", "number", true, null], ["inverter_to_order", "Inverter to be Ordered", "pre1b", "text", true, null], ["inverter_collected", "Inverter Collection Status", "pre1b", "yesno", true, null], ["inverter_date", "Expected Collection Date", "pre1b", "date", true, "Required because the inverter has not been collected."], ["inverter_serial_number", "Inverter Serial Number", "pre1b", "text", true, null], ["panel_pictures", "Installed Panel Pictures", "pre1b", "photos", true, null], ["inverter_pictures", "Installed Inverter Pictures", "pre1b", "photos", true, null], ["current_stage", "Current Stage", "pre1b", "number", true, null], ["installation_end_date", "Panel Installation Completion Date", "m1", "date", true, null], ["scaffolding_removal", "Scaffolding Removal", "m1", "yesno", true, null], ["scaffolding_removal_date", "Removal of Scaffolding Date", "m1", "date", true, null], ["sp_submission_date", "SP Submission Date", "m1", "date", true, null], ["sp_submission_screenshot", "Screenshot of SP Submission", "m1", "photos", true, null], ["panel_quantity_actual", "Panel Quantity (Actual)", "m1", "number", false, null], ["sp_pending_days", "SP Application Pending", "m1", "auto", true, null], ["inverter_commission_grid_connection", "Inverter Commission & Grid Connection", "m2", "yesno", true, null], ["commission_date", "Scheduled Grid Connection Date", "m2", "date", true, "Required because grid connection is not yet done."], ["rcb_breaker_replacement", "RCB Breaker Replacement Required", "m2", "yesno", true, null], ["rcb_breaker_replacement_date", "RCB Replacement Date", "m2", "date", true, "Required because a replacement is needed."], ["pvl_letter", "PVL Letter", "m2", "file", true, null], ["pvl_received_date", "PVL Received Date", "m2", "date", true, null], ["pre_inspection_date", "Pre-Inspection Date", "m3", "date", true, null], ["sp_appointment_letter", "SP Appointment Letter", "m3", "file", true, null], ["sp_appointment_letter_received_date", "Appointment Letter Received", "m3", "date", true, null], ["meter_replacement_date", "Meter Replacement Date", "m3", "date", false, null], ["sp_turn_on_inspection_date", "SP Turn-On Inspection Date", "m3", "date", true, null], ["as_built_pv_layout", "As-Built PV Layout", "post", "file", true, null], ["final_submission_documents", "Final Submission Documents", "post", "file", true, null], ["handover_docs", "Handover Docs to Homeowner", "post", "file", true, null], ["fusion_solar_app_access", "FusionSolar App Access", "post", "yesno", true, null], ["fusion_solar_access", "FusionSolar Access Document", "post", "file", true, null], ["completion_form_signed", "Completion Form Signed", "post", "file", true, null]];
const FIELD_GROUPS: Array<[string, string, string]> = [["pre1", "Before Milestone 1", "Admin / EPC · utilities & SP application"], ["pre1b", "Pre-end of Milestone 1", "Admin · survey, panels & inverter"], ["m1", "Milestone 1", "Installation & scaffolding removal"], ["m2", "Milestone 2", "Inverter commissioning & grid"], ["m3", "Milestone 3", "Inspection & appointment letter"], ["post", "Post Milestone 3", "Closing documents & handover"]];
const SECTION_MS: Record<string, number> = { pre1: 1, pre1b: 1, m1: 1, m2: 2, m3: 3, post: 3 };

/** Sample values: Milestone 1 complete, Milestone 2 under way. */
const SAMPLE_VALUES: Record<string, unknown> = {
  electricity_retailer_id: { id: 1, name: "SP Group" },
  "homeowner.ic_last4": "Recorded",
  "homeowner.email": "jasmine@example.com",
  sp_application_status: 2,
  sales: "K. Chandra · Q2-2026-118",
  waterproofing: true,
  create_group_chat: true,
  panel_quantity_estimate: 20,
  panel_capacity: 610,
  inverter_to_order: "Huawei SUN2000-10KTL-M1",
  inverter_collected: true,
  inverter_serial_number: "HW2K-10KTL-8843921",
  current_stage: 2,
  installation_end_date: day(-6),
  scaffolding_removal: true,
  scaffolding_removal_date: day(-5),
  sp_submission_date: day(-4),
  sp_pending_days: "4 days",
  inverter_commission_grid_connection: false,
  commission_date: day(5),
};
const SAMPLE_FILES = ["utility_bill", "gst_proof", "sp_forms_signed", "panel_pictures", "inverter_pictures", "sp_submission_screenshot"];

function projectFields(pid: number) {
  const p = PROJECTS.find((x) => x.id === pid) ?? PROJECTS[0];
  const approved = !["draft", "awaiting_homeowner", "homeowner_declined", "homeowner_approved"].includes(p.status as string);
  const reached = p.milestone as number;
  const sections = FIELD_GROUPS.map(([key, name, sub]) => {
    const n = SECTION_MS[key];
    const lockedReason = !approved
      ? "Opens once the homeowner and a project manager have approved the project."
      : n === 2 && reached < 1
        ? "Opens once Milestone 1 is complete."
        : n === 3 && reached < 2
          ? "Opens once Milestone 2 is complete."
          : null;
    const fields = FIELD_DEFS.filter((f) => f[2] === key).map(([k, label, , kind, required, note]) => {
      const sample = approved && pid === 101;
      const value = sample ? (SAMPLE_VALUES[k] ?? null) : null;
      const files = kind === "file" || kind === "photos" ? (sample && SAMPLE_FILES.includes(k) ? [{ id: 900 + k.length, name: `${k}.pdf`, type: "application/pdf", size: 120000, at: iso(3000), by: "Priya Nair" }] : []) : null;
      const shown = k === "inverter_date" ? value !== null : k === "commission_date" ? sample : k === "rcb_breaker_replacement_date" || k === "fusion_solar_access" || k === "retailer_contract_end_date" ? false : true;
      const filled = Boolean((files && files.length) || (value !== null && kind !== "auto"));
      const recorded = sample && n === 1;
      return {
        key: k, label, kind, required: required && kind !== "auto", note, shown, filled, value, files,
        lockedReason: lockedReason ?? (kind === "auto" ? "Calculated by the system." : k === "homeowner.email" ? "From the homeowner's account." : recorded ? null : null),
      };
    });
    const need = fields.filter((f) => f.required && f.shown);
    const done = need.filter((f) => f.filled).length;
    return { key, name, sub, milestone: n, lockedReason, done, total: need.length, complete: done === need.length, fields };
  });
  return {
    relation: "pm",
    sections,
    milestoneReached: reached,
    recordedMilestones: reached >= 1 ? Array.from({ length: reached }, (_, i) => i + 1) : [],
    retailers: [{ id: 1, name: "SP Group" }, { id: 2, name: "Geneco" }, { id: 3, name: "Keppel Electric" }, { id: 4, name: "Senoko Energy" }],
    storage: "local",
    actions: { approve: p.status === "homeowner_approved", decline: false, remind: ["awaiting_homeowner", "homeowner_declined"].includes(p.status as string), editDetails: true, reopen: reached >= 1 ? [1] : [] },
  };
}


// ------------------------------------------------------------ sites

const CHECKED_IN = { id: 501, visitId: 61, by: { uid: 4, name: "Ravi Kumar" }, inAt: iso(95), crewIn: 4, distance: 38.4, outAt: null, crewOut: null, outDistance: null };
const SITES = {
  canCheckIn: true,
  sites: [
    { id: 101, name: "Jalan Kayu Residence", address: "14 Jalan Kayu, Singapore 799463", postalCode: "799463", located: true, radius: 100,
      site: { lat: 1.3966, lng: 103.873 }, today: [{ id: 61, time: "09:00", note: "Panel mounting" }], next: null, open: CHECKED_IN, canCheckIn: true },
    { id: 102, name: "Sunbird Circle", address: "8 Sunbird Circle, Singapore 488106", postalCode: "488106", located: true, radius: 100,
      site: { lat: 1.3521, lng: 103.8198 }, today: [{ id: 62, time: "14:00", note: "Pre-inspection rectification" }], next: null, open: null, canCheckIn: true },
    { id: 104, name: "Bedok Ria Terrace", address: "3 Bedok Ria, Singapore 469000", postalCode: "469000", located: false, radius: 100,
      site: null, today: [], next: { date: day(3), time: "09:00", note: "Scaffolding" }, open: null, canCheckIn: false },
  ],
};

function projectVisits(pid: number) {
  const missed = pid === 102;
  return {
    visits: [
      { id: 60, date: day(-6), time: "09:00", note: "Scaffolding erected", by: "Wei Ming Tan", state: missed ? "missed" : "attended",
        checkIns: missed ? [] : [{ ...CHECKED_IN, id: 499, inAt: iso(8640 + 60), outAt: iso(8640 - 420), crewOut: 0, outDistance: 22.1 }] },
      { id: 61, date: day(0), time: "09:00", note: "Panel mounting", by: "Priya Nair", state: "attended", checkIns: [CHECKED_IN] },
      { id: 63, date: day(4), time: "10:00", note: "Inverter commissioning", by: "Wei Ming Tan", state: "upcoming", checkIns: [] },
    ],
    unscheduled: [],
    canSchedule: true,
    canCheckIn: true,
    myOpenCheckIn: null,
    site: { located: true, radius: 100, lat: 1.3966, lng: 103.873 },
    status: "in_progress",
  };
}

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
    restoresId: null,
    reason: null,
    operationId: null,
    revertedBy: [],
    lockedReason: null,
    rowUndo: null,
    ...extra,
  };
}

const AUDIT_ENTRIES = [
  ae(432, 25, WEI, "update", "projects", "projects", "Updated project details", JALAN, [["panel_quantity_actual", 20, 18]], {
    revertsId: 412,
    reason: "Site survey confirmed 18 panels; 20 was the quote for the neighbour.",
    operationId: "7c1d",
  }),
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
  ], { rowUndo: { verb: "Remove again", kind: "revert", state: "current" } }),
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
  ae(409, 2900, CHARLOTTE, "update", "projects", "projects", "Updated project details", BEDOK, [
    ["installation_end_date", "2026-10-10", "2026-10-17", "superseded", "Changed again by Priya Nair since"],
  ]),
  ae(408, 2880, PRIYA, "update", "projects", "projects", "Updated project details", BEDOK, [["installation_end_date", "2026-10-17", "2026-10-20"]]),
  ae(407, 4400, CHARLOTTE, "update", "users", "people", "Updated account", { key: "person:8", kind: "person", id: 8, label: "Marcus Teo" }, [["active", true, false]]),
  ae(405, 4300, CHARLOTTE, "delete", "contractor_groups", "groups", "Deleted group", { key: "group:2", kind: "group", id: 2, label: "Kim Seng M&E Services" }, [
    ["name", "Kim Seng M&E Services", null],
  ], { rowUndo: { verb: "Restore", kind: "restore_record", state: "current" } }),
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

function auditPreview(body: { kind: string; auditId: number; fields?: string[]; field?: string; withRelated?: boolean }) {
  const e = AUDIT_ENTRIES.find((x) => x.id === body.auditId);
  const warn = "Emails, WhatsApps and alerts already sent about the original change stay sent.";
  if (!e) return { summary: "Revert", blockers: ["No such audit entry."], warnings: [], effects: [], expect: 0 };
  if (e.location === BEDOK)
    return {
      summary: "Revert 1 field",
      blockers: [
        "Installation end is part of Milestone 1, which was completed with its current value. Rewinding it on its own would leave a completed milestone with different data and the project's status unchanged. Reopen Milestone 1 on the project first — that is logged as its own change.",
      ],
      warnings: [warn],
      effects: [],
      expect: 433,
    };
  if (body.kind === "restore_record")
    return {
      summary: body.withRelated === false ? "Restore 1 record" : "Restore 2 records",
      blockers: [],
      warnings: [warn],
      effects: [
        { table: "contractor_groups", action: "insert", summary: "Created group", location: "Kim Seng M&E Services", changes: [{ field: "name", from: null, to: "Kim Seng M&E Services" }] },
        ...(body.withRelated === false
          ? []
          : [{ table: "contractor_group_members", action: "insert", summary: "Added Priya Nair", location: "Kim Seng M&E Services", changes: [{ field: "user_id", from: null, to: 3 }] }]),
      ],
      expect: 433,
    };
  const changes = (e.changes as Array<{ field: string; from: unknown; to: unknown }>)
    .filter((c) => (body.kind === "restore_value" ? c.field === body.field : !body.fields?.length || body.fields.includes(c.field)))
    .map((c) => (body.kind === "restore_value" ? { field: c.field, from: "HW-SUN2000-10KTL-99999", to: c.to } : { field: c.field, from: c.to, to: c.from }));
  const who = (e.actor as { name?: string } | null)?.name;
  return {
    summary: body.kind === "restore_value" ? `Restore ${changes[0]?.field.replace(/_/g, " ")}` : `Revert ${changes.length} field${changes.length === 1 ? "" : "s"}`,
    blockers: [],
    warnings: [...(who && who !== "Wei Ming Tan" ? [`${who} will be told their change was undone, with your reason.`] : []), warn],
    effects: [{ table: e.table, action: "update", summary: e.summary, location: (e.location as { label: string }).label, changes }],
    expect: 433,
  };
}

function auditHistory(id: number, field: string) {
  const at = (m: number) => iso(m);
  return {
    field,
    table: "projects",
    location: "Jalan Kayu Residence",
    exists: true,
    current: "HW-SUN2000-10KTL-99999",
    lockedReason: null,
    versions: [
      { id: 433, at: at(10), actor: WEI, deleted: false, value: "HW-SUN2000-10KTL-99999", reason: null, revertsId: null, restoresId: null },
      { id, at: at(1500), actor: PRIYA, deleted: false, value: "HW-SUN2000-10KTL-88231", reason: null, revertsId: null, restoresId: null },
      { id: 401, at: at(9000), actor: RAVI, deleted: false, value: "HW-SUN2000-8KTL-10422", reason: null, revertsId: null, restoresId: null },
    ],
    refs: AUDIT_REFS,
  };
}

function answer(method: string, path: string, search: URLSearchParams = new URLSearchParams(), body?: unknown): unknown {
  const key = `${method} ${path}`;
  if (key === "GET /projects") return { projects: PROJECTS, canCreate: true, today: day(0) };
  if (key === "GET /projects/options") return PROJECT_OPTIONS;
  if (key === "GET /projects/geocode") {
    const postal = search.get("postal") ?? "";
    return postal === "000000"
      ? { error: "OneMap found nothing." }
      : { address: `${postal === "569933" ? "53 ANG MO KIO AVENUE 3 AMK HUB" : "1 SAMPLE ROAD"} SINGAPORE ${postal}`, postalCode: postal, lat: 1.37, lng: 103.85 };
  }
  if (key === "POST /projects") return { id: 101, message: "Preview only — nothing was saved." };
  if (key === "GET /storage/check") return { mode: "r2", environment: "production", bucket: "gethomeapps-prod", ok: true, problem: null };
  if (key === "GET /sites") return SITES;
  if (key === "GET /my-files") return MY_FILES;
  if (key === "GET /all-files") return allFiles(search);
  if (key === "GET /people/locations") return LOCATIONS;
  if (key === "GET /demo/people") return DEMO_PEOPLE;
  if (key === "PATCH /me/settings") return { message: "Settings saved." };
  if (key === "GET /alerts") return { alerts: ALERTS, more: false, unread: ALERTS.filter((a) => !a.read).length };
  if (key === "POST /alerts/read") return { unread: 0 };
  if (key === "GET /push/key") return { publicKey: null, devices: 0 };
  if (key === "POST /me/mobile/send") return { sentBy: "dev", to: "•••• 4567", message: "Preview only — code shown here.", devCode: "123456" };
  const visitsFor = path.match(/^\/projects\/(\d+)\/visits$/);
  if (method === "GET" && visitsFor) return projectVisits(Number(visitsFor[1]));
  if (method !== "GET" && path.startsWith("/check-ins/")) return { message: "Preview only — nothing was saved." };
  const fieldsFor = path.match(/^\/projects\/(\d+)\/fields$/);
  if (method === "GET" && fieldsFor) return projectFields(Number(fieldsFor[1]));
  if (method !== "GET" && path.startsWith("/projects/")) return { message: "Preview only — nothing was saved." };
  const pid = path.match(/^\/projects\/(\d+)$/);
  if (method === "GET" && pid) return PROJECTS.find((x) => x.id === Number(pid[1])) ?? {};
  if (key === "POST /audit/actions/preview") return auditPreview(body as Parameters<typeof auditPreview>[0]);
  if (key === "POST /audit/actions/apply") return { message: "Preview only — nothing was saved." };
  const hist = path.match(/^\/audit\/(\d+)\/history$/);
  if (method === "GET" && hist) return auditHistory(Number(hist[1]), search.get("field") ?? "");
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
  if (key === "GET /me") return me();
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
    const sent = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const body = answer((init?.method ?? "GET").toUpperCase(), u.pathname.slice("/api/py".length), u.searchParams, sent);
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
  if (pathname.startsWith("/dev-preview/onboarding") || pathname.startsWith("/dev-preview/demo")) return <>{children}</>;
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
