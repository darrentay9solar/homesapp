"use client";

import AddCircleOutlineRoundedIcon from "@mui/icons-material/AddCircleOutlineRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import HowToRegRoundedIcon from "@mui/icons-material/HowToRegRounded";
import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import ThumbUpAltRoundedIcon from "@mui/icons-material/ThumbUpAltRounded";
import TimerRoundedIcon from "@mui/icons-material/TimerRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { BarList, ChartCard, ColumnChart, DataTable, Gauge, Heatmap, StatTile, TILE_GRID, seriesColor } from "@/components/charts";
import { Field, ROLE_NAME } from "@/components/m";
import { StatusChip, useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { alarmSx, GRID, SegTabs, TopBar } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { type Analytics, bucketLabel, days, deltaText, kwp, type MiniProject, num, type Period, PERIODS, pct } from "@/lib/client/analytics";
import { useApi } from "@/lib/client/api";
import { isAdmin, type Role, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { T, TR } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";

type Tab = "overview" | "delivery" | "site" | "sales";
/** The list opened from a tile or a bar: its title and the projects in it. */
type Open = { key: string; title: string; ids: number[] } | null;

/**
 * The dashboard, for project managers and superadmins: what needs a decision
 * now, how delivery is going, the crews on site, and sales. Every tile and
 * every bar of the pipeline opens the projects behind it.
 */
export default function DashboardPage() {
  const me = useMe();
  const router = useRouter();
  const admin = isAdmin(me?.role);
  const [tab, setTab] = useTab<Tab>(["overview", "delivery", "site", "sales"], "overview");
  const [period, setPeriod] = useState<Period>("90d");
  const [pm, setPm] = useState("");
  // The open list belongs to the tab and filters it was opened under.
  const [opened, setOpened] = useState<(NonNullable<Open> & { ctx: string }) | null>(null);
  useEffect(() => {
    if (me && !admin) router.replace("/");
  }, [me, admin, router]);

  const { data, error } = useApi<Analytics>(admin ? `/analytics?period=${period}${pm ? `&pm=${pm}` : ""}` : null);
  // While a new period loads, the old numbers stay, dimmed.
  const stale = Boolean(data && (data.period.key !== period || String(data.scope.pm ?? "") !== pm));
  const ctx = `${tab}|${period}|${pm}`;
  const open: Open = opened && opened.ctx === ctx ? opened : null;
  const toggle = (key: string, title: string, ids: number[]) =>
    setOpened((o) => (o && o.ctx === ctx && o.key === key ? null : { key, title, ids, ctx }));

  if (!me || !admin) return null;
  return (
    <>
      <TopBar
        title={T("Dashboard")}
        action={
          // Audit isn't on the phone's bottom bar (five tabs fit): it's here instead.
          <IconButton component={Link} href="/audit" aria-label={T("Audit log")} sx={{ color: "#fff", display: { lg: "none" } }}>
            <FactCheckRoundedIcon />
          </IconButton>
        }
        tabs={
          <SegTabs
            label={T("Dashboard")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "delivery", label: "Delivery" },
              { value: "site", label: "Site work" },
              { value: "sales", label: "Sales" },
            ]}
          />
        }
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {/* One row of filters above everything they scope. */}
          <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1.5, mt: 1.5, mb: 2 }}>
            <Field select label={T("Period")} value={period} onChange={(e) => setPeriod(e.target.value as Period)} sx={{ minWidth: 200 }} data-testid="dashboard-period">
              {PERIODS.map(([k, l]) => (
                <MenuItem key={k} value={k}>
                  {TR(l)}
                </MenuItem>
              ))}
            </Field>
            {data?.scope.superadmin && (
              <Field
                select
                label={T("Project manager")}
                value={pm}
                onChange={(e) => setPm(e.target.value)}
                sx={{ minWidth: 240 }}
                data-testid="dashboard-pm"
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                <MenuItem value="">{T("All project managers")}</MenuItem>
                {data.scope.managers.map((m) => (
                  <MenuItem key={m.uid} value={String(m.uid)}>
                    {m.name}
                  </MenuItem>
                ))}
              </Field>
            )}
          </Stack>
          {error && <Alert severity="error">{error.message}</Alert>}
          {!data && !error && (
            <Box sx={TILE_GRID}>
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={132} />
              ))}
            </Box>
          )}
          {data && (
            <Box sx={{ opacity: stale ? 0.55 : 1, transition: "opacity .2s" }} data-testid={`dashboard-${tab}`}>
              {tab === "overview" && <Overview d={data} open={open} toggle={toggle} onPm={(uid) => setPm(String(uid))} />}
              {tab === "delivery" && <Delivery d={data} open={open} toggle={toggle} />}
              {tab === "site" && <SiteWork d={data} />}
              {tab === "sales" && <Sales d={data} />}
            </Box>
          )}
        </Page>
      </Box>
    </>
  );
}

