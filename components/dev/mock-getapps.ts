/**
 * DEVELOPMENT ONLY: GetApps' (9 Solar Fintech) workflow, groups and Works checklists, for the dev preview
 * run with NEXT_PUBLIC_EDITION=fintech (the getapps-web launch configuration).
 */

const now = Date.now();
const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offset: number) => new Date(now + offset * 86_400_000).toISOString();

type Def = { key: string; label: string; endorsed?: boolean; fields?: string[]; maxFiles?: number };
const STAGES: Array<{ key: string; label: string; checklist: "mechanical" | "electrical" | null; items: Def[] }> = [
  { key: "pre_install", label: "Pre-Installation", checklist: null, items: [
    { key: "ifc_pv_layout", label: "IFC PV Layout" }, { key: "pv_system", label: "PV System" },
    { key: "single_line_diagram", label: "Single Line Diagram" }, { key: "structure_drawing", label: "Structure Drawing" },
  ] },
  { key: "mechanical", label: "Mechanical Installation", checklist: "mechanical", items: [
    { key: "solar_panels", label: "Solar Panels" }, { key: "as_built_pvl", label: "As-Built PVL", endorsed: true },
    { key: "railings", label: "Applicable Railings", endorsed: true },
  ] },
  { key: "electrical", label: "Electrical Installation", checklist: "electrical", items: [
    { key: "pvdb", label: "PVDB" }, { key: "isolators", label: "Isolators" },
    { key: "inverters", label: "Inverters", fields: ["serial", "size"], maxFiles: 1 },
    { key: "msb_modules", label: "Electrical MSB Modules" },
    { key: "as_built_pvsl", label: "As-Built PVSL", endorsed: true }, { key: "as_built_sld", label: "As-Built Single Line Diagram", endorsed: true },
  ] },
  { key: "commissioning", label: "Commissioning", checklist: null, items: [
    { key: "pre_commissioning_report", label: "Pre-Commissioning Report" }, { key: "scdf_final_acceptance", label: "SCDF Final Acceptance" },
  ] },
]; // prettier-ignore
const SP: Def[] = [
  { key: "cs1_application", label: "CS1 Application" },
  { key: "pv1_letter", label: "PV1 Letter" },
  { key: "pq_submission", label: "PQ Submission" },
  { key: "pv2_letter", label: "PV2 Letter" },
  { key: "connection_agreement", label: "Connection Agreement" },
];
const FINAL: Def[] = [
  { key: "sp_turn_on", label: "SP Turn-On" },
  { key: "qa_qc_checklist", label: "QA/QC Checklist" },
];
const CHECKLISTS = {
  mechanical: ["Mounting structure fixed to engineer's drawing", "Rail spacing and clamps checked", "Roof penetrations sealed", "Module earthing bonded", "Cable trays and conduits secured"],
  electrical: ["DC string polarity tested", "Insulation resistance tested", "Isolators labelled", "Inverter earthing verified", "MSB breaker rating checked", "AC cabling terminated and torqued"],
};
const CHECK_IDS = { mechanical: 11, electrical: 31 };

/** How far each sample project has got: items done, in order. */
const PROGRESS: Record<number, number> = { 101: 15, 102: 9, 103: 2, 104: 24, 105: 31, 106: 36, 107: 40, 108: 4, 109: 0 };
const START: Record<number, number> = { 101: -150, 102: -320, 103: -20, 104: -200, 105: -240, 106: -260, 107: -280, 108: -40, 109: -2 };

function ordered() {
  // The order work gets done in: Pre-Installation, then CS1/PV1, Mechanical, Electrical, PQ/PV2, Commissioning, CA, Turn-On.
  const keys: string[] = [];
  const stage = (i: number) => {
    keys.push(...STAGES[i].items.map((x) => x.key));
    const c = STAGES[i].checklist;
    if (c) keys.push(...CHECKLISTS[c].map((_, n) => `check:${CHECK_IDS[c] + n}`));
  };
  stage(0);
  keys.push("cs1_application", "pv1_letter");
  stage(1);
  stage(2);
  keys.push("pq_submission", "pv2_letter");
  stage(3);
  keys.push("connection_agreement", "sp_turn_on", "qa_qc_checklist");
  return keys;
}
const ORDER = ordered();

