"use client";

import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import ElectricalServicesRoundedIcon from "@mui/icons-material/ElectricalServicesRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import RoofingRoundedIcon from "@mui/icons-material/RoofingRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CheckDoneDialog, checkColor, EditSystemDialog, nextCheckText, useMaintenanceHref } from "@/components/maintenance";
import { DetailRow, useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { TopBar } from "@/components/topbar";
import { d2s, dt2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { isAdmin, useApp, useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { type Check, inverterText, kwpText, type MaintenanceDetail, panelText, phaseText, planText, ppaText } from "@/lib/client/maintenance";

/**
 * One system in maintenance: its checks (with Mark done), what's on the roof,
 * the contract, who looks after it, and, for a handed-over project, the
 * project it came from with its signed certificate.
 */
export default function SystemPage() {
  const me = useMe();
  const router = useRouter();
  const admin = isAdmin(me?.role);
  const { id } = useParams<{ id: string }>();
  const href = useMaintenanceHref();
  useEffect(() => {
    if (me && !admin) router.replace("/");
  }, [me, admin, router]);
  const { data, error, reload } = useApi<MaintenanceDetail>(admin ? `/maintenance/${id}` : null);
  if (!me || !admin) return null;
  const s = data?.system;
  return (
    <>
      <TopBar title={s?.address ?? T("Maintenance")} sub={s?.postalCode ? `Singapore ${s.postalCode}` : undefined} onBack={() => router.push(href())} />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />}
          {data && <Body d={data} reload={reload} />}
        </Page>
      </Box>
    </>
  );
}

function Body({ d, reload }: { d: MaintenanceDetail; reload: () => Promise<void> }) {
  const s = d.system;
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState<Check | null>(null);
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const projectHref = useProjectHref();

  async function setDone(c: Check, doneOn: string | null) {
    setBusy(true);
    try {
      await fetcher(`/maintenance/${s.id}/checks/${c.key}`, { method: "POST", json: { doneOn } });
      toast(doneOn ? T("{check} recorded as done.", { check: TR(c.label) }) : T("{check} is open again.", { check: TR(c.label) }));
      await reload();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong.", "bad");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const overdue = s.checks.filter((c) => c.state === "overdue");
  return (
    <Box sx={{ display: "grid", gap: { xs: 2, lg: 3 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1.15fr)" }, alignItems: "start", mt: 1 }}>
      <Stack sx={{ gap: 2, minWidth: 0 }}>
        {s.attention && (
          <Alert severity="error" icon={<WarningAmberRoundedIcon />} data-testid="system-flags">
            <AlertTitle sx={{ fontWeight: 600 }}>{T("Needs attention")}</AlertTitle>
            {s.urgent && (
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {s.urgentNote ? T("Urgent: {note}", { note: s.urgentNote }) : T("Urgent maintenance")}
              </Typography>
            )}
            {overdue.map((c) => (
              <Typography key={c.key} variant="body2">
                {T("{check} overdue since {date}", { check: TR(c.label), date: d2s(c.due) })}
              </Typography>
            ))}
          </Alert>
        )}

        <Card sx={{ p: { xs: 2, sm: 2.5 } }} data-testid="system-checks">
          <Typography component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
            {T("Maintenance checks")}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
            {nextCheckText(s)}
          </Typography>
          <Stack sx={{ mt: 1.5 }} divider={<Divider />}>
            {s.checks.map((c) => (
              <Stack key={c.key} direction="row" sx={{ alignItems: "center", gap: 1.5, py: 1.25 }} data-testid={`check-${c.key}`}>
                <Box sx={{ color: c.state === "done" ? "success.main" : c.state === "overdue" ? "error.main" : "text.secondary", display: "grid" }}>
                  {c.state === "done" ? <CheckCircleRoundedIcon /> : <EventRoundedIcon />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>
                    {TR(c.label)}
                  </Typography>
                  <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap", mt: 0.25 }}>
                    <Chip size="small" color={checkColor(c)} variant={c.state === "scheduled" ? "outlined" : "filled"} label={TR(STATE[c.state])} sx={{ height: 22 }} />
                    <Typography variant="caption" sx={{ color: c.state === "overdue" ? "error.main" : "text.secondary", fontWeight: c.state === "overdue" ? 700 : 400 }}>
                      {c.doneOn ? T("Done {date}", { date: d2s(c.doneOn) }) : c.due ? T("Due {date}", { date: d2s(c.due) }) : T("Not scheduled")}
                    </Typography>
                  </Stack>
                </Box>
                {d.canEdit &&
                  (c.state === "done" ? (
                    <Button size="small" startIcon={<UndoRoundedIcon />} disabled={busy} onClick={() => void setDone(c, null)} aria-label={T("Undo {check}", { check: TR(c.label) })}>
                      {T("Undo")}
                    </Button>
                  ) : (
                    <Button size="small" variant="contained" disabled={busy || !c.due} onClick={() => setMarking(c)} data-testid={`done-${c.key}`}>
                      {T("Mark done")}
                    </Button>
                  ))}
              </Stack>
            ))}
          </Stack>
        </Card>

        {d.project && (
          <Card sx={{ p: { xs: 2, sm: 2.5 } }} data-testid="system-project">
            <Typography component="h2" sx={{ fontWeight: 600, fontSize: 17 }}>
              {T("Project history")}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
              {d.project.closedAt
                ? T("{name} was handed over on {date}. Its development is done; the project is kept as a record.", { name: d.project.name ?? "", date: dt2s(d.project.closedAt) })
                : T("{name}: the project this system came from.", { name: d.project.name ?? "" })}
            </Typography>
            <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: "wrap" }}>
              <Button variant="outlined" component={Link} href={projectHref(d.project.id)} startIcon={<FolderOpenRoundedIcon />}>
                {T("Open the project")}
              </Button>
              {d.project.certificate && (
                <Button variant="outlined" component="a" href={d.project.certificate} target="_blank" rel="noopener" startIcon={<PictureAsPdfRoundedIcon />}>
                  {T("Signed certificate")}
                </Button>
              )}
            </Stack>
          </Card>
        )}
        {!d.project && (
          <Typography variant="caption" component="p" sx={{ color: "text.secondary", px: 1 }}>
            {T("Imported from the project listing. It has no project in the app; its details are kept here.")}
          </Typography>
        )}
      </Stack>

      <Box sx={{ minWidth: 0 }}>
        {d.canEdit && (
          <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 1 }}>
            <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => setEditing(true)} data-testid="edit-system">
              {T("Edit")}
            </Button>
          </Stack>
        )}
        <Card sx={{ px: 2, py: 0.5 }} data-testid="system-details">
          <DetailRow icon={<SolarPowerRoundedIcon />} k="System size">
            {kwpText(s.kwp) ?? "—"}
          </DetailRow>
          <DetailRow icon={<GridViewRoundedIcon />} k="Panels">
            {panelText(s.panels) ?? "—"}
            {s.panels.length > 1 && <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>{T("{n} panels in all", { n: s.panelCount })}</Typography>}
          </DetailRow>
          <DetailRow icon={<ElectricalServicesRoundedIcon />} k="Inverter">
            {inverterText(s.inverters) ?? "—"}
          </DetailRow>
          <DetailRow icon={<BoltRoundedIcon />} k="Supply">
            {phaseText(s.phase) ?? "—"}
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
          <DetailRow icon={<RoofingRoundedIcon />} k="Roof access">
            {s.roofAccess === null ? "—" : s.roofAccess ? T("Yes") : T("No")}
          </DetailRow>
          <DetailRow icon={<ShieldOutlinedIcon />} k="Project manager">
            {s.pm.name ?? <Chip size="small" color="warning" variant="outlined" label={T("Unassigned")} />}
          </DetailRow>
          <DetailRow icon={<PersonOutlineRoundedIcon />} k="Homeowner">
            {s.homeowner.name ?? "—"}{" "}
            {s.homeowner.linked && <Chip size="small" color="success" variant="outlined" label={T("Account")} sx={{ ml: 0.5, height: 20 }} />}
          </DetailRow>
          <DetailRow icon={<PhoneRoundedIcon />} k="Homeowner contact no.">
            {s.contactNo ?? "—"}
          </DetailRow>
          {s.notes && (
            <DetailRow icon={<NotesRoundedIcon />} k="Notes">
              <Box component="span" sx={{ whiteSpace: "pre-wrap" }}>
                {s.notes}
              </Box>
            </DetailRow>
          )}
        </Card>
      </Box>

      {editing && <EditSystemDialog d={d} onClose={() => setEditing(false)} onSaved={reload} />}
      {marking && (
        <CheckDoneDialog
          check={marking}
          turnedOn={s.turnedOn}
          busy={busy}
          onClose={() => setMarking(null)}
          onDone={async (on) => {
            if (await setDone(marking, on)) setMarking(null);
          }}
        />
      )}
    </Box>
  );
}

const STATE: Record<Check["state"], string> = {
  done: "Done",
  overdue: "Overdue",
  due_soon: "Due soon",
  scheduled: "Scheduled",
  unscheduled: "Not scheduled",
};
