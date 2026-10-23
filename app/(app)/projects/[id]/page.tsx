"use client";

import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import EngineeringRoundedIcon from "@mui/icons-material/EngineeringRounded";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import ElectricalServicesRoundedIcon from "@mui/icons-material/ElectricalServicesRounded";
import RouterRoundedIcon from "@mui/icons-material/RouterRounded";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { ClientRecord, FeedbackCard, recordRows, WarrantyCard } from "@/components/client-record";
import { atHandover, HandoverPanel } from "@/components/handover";
import { InvoiceDialog, ProjectPayments } from "@/components/finance";
import { ProjectMaintenance } from "@/components/maintenance";
import { Field, MDialog, RoleChip } from "@/components/m";
import { SectionPanel } from "@/components/project-fields";
import { SiteSchedule } from "@/components/site-visits";
import { DetailRow, NewProjectDialog, ProgressRing, StatusChip, TimingChip } from "@/components/projects";
import { SiteLog } from "@/components/site-log";
import { Page } from "@/components/shell";
import { SegTabs, TopBar } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { handlesPayments, isAdmin, useApp, useMe } from "@/lib/client/app-state";
import { firstOpenSection, type ProjectFields, type ProjectRow, SECTIONS } from "@/lib/client/projects";
import { useTab } from "@/lib/client/tabs";
import type { ProjectRecord } from "@/lib/client/records";
import type { ProjectVisits } from "@/lib/client/sites";

import { T, TR } from "@/lib/client/i18n";
/**
 * One project. The automated header from the brief (progress, on track, days
 * running), what needs attention, the project's details, and its milestone
 * sections with how far each has got and whether it's open yet.
 */
export default function ProjectPage() {
  const me = useMe();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data: p, error, reload } = useApi<ProjectRow>(me ? `/projects/${id}` : null);
  const { data: fields, reload: reloadFields } = useApi<ProjectFields>(me ? `/projects/${id}/fields` : null);
  const { data: visits, reload: reloadVisits } = useApi<ProjectVisits>(me ? `/projects/${id}/visits` : null);
  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), reloadFields(), reloadVisits()]);
  }, [reload, reloadFields, reloadVisits]);
  // Handed over, a project is in maintenance: that's its first tab, and the installation is archived beside it.
  const upkeep = p?.status === "maintenance";
  const [tab, setTab] = useTab<Tab>(["maintenance", "milestones", "details", "visits"], upkeep ? "maintenance" : "milestones");
  // An alert about a site visit links to #site-visits: open that tab.
  useEffect(() => {
    if (window.location.hash === "#site-visits") setTab("visits");
  }, [setTab]);

  if (!me) return null;
  const back = () => (me.role === "homeowner" ? router.push("/") : router.back());

  return (
    <>
      <TopBar
        title={p?.name ?? T("Project")}
        sub={p?.address}
        onBack={me.role === "homeowner" ? undefined : back}
        tabs={
          <SegTabs
            label={T("Project")}
            value={tab}
            onChange={setTab}
            options={[
              ...(upkeep ? [{ value: "maintenance" as const, label: "Maintenance" }] : []),
              { value: "milestones", label: upkeep ? "Installation" : fields?.relation === "homeowner" ? "Your installation" : "Milestones" },
              { value: "details", label: "Details" },
              { value: "visits", label: "Site visits", count: visits?.visits.length },
            ]}
          />
        }
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!p && !error && <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />}
          {p && <Body p={p} fields={fields} visits={visits} reload={reloadAll} tab={tab} />}
        </Page>
      </Box>
    </>
  );
}

type Tab = "maintenance" | "milestones" | "details" | "visits";

/**
 * The automated header from the brief (progress, on track, days running) and
 * anything needing attention stay in view; the rest is one tab at a time.
 */
