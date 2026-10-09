"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ElectricalServicesRoundedIcon from "@mui/icons-material/ElectricalServicesRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import RoofingRoundedIcon from "@mui/icons-material/RoofingRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Field, MDialog } from "@/components/m";
import { EdgeCard } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { ApiError, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import {
  addMonths,
  type Check,
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

/** "6-month check due 26 Nov 2026", "1-year check overdue since …", "All checks done". */
export function nextCheckText(s: Pick<MaintenanceSystem, "next" | "checks">): string {
  const n = s.next;
  if (!n) return s.checks.some((c) => c.due) ? T("All scheduled checks done") : T("No checks scheduled yet");
  if (n.state === "overdue") return T("{check} overdue since {date}", { check: TR(n.label), date: d2s(n.due) });
  return T("{check} due {date}", { check: TR(n.label), date: d2s(n.due) });
}

export function SystemCard({ s }: { s: MaintenanceSystem }) {
  const router = useRouter();
  const href = useMaintenanceHref();
  const edge = (t: Theme) => (s.attention ? t.palette.error.main : s.next?.state === "due_soon" ? t.palette.warning.main : t.palette.primary.main);
  const facts = [kwpText(s.kwp), panelText(s.panels), phaseText(s.phase)].filter(Boolean) as string[];
  const n = s.next;
  return (
    <EdgeCard color={edge} alarm={s.attention}>
      <CardActionArea onClick={() => router.push(href(s.id))} data-testid="system-card" sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        <Box sx={{ p: 1.75, pl: 2.5, flex: 1 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 16 }}>
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
            <Typography variant="body2" sx={{ fontWeight: n && n.state !== "scheduled" ? 700 : 500, color: n?.state === "overdue" ? "error.main" : "text.primary" }} data-testid="next-check">
              {nextCheckText(s)}
            </Typography>
          </Stack>

          {s.urgent && (
            <Stack direction="row" sx={{ gap: 0.75, alignItems: "flex-start", color: "error.main", mt: 0.75 }}>
              <BoltRoundedIcon sx={{ fontSize: 16, mt: "2px" }} />
              <Typography variant="caption" sx={{ lineHeight: 1.45, fontWeight: 700 }}>
                {s.urgentNote ? T("Urgent: {note}", { note: s.urgentNote }) : T("Urgent maintenance")}
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
        error={future || early}
        helperText={future ? T("A check can't be done in the future.") : early ? T("A check can't be done before the system was turned on.") : " "}
        slotProps={{ htmlInput: { max: today, min: turnedOn ?? undefined, "data-testid": "done-on" } }}
      />
      <Stack sx={{ gap: 1, mt: 2 }}>
        <Button size="large" variant="contained" disabled={busy || !on || future || early} onClick={() => void onDone(on)} data-testid="confirm-done">
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
  sixMonthDue: string;
  oneYearDue: string;
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
    sixMonthDue: s.checks.find((c) => c.key === "six_month")?.due ?? "",
    oneYearDue: s.checks.find((c) => c.key === "one_year")?.due ?? "",
    roof: s.roofAccess === null ? "" : s.roofAccess ? "yes" : "no",
    urgent: s.urgent,
    urgentNote: s.urgentNote ?? "",
    notes: s.notes ?? "",
  };
}

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : null);

/** What's wrong with the form, if anything, in words. */
function problemOf(f: Form): string | null {
  const panels = f.panels.filter((p) => p.count.trim() || p.wp.trim());
  if (!f.address.trim()) return T("The address can't be empty.");
  if (f.postalCode.trim() && !/^\d{6}$/.test(f.postalCode.trim())) return T("A postal code is six digits.");
  if (f.ppaKind === "ppa" && !whole(f.ppaYears)) return T("Say how many years the PPA runs.");
  if (f.planYears.trim() && !whole(f.planYears)) return T("The plan's years are a whole number.");
  if (panels.some((p) => !whole(p.count) || (p.wp.trim() !== "" && !whole(p.wp)))) return T("Panels are a count and a wattage, in whole numbers.");
  if (f.kwp.trim() && !(Number(f.kwp) >= 0)) return T("The system size is a number of kWp.");
  if ((f.turnedOn && f.sixMonthDue && f.sixMonthDue < f.turnedOn) || (f.sixMonthDue && f.oneYearDue && f.oneYearDue < f.sixMonthDue))
    return T("The checks come after the turn-on date: the 6-month check, then the 1-year one.");
  return null;
}

/** Everything about a system that the app keeps, in one form. A superadmin also picks who looks after it. */
export function EditSystemDialog({ d, onClose, onSaved }: { d: MaintenanceDetail; onClose: () => void; onSaved: () => Promise<void> }) {
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
          sixMonthDue: f.sixMonthDue || null,
          oneYearDue: f.oneYearDue || null,
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
        <Stack direction="row" sx={{ gap: 1.5 }}>
          <Field select label={T("PPA")} icon={<DescriptionOutlinedIcon />} value={f.ppaKind} onChange={set("ppaKind")} slotProps={blank}>
            <MenuItem value="">{T("Not recorded")}</MenuItem>
            <MenuItem value="ppa">{T("PPA")}</MenuItem>
            <MenuItem value="value_buy">{T("Value buy")}</MenuItem>
          </Field>
          {f.ppaKind === "ppa" && <Field label={T("Years")} value={f.ppaYears} onChange={set("ppaYears")} slotProps={{ htmlInput: { inputMode: "numeric" } }} sx={{ maxWidth: 120 }} />}
        </Stack>
        <Stack direction="row" sx={{ gap: 1.5 }}>
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
        <Stack direction="row" sx={{ gap: 1.5 }}>
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
          onChange={(e) => {
            const on = e.target.value;
            // The checks follow the turn-on date, as the project listing counts them.
            setF((x) => ({ ...x, turnedOn: on, ...(on ? { sixMonthDue: addMonths(on, 6), oneYearDue: addMonths(on, 12) } : {}) }));
          }}
        />
        <Stack direction="row" sx={{ gap: 1.5 }}>
          <Field label={T("6-month check due")} type="date" value={f.sixMonthDue} onChange={set("sixMonthDue")} />
          <Field label={T("1-year check due")} type="date" value={f.oneYearDue} onChange={set("oneYearDue")} />
        </Stack>
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
      <Button fullWidth size="large" variant="contained" disabled={busy || Boolean(problem)} sx={{ mt: 3 }} onClick={() => void save()} data-testid="save-system">
        {busy ? T("Saving…") : T("Save Changes")}
      </Button>
      <Typography variant="caption" component="p" sx={{ textAlign: "center", color: problem ? "error.main" : "text.secondary", mt: 1.25 }}>
        {problem ?? T("Every change is kept in the audit log.")}
      </Typography>
    </MDialog>
  );
}
