"use client";

import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LockOpenRoundedIcon from "@mui/icons-material/LockOpenRounded";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type ReactNode, useRef, useState } from "react";

import { Field, MDialog } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { type FieldDef, type ProjectFields, type Section, showValue, SP_STATUS, type StoredFile } from "@/lib/client/projects";

type Ctx = { pid: number; data: ProjectFields; reload: () => Promise<void> };

/** One section of the brief's milestone lists: a card that opens to its fields. */
export function SectionPanel({ ctx, section: s, index, open, onToggle }: { ctx: Ctx; section: Section; index: number; open: boolean; onToggle: () => void }) {
  const homeowner = ctx.data.relation === "homeowner";
  const recorded = ctx.data.recordedMilestones.includes(s.milestone) && s.complete;
  const canReopen = ctx.data.actions.reopen.includes(s.milestone) && ["m1", "m2", "post"].includes(s.key);
  const [reopening, setReopening] = useState(false);
  const shown = s.fields.filter((f) => f.shown);
  return (
    <Card sx={{ opacity: s.lockedReason ? 0.72 : 1 }} data-testid="project-section" data-locked={Boolean(s.lockedReason) || undefined}>
      <ButtonBase onClick={onToggle} sx={{ width: "100%", textAlign: "left", fontFamily: "inherit", p: 1.75, gap: 1.5, alignItems: "center", borderRadius: `${DESIGN.radius.card}px` }} aria-expanded={open}>
        <Box
          sx={(t) => ({
            width: 32,
            height: 32,
            flex: "0 0 auto",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 13,
            color: s.complete ? "#fff" : s.lockedReason ? "text.disabled" : "primary.main",
            bgcolor: s.complete ? "primary.main" : s.lockedReason ? alpha(t.palette.text.primary, 0.06) : alpha(t.palette.primary.main, 0.12),
          })}
        >
          {s.complete ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : s.lockedReason ? <LockOutlinedIcon sx={{ fontSize: 16 }} /> : index + 1}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{s.name}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {s.lockedReason ?? `${s.done} of ${s.total} required · ${s.sub}`}
          </Typography>
        </Box>
        {s.complete ? <Chip size="small" color="success" label="Done" /> : !s.lockedReason && <Chip size="small" variant="outlined" label={`${s.total - s.done} to go`} />}
        <ExpandMoreRoundedIcon sx={{ color: "text.secondary", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Divider />
        <Stack sx={{ p: { xs: 1.75, sm: 2.25 }, gap: homeowner ? 0 : 2.5 }}>
          {shown.map((f) =>
            homeowner ? <ChecklistItem key={f.key} f={f} /> : <FieldRow key={f.key} ctx={ctx} f={f} />
          )}
          {canReopen && recorded && (
            <Button size="small" color="warning" variant="outlined" startIcon={<LockOpenRoundedIcon />} onClick={() => setReopening(true)} sx={{ alignSelf: "flex-start" }}>
              Reopen Milestone {s.milestone}
            </Button>
          )}
        </Stack>
      </Collapse>
      {reopening && <ReopenDialog ctx={ctx} n={s.milestone} onClose={() => setReopening(false)} />}
    </Card>
  );
}

/** The homeowner's view: what's done, ticked, as the brief asks. */
function ChecklistItem({ f }: { f: FieldDef }) {
  const done = f.filled || (f.kind === "auto" && f.value);
  return (
    <Stack direction="row" sx={{ gap: 1.25, py: 1, alignItems: "flex-start" }} data-testid="checklist-item">
      {done ? <CheckCircleRoundedIcon color="primary" sx={{ fontSize: 20, mt: "1px" }} /> : <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 20, mt: "1px", color: "text.disabled" }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: done ? 600 : 400, color: done ? "text.primary" : "text.secondary" }}>{f.label}</Typography>
        {f.kind === "auto" && f.value != null && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {String(f.value)}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

// ------------------------------------------------------------ one field

type SaveState = "idle" | "saving" | "saved";

function useSave(ctx: Ctx, f: FieldDef) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [state, setState] = useState<SaveState>("idle");
  async function save(value: unknown) {
    setState("saving");
    try {
      const res = await fetcher<{ message: string }>(`/projects/${ctx.pid}/fields`, { method: "PATCH", json: { key: f.key, value } });
      // A plain save shows a tick; a milestone completing is worth a message.
      if (!res.message.endsWith(" saved.")) toast(res.message);
      setState("saved");
      await ctx.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Couldn't save ${f.label}.`, "bad");
      setState("idle");
    }
  }
  return { save, state };
}

function FieldRow({ ctx, f }: { ctx: Ctx; f: FieldDef }) {
  const locked = f.lockedReason;
  const label = (
    <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, mb: 0.75 }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: "text.secondary", flex: 1, minWidth: 0 }}>
        {f.label}
        {f.required ? <Box component="span" sx={{ color: "error.main" }}> *</Box> : <Chip component="span" size="small" label="Optional" variant="outlined" sx={{ ml: 0.75, height: 18, fontSize: 10 }} />}
      </Typography>
      {f.filled && <CheckRoundedIcon sx={{ fontSize: 17, color: "primary.main" }} aria-label="Filled" />}
      {locked && (
        <Tooltip title={locked}>
          <LockOutlinedIcon sx={{ fontSize: 16, color: "text.disabled" }} aria-label={locked} />
        </Tooltip>
      )}
    </Stack>
  );

  let control: ReactNode;
  if (f.kind === "file" || f.kind === "photos") control = <FileSlot ctx={ctx} f={f} />;
  else if (locked || f.kind === "auto") control = <ReadOnly f={f} />;
  else if (f.kind === "yesno") control = <YesNo ctx={ctx} f={f} />;
  else if (f.kind === "select") control = <SpStatus ctx={ctx} f={f} />;
  else if (f.kind === "retailer") control = <Retailer ctx={ctx} f={f} />;
  else control = <Typed ctx={ctx} f={f} />;

  return (
    <Box data-testid="project-field" data-key={f.key}>
      {label}
      {control}
      {f.note && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
          {f.note}
        </Typography>
      )}
    </Box>
  );
}