function Body({ p, fields, visits, reload, tab }: { p: ProjectRow; fields: ProjectFields | null; visits: ProjectVisits | null; reload: () => Promise<void>; tab: Tab }) {
  const [editing, setEditing] = useState(false);
  const manager = isAdmin(useMe()?.role);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const first = fields ? firstOpenSection(fields.sections) : null;
  const isOpen = (key: string) => open[key] ?? key === first;
  const ctx = fields && { pid: p.id, data: fields, reload };
  return (
    <Box sx={{ display: "grid", gap: { xs: 2, lg: 3 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1.15fr)" }, alignItems: "start", mt: 1 }}>
      <Stack sx={{ gap: 2, minWidth: 0 }}>
        {p.attention && (
          <Alert severity="error" icon={<WarningAmberRoundedIcon />} data-testid="project-flags">
            <AlertTitle sx={{ fontWeight: 600 }}>{T("Needs attention")}</AlertTitle>
            {p.flags.map((f) => (
              <Typography key={f.text} variant="body2">
                {TR(f.text)}
              </Typography>
            ))}
          </Alert>
        )}
        {fields?.actions.takeOn && <TakeOn pid={p.id} reload={reload} />}
        <ActionBanner p={p} fields={fields} reload={reload} />
        {atHandover(p) && <HandoverPanel p={p} reload={reload} />}
        <Summary p={p} />
        <PaymentsCard pid={p.id} />
      </Stack>
      <Box sx={{ minWidth: 0 }} data-testid={`project-${tab}`}>
        {tab === "maintenance" && <ProjectMaintenance pid={p.id} />}
        {tab === "milestones" && (
          <>
            {p.status === "maintenance" && !p.toFill && (
              <Alert severity="success" icon={<Inventory2RoundedIcon />} sx={{ mb: 1.5 }} data-testid="installation-archived">
                {T("Archived: the installation is complete and handed over. It's kept here as a record.")}
              </Alert>
            )}
            {p.imported && Boolean(p.toFill) && (
              <Alert severity="warning" icon={<EditNoteRoundedIcon />} sx={{ mb: 1.5 }} data-testid="record-to-fill">
                <AlertTitle sx={{ fontWeight: 600 }}>{T("Fields to fill: {n}", { n: p.toFill ?? 0 })}</AlertTitle>
                {p.status === "maintenance"
                  ? T("Imported from 9 Solar Home's lists: handed over before the app. Complete its record here; the fields still empty are highlighted.")
                  : T("Imported from 9 Solar Home's lists. Fill in what the app hasn't recorded yet, in any order; the fields still empty are highlighted.")}
              </Alert>
            )}
            <MilestoneTrack p={p} />
            <Stack sx={{ gap: 1.25, mt: 2 }}>
              {!ctx && SECTIONS.map((x) => <Skeleton key={x.key} variant="rounded" height={68} />)}
              {ctx &&
                ctx.data.sections.map((s, i) => (
                  <SectionPanel key={s.key} ctx={ctx} section={s} index={i} open={isOpen(s.key)} onToggle={() => setOpen((o) => ({ ...o, [s.key]: !isOpen(s.key) }))} />
                ))}
            </Stack>
          </>
        )}
        {tab === "details" && (
          <>
            {fields?.actions.editDetails && (
              <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 1 }}>
                <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => setEditing(true)}>
                  {T("Edit")}
                </Button>
              </Stack>
            )}
            <Details p={p} />
            {manager && <ProjectRecordCards pid={p.id} />}
          </>
        )}
        {tab === "visits" &&
          (visits ? (
            <>
              <SiteSchedule pid={p.id} name={p.name} address={p.address} data={visits} reload={reload} />
              {manager && <SiteLog data={visits} project={p.name} />}
              <ScrollToHash />
            </>
          ) : (
            <Skeleton variant="rounded" height={200} />
          ))}
      </Box>
      {editing && <NewProjectDialog project={p} onClose={() => setEditing(false)} onSaved={reload} />}
    </Box>
  );
}

