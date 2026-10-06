"use client";

import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import EngineeringRoundedIcon from "@mui/icons-material/EngineeringRounded";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { useParams, useRouter } from "next/navigation";

import { RoleChip } from "@/components/m";
import { DetailRow, ProgressRing, StatusChip, TimingChip } from "@/components/projects";
import { Page } from "@/components/shell";
import { Heading, TopBar } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { lockReason, type ProjectRow, SECTIONS } from "@/lib/client/projects";

/**
 * One project. The automated header from the brief (progress, on track, days
 * running), what needs attention, the project's details, and its milestone
 * sections with how far each has got and whether it's open yet.
 */
export default function ProjectPage() {
  const me = useMe();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data: p, error } = useApi<ProjectRow>(me ? `/projects/${id}` : null);

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
          {!p && !error && <Skeleton variant="rounded" height={260} sx={{ borderRadius: "18px", mt: 2 }} />}
          {p && <Body p={p} />}
        </Page>
      </Box>
    </>
  );
}

function Body({ p }: { p: ProjectRow }) {
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
        <StatusBanner p={p} />
        <Summary p={p} />
        <Details p={p} />
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        <Heading title="Milestones" />
        <MilestoneTrack p={p} />
        <Stack sx={{ gap: 1.25, mt: 2 }}>
          {SECTIONS.map((s, i) => (
            <SectionCard key={s.key} p={p} index={i} section={s} />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function StatusBanner({ p }: { p: ProjectRow }) {
  if (p.status === "draft")
    return (
      <Alert severity="info">
        <AlertTitle sx={{ fontWeight: 600 }}>No homeowner account linked</AlertTitle>
        The homeowner is recorded as a name only. Link their account so they can approve the project and e-sign at handover.
      </Alert>
    );
  if (p.status === "awaiting_homeowner")
    return (
      <Alert severity="warning">
        <AlertTitle sx={{ fontWeight: 600 }}>Waiting on the homeowner</AlertTitle>
        {p.homeowner.name} has been asked to approve. Milestone fields open once they and a project manager have approved.
      </Alert>
    );
  if (p.status === "homeowner_declined")
    return (
      <Alert severity="error">
        <AlertTitle sx={{ fontWeight: 600 }}>Declined by the homeowner</AlertTitle>
        Talk to {p.homeowner.name} before asking again.
      </Alert>
    );
  return null;
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
      <Typography variant="overline" sx={{ color: "text.secondary", display: "block", pt: 1.25 }}>
        Project details
      </Typography>
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

function SectionCard({ p, index, section: s }: { p: ProjectRow; index: number; section: (typeof SECTIONS)[number] }) {
  const g = p.groups[s.key] ?? { done: 0, total: 0, complete: false };
  const lock = lockReason(p, s.key);
  return (
    <Card sx={{ p: 1.75, opacity: lock ? 0.72 : 1 }} data-testid="project-section" data-locked={Boolean(lock) || undefined}>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
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
            color: g.complete ? "#fff" : lock ? "text.disabled" : "primary.main",
            bgcolor: g.complete ? "primary.main" : lock ? alpha(t.palette.text.primary, 0.06) : alpha(t.palette.primary.main, 0.12),
          })}
        >
          {g.complete ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : lock ? <LockOutlinedIcon sx={{ fontSize: 16 }} /> : index + 1}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{s.name}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {lock ?? `${g.done} of ${g.total} fields · ${s.sub}`}
          </Typography>
        </Box>
        {g.complete ? (
          <Chip size="small" color="success" label="Done" />
        ) : (
          !lock && <Chip size="small" variant="outlined" icon={<FlagRoundedIcon />} label={`${g.total - g.done} to go`} />
        )}
      </Stack>
    </Card>
  );
}
