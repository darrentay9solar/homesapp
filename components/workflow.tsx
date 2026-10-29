"use client";

import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";

import { d2s } from "@/components/ui";
import { ApiError, type Fetcher, useApi, useFetcher } from "@/lib/client/api";
import { isAdmin, useApp, useMe } from "@/lib/client/app-state";
import { typeByName } from "@/lib/client/files";
import { T, TR } from "@/lib/client/i18n";
import { MAX_BYTES } from "@/lib/client/uploads";
import { FIELD_LABEL, SP_OPENS, type WfItem, type WfStage, type Workflow } from "@/lib/client/workflow";
import { useFlagged } from "@/lib/client/warnings";

/** A drawing for one item: a link to upload to, the upload, then attaching it. */
async function uploadDrawing(fetcher: Fetcher, pid: number, key: string, file: File): Promise<string> {
  const type = file.type || typeByName(file.name) || "";
  if (file.size > MAX_BYTES) throw new ApiError(T("Files must be under 25 MB."), 400);
  const link = await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>(`/projects/${pid}/workflow/${key}/upload-link`, {
    method: "POST",
    json: { fileName: file.name, contentType: type, size: file.size },
  });
  const put = await fetch(link.uploadUrl, { method: "PUT", body: file, headers: link.headers });
  if (!put.ok) throw new ApiError("The upload didn't go through. Please try again.", put.status);
  const done = await fetcher<{ message: string }>(`/projects/${pid}/workflow/${key}/files`, { method: "POST", json: { key: link.key, fileName: file.name } });
  return done.message;
}

type Act = (run: () => Promise<{ message: string; workflow?: Workflow }>) => Promise<void>;

/**
 * GetApps' project workflow: the four installation stages in turn, the SP approvals alongside, and SP
 * Turn-On once both are done. Each item needs its drawing uploaded and a tick; a stage opens when the one
 * before it is complete. The project's manager and its crew work it; everyone else on it sees it.
 */