/**
 * Where the project stands in its approvals, with the next step as a button
 * for whoever takes it. The brief: the homeowner's approval is on the project
 * page itself, obvious, with Approve and Decline.
 */
function ActionBanner({ p, fields, reload }: { p: ProjectRow; fields: ProjectFields | null; reload: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const a = fields?.actions;
  const homeowner = fields?.relation === "homeowner";

  async function act(path: string, json?: unknown) {
    setBusy(true);
    try {
      const res = await fetcher<{ message: string }>(`/projects/${p.id}/${path}`, { method: "POST", json });
      toast(res.message);
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong.", "bad");
    } finally {
      setBusy(false);
    }
  }

  let banner: ReactNode = null;
  if (homeowner && a?.approve) {
    banner = (
      <Alert severity="warning" icon={false} data-testid="approval-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600, fontSize: 16 }}>{T("Please approve your solar installation")}</AlertTitle>
        {T("9 Solar Home has set up {name} at {address}. Check the details, then approve so the installation can be scheduled.", { name: p.name, address: p.address })}
        <Stack direction="row" sx={{ gap: 1, mt: 1.5 }}>
          <Button size="large" variant="contained" disabled={busy} onClick={() => void act("approve")} sx={{ flex: 1 }}>
            {T("Approve")}
          </Button>
          {a.decline && (
            <Button size="large" variant="outlined" color="error" disabled={busy} onClick={() => setDeclining(true)} sx={{ flex: 1 }}>
              {T("Decline")}
            </Button>
          )}
        </Stack>
      </Alert>
    );
  } else if (p.status === "homeowner_approved") {
    banner = (
      <Alert severity="success" data-testid="approval-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600 }}>{T("Homeowner approved")}</AlertTitle>
        {a?.approve ? T("Approve to open Milestone 1 and let the crew start.") : T("Waiting for a project manager to approve and open Milestone 1.")}
        {a?.approve && (
          <Button size="large" variant="contained" fullWidth disabled={busy} onClick={() => void act("approve")} sx={{ mt: 1.5 }}>
            {T("Approve & Start Project")}
          </Button>
        )}
      </Alert>
    );
  } else if (p.status === "draft") {
    banner = (
      <Alert severity="info" data-testid="approval-banner">
        <AlertTitle sx={{ fontWeight: 600 }}>{T("No homeowner account linked")}</AlertTitle>
        {T("The homeowner is recorded as a name only.")}{" "}
        {a?.editDetails ? T("Edit the project details to link their account, so they can approve it.") : T("A project manager needs to link their account.")}
      </Alert>
    );
  } else if (p.status === "awaiting_homeowner" || p.status === "homeowner_declined") {
    const declined = p.status === "homeowner_declined";
    banner = (
      <Alert severity={declined ? "error" : "warning"} data-testid="approval-banner">
        <AlertTitle sx={{ fontWeight: 600 }}>{declined ? T("Declined by the homeowner") : T("Waiting on the homeowner")}</AlertTitle>
        {declined
          ? T("Talk to {name} before asking again.", { name: p.homeowner.name })
          : T("{name} has been asked to approve. Milestone fields open once they and a project manager have approved.", { name: p.homeowner.name })}
        {a?.remind && (
          <Button variant="outlined" color="inherit" disabled={busy} onClick={() => void act("remind")} sx={{ mt: 1.5, display: "flex" }}>
            {declined ? T("Ask again") : T("Send a reminder")}
          </Button>
        )}
      </Alert>
    );
  }

  return (
    <>
      {banner}
      {declining && (
        <DeclineDialog
          name={p.name}
          busy={busy}
          onClose={() => setDeclining(false)}
          onDecline={async (reason) => {
            setDeclining(false);
            await act("decline", { reason });
          }}
        />
      )}
    </>
  );
}

function DeclineDialog({ name, busy, onClose, onDecline }: { name: string; busy: boolean; onClose: () => void; onDecline: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  return (
    <MDialog title={T("Decline Project")} heading={`Decline ${name}?`} subtitle={T("9 Solar Home will be told and will contact you. You can still approve later.")} onClose={onClose} maxWidth="xs">
      <Field
        label={T("Reason (optional)")}
        icon={<ChatBubbleOutlineRoundedIcon />}
        multiline
        minRows={3}
        placeholder={T("e.g. I would like to change the installation date")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button size="large" variant="contained" color="error" disabled={busy} onClick={() => void onDecline(reason)}>
          {T("Decline Project")}
        </Button>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
      </Stack>
    </MDialog>
  );
}

function Summary({ p }: { p: ProjectRow }) {
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" sx={{ gap: { xs: 2, sm: 3 }, alignItems: "center", flexWrap: "wrap" }}>
        <ProgressRing value={p.progress} color={p.attention ? "error" : "primary"} />
        <Stack sx={{ gap: 1.25, minWidth: 0, flex: "1 1 120px" }}>
          <Box>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
              {T("Status")}
            </Typography>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
              <StatusChip p={p} />
              <TimingChip p={p} />
            </Stack>
          </Box>
          <Box>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
              {T("Days running")}
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{p.daysElapsed}</Typography>
          </Box>
        </Stack>
      </Stack>
      <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1.5 }}>
        {T("Progress, status and days running are calculated by the system and can't be edited.")}
      </Typography>
    </Card>
  );
}

