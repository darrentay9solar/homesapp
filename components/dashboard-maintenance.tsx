"use client";

import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { BarList, ChartCard, ColumnChart, seriesColor, StatTile, TILE_GRID } from "@/components/charts";
import { useMaintenanceHref } from "@/components/maintenance";
import { GRID, gradText } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { bucketLabel, kwp, num, type Upkeep, type UpkeepSystem } from "@/lib/client/analytics";
import { DESIGN } from "@/lib/client/design";
import { T, TR } from "@/lib/client/i18n";

type TileKey = "systems" | "dueSoon" | "attention" | "unassigned";

const CHECK_NAME: Record<string, string> = { six_month: "6-month check", one_year: "1-year check" };

/**
 * The dashboard's Maintenance tab, from the systems 9 Solar Home looks
 * after: how many and how big, the checks coming up (6-month and 1-year) and
 * those overdue, what needs a visit, and what the systems are (plan, PPA,
 * supply, inverters, region). Tap a number to see its systems.
 */
export function UpkeepTab({ u }: { u: Upkeep }) {
  const [open, setOpen] = useState<TileKey | null>(null);
  const wide = useMediaQuery((th: Theme) => th.breakpoints.up("md"));
  // Urgent, or a check overdue: one number, as on the Maintenance page.
  const attention = [...new Set([...u.tiles.urgent.ids, ...u.tiles.overdue.ids])];
  const t: Record<TileKey, { count: number; ids: number[] }> = { ...u.tiles, attention: { count: attention.length, ids: attention } };
  const tiles: Array<{ key: TileKey; label: string; icon: ReactNode; tone?: "bad" | "warn" | "good"; sub: string }> = [
    // The typical (median) size: a few big systems pull an average up.
    { key: "systems", label: "Systems looked after", icon: <SolarPowerRoundedIcon />, sub: u.medianKwp ? T("{total} · typically {size}", { total: kwp(u.kwp), size: kwp(u.medianKwp) }) : kwp(u.kwp) },
    { key: "dueSoon", label: "Checks due in 30 days", icon: <EventRoundedIcon />, tone: t.dueSoon.count ? "warn" : undefined, sub: T("6-month and 1-year checks") },
    { key: "attention", label: "Need attention", icon: <WarningAmberRoundedIcon />, tone: attention.length ? "bad" : "good", sub: T("{a} urgent · {b} with a check overdue", { a: u.tiles.urgent.count, b: u.tiles.overdue.count }) },
    { key: "unassigned", label: "Unassigned systems", icon: <PersonOffRoundedIcon />, tone: t.unassigned.count ? "warn" : undefined, sub: T("No project manager yet") },
  ];
  const picked = open ? tiles.find((x) => x.key === open) : null;
  const list = open ? t[open].ids.map((i) => u.systems[String(i)]).filter(Boolean) : [];
  // Overdue checks lead the chart, so the work already late is on it too.
  const late = u.overdueChecks.six + u.overdueChecks.year;
  const checks = [...(late ? [{ label: T("Overdue"), values: [u.overdueChecks.six, u.overdueChecks.year] }] : []), ...u.upcoming.map((x) => ({ label: bucketLabel(x.label), values: [x.six, x.year] }))];
  const busiest = u.upcoming.reduce<(typeof u.upcoming)[number] | null>((b, x) => (x.six + x.year > (b ? b.six + b.year : 0) ? x : b), null);
  const checksSub = [
    T("6-month and 1-year checks falling due, month by month, over the next 12 months"),
    late ? T("{n} overdue", { n: late }) : null,
    busiest ? T("busiest in {month} ({n} checks)", { month: bucketLabel(busiest.label), n: busiest.six + busiest.year }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <Stack sx={{ gap: { xs: 1.5, lg: 2 } }} data-testid="dashboard-upkeep">
      <Box sx={{ ...TILE_GRID, gridAutoFlow: "row dense" }}>
        {tiles.map((x) => (
          <StatTile
            key={x.key}
            testId={`utile-${x.key}`}
            label={x.label}
            value={num(t[x.key].count)}
            icon={x.icon}
            tone={x.tone}
            sub={x.sub}
            open={open === x.key}
            expanded={!wide}
            onClick={() => setOpen((o) => (o === x.key ? null : x.key))}
          >
            {open === x.key && <SystemRows list={list} />}
          </StatTile>
        ))}
      </Box>
      {wide && picked && (
        <Card sx={(th) => ({ p: 1.5, borderColor: (th.vars ?? th).palette[picked.tone === "bad" ? "error" : "primary"].main })} data-testid="upkeep-drop">
          <Stack direction="row" sx={{ alignItems: "center", px: 1, mb: 0.5 }}>
            <Typography component="h3" sx={[{ flex: 1, fontWeight: 600, fontSize: 15.5 }, gradText()]}>
              {TR(picked.label)} · {list.length}
            </Typography>
            <IconButton size="small" aria-label={T("Close")} onClick={() => setOpen(null)}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <SystemRows list={list} />
        </Card>
      )}

      <Box sx={GRID}>
        <ChartCard
          title="Checks coming up"
          sub={checksSub}
          legend={[
            { label: "6-month checks", color: (th) => seriesColor(th, 0) },
            { label: "1-year checks", color: (th) => seriesColor(th, 1) },
          ]}
          table={{ head: ["Month", "6-month checks", "1-year checks"], rows: checks.map((x) => [x.label, ...x.values]) }}
          testId="chart-checks"
        >
          <ColumnChart data={checks} series={["6-month checks", "1-year checks"]} />
        </ChartCard>
        <ChartCard
          title="Systems turned on"
          sub={T("New systems a month over the last 12 months; each starts its checks")}
          table={{ head: ["Month", "Systems", "kWp"], rows: u.turnedOn.map((x) => [bucketLabel(x.label), x.count, x.kwp]) }}
          testId="chart-turned-on"
        >
          <ColumnChart data={u.turnedOn.map((x) => ({ label: bucketLabel(x.label), values: [x.count] }))} series={["Systems"]} />
        </ChartCard>
      </Box>

      <Box sx={GRID}>
        <ChartCard title="Maintenance plan" sub={T("Systems by the plan they're on")} table={{ head: ["Plan", "Systems", "kWp"], rows: u.byPlan.map((g) => [g.label, g.count, g.kwp]) }} testId="chart-plan">
          <BarList rows={u.byPlan.map((g) => ({ key: g.label, label: g.label, value: g.count, note: kwp(g.kwp) }))} emptyText="No systems yet." />
        </ChartCard>
        {/* When each PPA ends says more than its length: the PPA and plan years mostly match. */}
        <ChartCard
          title="When PPAs end"
          sub={T("PPA systems by the year their agreement ends: the renewals to plan for")}
          table={{ head: ["Year", "Systems", "kWp"], rows: u.ppaEnds.map((g) => [g.label, g.count, g.kwp]) }}
          testId="chart-ppa-ends"
        >
          <BarList rows={u.ppaEnds.map((g) => ({ key: g.label, label: g.label, value: g.count, note: kwp(g.kwp) }))} emptyText="No PPAs recorded yet." />
        </ChartCard>
        <ChartCard
          title="Inverters"
          sub={T("Inverters by their rating; every model is in the table")}
          table={{ head: ["Rating", "Count", "Models"], rows: u.inverterPower.map((g) => [g.label, g.count, g.models.join(", ")]) }}
          testId="chart-inverters"
        >
          <BarList rows={u.inverterPower.map((g) => ({ key: g.label, label: g.label, value: g.count, note: g.models.length > 1 ? T("{n} models", { n: g.models.length }) : g.models[0] }))} emptyText="No inverters recorded yet." />
        </ChartCard>
        <ChartCard
          title="System sizes"
          sub={u.medianKwp ? T("Systems by size; typically {size}", { size: kwp(u.medianKwp) }) : T("Systems by size")}
          table={{ head: ["Size", "Systems", "kWp"], rows: u.bySize.map((g) => [g.label, g.count, g.kwp]) }}
          testId="chart-sizes"
        >
          <BarList rows={u.bySize.map((g) => ({ key: g.label, label: g.label, value: g.count, note: kwp(g.kwp) }))} emptyText="No systems yet." />
        </ChartCard>
        <ChartCard title="Where they are" sub={T("Systems by region, from the postal code")} table={{ head: ["Region", "Systems", "kWp"], rows: u.byRegion.map((g) => [g.label, g.count, g.kwp]) }} testId="chart-upkeep-region">
          <BarList rows={u.byRegion.map((g) => ({ key: g.label, label: g.label, value: g.count, note: kwp(g.kwp) }))} emptyText="No systems yet." />
        </ChartCard>
        <ChartCard title="Supply" sub={T("Single-phase or 3-phase")} table={{ head: ["Supply", "Systems", "kWp"], rows: u.byPhase.map((g) => [g.label, g.count, g.kwp]) }} testId="chart-phase">
          <BarList rows={u.byPhase.map((g) => ({ key: g.label, label: g.label, value: g.count, note: kwp(g.kwp) }))} emptyText="No systems yet." />
        </ChartCard>
      </Box>
    </Stack>
  );
}

/** The systems behind a number: address, the next check, who looks after it. */
function SystemRows({ list }: { list: UpkeepSystem[] }) {
  const router = useRouter();
  const href = useMaintenanceHref();
  if (!list.length)
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", py: 1, px: 1 }}>
        {T("No systems here right now.")}
      </Typography>
    );
  return (
    <Stack sx={{ gap: 0.25 }} data-testid="upkeep-rows">
      {list.map((s) => {
        const late = Boolean(s.next?.overdue) || s.urgent;
        return (
          <ButtonBase
            key={s.id}
            onClick={() => router.push(href(s.id))}
            sx={(th) => ({ display: "flex", gap: 1.25, alignItems: "center", textAlign: "left", px: 1, py: 1, borderRadius: `${DESIGN.radius.listItem}px`, "&:hover": { bgcolor: (th.vars ?? th).palette.action.hover } })}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {s.address}
              </Typography>
              <Typography variant="caption" noWrap component="p" sx={{ color: late ? "error.main" : "text.secondary", fontWeight: late ? 700 : 400 }}>
                {s.urgent ? T("Urgent maintenance") : s.next ? T(s.next.overdue ? "{check} overdue since {date}" : "{check} due {date}", { check: TR(CHECK_NAME[s.next.key]), date: d2s(s.next.due) }) : T("All checks done")}
                {` · ${s.pm ?? T("Unassigned")}`}
              </Typography>
            </Box>
            <ChevronRightRoundedIcon sx={{ color: "text.secondary" }} />
          </ButtonBase>
        );
      })}
    </Stack>
  );
}
