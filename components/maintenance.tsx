"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import ElectricalServicesRoundedIcon from "@mui/icons-material/ElectricalServicesRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import RoofingRoundedIcon from "@mui/icons-material/RoofingRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { MeetingDialog } from "@/components/calendar";
import { Field, MDialog } from "@/components/m";
import { DetailRow } from "@/components/projects";
import { EdgeCard, gradText } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp, useMe } from "@/lib/client/app-state";
import { useFlagged } from "@/lib/client/warnings";
import { whenText } from "@/lib/client/calendar";
import { T, TR, useLang } from "@/lib/client/i18n";
import {
  addMonths,
  type Check,
  checkLabel,
  kwpText,
  type MaintenanceDetail,
  type MaintenanceSystem,
  panelText,
  phaseText,
  planText,
  ppaText,
  sgToday,
} from "@/lib/client/maintenance";

/**
 * Maintenance's pieces: a system's card on the Maintenance page, and how its
 * checks read there and on the system's own page.
 */

/** Where Maintenance and a system open: inside the dev preview when browsing it, otherwise the app. */
export function useMaintenanceHref() {
  const pathname = usePathname() ?? "";
  const base = pathname.startsWith("/dev-preview") ? "/dev-preview/maintenance" : "/maintenance";
  return (id?: number) => (id === undefined ? base : `${base}/${id}`);
}

/** The colour a check reads in. */
export function checkColor(c: Pick<Check, "state">): "error" | "warning" | "success" | "default" {
  return c.state === "overdue" ? "error" : c.state === "due_soon" ? "warning" : c.state === "done" ? "success" : "default";
}

/** "Year 2 check due 26 Nov 2027", "Year 3 check overdue since …", "All scheduled checks done". */
export function nextCheckText(s: Pick<MaintenanceSystem, "next" | "checks"> & Partial<Pick<MaintenanceSystem, "checkYears" | "turnedOn">>): string {
  const n = s.next;
  if (!n && s.checkYears === null) return T("No maintenance plan recorded: add the plan's years to schedule its checks.");
  if (!n && typeof s.checkYears === "number" && s.checkYears < 2) return T("No yearly checks: the plan is one year, and the first year has none.");
  if (!n && s.turnedOn === null) return T("No turn-on date yet: the checks are counted from it.");
  if (!n) return s.checks.some((c) => c.due) ? T("All scheduled checks done") : T("No checks scheduled yet");
  if (n.state === "overdue") return T("{check} overdue since {date}", { check: TR(n.label), date: d2s(n.due) });
  return T("{check} due {date}", { check: TR(n.label), date: d2s(n.due) });
}

/** Imported from the lists: how many fields are still empty, on the system and its record project. */
export function toFill(s: Pick<MaintenanceSystem, "toFill">): number {
  return s.toFill ? s.toFill.system.length + s.toFill.project : 0;
}

