"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ConstructionRoundedIcon from "@mui/icons-material/ConstructionRounded";
import GpsFixedRoundedIcon from "@mui/icons-material/GpsFixedRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { Field, MDialog } from "@/components/m";
import { Heading } from "@/components/topbar";
import { ApiError, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { type CheckIn, describeCheckIn, describeFix, type Fix, getFix, type ProjectVisits, STATE_LABEL, visitDay } from "@/lib/client/sites";

const DEV = process.env.NODE_ENV === "development";

// ------------------------------------------------------------ check in / out

type CheckTarget = { projectId: number; name: string; address: string; open: CheckIn | null; site: { lat: number | null; lng: number | null } | null };

/**
 * Checking in or out: the crew count, then the phone's GPS. The location is
 * taken fresh when the button is pressed, and the server decides whether it
 * counts. Every refusal reads the same to the crew: move and try again.
 */
export function CheckDialog({ target: t, onClose, onDone }: { target: CheckTarget; onClose: () => void; onDone: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const leaving = Boolean(t.open);
  const [crew, setCrew] = useState(String(t.open?.crewIn ?? ""));
  const [phase, setPhase] = useState<"idle" | "locating" | "sending">("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const n = Number(crew);
  const crewOk = crew !== "" && Number.isInteger(n) && (leaving ? n >= 0 : n >= 1) && n <= 200;
  const simulated = DEV && t.site?.lat != null && t.site?.lng != null;

  async function go(useSite = false) {
    setProblem(null);
    let f: Fix;
    try {
      setPhase("locating");
      f = useSite && simulated ? { lat: t.site!.lat!, lng: t.site!.lng!, accuracy: 8 } : await getFix();
      setFix(f);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't get your location.");
      setPhase("idle");
      return;
    }
    setPhase("sending");
    try {
      const path = leaving ? `/check-ins/${t.open!.id}/check-out` : `/projects/${t.projectId}/check-ins`;
      const res = await fetcher<{ message: string }>(path, { method: "POST", json: { lat: f.lat, lng: f.lng, accuracy: f.accuracy, crew: n } });
      toast(res.message);
      onClose();
      await onDone();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "That didn't go through. Try again.");
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const quality = fix ? describeFix(fix) : null;
  return (
    <MDialog title={leaving ? "Check Out" : "Check In"} heading={t.name} subtitle={t.address} onClose={onClose} maxWidth="xs">
      <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 1 }}>{leaving ? "How many crew are still on site?" : "How many crew are on site?"}</Typography>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
        <IconButton aria-label="One fewer" disabled={busy || n <= (leaving ? 0 : 1)} onClick={() => setCrew(String(Math.max(leaving ? 0 : 1, (n || 0) - 1)))} sx={{ border: 1, borderColor: "divider", width: DESIGN.height.field, height: DESIGN.height.field, borderRadius: `${DESIGN.radius.field}px` }}>
          <RemoveRoundedIcon />
        </IconButton>
        <Field
          type="number"
          value={crew}
          onChange={(e) => setCrew(e.target.value.replace(/[^\d]/g, ""))}
          icon={<GroupsRoundedIcon />}
          placeholder={leaving ? "0" : "e.g. 4"}
          slotProps={{ htmlInput: { inputMode: "numeric", min: leaving ? 0 : 1, max: 200, "aria-label": "Crew count", style: { textAlign: "center", fontWeight: 700 } } }}
        />
        <IconButton aria-label="One more" disabled={busy || n >= 200} onClick={() => setCrew(String((n || 0) + 1))} sx={{ border: 1, borderColor: "divider", width: DESIGN.height.field, height: DESIGN.height.field, borderRadius: `${DESIGN.radius.field}px` }}>
          <AddRoundedIcon />
        </IconButton>
      </Stack>

      <Box
        data-testid="gps-status"
        sx={(th) => ({
          mt: 2.5,
          p: 1.75,
          display: "flex",
          gap: 1.25,
          alignItems: "center",
          borderRadius: `${DESIGN.radius.field}px`,
          bgcolor: alpha(quality && !quality.good ? th.palette.warning.main : th.palette.primary.main, 0.08),
        })}
      >
        {phase === "locating" ? <CircularProgress size={20} /> : <GpsFixedRoundedIcon color={quality && !quality.good ? "warning" : "primary"} />}
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {phase === "locating" ? "Getting your location…" : phase === "sending" ? "Checking you're at the site…" : quality ? quality.text : "Your location is taken when you press the button, using your phone's GPS."}
        </Typography>
      </Box>

      {problem && (
        <Alert severity="error" sx={{ mt: 2 }} data-testid="gps-problem">
          {problem}
        </Alert>
      )}

      <Button fullWidth size="large" variant="contained" disabled={!crewOk || busy} sx={{ mt: 3 }} startIcon={leaving ? <LogoutRoundedIcon /> : <LoginRoundedIcon />} onClick={() => void go()}>
        {busy ? "Working…" : problem ? "Try Again" : leaving ? "Check Out" : "Check In"}
      </Button>
      {simulated && (
        <Button fullWidth size="small" color="warning" disabled={!crewOk || busy} sx={{ mt: 1 }} onClick={() => void go(true)}>
          Use the site&apos;s location (development only)
        </Button>
      )}
      <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 1.25 }}>
        {crewOk ? "You need to be at the house, with a good GPS signal." : leaving ? "Enter how many crew are still on site (0 if everyone's left)." : "Enter how many crew are on site."}
      </Typography>
    </MDialog>
  );
}