type Props = { d: Analytics; open: Open; toggle: (key: string, title: string, ids: number[]) => void };

// ------------------------------------------------------------------ overview

function Overview({ d, open, toggle, onPm }: Props & { onPm: (uid: number) => void }) {
  const t = d.tiles;
  const p = d.period.key;
  const dueSoon = d.delivery.dueSoon.length;
  const oldest = t.late.ids.length ? d.projects[String(t.late.ids[0])]?.daysLate : 0;
  const toSign = t.handover.ids.filter((i) => d.projects[String(i)]?.status === "awaiting_signature").length;
  const tiles: Array<{ key: keyof Analytics["tiles"]; label: string; icon: ReactNode; tone?: "bad" | "warn" | "good"; sub?: string; delta?: ReturnType<typeof deltaText> }> = [
    { key: "ongoing", label: "Ongoing projects", icon: <PlayCircleOutlineRoundedIcon />, sub: dueSoon ? T("{n} due in the next 14 days", { n: dueSoon }) : T("None due in the next 14 days") },
    { key: "late", label: "Late projects", icon: <WarningAmberRoundedIcon />, tone: t.late.count ? "bad" : "good", sub: t.late.count ? T("The latest is {n} days over", { n: oldest }) : T("Everything on time") },
    { key: "noShow", label: "Crew no-shows", icon: <EventBusyRoundedIcon />, tone: t.noShow.count ? "bad" : undefined, sub: T("Visits with no check-in") },
    { key: "awaitingPm", label: "Waiting for PM approval", icon: <HowToRegRoundedIcon />, tone: t.awaitingPm.count ? "warn" : undefined, sub: T("The homeowner has approved") },
    { key: "awaitingHomeowner", label: "Waiting on the homeowner", icon: <HourglassTopRoundedIcon />, sub: T("To approve, or declined") },
    { key: "handover", label: "At handover", icon: <DrawRoundedIcon />, sub: T("{a} to sign · {b} to close", { a: toSign, b: t.handover.count - toSign }) },
    { key: "new", label: "New projects", icon: <AddCircleOutlineRoundedIcon />, delta: deltaText(t.new.delta, p), sub: TR(d.period.label) },
    { key: "closed", label: "Projects closed", icon: <TaskAltRoundedIcon />, delta: deltaText(t.closed.delta, p), sub: TR(d.period.label) },
  ];
  const tileOpen = open && tiles.some((x) => `tile-${x.key}` === open.key);
  return (
    <Stack sx={{ gap: { xs: 1.5, lg: 2 } }}>
      <Box sx={TILE_GRID}>
        {tiles.map((x) => (
          <StatTile
            key={x.key}
            testId={`tile-${x.key}`}
            label={x.label}
            value={num(t[x.key].count)}
            icon={x.icon}
            tone={x.tone}
            sub={x.sub}
            delta={x.delta}
            open={open?.key === `tile-${x.key}`}
            onClick={() => toggle(`tile-${x.key}`, x.label, t[x.key].ids)}
          />
        ))}
      </Box>
      {tileOpen && <ProjectDrop d={d} open={open} onClose={() => toggle(open.key, "", [])} />}

      <Box sx={GRID}>
        <ChartCard
          title="Started and finished"
          sub={T("Projects created and closed, {period}", { period: TR(d.period.label).toLowerCase() })}
          legend={[
            { label: "Started", color: (th) => seriesColor(th, 0) },
            { label: "Finished", color: (th) => seriesColor(th, 1) },
          ]}
          table={{ head: ["Period", "Started", "Finished"], rows: d.trend.map((x) => [bucketLabel(x.label), x.started, x.closed]) }}
          testId="chart-trend"
        >
          <ColumnChart data={d.trend.map((x) => ({ label: bucketLabel(x.label), values: [x.started, x.closed] }))} series={["Started", "Finished"]} />
        </ChartCard>
        <ChartCard title="On-time delivery" sub={T("Closed projects finished by their target date, {period}", { period: TR(d.period.label).toLowerCase() })} testId="chart-on-time">
          <Gauge value={d.onTime.rate} caption={d.onTime.closed ? T("{a} of {b} closed on time", { a: d.onTime.onTime, b: d.onTime.closed }) : T("No projects closed in this period yet.")} />
        </ChartCard>
      </Box>

      <ChartCard
        title="Where the projects are"
        sub={T("Every project by its stage. Tap a stage to see its projects.")}
        table={{ head: ["Stage", "Projects"], rows: d.pipeline.map((x) => [x.label, x.count]) }}
        testId="chart-pipeline"
      >
        <BarList rows={d.pipeline.map((x) => ({ key: x.key, label: x.label, value: x.count }))} picked={open?.key.replace(/^stage-/, "")} onPick={(k) => {
          const s = d.pipeline.find((x) => x.key === k);
          if (s) toggle(`stage-${k}`, s.label, s.ids);
        }} emptyText="No projects yet." />
        {open?.key.startsWith("stage-") && (
          <Box sx={{ mt: 1.5 }}>
            <ProjectDrop d={d} open={open} onClose={() => toggle(open.key, "", [])} flat />
          </Box>
        )}
      </ChartCard>

      {d.team && (
        <ChartCard title="By project manager" sub={T("Tap a project manager to see only their projects.")} testId="chart-team">
          <Stack sx={{ gap: 0.5 }}>
            {d.team.map((m) => (
              <ButtonBase key={m.uid} onClick={() => onPm(m.uid)} sx={(th) => ({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) repeat(4, auto)", gap: { xs: 1.25, sm: 3 }, alignItems: "center", textAlign: "left", px: 1, py: 1, borderRadius: `${DESIGN.radius.listItem}px`, "&:hover": { bgcolor: alpha(th.palette.text.primary, 0.04) } })}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {m.name}
                </Typography>
                <Figure n={m.ongoing} label="ongoing" />
                <Figure n={m.late} label="late" bad={m.late > 0} />
                <Figure n={m.closed} label="closed" />
                <Figure text={pct(m.onTime)} label="on time" />
              </ButtonBase>
            ))}
          </Stack>
        </ChartCard>
      )}
    </Stack>
  );
}

function Figure({ n, text, label, bad }: { n?: number; text?: string; label: string; bad?: boolean }) {
  return (
    <Box sx={{ textAlign: "right", minWidth: 44 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 15, color: bad ? "error.main" : "text.primary", fontVariantNumeric: "tabular-nums" }}>{text ?? num(n)}</Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.2 }}>
        {TR(label)}
      </Typography>
    </Box>
  );
}

