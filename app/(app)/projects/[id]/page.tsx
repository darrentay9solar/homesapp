"use client";

import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import EngineeringRoundedIcon from "@mui/icons-material/EngineeringRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
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
import { type ReactNode, useCallback, useState } from "react";

import { Field, MDialog, RoleChip } from "@/components/m";
import { SectionPanel } from "@/components/project-fields";
import { DetailRow, NewProjectDialog, ProgressRing, StatusChip, TimingChip } from "@/components/projects";
import { Page } from "@/components/shell";
import { Heading, TopBar } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp, useMe } from "@/lib/client/app-state";
import { firstOpenSection, type ProjectFields, type ProjectRow, SECTIONS } from "@/lib/client/projects";

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
  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), reloadFields()]);
  }, [reload, reloadFields]);

  if (!me) return null;
  const back = () => (me.role === "homeowner" ? router.push("/") : router.back());

  return (
    <>
      <TopBar title={p?.name ?? "Project"} sub={p?.address} onBack={me.role === "homeowner" ? undefined : back} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!p && !error && <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />}
          {p && <Body p={p} fields={fields} reload={reloadAll} />}
        </Page>
      </Box>
    </>
  );
}

function Body({ p, fields, reload }: { p: ProjectRow; fields: ProjectFields | null; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const first = fields ? firstOpenSection(fields.sections) : null;
  const isOpen = (key: string) => open[key] ?? key === first;
  const ctx = fields && { pid: p.id, data: fields, reload };
  return (
    <Box sx={{ display: "grid", gap: { xs: 2, lg: 3 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1.15fr)" }, alignItems: "start", mt: 1 }}>
      <Stack sx={{ gap: 2, minWidth: 0 }}>
        {p.attention && (
          <Alert severity="error" icon={<WarningAmberRoundedIcon />} data-testid="project-flags">
            <AlertTitle sx={{ fontWeight: 600 }}>Needs attention</AlertTitle>
            {p.flags.map((f) => (
              <Typography key={f.text} variant="body2">
                {f.text}
              </Typography>
            ))}
          </Alert>
        )}
        <ActionBanner p={p} fields={fields} reload={reload} />
        <Summary p={p} />
        <Box>
          <Heading
            title="Project details"
            action={
              fields?.actions.editDetails && (
                <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )
            }
          />
          <Details p={p} />
        </Box>
      </Stack>
      <Box sx={{ minWidth: 0, mt: { lg: -2.5 } }}>
        <Heading title={fields?.relation === "homeowner" ? "Your installation" : "Milestones"} />
        <MilestoneTrack p={p} />
        <Stack sx={{ gap: 1.25, mt: 2 }}>
          {!ctx && SECTIONS.map((x) => <Skeleton key={x.key} variant="rounded" height={68} />)}
          {ctx &&
            ctx.data.sections.map((s, i) => (
              <SectionPanel key={s.key} ctx={ctx} section={s} index={i} open={isOpen(s.key)} onToggle={() => setOpen((o) => ({ ...o, [s.key]: !isOpen(s.key) }))} />
            ))}
        </Stack>
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
        <AlertTitle sx={{ fontWeight: 600, fontSize: 16 }}>Please approve your solar installation</AlertTitle>
        9 Solar Home has set up {p.name} at {p.address}. Check the details below, then approve so the installation can be scheduled.
        <Stack direction="row" sx={{ gap: 1, mt: 1.5 }}>
          <Button size="large" variant="contained" disabled={busy} onClick={() => void act("approve")} sx={{ flex: 1 }}>
            Approve
          </Button>
          {a.decline && (
            <Button size="large" variant="outlined" color="error" disabled={busy} onClick={() => setDeclining(true)} sx={{ flex: 1 }}>
              Decline
            </Button>
          )}
        </Stack>
      </Alert>
    );
  } else if (p.status === "homeowner_approved") {
    banner = (
      <Alert severity="success" data-testid="approval-banner" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <AlertTitle sx={{ fontWeight: 600 }}>Homeowner approved</AlertTitle>
        {a?.approve ? "Approve to open Milestone 1 and let the crew start." : "Waiting for a project manager to approve and open Milestone 1."}
        {a?.approve && (
          <Button size="large" variant="contained" fullWidth disabled={busy} onClick={() => void act("approve")} sx={{ mt: 1.5 }}>
            Approve &amp; Start Project
          </Button>
        )}
      </Alert>
    );
  } else if (p.status === "draft") {
    banner = (
      <Alert severity="info" data-testid="approval-banner">
        <AlertTitle sx={{ fontWeight: 600 }}>No homeowner account linked</AlertTitle>
        The homeowner is recorded as a name only.{" "}
        {a?.editDetails ? "Edit the project details to link their account, so they can approve it." : "A project manager needs to link their account."}
      </Alert>
    );
  } else if (p.status === "awaiting_homeowner" || p.status === "homeowner_declined") {
    const declined = p.status === "homeowner_declined";
    banner = (
      <Alert severity={declined ? "error" : "warning"} data-testid="approval-banner">
        <AlertTitle sx={{ fontWeight: 600 }}>{declined ? "Declined by the homeowner" : "Waiting on the homeowner"}</AlertTitle>
        {declined
          ? `Talk to ${p.homeowner.name} before asking again.`
          : `${p.homeowner.name} has been asked to approve. Milestone fields open once they and a project manager have approved.`}
        {a?.remind && (
          <Button variant="outlined" color="inherit" disabled={busy} onClick={() => void act("remind")} sx={{ mt: 1.5, display: "flex" }}>
            {declined ? "Ask again" : "Send a reminder"}
          </Button>
        )}
      </Alert>
    );
  } else if (p.milestone === 3 && !homeowner) {
    banner = (
      <Alert severity="success" data-testid="approval-banner">
        <AlertTitle sx={{ fontWeight: 600 }}>Ready for handover</AlertTitle>
        Every milestone is complete. Next comes the handover certificate for the homeowner to e-sign (the next build step).
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
    <MDialog title="Decline Project" heading={`Decline ${name}?`} subtitle="9 Solar Home will be told and will contact you. You can still approve later." onClose={onClose} maxWidth="xs">
      <Field
        label="Reason (optional)"
        icon={<ChatBubbleOutlineRoundedIcon />}
        multiline
        minRows={3}
        placeholder="e.g. I would like to change the installation date"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button size="large" variant="contained" color="error" disabled={busy} onClick={() => void onDecline(reason)}>
          Decline Project
        </Button>
        <Button size="large" onClick={onClose}>
          Cancel
        </Button>
      </Stack>
    </MDialog>
  );
}

function Summary({ p }: { p: ProjectRow }) {
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" sx={{ gap: { xs: 2, sm: 3 }, alignItems: "center" }}>
        <ProgressRing value={p.progress} color={p.attention ? "error" : "primary"} />
        <Stack sx={{ gap: 1.25, minWidth: 0, flex: 1 }}>
          <Box>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
              Status
            </Typography>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
              <StatusChip p={p} />
              <TimingChip p={p} />
            </Stack>
          </Box>
          <Box>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
              Days running
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{p.daysElapsed}</Typography>
          </Box>
        </Stack>
      </Stack>
      <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1.5 }}>
        Progress, status and days running are calculated by the system and can&apos;t be edited.
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
          <Chip size="small" color="success" variant="outlined" label="Account" sx={{ ml: 0.5, height: 20 }} />
        ) : (
          <Chip size="small" variant="outlined" label="Name only" sx={{ ml: 0.5, height: 20 }} />
        )}
      </DetailRow>
      <DetailRow icon={<PhoneRoundedIcon />} k="Homeowner contact no.">
        {p.contactNo}
      </DetailRow>
      <DetailRow icon={<PlaceOutlinedIcon />} k="Site">
        {p.postalCode ? `Singapore ${p.postalCode}` : "—"}{" "}
        {p.siteLocated ? (
          <Chip size="small" color="success" variant="outlined" label="GPS set" sx={{ ml: 0.5, height: 20 }} />
        ) : (
          <Chip size="small" color="warning" variant="outlined" label="No GPS yet" sx={{ ml: 0.5, height: 20 }} />
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
  const labels = ["M1 · Install", "M2 · Grid", "M3 · Handover"];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
      {parts.map((pc, i) => (
        <Box key={i}>
          <Box sx={(t) => ({ height: 6, borderRadius: 3, bgcolor: alpha(t.palette.text.primary, 0.08), overflow: "hidden" })}>
            <Box sx={{ height: "100%", width: `${pc}%`, bgcolor: p.milestone > i ? "primary.main" : "primary.light", transition: "width .6s" }} />
          </Box>
          <Typography variant="caption" sx={{ color: p.milestone > i ? "primary.main" : "text.secondary", fontWeight: p.milestone > i ? 600 : 400 }}>
            {labels[i]}
            {p.milestone > i && <CheckRoundedIcon sx={{ fontSize: 13, ml: 0.25, verticalAlign: "-2px" }} />}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