// ------------------------------------------------------------ schedule

function ScheduleDialog({ pid, onClose, onDone }: { pid: number; onClose: () => void; onDone: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const [f, setF] = useState({ date: todayIso, time: "09:00", note: "" });
  const [busy, setBusy] = useState(false);
  const ok = Boolean(f.date) && f.date >= todayIso;
  return (
    <MDialog title="Schedule Visit" heading="When must the EPC team be on site?" subtitle="The crew is told now, reminded an hour before, and you're alerted if nobody checks in." onClose={onClose} maxWidth="xs">
      <Stack sx={{ gap: 2.5 }}>
        <Stack direction="row" sx={{ gap: 1.5 }}>
          <Field label="Date" required type="date" icon={<CalendarMonthRoundedIcon />} value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} slotProps={{ htmlInput: { min: todayIso } }} />
          <Field label="Start time" type="time" icon={<ScheduleRoundedIcon />} value={f.time} onChange={(e) => setF((x) => ({ ...x, time: e.target.value }))} helperText="Optional" />
        </Stack>
        <Field label="Works" icon={<ConstructionRoundedIcon />} placeholder="e.g. Scaffolding and panel mounting" value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} slotProps={{ htmlInput: { maxLength: 200 } }} />
      </Stack>
      <Button
        fullWidth
        size="large"
        variant="contained"
        disabled={!ok || busy}
        sx={{ mt: 3 }}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetcher<{ message: string }>(`/projects/${pid}/visits`, { method: "POST", json: { date: f.date, time: f.time || null, note: f.note } });
            toast(res.message);
            onClose();
            await onDone();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : "Couldn't schedule it.", "bad");
            setBusy(false);
          }
        }}
      >
        {busy ? "Scheduling…" : "Schedule Visit"}
      </Button>
      <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 1.25 }}>
        The EPC team can still check in on other days too.
      </Typography>
    </MDialog>
  );
}

// ------------------------------------------------------------ the schedule

const STATE_COLOR = { upcoming: "default", today: "warning", attended: "success", missed: "error" } as const;