// ------------------------------------------------------------------ the list behind a number

function ProjectDrop({ d, open, onClose, flat }: { d: Analytics; open: NonNullable<Open>; onClose: () => void; flat?: boolean }) {
  const list = open.ids.map((i) => d.projects[String(i)]).filter(Boolean);
  const body = (
    <>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.5 }}>
        <Typography component="h3" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
          {TR(open.title)} · {list.length}
        </Typography>
        <IconButton size="small" aria-label={T("Close the list")} onClick={onClose}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <ProjectRows list={list} empty="No projects here right now." />
    </>
  );
  return flat ? (
    <Box data-testid="project-drop">{body}</Box>
  ) : (
    <Card sx={{ p: { xs: 1.75, sm: 2.25 } }} data-testid="project-drop">
      {body}
    </Card>
  );
}

function ProjectRows({ list, empty }: { list: MiniProject[]; empty: string }) {
  const router = useRouter();
  const href = useProjectHref();
  if (!list.length) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", py: 1 }}>
        {TR(empty)}
      </Typography>
    );
  }
  return (
    <Stack sx={{ gap: 0.25 }}>
      {list.map((p) => (
        <ButtonBase
          key={p.id}
          onClick={() => router.push(href(p.id))}
          data-alarm={p.daysLate > 0 || p.flags.length > 0 || undefined}
          sx={(th) => ({
            display: "flex",
            gap: 1.25,
            alignItems: "center",
            textAlign: "left",
            px: 1,
            py: 1,
            borderRadius: `${DESIGN.radius.listItem}px`,
            "&:hover": { bgcolor: alpha(th.palette.text.primary, 0.04) },
            // A project with an issue is red here too, as on the Projects list.
            ...((p.daysLate > 0 || p.flags.length > 0) && { ...alarmSx(th), boxShadow: "none", mb: 0.5, "&:hover": { filter: "brightness(0.97)" } }),
          })}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {p.name}
            </Typography>
            <Typography variant="caption" noWrap component="p" sx={{ color: p.daysLate ? "error.main" : "text.secondary", fontWeight: p.daysLate ? 700 : 400 }}>
              {p.daysLate ? T("{n} days late", { n: p.daysLate }) : p.endDate ? T("Target end {date}", { date: d2s(p.endDate) }) : TR("No target date")}
              {p.pm ? ` · ${p.pm}` : ""}
            </Typography>
          </Box>
          <Box sx={{ display: { xs: "none", sm: "block" } }}>
            <StatusChip p={p} />
          </Box>
          <ChevronRightRoundedIcon sx={{ color: "text.secondary" }} />
        </ButtonBase>
      ))}
    </Stack>
  );
}