export function mockWorkflow(pid: number) {
  const n = PROGRESS[pid] ?? 6;
  const done = new Set(ORDER.slice(0, n));
  const startOff = START[pid] ?? -60;
  const item = (d: Def, open: boolean, i: number) => ({
    key: d.key,
    label: d.label,
    endorsed: Boolean(d.endorsed),
    fields: d.fields ?? [],
    maxFiles: d.maxFiles ?? null,
    open,
    done: done.has(d.key),
    doneAt: done.has(d.key) ? at(startOff + 10 + i * 6) : null,
    doneBy: done.has(d.key) ? "Ravi Kumar" : null,
    data: done.has(d.key) && d.fields ? { serial: "HW2260KTL-7731", size: "50 kW" } : {},
    note: null,
    files: done.has(d.key) || (open && i % 3 === 0) ? [{ id: 900 + i, name: `${d.label.replace(/\W+/g, "-")}.pdf`, type: "application/pdf", at: at(startOff + 8 + i * 6) }] : [],
  });
  let prev = true;
  let i = 0;
  const stageDone: Record<string, boolean> = {};
  const stages = STAGES.map((s) => {
    const open = prev;
    const items = s.items.map((d) => item(d, open, i++));
    const checklist = s.checklist
      ? CHECKLISTS[s.checklist].map((label, k) => {
          const key = `check:${CHECK_IDS[s.checklist!] + k}`;
          return { key, label, done: done.has(key), open };
        })
      : [];
    const all = items.every((x) => x.done) && checklist.every((c) => c.done);
    stageDone[s.key] = all;
    prev = all;
    return { key: s.key, label: s.label, open, done: all, items, checklist, checklistKind: s.checklist, checklistLoaded: Boolean(s.checklist) };
  });
  const spOpen = (k: string) =>
    ({ cs1_application: stageDone.pre_install, pv1_letter: done.has("cs1_application"), pq_submission: stageDone.electrical, pv2_letter: done.has("pq_submission"), connection_agreement: done.has("pv2_letter") })[k] ?? false;
  const sp = SP.map((d) => {
    const x: Record<string, unknown> = item(d, spOpen(d.key), i++);
    if (d.key === "connection_agreement" && done.has("pv2_letter")) {
      const due = day(-12);
      x.dueOn = due;
      x.overdue = !done.has(d.key);
    }
    return x;
  });
  const spDone = SP.every((d) => done.has(d.key));
  const finalOpen = Object.values(stageDone).every(Boolean) && spDone;
  const final = FINAL.map((d) => item(d, finalOpen, i++));
  const complete = finalOpen && final.every((x) => x.done);
  const current = stages.find((s) => !s.done)?.key ?? (complete ? "complete" : "sp_turn_on");
  const start = day(startOff);
  const endD = new Date(`${start}T00:00:00Z`);
  endD.setUTCMonth(endD.getUTCMonth() + 10);
  const end = endD.toISOString().slice(0, 10);
  const lateDays = !complete && end < day(0) ? Math.round((now - Date.parse(end)) / 86_400_000) : 0;
  const label = { pre_install: "Pre-Installation", mechanical: "Mechanical Installation", electrical: "Electrical Installation", commissioning: "Commissioning", sp_turn_on: "SP Turn-On", complete: "Complete" }[current]!;
  return {
    stages,
    sp: { items: sp, done: spDone },
    final: { key: "sp_turn_on", label: "SP Turn-On", open: finalOpen, done: complete, items: final },
    complete,
    current,
    currentLabel: label,
    progress: Math.round((Math.min(n, ORDER.length) * 100) / ORDER.length),
    startDate: start,
    endDate: end,
    lateDays,
    canWork: true,
  };
}

const GROUP_OF: Record<number, [number, number | null]> = { 101: [1, 1], 102: [1, 1], 103: [1, 2], 104: [1, 2], 105: [2, 3], 106: [2, 3], 107: [2, 4], 108: [3, null], 109: [3, null] };
const GROUPS = [
  { id: 1, name: "Tampines Industrial Rooftops", contractRef: "9SF-C-2026-014", client: "JTC Corporation", notes: "Twelve factory roofs across two phases.", phases: [{ id: 1, name: "Phase 1", sort: 0 }, { id: 2, name: "Phase 2", sort: 1 }] },
  { id: 2, name: "Jurong West Schools", contractRef: "9SF-C-2026-021", client: "MOE Facilities", notes: null, phases: [{ id: 3, name: "Phase 1", sort: 0 }, { id: 4, name: "Phase 2", sort: 1 }] },
  { id: 3, name: "Changi Logistics Park", contractRef: null, client: "Changi Warehousing Pte Ltd", notes: null, phases: [] },
];

