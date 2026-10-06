"use client";

import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import EngineeringRoundedIcon from "@mui/icons-material/EngineeringRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Autocomplete from "@mui/material/Autocomplete";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { Field, MDialog, PhoneField, RoleAvatar, ROLE_NAME } from "@/components/m";
import { splitPhone } from "@/components/phone-input";
import { EdgeCard } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { type Options, planDates, type ProjectRow, STATUS_TONE } from "@/lib/client/projects";

/** Where a project opens: inside the dev preview when browsing it, otherwise the app. */
export function useProjectHref() {
  const pathname = usePathname();
  return (id: number) => (pathname.startsWith("/dev-preview") ? `/dev-preview/projects/${id}` : `/projects/${id}`);
}

const edgeColor = (p: ProjectRow) => (t: Theme) => {
  if (p.attention) return t.palette.error.main;
  const tone = STATUS_TONE[p.status];
  return tone === "default" ? t.palette.text.disabled : t.palette[tone].main;
};

export function StatusChip({ p, size = "small" }: { p: Pick<ProjectRow, "status" | "statusLabel">; size?: "small" | "medium" }) {
  const tone = STATUS_TONE[p.status];
  return <Chip size={size} label={p.statusLabel} color={tone} variant={tone === "default" ? "outlined" : "filled"} sx={{ fontWeight: 600 }} />;
}

export function TimingChip({ p }: { p: Pick<ProjectRow, "attention" | "flags"> }) {
  if (!p.attention) return <Chip size="small" variant="outlined" color="success" label="On time" />;
  const late = p.flags.some((f) => f.kind === "overdue");
  return <Chip size="small" color="error" icon={<WarningAmberRoundedIcon />} label={late ? "Late" : "Issue"} />;
}

function Meta({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.3 }}>
        {k}
      </Typography>
      <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600, color: bad ? "error.main" : "text.primary" }}>
        {v}
      </Typography>
    </Box>
  );
}