function Details({ p }: { p: ProjectRow }) {
  const overdue = p.flags.some((f) => f.kind === "overdue");
  return (
    <Card sx={{ px: 2, py: 0.5 }} data-testid="project-details">
      <DetailRow icon={<PersonOutlineRoundedIcon />} k="Homeowner">
        {p.homeowner.name}{" "}
        {p.homeowner.linked ? (
          <Chip size="small" color="success" variant="outlined" label={T("Account")} sx={{ ml: 0.5, height: 20 }} />
        ) : (
          <Chip size="small" variant="outlined" label={T("Name only")} sx={{ ml: 0.5, height: 20 }} />
        )}
      </DetailRow>
      <DetailRow icon={<PhoneRoundedIcon />} k="Homeowner contact no.">
        {p.contactNo}
      </DetailRow>
      <DetailRow icon={<PlaceOutlinedIcon />} k="Site">
        {p.postalCode ? `Singapore ${p.postalCode}` : "—"}{" "}
        {p.siteLocated ? (
          <Chip size="small" color="success" variant="outlined" label={T("GPS set")} sx={{ ml: 0.5, height: 20 }} />
        ) : (
          <Chip size="small" color="warning" variant="outlined" label={T("No GPS yet")} sx={{ ml: 0.5, height: 20 }} />
        )}
      </DetailRow>
      <DetailRow icon={p.contractor.type === "group" ? <GroupsRoundedIcon /> : <EngineeringRoundedIcon />} k="Contractor">
        {p.contractor.label}
      </DetailRow>
      <DetailRow icon={<CalendarMonthRoundedIcon />} k="Start → target end">
        {p.startDate ? d2s(p.startDate) : "—"} →{" "}
        <Box component="span" sx={{ color: overdue ? "error.main" : "inherit", fontWeight: overdue ? 600 : 400 }}>
          {p.endDate ? d2s(p.endDate) : "—"}
        </Box>
      </DetailRow>
      <DetailRow icon={<GroupsRoundedIcon />} k="Assigned accounts">
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", mt: 0.5 }}>
          {p.team.map((t) => (
            <RoleChip key={t.uid} role={t.role} label={t.name ?? ""} />
          ))}
        </Stack>
      </DetailRow>
    </Card>
  );
}

