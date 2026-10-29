/**
 * GetApps (9 Solar Fintech): a project's workflow and the groups of projects, as the API sends them
 * (api/_lib/workflow.py, api/_routes/workflow.py, docs/getapps-workflow.md). 9 Solar Home's app doesn't use it.
 */

export type WfFile = { id: number; name: string; type: string; at: string | null };

export type WfItem = {
  key: string;
  label: string;
  /** Shown under "With Applicable PE/LEW Endorsements". */
  endorsed: boolean;
  /** Entered with it: the inverters' serial number and size. */
  fields: string[];
  /** The inverters: one picture. */
  maxFiles: number | null;
  open: boolean;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  data: Record<string, string>;
  note: string | null;
  files: WfFile[];
  /** The Connection Agreement: due a week after the PV2 letter. */
  dueOn?: string;
  overdue?: boolean;
};

export type WfCheck = { key: string; label: string; done: boolean; open: boolean };

export type WfStage = {
  key: string;
  label: string;
  open: boolean;
  done: boolean;
  items: WfItem[];
  checklist: WfCheck[];
  checklistKind: "mechanical" | "electrical" | null;
  checklistLoaded: boolean;
};

export type Workflow = {
  stages: WfStage[];
  sp: { items: WfItem[]; done: boolean };
  final: { key: string; label: string; open: boolean; done: boolean; items: WfItem[] };
  complete: boolean;
  current: string;
  currentLabel: string;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  lateDays: number;
  /** The project's manager or its crew: they upload and tick. */
  canWork: boolean;
};

/** The stages, in order, then "complete": the projects list's tabs and the groups' figures. */
export const STAGES: Array<[string, string]> = [
  ["pre_install", "Pre-Installation"],
  ["mechanical", "Mechanical Installation"],
  ["electrical", "Electrical Installation"],
  ["commissioning", "Commissioning"],
  ["sp_turn_on", "SP Turn-On"],
  ["complete", "Completed"],
];

/** What opens each SP approval (as api/_lib/workflow.py SP_TRACK). */
export const SP_OPENS: Record<string, string> = {
  cs1_application: "Opens when Pre-Installation is complete.",
  pv1_letter: "Opens after the CS1 application.",
  pq_submission: "Opens when Electrical Installation is complete.",
  pv2_letter: "Opens after the PQ submission.",
  connection_agreement: "Due a week after the PV2 letter.",
};

export const FIELD_LABEL: Record<string, string> = { serial: "Inverter serial no.", size: "Inverter size" };

export type GroupFigures = {
  projects: number;
  complete: number;
  late: number;
  progress: number;
  byStage: Record<string, number>;
  sp: Record<string, number>;
  byPhase: Record<string, number>;
};

export type Phase = { id: number; name: string; sort: number };

export type ProjectGroup = {
  id: number;
  name: string;
  contractRef: string | null;
  client: string | null;
  notes: string | null;
  phases: Phase[];
  figures: GroupFigures;
};

export type GroupList = { groups: ProjectGroup[]; canManage: boolean };

export type GroupProject = {
  id: number;
  name: string;
  address: string;
  postalCode: string | null;
  phaseId: number | null;
  pm: string | null;
  stage: string;
  stageLabel: string;
  progress: number;
  complete: boolean;
  lateDays: number;
  startDate: string | null;
  endDate: string | null;
  sp: Record<string, boolean>;
};

export type GroupDetail = ProjectGroup & {
  projects: GroupProject[];
  stages: Array<{ key: string; label: string }>;
  spItems: Array<{ key: string; label: string }>;
  canManage: boolean;
};

export type Checklists = Record<"mechanical" | "electrical", { label: string; items: Array<{ id: number; label: string }>; file: string | null }>;

/** A group's projects narrowed by its filters: phase, stage, an SP approval done or not, late, and words. */
export type GroupFilter = { phase: string; stage: string; sp: string; spDone: string; late: string; q: string };
export const NO_FILTER: GroupFilter = { phase: "", stage: "", sp: "", spDone: "", late: "", q: "" };

export function filterGroupProjects(rows: GroupProject[], f: GroupFilter): GroupProject[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (p) =>
      (!f.phase || (f.phase === "none" ? p.phaseId === null : String(p.phaseId) === f.phase)) &&
      (!f.stage || p.stage === f.stage) &&
      (!f.sp || !f.spDone || p.sp[f.sp] === (f.spDone === "done")) &&
      (!f.late || (f.late === "late" ? p.lateDays > 0 : p.lateDays === 0)) &&
      words.every((w) => [p.name, p.address, p.postalCode ?? "", p.pm ?? ""].join(" ").toLowerCase().includes(w))
  );
}

/** A file as base64, for the checklist sheets (small Excel files sent with the request). */
export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