export function SystemCard({ s }: { s: MaintenanceSystem }) {
  const flagged = useFlagged();
  const router = useRouter();
  const href = useMaintenanceHref();
  const edge = (t: Theme) => (flagged(s.attention) ? t.palette.error.main : s.next?.state === "due_soon" ? t.palette.warning.main : t.palette.primary.main);
  const facts = [kwpText(s.kwp), panelText(s.panels), phaseText(s.phase)].filter(Boolean) as string[];
  const n = s.next;
  return (
    <EdgeCard color={edge} alarm={flagged(s.attention)}>
      <CardActionArea onClick={() => router.push(href(s.id))} data-testid="system-card" sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        <Box sx={{ p: 1.75, pl: 2.5, flex: 1 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={[{ fontWeight: 600, fontSize: 16 }, gradText()]}>
                {s.address}
              </Typography>
              <Typography noWrap variant="body2" sx={{ color: "text.secondary", fontSize: 13 }}>
                {[s.postalCode ? `Singapore ${s.postalCode}` : null, s.homeowner.name].filter(Boolean).join(" · ") || "—"}
              </Typography>
            </Box>
            {s.pm.uid ? (
              <Chip size="small" variant="outlined" label={s.pm.name} sx={{ maxWidth: 140 }} />
            ) : (
              <Chip size="small" color="warning" variant="outlined" label={T("Unassigned")} />
            )}
          </Stack>

          <Stack direction="row" sx={{ gap: 0.75, mt: 1.25, flexWrap: "wrap" }}>
            {facts.map((f) => (
              <Chip key={f} size="small" variant="outlined" label={f} />
            ))}
          </Stack>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1, mt: 1.5 }}>
            <Meta k="Turned on" v={s.turnedOn ? d2s(s.turnedOn) : "—"} />
            <Meta k="PPA" v={ppaText(s) ?? "—"} />
            <Meta k="Maintenance plan" v={planText(s) ?? "—"} wide />
          </Box>

          <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", mt: 1.25 }}>
            <EventRoundedIcon sx={{ fontSize: 16, color: n ? `${checkColor(n) === "default" ? "text.secondary" : `${checkColor(n)}.main`}` : "success.main" }} />
            <Typography variant="body2" sx={{ fontWeight: n && n.state !== "scheduled" ? 700 : 500, color: flagged(true) && n?.state === "overdue" ? "error.main" : "text.primary" }} data-testid="next-check">
              {nextCheckText(s)}
            </Typography>
          </Stack>

          {flagged(true) && s.urgent && (
            <Stack direction="row" sx={{ gap: 0.75, alignItems: "flex-start", color: "error.main", mt: 0.75 }}>
              <BoltRoundedIcon sx={{ fontSize: 16, mt: "2px" }} />
              <Typography variant="caption" sx={{ lineHeight: 1.45, fontWeight: 700 }}>
                {s.urgentNote ? T("Urgent: {note}", { note: s.urgentNote }) : T("Urgent maintenance")}
              </Typography>
            </Stack>
          )}
          {toFill(s) > 0 && (
            <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "warning.main", mt: 0.75 }} data-testid="system-to-fill">
              <EditNoteRoundedIcon sx={{ fontSize: 17 }} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {T("Fields to fill: {n}", { n: toFill(s) })}
              </Typography>
            </Stack>
          )}
        </Box>
      </CardActionArea>
    </EdgeCard>
  );
}

function Meta({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <Box sx={{ minWidth: 0, gridColumn: wide ? "1 / -1" : undefined }}>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
        {TR(k)}
      </Typography>
      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
        {v}
      </Typography>
    </Box>
  );
}

// ------------------------------------------------------------------- dialogs

/** When a check was done: today unless said otherwise, never in the future or before the turn-on. */
export function CheckDoneDialog({
  check,
  turnedOn,
  busy,
  onClose,
  onDone,
}: {
  check: Check;
  turnedOn: string | null;
  busy: boolean;
  onClose: () => void;
  onDone: (on: string) => Promise<void>;
}) {
  const today = sgToday();
  const [on, setOn] = useState(today);
  const future = Boolean(on) && on > today;
  const early = Boolean(on && turnedOn && on < turnedOn);
  const [tried, setTried] = useState(false);
  const missing = tried && !on;
  return (
    <MDialog
      title={T("Maintenance Check")}
      heading={T("Record the {check}", { check: TR(check.label).toLowerCase() })}
      subtitle={check.due ? T("It was due {date}.", { date: d2s(check.due) }) : undefined}
      onClose={onClose}
      maxWidth="xs"
    >
      <Field
        label={T("Done on")}
        type="date"
        icon={<CalendarMonthRoundedIcon />}
        value={on}
        onChange={(e) => setOn(e.target.value)}
        error={future || early || missing}
        helperText={future ? T("A check can't be done in the future.") : early ? T("A check can't be done before the system was turned on.") : missing ? T("Choose the day it was done.") : " "}
        slotProps={{ htmlInput: { max: today, min: turnedOn ?? undefined, "data-testid": "done-on" } }}
      />
      <Stack sx={{ gap: 1, mt: 2 }}>
        <Button size="large" variant="contained" disabled={busy} onClick={() => (!on || future || early ? setTried(true) : void onDone(on))} data-testid="confirm-done">
          {T("Mark done")}
        </Button>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Stack>
    </MDialog>
  );
}

type Form = {
  address: string;
  postalCode: string;
  homeownerName: string;
  contactNo: string;
  runBy: string;
  ppaKind: "" | "ppa" | "value_buy";
  ppaYears: string;
  planYears: string;
  planKind: "free" | "excl";
  panels: Array<{ count: string; wp: string }>;
  kwp: string;
  phase: "" | "1" | "3";
  inverters: string;
  turnedOn: string;
  roof: "" | "yes" | "no";
  urgent: boolean;
  urgentNote: string;
  notes: string;
};