/** Three bars, one per milestone, filled as their sections fill. */
function MilestoneTrack({ p }: { p: ProjectRow }) {
  const parts = [1, 2, 3].map((n) => {
    const s = SECTIONS.filter((x) => x.milestone === n).map((x) => p.groups[x.key] ?? { done: 0, total: 0 });
    const done = s.reduce((a, g) => a + g.done, 0);
    const total = s.reduce((a, g) => a + g.total, 0);
    return total ? Math.round((done / total) * 100) : 0;
  });
  const labels = [T("Installation"), T("Grid connection"), T("Handover")];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
      {parts.map((pc, i) => (
        <Box key={i} sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <Box sx={(t) => ({ height: 6, borderRadius: 3, bgcolor: alpha(t.palette.text.primary, 0.08), overflow: "hidden" })}>
            <Box sx={{ height: "100%", width: `${pc}%`, bgcolor: p.milestone > i ? "primary.main" : "primary.light", transition: "width .6s" }} />
          </Box>
          <Typography variant="caption" component="div" sx={{ color: p.milestone > i ? "primary.main" : "text.secondary", fontWeight: 600, mt: 0.5, lineHeight: 1.3 }}>
            {T("Milestone {n}", { n: i + 1 })}
            {p.milestone > i && <CheckRoundedIcon sx={{ fontSize: 13, ml: 0.25, verticalAlign: "-2px" }} />}
          </Typography>
          <Typography variant="caption" component="div" sx={{ color: "text.secondary", lineHeight: 1.3 }}>
            {labels[i]}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** An alert's link can point at a part of the page (#site-visits); go there once it exists. */
function ScrollToHash() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return null;
}

/** The project list's client record, the inverter's warranty and what the homeowner said: project managers only. */
function ProjectRecordCards({ pid }: { pid: number }) {
  const { data } = useApi<ProjectRecord>(`/projects/${pid}/record`);
  if (!data) return null;
  const r = data.record;
  const extra = [
    { icon: <BoltOutlinedIcon />, k: "PPA", v: r.ppa ? (r.ppa.kind === "value_buy" ? T("Value buy") : T("{n}-year PPA", { n: r.ppa.years ?? "" })) : null },
    { icon: <ElectricalServicesRoundedIcon />, k: "Supply", v: r.phase === 1 ? T("Single-phase") : r.phase === 3 ? T("3-phase") : null },
    { icon: <RouterRoundedIcon />, k: "Dongle serial no.", v: r.dongleSerial },
  ];
  return (
    <Stack sx={{ gap: 2, mt: 2 }}>
      <ClientRecord rows={[...recordRows(r), ...extra]} note={r.note} />
      <WarrantyCard warranties={data.warranties} />
      <FeedbackCard feedback={data.feedback} />
    </Stack>
  );
}

/** A project nobody runs yet (from the project list): a project manager takes it on. */
function TakeOn({ pid, reload }: { pid: number; reload: () => Promise<void> | void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Alert severity="info" data-testid="take-on" action={
      <Button size="small" color="inherit" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await fetcher<{ message: string }>(`/projects/${pid}/take-on`, { method: "POST" });
          toast(r.message);
          await reload();
        } catch (e) {
          toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
        } finally {
          setBusy(false);
        }
      }}>
        {T("Take on this project")}
      </Button>
    }>
      {T("Nobody runs this project yet. Take it on to run it.")}
    </Alert>
  );
}

/** The admin fee and the months: Admin opens each invoice; the homeowner goes to Payments; managers see statuses. */
function PaymentsCard({ pid }: { pid: number }) {
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  if (!me || !["project_manager", "superadmin", "finance", "homeowner"].includes(me.role)) return null;
  const admin = handlesPayments(me.role);
  return (
    <>
      <ProjectPayments pid={pid} onOpen={admin ? setOpen : me.role === "homeowner" ? (id) => router.push(`/payments?invoice=${id}`) : undefined} />
      {open !== null && <InvoiceDialog id={open} admin onClose={() => setOpen(null)} onChanged={() => undefined} />}
    </>
  );
}