export function WorkflowPanel({ pid, onChange }: { pid: number; onChange: () => Promise<void> | void }) {
  const { data, error, reload } = useApi<Workflow>(`/projects/${pid}/workflow`);
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const act: Act = async (run) => {
    setBusy(true);
    try {
      const res = await run();
      toast(TR(res.message));
      await Promise.all([reload(), onChange()]);
    } catch (e) {
      toast(e instanceof ApiError ? TR(e.message) : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert severity="error">{TR(error.message)}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={420} />;
  const w = data;
  const isOpen = (key: string, current: boolean) => open[key] ?? current;
  const toggle = (key: string, current: boolean) => setOpen((o) => ({ ...o, [key]: !isOpen(key, current) }));
  const ctx = { pid, w, busy, act, fetcher };

  return (
    <Stack sx={{ gap: 1.5 }} data-testid="workflow">
      <Timeline w={w} />
      <StageStrip w={w} />
      {w.stages.map((s, i) => (
        <StageCard key={s.key} ctx={ctx} stage={s} n={i + 1} before={w.stages[i - 1]?.label} expanded={isOpen(s.key, s.key === w.current)} onToggle={() => toggle(s.key, s.key === w.current)} />
      ))}
      <Section
        testId="wf-sp"
        icon={<FactCheckOutlinedIcon />}
        title={T("SP Milestones")}
        sub={T("SP Group's approvals, alongside the installation")}
        state={w.sp.done ? "done" : w.sp.items.some((x) => x.open) ? "open" : "locked"}
        count={[w.sp.items.filter((x) => x.done).length, w.sp.items.length]}
        expanded={isOpen("sp", !w.sp.done && w.sp.items.some((x) => x.open))}
        onToggle={() => toggle("sp", !w.sp.done && w.sp.items.some((x) => x.open))}
      >
        {w.sp.items.map((it) => (
          <ItemRow key={it.key} ctx={ctx} item={it} hint={it.open ? null : SP_OPENS[it.key]} />
        ))}
      </Section>
      <Section
        testId="wf-turn-on"
        icon={<PowerSettingsNewRoundedIcon />}
        title={`5 · ${TR(w.final.label)}`}
        sub={T("Opens when the installation and the SP milestones are both complete")}
        state={w.final.done ? "done" : w.final.open ? "open" : "locked"}
        count={[w.final.items.filter((x) => x.done).length, w.final.items.length]}
        expanded={isOpen("sp_turn_on", w.current === "sp_turn_on" && w.final.open)}
        onToggle={() => toggle("sp_turn_on", w.current === "sp_turn_on" && w.final.open)}
      >
        {!w.final.open && (
          <Typography variant="body2" sx={{ color: "text.secondary", px: 2, py: 1.25 }}>
            {T("Opens when the installation and the SP milestones are both complete.")}
          </Typography>
        )}
        {w.final.items.map((it) => (
          <ItemRow key={it.key} ctx={ctx} item={it} hint={null} />
        ))}
      </Section>
      {w.complete && (
        <Alert severity="success" icon={<CheckCircleRoundedIcon />} data-testid="wf-complete">
          {T("Complete: every stage, the SP milestones and SP Turn-On are done.")}
        </Alert>
      )}
    </Stack>
  );
}

type Ctx = { pid: number; w: Workflow; busy: boolean; act: Act; fetcher: Fetcher };

/** Start → target completion (10 months), how far through that time is and how far the work is. */
function Timeline({ w }: { w: Workflow }) {
  const flagged = useFlagged();
  const today = new Date().toISOString().slice(0, 10);
  const span = w.startDate && w.endDate ? Date.parse(w.endDate) - Date.parse(w.startDate) : 0;
  const gone = span > 0 && w.startDate ? Math.min(100, Math.max(0, Math.round(((Date.parse(today) - Date.parse(w.startDate)) / span) * 100))) : 0;
  const late = flagged(w.lateDays > 0);
  return (
    <Card sx={{ p: 2 }} data-testid="wf-timeline">
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center", minWidth: 0 }}>
          <ScheduleRoundedIcon sx={{ color: "text.secondary", fontSize: 20 }} />
          <Typography sx={{ fontWeight: 600 }}>{T("Timeline: 10 months")}</Typography>
        </Stack>
        {w.complete ? (
          <Chip size="small" color="success" label={T("Complete")} />
        ) : late ? (
          <Chip size="small" color="error" icon={<WarningAmberRoundedIcon />} label={T("{n} days late", { n: w.lateDays })} />
        ) : (
          <Chip size="small" variant="outlined" label={TR(w.currentLabel)} />
        )}
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1, mt: 1.25 }}>
        <Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {T("Start")}
          </Typography>
          <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{w.startDate ? d2s(w.startDate) : "—"}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {T("Target completion")}
          </Typography>
          <Typography sx={{ fontWeight: 600, fontSize: 14.5, color: late ? "error.main" : "inherit" }}>{w.endDate ? d2s(w.endDate) : "—"}</Typography>
        </Box>
      </Box>
      <Stack sx={{ gap: 0.75, mt: 1.5 }}>
        <Bar label={T("Work done")} value={w.progress} color={late ? "error" : "primary"} />
        <Bar label={T("Time gone")} value={gone} color="inherit" />
      </Stack>
    </Card>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: "primary" | "error" | "inherit" }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr) 40px", gap: 1, alignItems: "center" }}>
      <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.3 }}>
        {label}
      </Typography>
      <LinearProgress variant="determinate" value={value} color={color} sx={{ height: 6, borderRadius: 3, ...(color === "inherit" ? { color: "text.disabled" } : {}) }} />
      <Typography variant="caption" sx={{ textAlign: "right", fontWeight: 600 }}>
        {value}%
      </Typography>
    </Box>
  );
}

/** The five stages as a strip (done, the current one, those ahead), with the current stage named under it. */
function StageStrip({ w }: { w: Workflow }) {
  const steps = [...w.stages.map((s) => ({ key: s.key, label: s.label, done: s.done })), { key: w.final.key, label: w.final.label, done: w.final.done }];
  const at = steps.findIndex((s) => s.key === w.current);
  return (
    <Box data-testid="wf-strip">
      <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 0.75 }}>
        {steps.map((s) => (
          <Tooltip key={s.key} title={TR(s.label)}>
            <Box sx={(t) => ({ height: 6, borderRadius: 3, bgcolor: s.done ? "primary.main" : s.key === w.current ? alpha(t.palette.primary.main, 0.45) : alpha(t.palette.text.primary, 0.08) })} />
          </Tooltip>
        ))}
      </Box>
      <Typography variant="caption" component="div" sx={{ mt: 0.5, color: "text.secondary" }}>
        {w.complete ? T("All 5 stages complete") : T("Stage {n} of 5: {stage}", { n: at + 1, stage: TR(w.currentLabel) })}
      </Typography>
    </Box>
  );
}