/** One project as a line item, as in the brief: everything a PM scans for at a glance. */
export function ProjectCard({ p }: { p: ProjectRow }) {
  const router = useRouter();
  const href = useProjectHref();
  const overdue = p.flags.some((f) => f.kind === "overdue");
  return (
    <EdgeCard color={edgeColor(p)}>
      <CardActionArea
        onClick={() => router.push(href(p.id))}
        data-testid="project-card"
        sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}
      >
        <Box sx={{ p: 1.75, pl: 2.5, flex: 1 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 16 }}>
                {p.name}
              </Typography>
              <Typography noWrap variant="body2" sx={{ color: "text.secondary", fontSize: 13 }}>
                {p.homeowner.name ?? "—"} · {p.contractor.label}
              </Typography>
            </Box>
            <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 30, height: 30, fontSize: 11, borderColor: "background.paper" } }}>
              {p.team.map((t) => (
                <RoleAvatar key={t.uid} name={t.name} role={t.role} size={30} />
              ))}
            </AvatarGroup>
          </Stack>

          <Stack direction="row" sx={{ gap: 0.75, mt: 1.25, flexWrap: "wrap" }}>
            <StatusChip p={p} />
            <TimingChip p={p} />
            <Chip size="small" variant="outlined" label={p.milestone === 3 ? "All milestones" : `Milestone ${p.currentMilestone}`} />
          </Stack>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1, mt: 1.5 }}>
            <Meta k="Start" v={p.startDate ? d2s(p.startDate) : "—"} />
            <Meta k="Target end" v={p.endDate ? d2s(p.endDate) : "—"} bad={overdue} />
            <Meta k="Elapsed" v={`${p.daysElapsed} day${p.daysElapsed === 1 ? "" : "s"}`} />
          </Box>

          <LinearProgress
            variant="determinate"
            value={p.progress}
            color={p.attention ? "error" : "primary"}
            sx={{ mt: 1.5, height: 6, borderRadius: 3 }}
          />
          <Stack direction="row" sx={{ justifyContent: "space-between", mt: 0.75 }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {p.progress}% complete
            </Typography>
            <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>
              {p.pm.name ?? ""}
            </Typography>
          </Stack>

          {p.flags.length > 0 && (
            <Stack sx={{ mt: 1, gap: 0.25 }}>
              {p.flags.map((f) => (
                <Stack key={f.text} direction="row" sx={{ gap: 0.75, alignItems: "flex-start", color: "error.main" }}>
                  <WarningAmberRoundedIcon sx={{ fontSize: 15, mt: "2px" }} />
                  <Typography variant="caption" sx={{ lineHeight: 1.45 }}>
                    {f.text}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </CardActionArea>
    </EdgeCard>
  );
}

/** The circular progress from the brief: % complete in the middle. */
export function ProgressRing({ value, size = 108, color = "primary" }: { value: number; size?: number; color?: "primary" | "error" }) {
  return (
    <Box sx={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <CircularProgress variant="determinate" value={100} size={size} thickness={3.2} sx={{ color: "action.hover", position: "absolute" }} />
      <CircularProgress variant="determinate" value={value} size={size} thickness={3.2} color={color} sx={{ position: "absolute", "& circle": { strokeLinecap: "round" } }} />
      <Stack sx={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <Typography sx={{ fontWeight: 700, fontSize: size * 0.24, lineHeight: 1 }}>
          {value}
          <Box component="span" sx={{ fontSize: "0.5em" }}>
            %
          </Box>
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: size * 0.095, mt: 0.25 }}>
          Complete
        </Typography>
      </Stack>
    </Box>
  );
}

// ------------------------------------------------------------ create

type Contractor = "group" | "users" | "text";
type Homeowner = { uid: number; name: string; email: string; contactNo: string | null };

/**
 * Create Project, in the sign-up design. Everything is mandatory: name,
 * postal code (which fills in the address and the site's GPS point), address,
 * homeowner (an account, or a typed name), their contact number, the
 * contractor (a group, named people, or a typed name) and a start or end date.
 */
export function NewProjectDialog({ onClose, project: p, onSaved }: { onClose: () => void; project?: ProjectRow; onSaved?: () => Promise<void> }) {
  const fetcher = useFetcher();
  const router = useRouter();
  const href = useProjectHref();
  const { toast } = useApp();
  const { data: opts } = useApi<Options>("/projects/options");
  // Editing starts from the project as it is; creating starts empty.
  const [f, setF] = useState(() => ({
    name: p?.name ?? "",
    postal: p?.postalCode ?? "",
    address: p?.address ?? "",
    contact: p?.contactNo ?? "",
    start: p?.startDate ?? "",
    end: p?.endDate ?? "",
    ctrText: p?.contractor.type === "text" ? p.contractor.label : "",
    groupId: p?.contractor.groupId ? String(p.contractor.groupId) : "",
  }));
  const [homeowner, setHomeowner] = useState<Homeowner | string | null>(() =>
    !p ? null : p.homeowner.linked ? { uid: p.homeowner.uid!, name: p.homeowner.name ?? "", email: "", contactNo: p.contactNo } : (p.homeowner.name ?? "")
  );
  const [ctr, setCtr] = useState<Contractor>(p?.contractor.type ?? "group");
  const [crew, setCrew] = useState<Options["crew"]>(() =>
    p?.contractor.type === "users"
      ? p.team.filter((t) => t.role === "contractor" || t.role === "epc_team").map((t) => ({ uid: t.uid, name: t.name ?? "", role: t.role, roleLabel: ROLE_NAME[t.role] }))
      : []
  );
  const [geo, setGeo] = useState<{ postal: string; ok: boolean; text: string } | null>(() =>
    p?.postalCode ? { postal: p.postalCode, ok: true, text: p.address } : null
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // A complete postal code is looked up once; the address it finds fills an
  // empty address box (or one OneMap filled before), never one typed by hand.
  useEffect(() => {
    if (!/^\d{6}$/.test(f.postal) || geo?.postal === f.postal) return;
    let live = true;
    fetcher<{ address: string }>(`/projects/geocode?postal=${f.postal}`).then(
      (r) => {
        if (!live) return;
        setGeo({ postal: f.postal, ok: true, text: r.address });
        setF((x) => (!x.address || x.address === geo?.text ? { ...x, address: r.address } : x));
      },
      (err: unknown) => live && setGeo({ postal: f.postal, ok: false, text: err instanceof ApiError ? err.message : "Couldn't look that up." })
    );
    return () => {
      live = false;
    };
  }, [f.postal, fetcher, geo]);

  const dates = planDates(f.start, f.end);
  const homeownerOk = typeof homeowner === "string" ? homeowner.trim().length >= 2 : homeowner !== null;
  const contractorOk = ctr === "group" ? Boolean(f.groupId) : ctr === "users" ? crew.length > 0 : f.ctrText.trim().length >= 2;
  const ok =
    f.name.trim().length >= 2 &&
    /^\d{6}$/.test(f.postal) &&
    geo?.postal === f.postal &&
    geo.ok &&
    f.address.trim().length >= 5 &&
    homeownerOk &&
    splitPhone(f.contact).local.replace(/\D/g, "").length >= 6 &&
    contractorOk &&
    dates !== null &&
    !dates.error;
  const linked = homeowner !== null && typeof homeowner !== "string";

  async function submit() {
    setBusy(true);
    try {
      const res = await fetcher<{ id?: number; message: string }>(p ? `/projects/${p.id}` : "/projects", {
        method: p ? "PATCH" : "POST",
        json: {
          name: f.name,
          postalCode: f.postal,
          address: f.address,
          homeownerId: linked ? (homeowner as Homeowner).uid : null,
          homeownerName: typeof homeowner === "string" ? homeowner : "",
          contactNo: f.contact,
          contractor: { type: ctr, groupId: f.groupId ? Number(f.groupId) : null, userIds: crew.map((c) => c.uid), text: f.ctrText },
          startDate: f.start || null,
          endDate: f.end || null,
        },
      });
      toast(res.message);
      onClose();
      if (p) await onSaved?.();
      else if (res.id) router.push(href(res.id));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't create the project.", "bad");
      setBusy(false);
    }
  }

  return (
    <MDialog
      title={p ? "Edit Project" : "Create Project"}
      heading={p ? "Project details" : "A new installation"}
      subtitle={p ? "Every field is required. Each change is recorded in the audit log." : "Every field is required."}
      onClose={onClose}
    >
      <Stack sx={{ gap: 2.5 }}>
        <Field label="Project name" required icon={<SolarPowerRoundedIcon />} placeholder="e.g. Hillcrest Villa" value={f.name} onChange={set("name")} />

        <Field
          label="Postal code"
          required
          icon={<PlaceOutlinedIcon />}
          placeholder="6 digits — finds the address and site location"
          value={f.postal}
          onChange={(e) => setF((x) => ({ ...x, postal: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
          error={Boolean(geo && geo.postal === f.postal && !geo.ok)}
          helperText={
            geo && geo.postal === f.postal
              ? geo.ok
                ? "Found on OneMap. GPS check-in will use this site."
                : geo.text
              : /^\d{6}$/.test(f.postal)
                ? "Looking it up…"
                : "Used for the site's GPS location at check-in."
          }
          slotProps={{
            htmlInput: { inputMode: "numeric", maxLength: 6 },
            input: geo && geo.postal === f.postal && geo.ok ? { endAdornment: <InputAdornment position="end"><Chip size="small" color="success" label="Located" /></InputAdornment> } : undefined,
          }}
        />
        <Field label="Project address" required icon={<HomeOutlinedIcon />} multiline minRows={2} placeholder="Filled in from the postal code" value={f.address} onChange={set("address")} />

        <Autocomplete
          freeSolo
          options={opts?.homeowners ?? []}
          value={homeowner}
          onChange={(_, v) => {
            setHomeowner(v);
            if (v && typeof v !== "string" && v.contactNo) setF((x) => ({ ...x, contact: v.contactNo ?? x.contact }));
          }}
          onInputChange={(_, text, reason) => {
            if (reason === "input") setHomeowner(text);
          }}
          getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
          isOptionEqualToValue={(a, b) => typeof b !== "string" && a.uid === b.uid}
          renderOption={({ key, ...props }, o) => (
            <li key={key} {...props}>
              <Box>
                <Typography sx={{ fontSize: 14.5, fontWeight: 500 }}>{o.name}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {o.email}
                </Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Homeowner"
              required
              placeholder="Choose their account, or type a name"
              helperText={
                linked
                  ? "Account linked: they'll be asked to approve the project."
                  : homeownerOk
                    ? "No account: the project stays a draft until one is linked, since only an account can approve and e-sign."
                    : "Choose a homeowner account, or type a name if they don't have one yet."
              }
              slotProps={{
                ...params.slotProps,
                inputLabel: { ...params.slotProps.inputLabel, shrink: true },
                input: {
                  ...params.slotProps.input,
                  startAdornment: (
                    <InputAdornment position="start" sx={{ color: "text.secondary", "& svg": { fontSize: 20 } }}>
                      <PersonOutlineRoundedIcon />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
        />
        <PhoneField required label="Homeowner contact no." value={f.contact} onChange={(v) => setF((x) => ({ ...x, contact: v }))} />

        <Box>
          <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 500, display: "block", mb: 0.75 }}>
            Contractor *
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={ctr}
            onChange={(_, v: Contractor | null) => v && setCtr(v)}
            sx={{ mb: 1.75 }}
          >
            <ToggleButton value="group">Group</ToggleButton>
            <ToggleButton value="users">Individuals</ToggleButton>
            <ToggleButton value="text">Free text</ToggleButton>
          </ToggleButtonGroup>
          {ctr === "group" && (
            <Field select label="Contractor group" required icon={<GroupsRoundedIcon />} value={f.groupId} onChange={set("groupId")}
              helperText={opts?.groups.length === 0 ? "No groups yet. Create one in People." : "Everyone in the group is told about the project."}>
              {(opts?.groups ?? []).map((g) => (
                <MenuItem key={g.id} value={String(g.id)}>
                  {g.name} · {g.members.length} member{g.members.length === 1 ? "" : "s"}
                </MenuItem>
              ))}
            </Field>
          )}
          {ctr === "users" && (
            <Autocomplete
              multiple
              options={opts?.crew ?? []}
              value={crew}
              onChange={(_, v) => setCrew(v)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.uid === b.uid}
              renderOption={({ key, ...props }, o) => (
                <li key={key} {...props}>
                  <Stack direction="row" sx={{ gap: 1.25, alignItems: "center" }}>
                    <RoleAvatar name={o.name} role={o.role} size={28} />
                    <Box>
                      <Typography sx={{ fontSize: 14.5 }}>{o.name}</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {ROLE_NAME[o.role]}
                      </Typography>
                    </Box>
                  </Stack>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Contractor admins & EPC crew"
                  required
                  helperText="Each person chosen is told about the project."
                  slotProps={{ ...params.slotProps, inputLabel: { ...params.slotProps.inputLabel, shrink: true } }}
                />
              )}
            />
          )}
          {ctr === "text" && (
            <Field label="Contractor name" required icon={<EngineeringRoundedIcon />} placeholder="e.g. Northline Roofing Pte Ltd" value={f.ctrText} onChange={set("ctrText")}
              helperText="A typed name has no accounts to notify." />
          )}
        </Box>

        <Box>
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <Field label="Start date" type="date" icon={<CalendarMonthRoundedIcon />} value={f.start} onChange={set("start")} />
            <Field label="End date" type="date" icon={<CalendarMonthRoundedIcon />} value={f.end} onChange={set("end")} />
          </Stack>
          <DatesNote start={f.start} end={f.end} />
        </Box>
      </Stack>

      <Button fullWidth size="large" variant="contained" disabled={!ok || busy} sx={{ mt: 3 }} onClick={() => void submit()}>
        {busy ? (p ? "Saving…" : "Creating…") : p ? "Save Changes" : "Next — Create Project"}
      </Button>
      <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 1.25 }}>
        {!ok ? "Complete every field to continue." : p ? "Anyone newly added to the project will be notified." : "The homeowner, contractor admins and EPC crew will be notified."}
      </Typography>
    </MDialog>
  );
}

function DatesNote({ start, end }: { start: string; end: string }) {
  const d = planDates(start, end);
  let text: ReactNode = "Give a start date, an end date, or both. A missing one is set three weeks from the other.";
  let color = "text.secondary";
  if (d?.error) {
    text = d.error;
    color = "error.main";
  } else if (d) {
    const filled = !start ? "start set 3 weeks before the end" : !end ? "end set 3 weeks after the start" : null;
    text = (
      <>
        Runs <b>{d2s(d.start)}</b> → <b>{d2s(d.end)}</b>
        {filled ? ` (${filled})` : ""}. Only a project manager can change these later.
      </>
    );
  }
  return (
    <Typography variant="caption" component="p" sx={{ color, mt: 0.75, mx: 1.75 }}>
      {text}
    </Typography>
  );
}

export function DetailRow({ icon, k, children }: { icon: ReactNode; k: string; children: ReactNode }) {
  return (
    <>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start", py: 1.25 }}>
        <Box sx={{ color: "text.secondary", display: "grid", mt: "1px", "& svg": { fontSize: 20 } }}>{icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {k}
          </Typography>
          <Box sx={{ fontSize: 14.5, overflowWrap: "anywhere" }}>{children}</Box>
        </Box>
      </Stack>
      <Divider sx={{ "&:last-child": { display: "none" } }} />
    </>
  );
}