function formOf(s: MaintenanceSystem): Form {
  return {
    address: s.address,
    postalCode: s.postalCode ?? "",
    homeownerName: s.homeowner.name ?? "",
    contactNo: s.contactNo ?? "",
    runBy: s.pm.uid ? String(s.pm.uid) : "",
    ppaKind: s.ppa?.kind ?? "",
    ppaYears: s.ppa?.years ? String(s.ppa.years) : "",
    planYears: s.plan ? String(s.plan.years) : "",
    planKind: s.plan?.excludesFirstYear ? "excl" : "free",
    panels: s.panels.length ? s.panels.map((p) => ({ count: String(p.count), wp: p.wp ? String(p.wp) : "" })) : [{ count: "", wp: "" }],
    kwp: s.kwp === null ? "" : String(s.kwp),
    phase: s.phase ? (String(s.phase) as "1" | "3") : "",
    inverters: s.inverters.join("\n"),
    turnedOn: s.turnedOn ?? "",
    roof: s.roofAccess === null ? "" : s.roofAccess ? "yes" : "no",
    urgent: s.urgent,
    urgentNote: s.urgentNote ?? "",
    notes: s.notes ?? "",
  };
}

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : null);

/** The checks the form's dates and years make: yearly from 24 months after turn-on, for the plan's (else the PPA's) years. */
function checkPlanText(f: Form): string {
  const years = whole(f.planYears) ?? (f.ppaKind === "ppa" ? whole(f.ppaYears) : null);
  if (!years || years < 2) return T("Checks are yearly from the second year, for the plan's years. Add the plan's years to schedule them.");
  if (!f.turnedOn) return T("Checks are yearly from the second year. Add the turn-on date to schedule them.");
  const n = years - 1;
  return T(n === 1 ? "1 check: {first}." : "{n} checks, yearly from {first} to {last}.", { n, first: d2s(addMonths(f.turnedOn, 24)), last: d2s(addMonths(f.turnedOn, 12 * years)) });
}

/** What's wrong with the form, if anything, in words. */
function problemOf(f: Form): string | null {
  const panels = f.panels.filter((p) => p.count.trim() || p.wp.trim());
  if (!f.address.trim()) return T("The address can't be empty.");
  if (f.postalCode.trim() && !/^\d{6}$/.test(f.postalCode.trim())) return T("A postal code is six digits.");
  if (f.ppaKind === "ppa" && !whole(f.ppaYears)) return T("Say how many years the PPA runs.");
  if (f.planYears.trim() && !whole(f.planYears)) return T("The plan's years are a whole number.");
  if (panels.some((p) => !whole(p.count) || (p.wp.trim() !== "" && !whole(p.wp)))) return T("Panels are a count and a wattage, in whole numbers.");
  if (f.kwp.trim() && !(Number(f.kwp) >= 0)) return T("The system size is a number of kWp.");
  return null;
}

