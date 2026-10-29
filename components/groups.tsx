"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import FolderSpecialOutlinedIcon from "@mui/icons-material/FolderSpecialOutlined";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import TagRoundedIcon from "@mui/icons-material/TagRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";

import { Field, MDialog } from "@/components/m";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { isAdmin, useApp, useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { type Checklists, type GroupFigures, type Phase, type ProjectGroup, STAGES, toBase64 } from "@/lib/client/workflow";

/** Runs a change, says what happened, and reloads. */
export function useAct() {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const act = async (path: string, init: { method: string; json?: unknown }, after?: () => Promise<unknown> | void): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fetcher<{ message: string }>(path, init);
      toast(TR(r.message));
      await after?.();
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? TR(e.message) : T("Something went wrong. Please try again."), "bad");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { act, busy };
}

/** The figures across a group's projects (or every group's): how many, completed, late, and the average progress. */
export function FigureTiles({ f }: { f: Pick<GroupFigures, "projects" | "complete" | "late" | "progress"> }) {
  const tiles: Array<[string, string, boolean]> = [
    ["Projects", String(f.projects), false],
    ["Completed", String(f.complete), false],
    ["Late", String(f.late), f.late > 0],
    ["Average progress", `${f.progress}%`, false],
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" }, gap: 1.25 }} data-testid="group-figures">
      {tiles.map(([k, v, bad]) => (
        <Card key={k} sx={{ p: 1.75, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.3 }}>
            {T(k)}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.4, color: bad ? "error.main" : "text.primary" }}>{v}</Typography>
        </Card>
      ))}
    </Box>
  );
}

/** Each stage's short name, for the bar's legend. */
const SHORT: Record<string, string> = { pre_install: "Pre-Install", mechanical: "Mechanical", electrical: "Electrical", commissioning: "Commissioning", sp_turn_on: "SP Turn-On", complete: "Completed" };

/**
 * How many projects are at each stage: one bar in steps of a single green, light (early) to dark
 * (completed), with each stage's count in the legend under it (left out where space is short).
 */