/** A sample project's row as GetApps sends it: its stage, progress and timing from the workflow, and its group. */
export function getappsRow<P extends { id: number; flags: unknown[] }>(p: P) {
  const w = mockWorkflow(p.id);
  const [gid, phid] = GROUP_OF[p.id] ?? [null, null];
  const g = GROUPS.find((x) => x.id === gid);
  const flags = [
    ...(w.lateDays ? [{ kind: "overdue", text: `Past its 10 months by ${w.lateDays} days` }] : []),
    ...((w.sp.items.find((x) => x.key === "connection_agreement") as { overdue?: boolean } | undefined)?.overdue ? [{ kind: "sp", text: "Connection Agreement overdue (due a week after the PV2 letter)" }] : []),
  ];
  return {
    ...p,
    status: "in_progress",
    statusLabel: "In Progress",
    homeowner: { uid: null, name: ["JTC Corporation", "MOE Facilities", "Changi Warehousing"][(gid ?? 1) - 1] ?? "Client", linked: false },
    team: (p as unknown as { team: Array<{ role: string }> }).team.filter((t) => t.role !== "homeowner"),
    startDate: w.startDate,
    endDate: w.endDate,
    daysElapsed: Math.max(0, Math.round((now - Date.parse(w.startDate)) / 86_400_000)),
    progress: w.progress,
    stage: w.current,
    stageLabel: w.currentLabel,
    complete: w.complete,
    flags,
    attention: flags.length > 0,
    toFill: 0,
    imported: false,
    group: g ? { id: g.id, name: g.name } : null,
    phase: g && phid ? { id: phid, name: g.phases.find((x) => x.id === phid)!.name } : null,
  };
}

const NAMES: Record<number, string> = { 101: "Tampines Ave 5 · Block A", 102: "Tampines Ave 5 · Block B", 103: "Tampines St 92 Warehouse", 104: "Tampines Loop Factory", 105: "Jurong West Primary", 106: "Westwood Secondary", 107: "Jurong West Sports Hall", 108: "Changi South Lane DC", 109: "Changi North Rise Hub" };

function lines(gid: number) {
  return Object.entries(GROUP_OF)
    .filter(([, [g]]) => g === gid)
    .map(([id, [, phid]]) => {
      const pid = Number(id);
      const w = mockWorkflow(pid);
      return {
        id: pid, name: NAMES[pid], address: `${pid} Sample Road, Singapore 5${pid}00`, postalCode: `5${pid}00`, phaseId: phid, pm: "Wei Ming Tan",
        stage: w.current, stageLabel: w.currentLabel, progress: w.progress, complete: w.complete, lateDays: w.lateDays,
        startDate: w.startDate, endDate: w.endDate, sp: Object.fromEntries(w.sp.items.map((x) => [x.key as string, Boolean(x.done)])),
      };
    }); // prettier-ignore
}

function figures(gid: number, phases: Array<{ id: number }>) {
  const ls = lines(gid);
  const stages = ["pre_install", "mechanical", "electrical", "commissioning", "sp_turn_on", "complete"];
  return {
    projects: ls.length,
    complete: ls.filter((x) => x.complete).length,
    late: ls.filter((x) => x.lateDays > 0).length,
    progress: ls.length ? Math.round(ls.reduce((a, x) => a + x.progress, 0) / ls.length) : 0,
    byStage: Object.fromEntries(stages.map((k) => [k, ls.filter((x) => x.stage === k).length])),
    sp: Object.fromEntries(SP.map((d) => [d.key, ls.filter((x) => x.sp[d.key]).length])),
    byPhase: Object.fromEntries(phases.map((ph) => [ph.id, ls.filter((x) => x.phaseId === ph.id).length])),
  };
}

export function mockGroups() {
  return { groups: GROUPS.map((g) => ({ ...g, figures: figures(g.id, g.phases) })), canManage: true };
}

export function mockGroup(gid: number) {
  const g = GROUPS.find((x) => x.id === gid) ?? GROUPS[0];
  return {
    ...g,
    figures: figures(g.id, g.phases),
    projects: lines(g.id),
    stages: [["pre_install", "Pre-Installation"], ["mechanical", "Mechanical Installation"], ["electrical", "Electrical Installation"], ["commissioning", "Commissioning"], ["sp_turn_on", "SP Turn-On"], ["complete", "Complete"]].map(([key, label]) => ({ key, label })),
    spItems: SP.map((d) => ({ key: d.key, label: d.label })),
    canManage: true,
  };
}

export function mockChecklists() {
  return {
    mechanical: { label: "Mechanical Works", items: CHECKLISTS.mechanical.map((label, k) => ({ id: CHECK_IDS.mechanical + k, label })), file: "Mechanical Works checklist.xlsx" },
    electrical: { label: "Electrical Works", items: CHECKLISTS.electrical.map((label, k) => ({ id: CHECK_IDS.electrical + k, label })), file: "Electrical Works checklist.xlsx" },
  };
}

export { NAMES as GETAPPS_NAMES };