/** Everything about a system that the app keeps, in one form. A superadmin also picks who looks after it. */
export function EditSystemDialog({ d, onClose, onSaved }: { d: MaintenanceDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const [tried, setTried] = useState(false);
  const s = d.system;
  const [f, setF] = useState<Form>(() => formOf(s));
  const [busy, setBusy] = useState(false);
  const fetcher = useFetcher();
  const { toast } = useApp();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setPanel = (i: number, k: "count" | "wp", v: string) => setF((x) => ({ ...x, panels: x.panels.map((q, j) => (j === i ? { ...q, [k]: v } : q)) }));
  const problem = problemOf(f);

  async function save() {
    setBusy(true);
    try {
      await fetcher(`/maintenance/${s.id}`, {
        method: "PATCH",
        json: {
          address: f.address,
          postalCode: f.postalCode,
          ...(s.homeowner.linked ? {} : { homeownerName: f.homeownerName }),
          contactNo: f.contactNo,
          ...(d.canAssign ? { runBy: f.runBy ? Number(f.runBy) : null } : {}),
          ppa: f.ppaKind ? { kind: f.ppaKind, years: f.ppaKind === "ppa" ? whole(f.ppaYears) : null } : null,
          plan: f.planYears.trim() ? { years: whole(f.planYears), excludesFirstYear: f.planKind === "excl" } : null,
          panels: f.panels.filter((p) => p.count.trim() || p.wp.trim()).map((p) => ({ count: whole(p.count), wp: whole(p.wp) })),
          kwp: f.kwp.trim() ? Number(f.kwp) : null,
          phase: f.phase ? Number(f.phase) : null,
          inverters: f.inverters
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
          turnedOn: f.turnedOn || null,
          roofAccess: f.roof ? f.roof === "yes" : null,
          urgent: f.urgent,
          urgentNote: f.urgent ? f.urgentNote : null,
          notes: f.notes,
        },
      });
      toast(T("Saved."));
      await onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong.", "bad");
    } finally {
      setBusy(false);
    }
  }

  const blank = { select: { displayEmpty: true }, inputLabel: { shrink: true } } as const;
  return (
    <MDialog title={T("Edit System")} heading={s.address} onClose={onClose}>
      <Stack sx={{ gap: 2 }}>
        <Field label={T("Address")} required icon={<PlaceOutlinedIcon />} value={f.address} onChange={set("address")} />
        <Field label={T("Postal code")} icon={<PlaceOutlinedIcon />} value={f.postalCode} onChange={set("postalCode")} slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }} />
        {d.canAssign && (
          <Field
            select
            label={T("Project manager")}
            icon={<ShieldOutlinedIcon />}
            value={f.runBy}
            onChange={set("runBy")}
            helperText={T("Who looks after this system. Only a superadmin chooses.")}
            slotProps={{ ...blank, htmlInput: { "data-testid": "system-manager" } }}
          >
            <MenuItem value="">{T("Unassigned")}</MenuItem>
            {d.managers.map((m) => (
              <MenuItem key={m.uid} value={String(m.uid)}>
                {m.name}
              </MenuItem>
            ))}
          </Field>
        )}
        <Field
          label={T("Homeowner")}
          icon={<PersonOutlineRoundedIcon />}
          value={f.homeownerName}
          onChange={set("homeownerName")}
          disabled={s.homeowner.linked}
          helperText={s.homeowner.linked ? T("From the homeowner's account.") : undefined}
        />
        <Field label={T("Homeowner contact no.")} icon={<PhoneRoundedIcon />} value={f.contactNo} onChange={set("contactNo")} slotProps={{ htmlInput: { inputMode: "tel" } }} />

        <Typography component="h3" sx={{ fontWeight: 600, mt: 1 }}>
          {T("Contract")}
        </Typography>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", "& > *": { flex: "1 1 150px", minWidth: 0 } }}>
          <Field select label={T("PPA")} icon={<DescriptionOutlinedIcon />} value={f.ppaKind} onChange={set("ppaKind")} slotProps={blank}>
            <MenuItem value="">{T("Not recorded")}</MenuItem>
            <MenuItem value="ppa">{T("PPA")}</MenuItem>
            <MenuItem value="value_buy">{T("Value buy")}</MenuItem>
          </Field>
          {f.ppaKind === "ppa" && <Field label={T("Years")} value={f.ppaYears} onChange={set("ppaYears")} slotProps={{ htmlInput: { inputMode: "numeric" } }} sx={{ maxWidth: 120 }} />}
        </Stack>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", "& > *": { flex: "1 1 150px", minWidth: 0 } }}>
          <Field select label={T("Maintenance plan")} icon={<CalendarMonthRoundedIcon />} value={f.planKind} onChange={set("planKind")}>
            <MenuItem value="free">{T("Free")}</MenuItem>
            <MenuItem value="excl">{T("Excluding the 1st year")}</MenuItem>
          </Field>
          <Field label={T("Years")} value={f.planYears} onChange={set("planYears")} slotProps={{ htmlInput: { inputMode: "numeric" } }} sx={{ maxWidth: 120 }} />
        </Stack>

        <Typography component="h3" sx={{ fontWeight: 600, mt: 1 }}>
          {T("System")}
        </Typography>
        {f.panels.map((p, i) => (
          <Stack key={i} direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
            <Field label={T("Panels")} icon={<GridViewRoundedIcon />} value={p.count} onChange={(e) => setPanel(i, "count", e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
            <Field label={T("Wp each")} value={p.wp} onChange={(e) => setPanel(i, "wp", e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric" } }} sx={{ maxWidth: 140 }} />
            {f.panels.length > 1 && (
              <IconButton aria-label={T("Remove these panels")} onClick={() => setF((x) => ({ ...x, panels: x.panels.filter((_, j) => j !== i) }))}>
                <DeleteOutlineRoundedIcon />
              </IconButton>
            )}
          </Stack>
        ))}
        <Button size="small" startIcon={<AddRoundedIcon />} sx={{ alignSelf: "flex-start" }} onClick={() => setF((x) => ({ ...x, panels: [...x.panels, { count: "", wp: "" }] }))}>
          {T("Another panel type")}
        </Button>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", "& > *": { flex: "1 1 150px", minWidth: 0 } }}>
          <Field label={T("System size (kWp)")} icon={<SolarPowerRoundedIcon />} value={f.kwp} onChange={set("kwp")} slotProps={{ htmlInput: { inputMode: "decimal" } }} />
          <Field select label={T("Supply")} value={f.phase} onChange={set("phase")} slotProps={blank} sx={{ maxWidth: 180 }}>
            <MenuItem value="">{T("Not recorded")}</MenuItem>
            <MenuItem value="1">{T("Single-phase")}</MenuItem>
            <MenuItem value="3">{T("3-phase")}</MenuItem>
          </Field>
        </Stack>
        <Field
          label={T("Inverters")}
          icon={<ElectricalServicesRoundedIcon />}
          multiline
          minRows={2}
          value={f.inverters}
          onChange={set("inverters")}
          helperText={T("One model per line; list a model twice for two of them.")}
        />

        <Typography component="h3" sx={{ fontWeight: 600, mt: 1 }}>
          {T("Checks")}
        </Typography>
        <Field
          label={T("Turned on")}
          type="date"
          icon={<PowerSettingsNewRoundedIcon />}
          value={f.turnedOn}
          onChange={set("turnedOn")}
          helperText={checkPlanText(f)}
        />
        <Field select label={T("Roof access")} icon={<RoofingRoundedIcon />} value={f.roof} onChange={set("roof")} slotProps={blank}>
          <MenuItem value="">{T("Not recorded")}</MenuItem>
          <MenuItem value="yes">{T("Yes")}</MenuItem>
          <MenuItem value="no">{T("No")}</MenuItem>
        </Field>
        <FormControlLabel
          control={
            <Switch
              checked={f.urgent}
              onChange={(e) => setF((x) => ({ ...x, urgent: e.target.checked }))}
              slotProps={{ input: { "aria-label": T("Urgent maintenance"), "data-testid": "system-urgent" } as object }}
            />
          }
          label={T("Urgent maintenance (e.g. poor generation)")}
        />
        {f.urgent && <Field label={T("What's wrong")} icon={<WarningAmberRoundedIcon />} value={f.urgentNote} onChange={set("urgentNote")} />}
        <Field label={T("Notes")} icon={<NotesRoundedIcon />} multiline minRows={2} value={f.notes} onChange={set("notes")} />
      </Stack>
      {tried && problem && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {problem}
        </Alert>
      )}
      <Button fullWidth size="large" variant="contained" disabled={busy} sx={{ mt: 3 }} onClick={() => (problem ? setTried(true) : void save())} data-testid="save-system">
        {busy ? T("Saving…") : T("Save Changes")}
      </Button>
      <Typography variant="caption" component="p" sx={{ textAlign: "center", color: problem ? "error.main" : "text.secondary", mt: 1.25 }}>
        {problem ?? T("Every change is kept in the audit log.")}
      </Typography>
    </MDialog>
  );
}

// ------------------------------------------------------------------- checks and booking

export const CHECK_STATE: Record<Check["state"], string> = {
  done: "Done",
  overdue: "Overdue",
  due_soon: "Due soon",
  scheduled: "Scheduled",
  unscheduled: "Not scheduled",
  record: "Record only",
};

/**
 * A system's yearly checks (from the second year, for the plan's years): when each is due or was done, the
 * visit booked for it (waiting for answers, or agreed), and booking one
 * through the calendar. The office also marks a check done (onMark, onUndo).
 */
export function ChecksCard({
  d,
  busy = false,
  onMark,
  onUndo,
  onBooked,
}: {
  d: MaintenanceDetail;
  busy?: boolean;
  onMark?: (c: Check) => void;
  onUndo?: (c: Check) => void;
  onBooked: () => void;
}) {
  const s = d.system;
  const { lang } = useLang();
  const meetingHref = useMeetingHref();
  const [booking, setBooking] = useState<Check | null>(null);
  const [starting, setStarting] = useState<{ key: string | null } | null>(null);
  const today = sgToday();
  const job = d.maintenance ?? null;
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }} data-testid="system-checks">
      <Typography component="h2" sx={[{ fontWeight: 600, fontSize: 17 }, gradText()]}>
        {T("Maintenance checks")}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
        {nextCheckText(s)}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.25 }}>
        {T("None in the first year; then one a year, the first 24 months after turn-on. The homeowner doesn't see these: they hear when you start maintenance.")}
      </Typography>
      <MaintenanceUnderWay d={d} onChanged={onBooked} onStart={(key) => setStarting({ key })} />
      <Stack sx={{ mt: 1.5 }} divider={<Divider />}>
        {s.checks.map((c) => (
          <Box key={c.key} sx={{ py: 1.25 }} data-testid={`check-${c.key}`}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, rowGap: 1, flexWrap: "wrap" }}>
              <Box sx={{ color: c.state === "done" ? "success.main" : c.state === "overdue" ? "error.main" : "text.secondary", display: "grid" }}>
                {c.state === "done" ? <CheckCircleRoundedIcon /> : <EventRoundedIcon />}
              </Box>
              <Box sx={{ flex: "1 1 120px", minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>
                  {TR(c.label)}
                </Typography>
                <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap", mt: 0.25 }}>
                  <Chip size="small" color={checkColor(c)} variant={c.state === "scheduled" ? "outlined" : "filled"} label={TR(CHECK_STATE[c.state])} sx={{ height: 22 }} />
                  <Typography variant="caption" sx={{ color: c.state === "overdue" ? "error.main" : "text.secondary", fontWeight: c.state === "overdue" ? 700 : 400 }}>
                    {c.doneOn ? T("Done {date}", { date: d2s(c.doneOn) }) : c.due ? T("Due {date}", { date: d2s(c.due) }) : T("Not scheduled")}
                  </Typography>
                </Stack>
              </Box>
              {onMark &&
                onUndo &&
                (c.state === "done" ? (
                  <Button size="small" startIcon={<UndoRoundedIcon />} disabled={busy} onClick={() => onUndo(c)} aria-label={T("Undo {check}", { check: TR(c.label) })}>
                    {T("Undo")}
                  </Button>
                ) : (
                  <Button size="small" variant="contained" disabled={busy || !c.due} onClick={() => onMark(c)} data-testid={`done-${c.key}`}>
                    {T("Mark done")}
                  </Button>
                ))}
            </Stack>
            {/* Not done and not the 6-month record: start its maintenance, or book the visit once it's started. */}
            {c.state !== "done" && c.state !== "record" && !c.booked && d.canStart && !job && (
              <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 1, ml: { xs: 0, sm: 4.5 }, flexWrap: "wrap" }}>
                <Button size="small" variant="outlined" startIcon={<HandymanRoundedIcon />} onClick={() => setStarting({ key: c.key })} data-testid={`start-${c.key}`}>
                  {T("Start maintenance")}
                </Button>
              </Stack>
            )}
            {c.state !== "done" && c.state !== "record" && (c.booked || (d.canBook && job?.checkKey === c.key)) && (
              <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 1, ml: { xs: 0, sm: 4.5 }, flexWrap: "wrap" }}>
                {c.booked ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color={c.booked.agreed ? "success" : "warning"}
                    startIcon={<EventAvailableRoundedIcon />}
                    component={Link}
                    href={meetingHref(c.booked.meetingId)}
                    data-testid={`booked-${c.key}`}
                    sx={{ textAlign: "left" }}
                  >
                    {c.booked.agreed ? T("Visit agreed: {when}", { when: whenText(c.booked, lang) }) : T("Visit asked for: {when}", { when: whenText(c.booked, lang) })}
                  </Button>
                ) : (
                  <Button size="small" variant="outlined" startIcon={<EventRoundedIcon />} onClick={() => setBooking(c)} data-testid={`book-${c.key}`}>
                    {T("Book a visit")}
                  </Button>
                )}
              </Stack>
            )}
          </Box>
        ))}
      </Stack>
      {starting && <StartMaintenanceDialog systemId={s.id} checkKey={starting.key} onClose={() => setStarting(null)} onStarted={() => { setStarting(null); onBooked(); }} />}
      {booking && (
        <MeetingDialog
          draft={{
            title: `${TR(booking.label)} · ${s.address}`,
            people: d.bookWith ?? [],
            systemId: s.id,
            checkKey: booking.key,
            place: "physical",
            location: s.address ?? "",
            postalCode: s.postalCode ?? undefined,
            duration: 120,
            day: booking.due && booking.due > today ? booking.due : undefined,
          }}
          onClose={() => setBooking(null)}
          onSaved={() => {
            setBooking(null);
            onBooked();
          }}
        />
      )}
    </Card>
  );
}