/** The project page's site schedule: visits, who checked in, and the buttons for whoever acts next. */
export function SiteSchedule({ pid, name, address, data, reload }: { pid: number; name: string; address: string; data: ProjectVisits; reload: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [scheduling, setScheduling] = useState(false);
  const [checking, setChecking] = useState(false);
  const site = { lat: data.site.lat, lng: data.site.lng };

  async function cancel(id: number, label: string) {
    if (!confirm(`Cancel the visit on ${label}? The crew will be told.`)) return;
    try {
      const res = await fetcher<{ message: string }>(`/projects/${pid}/visits/${id}`, { method: "DELETE" });
      toast(res.message);
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't cancel it.", "bad");
    }
  }

  return (
    <Box data-testid="site-schedule">
      <Heading
        title="Site schedule"
        count={data.visits.length}
        action={
          data.canSchedule && (
            <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setScheduling(true)}>
              Schedule visit
            </Button>
          )
        }
      />
      {data.canCheckIn && (
        <Button fullWidth size="large" variant="contained" color={data.myOpenCheckIn ? "warning" : "primary"} startIcon={data.myOpenCheckIn ? <LogoutRoundedIcon /> : <LoginRoundedIcon />} onClick={() => setChecking(true)} sx={{ mb: 1.5 }}>
          {data.myOpenCheckIn ? "Check Out" : "Check In"}
        </Button>
      )}
      {!data.site.located && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          This site has no GPS location yet, so nobody can check in. A project manager can fix it by saving the project&apos;s postal code again.
        </Alert>
      )}
      <Card>
        {data.visits.length === 0 && data.unscheduled.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", p: 2.5, textAlign: "center" }}>
            {data.canSchedule ? "No visits scheduled yet. Schedule the dates the EPC team must be on site." : "No site visits scheduled yet."}
          </Typography>
        )}
        {data.visits.map((v, i) => {
          const label = `${visitDay(v.date)}${v.time ? ` ${v.time}` : ""}`;
          return (
            <Box key={v.id} data-testid="visit-row">
              {i > 0 && <Divider />}
              <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start", p: 1.75 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{label}</Typography>
                    <Chip size="small" color={STATE_COLOR[v.state]} variant={v.state === "upcoming" ? "outlined" : "filled"} label={STATE_LABEL[v.state]} />
                  </Stack>
                  {v.note && (
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {v.note}
                    </Typography>
                  )}
                  {v.checkIns.map((c) => (
                    <Typography key={c.id} variant="caption" component="div" sx={{ color: "primary.main", mt: 0.25 }}>
                      {describeCheckIn(c)}
                    </Typography>
                  ))}
                  {v.state === "missed" && (
                    <Typography variant="caption" component="div" sx={{ color: "error.main", mt: 0.25 }}>
                      Nobody checked in. The project shows as needing attention.
                    </Typography>
                  )}
                </Box>
                {data.canSchedule && v.checkIns.length === 0 && v.state !== "missed" && (
                  <Tooltip title="Cancel this visit">
                    <IconButton size="small" aria-label={`Cancel the visit on ${label}`} onClick={() => void cancel(v.id, label)}>
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Box>
          );
        })}
        {data.unscheduled.length > 0 && (
          <Box sx={{ p: 1.75, borderTop: data.visits.length ? 1 : 0, borderColor: "divider" }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Check-ins on other days</Typography>
            {data.unscheduled.map((c) => (
              <Typography key={c.id} variant="caption" component="div" sx={{ color: "text.secondary", mt: 0.25 }}>
                {new Date(c.inAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short", timeZone: "Asia/Singapore" })} · {describeCheckIn(c)}
              </Typography>
            ))}
          </Box>
        )}
      </Card>
      {scheduling && <ScheduleDialog pid={pid} onClose={() => setScheduling(false)} onDone={reload} />}
      {checking && <CheckDialog target={{ projectId: pid, name, address, open: data.myOpenCheckIn, site }} onClose={() => setChecking(false)} onDone={reload} />}
    </Box>
  );
}