function ReadOnly({ f }: { f: FieldDef }) {
  const v = showValue(f);
  return (
    <Box sx={(t) => ({ minHeight: DESIGN.height.field, px: 1.75, display: "flex", alignItems: "center", gap: 1, borderRadius: `${DESIGN.radius.field}px`, bgcolor: alpha(t.palette.text.primary, 0.04), border: 1, borderColor: "divider" })}>
      <Typography sx={{ fontSize: 15, color: v ? "text.primary" : "text.disabled", overflowWrap: "anywhere" }}>{v || (f.kind === "auto" ? "Calculated once there's a date" : "Not filled in")}</Typography>
      {f.kind === "auto" && <Chip size="small" variant="outlined" label="Auto" sx={{ ml: "auto" }} />}
    </Box>
  );
}

function Status({ state }: { state: SaveState }) {
  if (state === "saving") return <CircularProgress size={16} />;
  if (state === "saved") return <CheckRoundedIcon sx={{ fontSize: 18, color: "primary.main" }} />;
  return null;
}

/** Text, numbers, dates and the homeowner's IC: saved when you leave the field (or press Enter). */
function Typed({ ctx, f }: { ctx: Ctx; f: FieldDef }) {
  const { save, state } = useSave(ctx, f);
  const ic = f.key === "homeowner.ic_last4";
  const initial = ic ? "" : f.value == null ? "" : String(f.value);
  const [text, setText] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setText(initial);
  }
  const commit = () => {
    if (text === initial && !(ic && text)) return;
    void save(f.kind === "number" ? (text === "" ? null : Number(text)) : text);
  };
  return (
    <Field
      type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"}
      value={text}
      placeholder={ic ? (f.value ? "Recorded · type to replace" : "e.g. 567D") : f.kind === "number" ? "0" : ""}
      onChange={(e) => {
        setText(e.target.value);
        if (f.kind === "date" && e.target.value && e.target.value !== initial) void save(e.target.value);
      }}
      onBlur={f.kind === "date" ? undefined : commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      helperText={ic ? "Only the last 4 characters, e.g. 567D. Stored privately and never shown again." : undefined}
      slotProps={{
        htmlInput: { inputMode: f.kind === "number" ? "numeric" : undefined, maxLength: ic ? 4 : 200, min: f.kind === "number" ? 0 : undefined, "aria-label": f.label },
        input: { endAdornment: <Status state={state} /> },
      }}
    />
  );
}