/**
 * The maintenance under way on a system (the office's view): what it's for, since when, its visit, and
 * finishing it. With none under way, a way to start maintenance that isn't one of the yearly checks.
 */
function MaintenanceUnderWay({ d, onChanged, onStart }: { d: MaintenanceDetail; onChanged: () => void; onStart: (key: string | null) => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { lang } = useLang();
  const meetingHref = useMeetingHref();
  const [busy, setBusy] = useState(false);
  const job = d.maintenance ?? null;
  const finish = async (outcome: "done" | "cancelled") => {
    if (!job) return;
    setBusy(true);
    try {
      await fetcher(`/maintenance/${d.system.id}/jobs/${job.id}/finish`, { method: "POST", json: { outcome } });
      toast(outcome === "done" ? T("Done. The homeowner has been told.") : T("Called off. The homeowner has been told."));
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  };
  if (!job) {
    return d.canStart ? (
      <Button size="small" startIcon={<HandymanRoundedIcon />} onClick={() => onStart(null)} sx={{ mt: 1 }} data-testid="start-other">
        {T("Start other maintenance")}
      </Button>
    ) : null;
  }
  return (
    <Alert
      severity="info"
      icon={<HandymanRoundedIcon />}
      sx={{ mt: 1.5 }}
      data-testid="maintenance-under-way"
      action={
        d.canStart ? (
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button size="small" variant="contained" disabled={busy} onClick={() => void finish("done")} data-testid="maintenance-done">
              {T("Done")}
            </Button>
            <Button size="small" color="inherit" disabled={busy} onClick={() => void finish("cancelled")} data-testid="maintenance-call-off">
              {T("Call off")}
            </Button>
          </Stack>
        ) : undefined
      }
    >
      <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{T("{what} under way since {date}", { what: TR(job.checkKey ? checkLabel(job.checkKey) : "Maintenance"), date: d2s(job.startedAt.slice(0, 10)) })}</Typography>
      <Typography variant="body2">
        {job.visit ? (
          <Link href={meetingHref(job.visit.meetingId)}>{job.visit.agreed ? T("Visit agreed: {when}", { when: whenText(job.visit, lang) }) : T("Visit asked for: {when}", { when: whenText(job.visit, lang) })}</Link>
        ) : (
          T("The homeowner has been told. Book the visit with them next.")
        )}
      </Typography>
      {job.note && (
        <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
          {job.note}
        </Typography>
      )}
    </Alert>
  );
}

/** Starting maintenance: the homeowner is told now, and invited to the visit when it's booked. */
function StartMaintenanceDialog({ systemId, checkKey, onClose, onStarted }: { systemId: number; checkKey: string | null; onClose: () => void; onStarted: () => void }) {
  const fetcher = useFetcher();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await fetcher(`/maintenance/${systemId}/jobs`, { method: "POST", json: { checkKey, note: note.trim() || null } });
      onStarted();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <MDialog
      title={T("Start maintenance")}
      heading={checkKey ? checkLabel(checkKey) : T("Other maintenance")}
      subtitle={T("The homeowner gets a message that maintenance is starting, and that you'll arrange a visit with them. They don't see the check schedule.")}
      onClose={onClose}
      maxWidth="xs"
    >
      <Field label={T("Note for the record (optional)")} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000, "data-testid": "start-note" } }} />
      {err && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {err}
        </Alert>
      )}
      <Button variant="contained" size="large" fullWidth disabled={busy} onClick={() => void start()} sx={{ mt: 3 }} data-testid="start-confirm">
        {busy ? T("Starting…") : T("Start and tell the homeowner")}
      </Button>
    </MDialog>
  );
}