/** A collapsible card: its title, how many of its items are done, and whether it's open yet. */
function Section({ testId, icon, title, sub, state, count, expanded, onToggle, children }: {
  testId: string;
  icon: ReactNode;
  title: string;
  sub: string;
  state: "done" | "open" | "locked";
  count: [number, number];
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId} sx={{ overflow: "hidden" }}>
      <ButtonBase onClick={onToggle} aria-expanded={expanded} sx={{ width: "100%", textAlign: "left", px: 2, py: 1.5, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "flex-start" }}>
        <Box sx={{ color: state === "done" ? "success.main" : state === "open" ? "primary.main" : "text.disabled", display: "grid", "& svg": { fontSize: 22 } }}>
          {state === "done" ? <CheckCircleRoundedIcon /> : state === "locked" ? <LockOutlinedIcon /> : icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15.5, lineHeight: 1.3, overflowWrap: "anywhere" }}>{title}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.35 }}>
            <Box component="span" sx={{ fontWeight: 700, color: state === "done" ? "success.main" : "text.primary" }}>
              {count[0]}/{count[1]}
            </Box>
            {" · "}
            {sub}
          </Typography>
        </Box>
        <ExpandMoreRoundedIcon sx={{ color: "text.secondary", transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </ButtonBase>
      <Collapse in={expanded} unmountOnExit>
        <Divider />
        <Box sx={{ py: 0.5 }}>{children}</Box>
      </Collapse>
    </Card>
  );
}

function StageCard({ ctx, stage: s, n, before, expanded, onToggle }: { ctx: Ctx; stage: WfStage; n: number; before?: string; expanded: boolean; onToggle: () => void }) {
  const office = isAdmin(useMe()?.role);
  const plain = s.items.filter((i) => !i.endorsed);
  const endorsed = s.items.filter((i) => i.endorsed);
  const all = s.items.length + s.checklist.length;
  const done = s.items.filter((i) => i.done).length + s.checklist.filter((c) => c.done).length;
  const works = s.checklistKind === "mechanical" ? T("Mechanical Works checklist") : T("Electrical Works checklist");
  return (
    <Section
      testId={`wf-stage-${s.key}`}
      icon={<RadioButtonUncheckedRoundedIcon />}
      title={`${n} · ${TR(s.label)}`}
      sub={s.done ? T("Complete") : s.open ? T("Open: upload each drawing and tick it") : T("Opens when {stage} is complete.", { stage: TR(before ?? "") })}
      state={s.done ? "done" : s.open ? "open" : "locked"}
      count={[done, all]}
      expanded={expanded}
      onToggle={onToggle}
    >
      {plain.map((it) => (
        <ItemRow key={it.key} ctx={ctx} item={it} hint={null} />
      ))}
      {endorsed.length > 0 && (
        <>
          <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", px: 2, pt: 1.5, pb: 0.5, color: "text.secondary" }}>
            <VerifiedOutlinedIcon sx={{ fontSize: 17 }} />
            <Typography variant="overline" sx={{ lineHeight: 1.4 }}>
              {T("With Applicable PE/LEW Endorsements")}
            </Typography>
          </Stack>
          {endorsed.map((it) => (
            <ItemRow key={it.key} ctx={ctx} item={it} hint={null} />
          ))}
        </>
      )}
      {s.checklistKind && (
        <>
          <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", px: 2, pt: 1.5, pb: 0.5, color: "text.secondary" }}>
            <FactCheckOutlinedIcon sx={{ fontSize: 17 }} />
            <Typography variant="overline" sx={{ lineHeight: 1.4 }}>
              {works}
            </Typography>
          </Stack>
          {!s.checklistLoaded ? (
            <Typography variant="body2" sx={{ color: "text.secondary", px: 2, pb: 1.25 }} data-testid={`wf-no-checklist-${s.checklistKind}`}>
              {T("The checklist hasn't been uploaded yet.")}{" "}
              {office && (
                <Box component={Link} href="/groups?tab=checklists" sx={{ color: "primary.main", fontWeight: 600 }}>
                  {T("Upload it from Excel")}
                </Box>
              )}
            </Typography>
          ) : (
            s.checklist.map((c) => (
              <Stack key={c.key} direction="row" sx={{ alignItems: "flex-start", gap: 0.5, px: 1, py: 0.25 }}>
                <Checkbox
                  size="small"
                  checked={c.done}
                  disabled={!ctx.w.canWork || !c.open || ctx.busy}
                  onChange={() =>
                    void ctx.act(() => ctx.fetcher(`/projects/${ctx.pid}/workflow/${c.key}/done`, { method: c.done ? "DELETE" : "POST", json: c.done ? undefined : {} }))
                  }
                  slotProps={{ input: { "aria-label": c.label } }}
                />
                <Typography variant="body2" sx={{ pt: 1, lineHeight: 1.4, color: c.done ? "text.secondary" : "text.primary", minWidth: 0, overflowWrap: "anywhere" }}>
                  {c.label}
                </Typography>
              </Stack>
            ))
          )}
        </>
      )}
    </Section>
  );
}