function YesNo({ ctx, f }: { ctx: Ctx; f: FieldDef }) {
  const { save, state } = useSave(ctx, f);
  const v = f.value === true ? "yes" : f.value === false ? "no" : null;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
      <ToggleButtonGroup exclusive value={v} onChange={(_, next: string | null) => next && next !== v && void save(next === "yes")} aria-label={f.label} sx={{ flex: 1, maxWidth: 320 }}>
        <ToggleButton value="yes" sx={{ flex: 1 }} color="primary">
          Yes
        </ToggleButton>
        <ToggleButton value="no" sx={{ flex: 1 }} color="primary">
          No
        </ToggleButton>
      </ToggleButtonGroup>
      <Status state={state} />
    </Stack>
  );
}

function SpStatus({ ctx, f }: { ctx: Ctx; f: FieldDef }) {
  const { save, state } = useSave(ctx, f);
  const v = f.value === 1 || f.value === 2 ? String(f.value) : null;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
      <ToggleButtonGroup exclusive value={v} onChange={(_, next: string | null) => next && next !== v && void save(Number(next))} aria-label={f.label} sx={{ flex: 1 }}>
        {[1, 2].map((n) => (
          <ToggleButton key={n} value={String(n)} sx={{ flex: 1, fontSize: 13 }} color="primary">
            {SP_STATUS[n]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Status state={state} />
    </Stack>
  );
}

type RetailerOption = { id: number; name: string };

function Retailer({ ctx, f }: { ctx: Ctx; f: FieldDef }) {
  const { save, state } = useSave(ctx, f);
  const value = (f.value as RetailerOption | null) ?? null;
  return (
    <Autocomplete
      freeSolo
      options={ctx.data.retailers}
      value={value}
      getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
      isOptionEqualToValue={(a, b) => typeof b !== "string" && a.id === b.id}
      onChange={(_, next) => {
        if (next === null) return;
        if (typeof next === "string") void save({ name: next });
        else if (next.id !== value?.id) void save(next.id);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Choose, or type a retailer not in the list"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, "aria-label": f.label },
            input: { ...params.slotProps.input, endAdornment: (
              <>
                <Status state={state} />
                {params.slotProps.input.endAdornment}
              </>
            ) },
          }}
        />
      )}
    />
  );
}

// ------------------------------------------------------------ files

const isImage = (t: string | null) => Boolean(t && t.startsWith("image/"));

/**
 * Photos and documents. The browser asks for a five-minute upload link, sends
 * the file straight to storage, then tells the API it arrived; the API checks
 * what actually landed before recording it.
 */
function FileSlot({ ctx, f }: { ctx: Ctx; f: FieldDef }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const files = f.files ?? [];
  const canChange = !f.lockedReason;
  const many = f.kind === "photos";

  async function send(list: FileList) {
    for (const file of Array.from(list)) {
      setBusy(file.name);
      try {
        const link = await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>(`/projects/${ctx.pid}/files/upload-link`, {
          method: "POST",
          json: { category: f.key, fileName: file.name, contentType: file.type, size: file.size },
        });
        const put = await fetch(link.uploadUrl, { method: "PUT", body: file, headers: link.headers });
        if (!put.ok) throw new ApiError("The upload didn't go through. Please try again.", put.status);
        const res = await fetcher<{ message: string }>(`/projects/${ctx.pid}/files`, { method: "POST", json: { category: f.key, key: link.key, fileName: file.name } });
        toast(res.message);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : `Couldn't upload ${file.name}.`, "bad");
      }
    }
    setBusy(null);
    await ctx.reload();
  }

  async function remove(file: StoredFile) {
    if (!confirm(`Remove ${file.name}? It can be restored from the audit log.`)) return;
    try {
      const res = await fetcher<{ message: string }>(`/projects/${ctx.pid}/files/${file.id}`, { method: "DELETE" });
      toast(res.message);
      await ctx.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't remove it.", "bad");
    }
  }

  return (
    <Box>
      {files.length > 0 && (
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", mb: 1 }}>
          {files.map((file) => (
            <Box key={file.id} sx={{ position: "relative", borderRadius: `${DESIGN.radius.field}px`, overflow: "hidden", border: 1, borderColor: "divider", bgcolor: "background.default" }}>
              <Box component="a" href={`/api/py/files/${file.id}`} target="_blank" rel="noopener" sx={{ display: "block", color: "inherit", textDecoration: "none" }}>
                <Box sx={{ height: 78, display: "grid", placeItems: "center", bgcolor: "action.hover" }}>
                  {isImage(file.type) ? (
                    <Box component="img" src={`/api/py/files/${file.id}`} alt={file.name} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <PictureAsPdfOutlinedIcon sx={{ fontSize: 30, color: "error.main" }} />
                  )}
                </Box>
                <Typography noWrap sx={{ fontSize: 11.5, px: 0.75, py: 0.5 }} title={file.name}>
                  {file.name}
                </Typography>
              </Box>
              {canChange && (
                <IconButton size="small" aria-label={`Remove ${file.name}`} onClick={() => void remove(file)} sx={{ position: "absolute", top: 4, right: 4, bgcolor: "rgba(0,0,0,0.55)", color: "#fff", p: 0.25, "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
                  <CloseRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
          ))}
        </Box>
      )}
      {canChange ? (
        <ButtonBase
          onClick={() => input.current?.click()}
          disabled={Boolean(busy)}
          sx={(t) => ({ width: "100%", minHeight: DESIGN.height.field, px: 2, gap: 1, justifyContent: "flex-start", fontFamily: "inherit", borderRadius: `${DESIGN.radius.field}px`, border: `1.5px dashed ${alpha(t.palette.primary.main, 0.5)}`, color: "primary.main", bgcolor: alpha(t.palette.primary.main, 0.04) })}
        >
          {busy ? <CircularProgress size={18} /> : many ? <AddPhotoAlternateOutlinedIcon /> : <UploadFileRoundedIcon />}
          <Box sx={{ textAlign: "left" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{busy ? `Uploading ${busy}…` : files.length ? (many ? "Add more photos" : "Replace or add another") : many ? "Add photos" : "Upload document"}</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Photos or PDF, up to 25 MB{ctx.data.storage === "local" ? " · saved on this computer until Cloudflare R2 is set up" : ""}
            </Typography>
          </Box>
          <input
            ref={input}
            hidden
            type="file"
            multiple={many}
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            onChange={(e) => {
              if (e.target.files?.length) void send(e.target.files);
              e.target.value = "";
            }}
          />
        </ButtonBase>
      ) : (
        !files.length && <ReadOnly f={f} />
      )}
      {ctx.data.storage === null && canChange && (
        <Typography variant="caption" sx={{ color: "warning.main", display: "block", mt: 0.5 }}>
          File storage isn&apos;t set up yet (Cloudflare R2), so uploads will be refused.
        </Typography>
      )}
    </Box>
  );
}

// ------------------------------------------------------------ reopen

function ReopenDialog({ ctx, n, onClose }: { ctx: Ctx; n: number; onClose: () => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <MDialog title="Reopen Milestone" heading={`Reopen Milestone ${n}?`} subtitle={`Its fields become editable for the crew again${n < 3 ? `, and any later milestone reopens too` : ""}. Recorded in the audit log.`} onClose={onClose} maxWidth="xs">
      <Stack sx={{ gap: 1 }}>
        <Button
          size="large"
          variant="contained"
          color="warning"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetcher<{ message: string }>(`/projects/${ctx.pid}/milestones/${n}/reopen`, { method: "POST" });
              toast(res.message);
              onClose();
              await ctx.reload();
            } catch (err) {
              toast(err instanceof ApiError ? err.message : "Couldn't reopen it.", "bad");
              setBusy(false);
            }
          }}
        >
          {busy ? "Reopening…" : `Reopen Milestone ${n}`}
        </Button>
        <Button size="large" onClick={onClose}>
          Cancel
        </Button>
      </Stack>
    </MDialog>
  );
}