export function StageBar({ byStage, total, legend = true }: { byStage: Record<string, number>; total: number; legend?: boolean }) {
  const shade = (i: number) => (t: { palette: { primary: { main: string } } }) => alpha(t.palette.primary.main, 0.3 + (i / (STAGES.length - 1)) * 0.7);
  return (
    <Box data-testid="stage-bar">
      <Box sx={(t) => ({ display: "flex", gap: "2px", height: 12, borderRadius: 1, overflow: "hidden", bgcolor: alpha(t.palette.text.primary, 0.06) })}>
        {total > 0 &&
          STAGES.map(([key, label], i) =>
            byStage[key] ? (
              <Tooltip key={key} title={`${TR(label)}: ${byStage[key]}`}>
                <Box sx={(t) => ({ flex: byStage[key], bgcolor: shade(i)(t) })} />
              </Tooltip>
            ) : null
          )}
      </Box>
      {legend && (
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2, rowGap: 0.5, mt: 1 }}>
          {STAGES.map(([key], i) => (
            <Stack key={key} direction="row" sx={{ gap: 0.75, alignItems: "center" }}>
              <Box sx={(t) => ({ width: 10, height: 10, borderRadius: "3px", flexShrink: 0, bgcolor: shade(i)(t) })} />
              <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.3, whiteSpace: "nowrap" }}>
                {T(SHORT[key])}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {byStage[key] ?? 0}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** The SP approvals: how many of the projects have each one. */
export function SpCounts({ sp, items, total }: { sp: Record<string, number>; items: Array<{ key: string; label: string }>; total: number }) {
  return (
    <Stack sx={{ gap: 0.75 }} data-testid="sp-counts">
      {items.map((i) => (
        <Box key={i.key} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 56px", gap: 1, alignItems: "center" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.3 }}>
              {TR(i.label)}
            </Typography>
            <Box sx={(t) => ({ height: 6, borderRadius: 3, bgcolor: alpha(t.palette.text.primary, 0.08), overflow: "hidden", mt: 0.25 })}>
              <Box sx={{ height: "100%", width: `${total ? Math.round(((sp[i.key] ?? 0) / total) * 100) : 0}%`, bgcolor: "primary.main" }} />
            </Box>
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 700, textAlign: "right" }}>
            {sp[i.key] ?? 0}/{total}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

export const SP_ITEMS = [
  { key: "cs1_application", label: "CS1 Application" },
  { key: "pv1_letter", label: "PV1 Letter" },
  { key: "pq_submission", label: "PQ Submission" },
  { key: "pv2_letter", label: "PV2 Letter" },
  { key: "connection_agreement", label: "Connection Agreement" },
];

/** Create a group, or change one's details. */
export function GroupDialog({ group, onClose, onSaved }: { group?: ProjectGroup; onClose: () => void; onSaved: (id?: number) => Promise<void> | void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [f, setF] = useState({ name: group?.name ?? "", contractRef: group?.contractRef ?? "", client: group?.client ?? "", notes: group?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const bad = f.name.trim().length < 2;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    if (bad) return setTried(true);
    setBusy(true);
    try {
      const r = await fetcher<{ id?: number; message: string }>(group ? `/project-groups/${group.id}` : "/project-groups", { method: group ? "PATCH" : "POST", json: f });
      toast(TR(r.message));
      onClose();
      await onSaved(r.id);
    } catch (e) {
      toast(e instanceof ApiError ? TR(e.message) : T("Something went wrong. Please try again."), "bad");
      setBusy(false);
    }
  }
  return (
    <MDialog title={group ? T("Edit Group") : T("New Group")} heading={group ? group.name : T("A group of projects")} subtitle={T("A contract, with its projects and as many phases as it needs.")} onClose={onClose}>
      <Stack sx={{ gap: 2.5 }}>
        <Field label={T("Group name")} required icon={<FolderSpecialOutlinedIcon />} placeholder={T("e.g. the contract's name")} value={f.name} onChange={set("name")} error={tried && bad} helperText={tried && bad ? T("Give the group a name, e.g. the contract's.") : undefined} slotProps={{ htmlInput: { maxLength: 200, "data-testid": "group-name" } }} />
        <Field label={T("Contract reference")} icon={<TagRoundedIcon />} value={f.contractRef} onChange={set("contractRef")} slotProps={{ htmlInput: { maxLength: 100 } }} />
        <Field label={T("Client")} icon={<PersonOutlineRoundedIcon />} value={f.client} onChange={set("client")} slotProps={{ htmlInput: { maxLength: 200 } }} />
        <Field label={T("Notes")} icon={<NotesRoundedIcon />} multiline minRows={2} value={f.notes} onChange={set("notes")} slotProps={{ htmlInput: { maxLength: 2000 } }} />
      </Stack>
      <Button fullWidth size="large" variant="contained" disabled={busy} sx={{ mt: 3 }} onClick={() => void save()} data-testid="group-save">
        {group ? T("Save Changes") : T("Create group")}
      </Button>
    </MDialog>
  );
}

/** A group's phases: how many projects are in each, and (the office) add, rename or remove one. */
export function Phases({ gid, phases, counts, manage, onChanged }: { gid: number; phases: Phase[]; counts: Record<string, number>; manage: boolean; onChanged: () => Promise<void> | void }) {
  const { act, busy } = useAct();
  const [editing, setEditing] = useState<Phase | "new" | null>(null);
  const [name, setName] = useState("");
  const open = (ph: Phase | "new") => {
    setEditing(ph);
    setName(ph === "new" ? T("Phase {n}", { n: phases.length + 1 }) : ph.name);
  };
  return (
    <Box data-testid="phases">
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
        {phases.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {T("No phases yet.")}
          </Typography>
        )}
        {phases.map((ph) => (
          <Chip
            key={ph.id}
            label={`${ph.name} · ${counts[ph.id] ?? 0}`}
            variant="outlined"
            onClick={manage ? () => open(ph) : undefined}
            icon={manage ? <EditRoundedIcon /> : undefined}
            sx={{ maxWidth: "100%" }}
          />
        ))}
        {manage && (
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => open("new")} data-testid="phase-add">
            {T("Add phase")}
          </Button>
        )}
      </Stack>
      {editing && (
        <MDialog title={editing === "new" ? T("Add Phase") : T("Edit Phase")} onClose={() => setEditing(null)} maxWidth="xs">
          <Field label={T("Phase name")} required value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 100, "data-testid": "phase-name" } }} />
          <Button
            fullWidth
            size="large"
            variant="contained"
            disabled={busy || !name.trim()}
            sx={{ mt: 3 }}
            data-testid="phase-save"
            onClick={async () => {
              const ok = await act(editing === "new" ? `/project-groups/${gid}/phases` : `/project-phases/${editing.id}`, { method: editing === "new" ? "POST" : "PATCH", json: { name } }, onChanged);
              if (ok) setEditing(null);
            }}
          >
            {editing === "new" ? T("Add phase") : T("Save Changes")}
          </Button>
          {editing !== "new" && (
            <Button
              fullWidth
              size="large"
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              disabled={busy}
              sx={{ mt: 1 }}
              onClick={async () => {
                const ok = await act(`/project-phases/${editing.id}`, { method: "DELETE" }, onChanged);
                if (ok) setEditing(null);
              }}
            >
              {T("Remove phase")}
            </Button>
          )}
          {editing !== "new" && (
            <Typography variant="caption" component="p" sx={{ color: "text.secondary", textAlign: "center", mt: 1 }}>
              {T("Its projects stay in the group, without a phase.")}
            </Typography>
          )}
        </MDialog>
      )}
    </Box>
  );
}

/** The Mechanical and Electrical Works checklists, read from the Excel sheets the office uploads. */
export function ChecklistsPanel() {
  const { data, error, reload } = useApi<Checklists>("/workflow/checklists");
  const office = isAdmin(useMe()?.role);
  if (error) return <Alert severity="error">{TR(error.message)}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={240} />;
  return (
    <Stack sx={{ gap: 1.5 }} data-testid="checklists">
      <Alert severity="info" icon={<FactCheckOutlinedIcon />}>
        {T("Each sheet's first column is read, top to bottom: one checklist item per row. Uploading a new sheet replaces the list; items with the same wording keep the ticks already made on projects.")}
      </Alert>
      {(["mechanical", "electrical"] as const).map((k) => (
        <ChecklistCard key={k} stage={k} c={data[k]} office={office} reload={reload} />
      ))}
    </Stack>
  );
}

function ChecklistCard({ stage, c, office, reload }: { stage: "mechanical" | "electrical"; c: Checklists["mechanical"]; office: boolean; reload: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const { act, busy } = useAct();
  const [open, setOpen] = useState(false);
  return (
    <Card sx={{ p: 2 }} data-testid={`checklist-${stage}`}>
      <Stack direction="row" sx={{ gap: 1.25, alignItems: "center", flexWrap: "wrap" }}>
        <FactCheckOutlinedIcon sx={{ color: c.items.length ? "primary.main" : "text.disabled" }} />
        <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }}>{TR(c.label)}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", overflowWrap: "anywhere" }}>
            {c.items.length ? T("{n} items from {file}", { n: c.items.length, file: c.file ?? "" }) : T("Not uploaded yet")}
          </Typography>
        </Box>
        {office && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) await act(`/workflow/checklists/${stage}`, { method: "POST", json: { fileName: file.name, contentBase64: await toBase64(file) } }, reload);
              }}
            />
            <Button size="small" variant="outlined" startIcon={<UploadFileRoundedIcon />} disabled={busy} onClick={() => input.current?.click()} data-testid={`checklist-upload-${stage}`}>
              {c.items.length ? T("Replace from Excel") : T("Upload Excel")}
            </Button>
          </>
        )}
      </Stack>
      {c.items.length > 0 && (
        <>
          <Button size="small" color="inherit" startIcon={<DescriptionOutlinedIcon />} onClick={() => setOpen((o) => !o)} sx={{ mt: 1 }}>
            {open ? T("Hide items") : T("Show items")}
          </Button>
          <Collapse in={open} unmountOnExit>
            <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 3 }}>
              {c.items.map((i) => (
                <Typography key={i.id} component="li" variant="body2" sx={{ py: 0.25, overflowWrap: "anywhere" }}>
                  {i.label}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </>
      )}
    </Card>
  );
}

/** A small icon button for the office's actions on a group. */
export function GroupAction({ label, icon, onClick, testId }: { label: string; icon: React.ReactNode; onClick: () => void; testId?: string }) {
  return (
    <Tooltip title={T(label)}>
      <IconButton aria-label={T(label)} onClick={onClick} sx={{ color: "#fff" }} data-testid={testId}>
        {icon}
      </IconButton>
    </Tooltip>
  );
}