/** One item: its drawing(s), the inverters' serial number and size, and its tick. */
function ItemRow({ ctx, item: it, hint }: { ctx: Ctx; item: WfItem; hint: string | null }) {
  const flagged = useFlagged();
  const input = useRef<HTMLInputElement>(null);
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...it.data }));
  const can = ctx.w.canWork && it.open && !ctx.busy;
  const full = it.maxFiles !== null && it.files.length >= it.maxFiles;
  const missing = it.fields.filter((f) => !(vals[f] ?? "").trim());
  const overdue = flagged(Boolean(it.overdue));
  return (
    <Box sx={{ px: 2, py: 1.25, "& + &": { borderTop: 1, borderColor: "divider" } }} data-testid={`wf-item-${it.key}`}>
      <Stack direction="row" sx={{ gap: 1.25, alignItems: "flex-start" }}>
        <Box sx={{ color: it.done ? "success.main" : it.open ? "text.secondary" : "text.disabled", display: "grid", mt: "1px", "& svg": { fontSize: 20 } }}>
          {it.done ? <CheckCircleRoundedIcon /> : it.open ? <RadioButtonUncheckedRoundedIcon /> : <LockOutlinedIcon />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.35, color: it.open || it.done ? "text.primary" : "text.secondary" }}>{TR(it.label)}</Typography>
          {it.done && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {T("Done {when} by {name}", { when: it.doneAt ? d2s(it.doneAt) : "", name: it.doneBy ?? "—" })}
            </Typography>
          )}
          {hint && !it.done && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {T(hint)}
            </Typography>
          )}
          {it.dueOn && !it.done && (
            <Typography variant="caption" sx={{ color: overdue ? "error.main" : "text.secondary", fontWeight: overdue ? 700 : 400, display: "block" }} data-testid="wf-due">
              {overdue ? T("Overdue: was due {date}", { date: d2s(it.dueOn) }) : T("Due {date}", { date: d2s(it.dueOn) })}
            </Typography>
          )}
          {it.maxFiles === 1 && !it.done && it.open && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {T("One picture.")}
            </Typography>
          )}
          {it.files.length > 0 && (
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", mt: 0.75 }}>
              {it.files.map((f) => (
                <Chip
                  key={f.id}
                  size="small"
                  variant="outlined"
                  icon={<AttachFileRoundedIcon />}
                  label={f.name}
                  component="a"
                  href={`/api/py/files/${f.id}`}
                  target="_blank"
                  rel="noopener"
                  clickable
                  onDelete={can && !it.done ? () => void ctx.act(() => ctx.fetcher(`/projects/${ctx.pid}/workflow/${it.key}/files/${f.id}`, { method: "DELETE" })) : undefined}
                  sx={{ maxWidth: "100%" }}
                />
              ))}
            </Stack>
          )}
          {it.fields.length > 0 &&
            (it.done ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {it.fields.map((f) => `${T(FIELD_LABEL[f])}: ${it.data[f] ?? "—"}`).join(" · ")}
              </Typography>
            ) : (
              it.open &&
              ctx.w.canWork && (
                <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: "wrap", "& > *": { flex: "1 1 140px", minWidth: 0 } }}>
                  {it.fields.map((f) => (
                    <TextField key={f} size="small" label={T(FIELD_LABEL[f])} value={vals[f] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f]: e.target.value }))} slotProps={{ htmlInput: { maxLength: 60, "data-testid": `wf-field-${f}` } }} />
                  ))}
                </Stack>
              )
            ))}
          {ctx.w.canWork && (it.open || it.done) && (
            <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: "wrap" }}>
              {!it.done && (
                <>
                  <input
                    ref={input}
                    type="file"
                    hidden
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void ctx.act(async () => ({ message: await uploadDrawing(ctx.fetcher, ctx.pid, it.key, file) }));
                    }}
                  />
                  <Button size="small" variant="outlined" startIcon={<UploadFileRoundedIcon />} disabled={!can || full} onClick={() => input.current?.click()} data-testid={`wf-upload-${it.key}`}>
                    {it.maxFiles === 1 ? T("Upload picture") : T("Upload drawing")}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!can || it.files.length === 0 || missing.length > 0}
                    onClick={() => void ctx.act(() => ctx.fetcher(`/projects/${ctx.pid}/workflow/${it.key}/done`, { method: "POST", json: { data: vals } }))}
                    data-testid={`wf-tick-${it.key}`}
                  >
                    {T("Mark done")}
                  </Button>
                </>
              )}
              {it.done && (
                <Button size="small" color="inherit" disabled={ctx.busy} onClick={() => void ctx.act(() => ctx.fetcher(`/projects/${ctx.pid}/workflow/${it.key}/done`, { method: "DELETE" }))} data-testid={`wf-untick-${it.key}`}>
                  {T("Undo")}
                </Button>
              )}
            </Stack>
          )}
          {!it.done && it.open && ctx.w.canWork && it.files.length === 0 && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
              {T("Upload the drawing, then mark it done.")}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