/**
 * A homeowner's view of their system's maintenance: nothing about the check schedule (only the office
 * sees that), just maintenance their project manager has started, its visit, and when it was last done.
 */
function HomeownerMaintenance({ d }: { d: MaintenanceDetail }) {
  const { lang } = useLang();
  const meetingHref = useMeetingHref();
  const job = d.maintenance ?? null;
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }} data-testid="homeowner-maintenance">
      <Typography component="h2" sx={[{ fontWeight: 600, fontSize: 17 }, gradText()]}>
        {T("Maintenance")}
      </Typography>
      {job ? (
        <>
          <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Maintenance started on {date}", { date: d2s(job.startedAt.slice(0, 10)) })}</Typography>
          {job.visit ? (
            <Button size="small" variant="outlined" color={job.visit.agreed ? "success" : "warning"} startIcon={<EventAvailableRoundedIcon />} component={Link} href={meetingHref(job.visit.meetingId)} sx={{ mt: 1, textAlign: "left" }} data-testid="homeowner-visit">
              {job.visit.agreed ? T("Visit agreed: {when}", { when: whenText(job.visit, lang) }) : T("Visit asked for: {when}", { when: whenText(job.visit, lang) })}
            </Button>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
              {T("Your project manager will invite you to a visit. Accept it in your calendar, or block out the times you can't do.")}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
          {T("Your project manager looks after your system's maintenance. When it's time, you'll get a message, then an invitation to a visit.")}
        </Typography>
      )}
      {d.lastMaintained && (
        <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1.25 }}>
          {T("Last maintained on {date}", { date: d2s(d.lastMaintained.slice(0, 10)) })}
        </Typography>
      )}
    </Card>
  );
}