// ------------------------------------------------------------------ delivery

function Delivery({ d, open, toggle }: Props) {
  const del = d.delivery;
  const p = (ids: number[]) => ids.map((i) => d.projects[String(i)]).filter(Boolean);
  return (
    <Stack sx={{ gap: { xs: 1.5, lg: 2 } }}>
      <Box sx={TILE_GRID}>
        <StatTile label="Average project length" value={days(del.cycleDays)} icon={<TimerRoundedIcon />} sub={T("Created to closed, {n} projects", { n: del.cycleN })} />
        <StatTile label="Late projects" value={num(del.late.length)} icon={<WarningAmberRoundedIcon />} tone={del.late.length ? "bad" : "good"} sub={T("Past their target end date")} />
        <StatTile label="Due in the next 14 days" value={num(del.dueSoon.length)} icon={<EventRoundedIcon />} tone={del.dueSoon.length ? "warn" : undefined} sub={T("Still in progress")} />
        <StatTile label="Closed on time" value={pct(d.onTime.rate)} icon={<TaskAltRoundedIcon />} sub={T("{a} of {b} closed projects", { a: d.onTime.onTime, b: d.onTime.closed })} />
      </Box>
      <Box sx={GRID}>
        <ChartCard
          title="Days per stage"
          sub={T("Average days each step took, for steps finished {period}", { period: TR(d.period.label).toLowerCase() })}
          table={{ head: ["Stage", "Average days", "Projects"], rows: del.stages.map((s) => [s.label, s.avgDays ?? "—", s.n]) }}
          testId="chart-stages"
        >
          <BarList rows={del.stages.map((s) => ({ key: s.key, label: s.label, value: s.avgDays ?? 0, note: s.n ? T("{n} projects", { n: s.n }) : undefined }))} format={(v) => days(v)} emptyText="No steps finished in this period yet." />
        </ChartCard>
        <ChartCard title="How late" sub={T("Late projects by how far past their target end date. Tap a band to see them.")} table={{ head: ["Days late", "Projects"], rows: del.aging.map((a) => [a.label, a.count]) }} testId="chart-aging">
          <BarList rows={del.aging.map((a) => ({ key: a.label, label: a.label, value: a.count }))} tone={(th) => th.palette.error.main} picked={open?.key.replace(/^aging-/, "")} onPick={(k) => {
            const a = del.aging.find((x) => x.label === k);
            if (a) toggle(`aging-${k}`, T("{band} late", { band: TR(k) }), a.ids);
          }} emptyText="Nothing late. Every project is on time." />
          {open?.key.startsWith("aging-") && (
            <Box sx={{ mt: 1.5 }}>
              <ProjectDrop d={d} open={open} onClose={() => toggle(open.key, "", [])} flat />
            </Box>
          )}
        </ChartCard>
      </Box>
      <Box sx={GRID}>
        <ChartCard title="Due in the next 14 days" sub={T("Ongoing projects whose target end date is close.")} testId="list-due">
          <ProjectRows list={p(del.dueSoon)} empty="Nothing due in the next 14 days." />
        </ChartCard>
        <ChartCard title="Late projects" sub={T("The latest first.")} testId="list-late">
          <ProjectRows list={p(del.late)} empty="Nothing late. Every project is on time." />
        </ChartCard>
      </Box>
    </Stack>
  );
}

// ------------------------------------------------------------------ site work

function SiteWork({ d }: { d: Analytics }) {
  const s = d.site;
  return (
    <Stack sx={{ gap: { xs: 1.5, lg: 2 } }}>
      <Box sx={TILE_GRID}>
        <StatTile label="Site visits" value={num(s.visits)} icon={<EventRoundedIcon />} sub={TR(d.period.label)} />
        <StatTile label="Attendance" value={pct(s.attendance)} icon={<EventAvailableRoundedIcon />} tone={s.attendance !== null && s.attendance < 0.9 ? "warn" : undefined} sub={T("{a} attended · {b} missed", { a: s.attended, b: s.missed })} />
        <StatTile label="Missed visits" value={num(s.missed)} icon={<EventBusyRoundedIcon />} tone={s.missed ? "bad" : "good"} sub={T("No check-in that day")} />
        <StatTile label="Late arrivals" value={num(s.lateArrivals)} icon={<ScheduleRoundedIcon />} tone={s.lateArrivals ? "warn" : undefined} sub={T("An hour or more after the start time")} />
        <StatTile label="Average crew" value={s.avgCrew === null ? "—" : num(s.avgCrew, 1)} icon={<GroupsRoundedIcon />} sub={T("{n} check-ins", { n: s.checkIns })} />
        <StatTile label="Visits in the next 7 days" value={num(s.upcoming)} icon={<EventRoundedIcon />} sub={T("Scheduled")} />
      </Box>
      <ChartCard
        title="When crews check in"
        sub={T("Check-ins by day and hour, {period}", { period: TR(d.period.label).toLowerCase() })}
        table={{ head: ["Day", ...s.heatmap.hours.map((h) => `${h}:00`)], rows: s.heatmap.days.map((day, i) => [day, ...s.heatmap.counts[i]]) }}
        testId="chart-heatmap"
      >
        <Heatmap days={s.heatmap.days} hours={s.heatmap.hours} counts={s.heatmap.counts} />
      </ChartCard>
      <ChartCard title="Contractor scorecard" sub={T("Each contractor's projects and site visits, {period}", { period: TR(d.period.label).toLowerCase() })} testId="chart-crews">
        {s.crews.length ? (
          <DataTable
            head={["Contractor", "Ongoing", "Late", "Visits", "Attendance", "Missed", "Late arrivals"]}
            rows={s.crews.map((c) => [c.name, c.ongoing, c.late, c.visits, pct(c.attendance), c.missed, c.lateArrivals])}
          />
        ) : (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {T("No projects yet.")}
          </Typography>
        )}
      </ChartCard>
    </Stack>
  );
}