/** A meeting in the calendar: inside the dev preview when browsing it, otherwise the app. */
export function useMeetingHref() {
  const preview = usePathname().startsWith("/dev-preview");
  return (id: number) => `${preview ? "/dev-preview" : ""}/calendar?meeting=${id}`;
}

/**
 * A handed-over project's Maintenance tab (its homeowner, and the office):
 * the checks, with booking a visit, and what's on the roof. The project's
 * installation itself is archived under its own tab.
 */
export function ProjectMaintenance({ pid }: { pid: number }) {
  const { data, error, reload } = useApi<MaintenanceDetail>(`/projects/${pid}/maintenance`);
  const href = useMaintenanceHref();
  const me = useMe();
  if (error)
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        {error.message}
      </Alert>
    );
  if (!data) return <Skeleton variant="rounded" height={260} />;
  const s = data.system;
  return (
    <Stack sx={{ gap: 2 }} data-testid="project-maintenance">
      {me?.role === "homeowner" ? <HomeownerMaintenance d={data} /> : <ChecksCard d={data} onBooked={() => void reload()} />}
      <Card sx={{ px: 2, py: 0.5 }} data-testid="system-details">
        <DetailRow icon={<SolarPowerRoundedIcon />} k="System size">
          {kwpText(s.kwp) ?? "—"}
        </DetailRow>
        <DetailRow icon={<GridViewRoundedIcon />} k="Panels">
          {panelText(s.panels) ?? "—"}
        </DetailRow>
        <DetailRow icon={<ElectricalServicesRoundedIcon />} k="Inverter">
          {s.inverters.join(", ") || "—"}
        </DetailRow>
        <DetailRow icon={<PowerSettingsNewRoundedIcon />} k="Turned on">
          {s.turnedOn ? d2s(s.turnedOn) : "—"}
        </DetailRow>
        <DetailRow icon={<DescriptionOutlinedIcon />} k="PPA">
          {ppaText(s) ?? "—"}
        </DetailRow>
        <DetailRow icon={<CalendarMonthRoundedIcon />} k="Maintenance plan">
          {planText(s) ?? "—"}
        </DetailRow>
        <DetailRow icon={<ShieldOutlinedIcon />} k="Looked after by">
          {s.pm.name ?? T("9 Solar Home")}
        </DetailRow>
      </Card>
      {data.canEdit && (
        <Button variant="outlined" component={Link} href={href(s.id)} startIcon={<HandymanRoundedIcon />} sx={{ alignSelf: "flex-start" }}>
          {T("Open in Maintenance")}
        </Button>
      )}
    </Stack>
  );
}