// ------------------------------------------------------------------ sales

function Sales({ d }: { d: Analytics }) {
  const s = d.sales;
  const p = d.period.key;
  const groupRows = (g: Analytics["sales"]["byRegion"]) => g.map((x) => ({ key: x.label, label: x.label, value: x.count, note: x.kwp ? kwp(x.kwp) : undefined }));
  const groupTable = (first: string, g: Analytics["sales"]["byRegion"]) => ({ head: [first, "Projects", "kWp", "Closed"], rows: g.map((x) => [x.label, x.count, x.kwp, x.closed]) });
  const scope = p === "all" ? T("All projects") : T("New projects, {period}", { period: TR(d.period.label).toLowerCase() });
  return (
    <Stack sx={{ gap: { xs: 1.5, lg: 2 } }}>
      <Box sx={TILE_GRID}>
        <StatTile label="New projects" value={num(s.newProjects.count)} icon={<AddCircleOutlineRoundedIcon />} delta={deltaText(s.newProjects.delta, p)} sub={TR(d.period.label)} />
        <StatTile label="Capacity installed" value={kwp(s.installedKwp)} icon={<SolarPowerRoundedIcon />} sub={T("{n} projects closed", { n: s.installedCount })} />
        <StatTile label="Capacity in the pipeline" value={kwp(s.pipelineKwp)} icon={<BoltRoundedIcon />} sub={T("Projects not yet closed")} />
        <StatTile label="Average system size" value={kwp(s.avgKwp)} icon={<SolarPowerRoundedIcon />} sub={T("Panels × panel capacity")} />
        <StatTile label="Homeowner approval rate" value={pct(s.approval.rate)} icon={<ThumbUpAltRoundedIcon />} sub={T("{a} approved · {b} declined", { a: s.approval.approved, b: s.approval.declined })} />
        <StatTile label="Days to homeowner approval" value={days(s.approval.avgDays)} icon={<HourglassTopRoundedIcon />} sub={T("From creating the project")} />
        <StatTile label="Account sign-ups" value={num(s.signups.count)} icon={<PersonAddAltRoundedIcon />} delta={deltaText(s.signups.delta, p)} sub={T("{n} waiting for review", { n: s.signups.pending })} />
      </Box>
      <ChartCard title="New projects" sub={TR(d.period.label)} table={{ head: ["Period", "New projects"], rows: s.trend.map((x) => [bucketLabel(x.label), x.count]) }} testId="chart-new">
        <ColumnChart data={s.trend.map((x) => ({ label: bucketLabel(x.label), values: [x.count] }))} series={["New projects"]} />
      </ChartCard>
      <Box sx={GRID}>
        <ChartCard title="By region" sub={T("{scope}, from the site's postal code", { scope })} table={groupTable("Region", s.byRegion)} testId="chart-region">
          <BarList rows={groupRows(s.byRegion)} />
        </ChartCard>
        <ChartCard title="By electricity retailer" sub={scope} table={groupTable("Retailer", s.byRetailer)} testId="chart-retailer">
          <BarList rows={groupRows(s.byRetailer)} />
        </ChartCard>
        <ChartCard title="By salesperson" sub={T("{scope}, from the Sales field", { scope })} table={groupTable("Salesperson", s.bySales)} testId="chart-sales">
          <BarList rows={groupRows(s.bySales)} />
        </ChartCard>
        <ChartCard title="Sign-ups by role" sub={T("Who asked for an account, {period}", { period: TR(d.period.label).toLowerCase() })} table={{ head: ["Role", "Requests"], rows: s.signups.byRole.map((r) => [ROLE_NAME[r.label as Role] ?? r.label, r.count]) }} testId="chart-signups">
          <BarList rows={s.signups.byRole.map((r) => ({ key: r.label, label: ROLE_NAME[r.label as Role] ?? r.label, value: r.count }))} />
        </ChartCard>
      </Box>
    </Stack>
  );
}
