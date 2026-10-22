"use client";

import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CloudRoundedIcon from "@mui/icons-material/CloudRounded";
import ElectricalServicesRoundedIcon from "@mui/icons-material/ElectricalServicesRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import NightsStayRoundedIcon from "@mui/icons-material/NightsStayRounded";
import ThunderstormRoundedIcon from "@mui/icons-material/ThunderstormRounded";
import UmbrellaRoundedIcon from "@mui/icons-material/UmbrellaRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Co2RoundedIcon from "@mui/icons-material/Co2Rounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import ForestRoundedIcon from "@mui/icons-material/ForestRounded";
import FactoryRoundedIcon from "@mui/icons-material/FactoryRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import ReportProblemRoundedIcon from "@mui/icons-material/ReportProblemRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { AreaChart, ChartCard, ColumnChart, DataTable as PlainTable, StatTile, TILE_GRID } from "@/components/charts";
import { DataTable, type TableCol } from "@/components/data-table";
import { Field, MDialog } from "@/components/m";
import { Page } from "@/components/shell";
import { SegTabs, TopBar } from "@/components/topbar";
import { ago, dt2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";
import {
  type AlarmLevel,
  capacity,
  type Connection,
  energy,
  type EnergyPeriod,
  type EnergySeries,
  HEALTH,
  HEALTH_LABEL,
  type Health,
  LEVEL_LABEL,
  LEVELS,
  inverterStatus,
  KIND_LABEL,
  type PlantDetail,
  type PlantDevice,
  type PlantWeather,
  periodTitle,
  type PowerSeries,
  type DeviceReadings,
  power,
  reading,
  type ReportBy,
  type SolarReport,
  sgd,
  shiftDate,
  STATE_LABEL,
} from "@/lib/client/solar";

// Status colours are kept for state, with an icon and a word, never colour alone.
const HEALTH_COLOR: Record<Health, (t: Theme) => string> = {
  normal: (t) => t.palette.success.main,
  faulty: (t) => t.palette.error.main,
  disconnected: (t) => t.palette.text.disabled,
  unknown: (t) => t.palette.divider,
};
const LEVEL_ICON: Record<AlarmLevel, ReactNode> = {
  critical: <ErrorRoundedIcon fontSize="small" />,
  major: <ReportProblemRoundedIcon fontSize="small" />,
  minor: <WarningAmberRoundedIcon fontSize="small" />,
  warning: <InfoRoundedIcon fontSize="small" />,
};
const LEVEL_COLOR: Record<AlarmLevel, string> = { critical: "error.main", major: "warning.main", minor: "warning.main", warning: "info.main" };

export function HealthChip({ health }: { health: Health }) {
  return (
    <Chip
      // A span: it also sits in the header's line of text (a <p>).
      component="span"
      size="small"
      variant="outlined"
      label={TR(HEALTH_LABEL[health])}
      icon={<Box component="span" sx={(t) => ({ width: 8, height: 8, borderRadius: "50%", bgcolor: HEALTH_COLOR[health](t), ml: "8px !important" })} />}
      data-testid={`health-${health}`}
    />
  );
}

/** Whether FusionSolar is connected, and how fresh the figures are. */
export function ConnectionNote({ connection, staff }: { connection: Connection; staff: boolean }) {
  if (!connection.connected) {
    return (
      <Alert severity="info" sx={{ mt: 1.5 }} data-testid="solar-not-connected">
        {staff
          ? T("FusionSolar isn't connected yet, so these are the last figures brought in. Once its API account is set up, they update every 15 minutes.")
          : T("Live figures from your system's monitoring appear here once it's connected.")}
      </Alert>
    );
  }
  return (
    <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1 }} data-testid="solar-updated">
      {connection.lastSync ? T("From FusionSolar · updated {when}", { when: ago(connection.lastSync) }) : T("From FusionSolar · waiting for the first update")}
    </Typography>
  );
}

/** Plants by health: one bar split in proportion, and each part named with its count. */
export function HealthCard({ health }: { health: Record<Health, number> }) {
  const total = HEALTH.reduce((n, [k]) => n + health[k], 0);
  return (
    <Card sx={{ p: 2.25 }} data-testid="solar-health">
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
        {T("Plant status")}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {T(total === 1 ? "1 plant" : "{n} plants", { n: total })}
      </Typography>
      <Stack direction="row" sx={{ mt: 1.5, height: 10, borderRadius: 5, overflow: "hidden", gap: "2px", bgcolor: "action.hover" }} aria-hidden>
        {HEALTH.filter(([k]) => health[k] > 0).map(([k]) => (
          <Box key={k} sx={(t) => ({ flex: health[k], bgcolor: HEALTH_COLOR[k](t) })} />
        ))}
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 1, mt: 1.5 }}>
        {HEALTH.filter(([k]) => k !== "unknown" || health.unknown > 0).map(([k, l]) => (
          <Stack key={k} direction="row" sx={{ gap: 1, alignItems: "baseline" }}>
            <Box sx={(t) => ({ width: 10, height: 10, borderRadius: "50%", bgcolor: HEALTH_COLOR[k](t), flex: "0 0 auto", alignSelf: "center" })} />
            <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{health[k]}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}>
              {TR(l)}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Card>
  );
}

/** Active alarms, by FusionSolar's four levels. */
export function AlarmsCard({ alarms }: { alarms: Record<AlarmLevel, number> }) {
  const total = LEVELS.reduce((n, [k]) => n + alarms[k], 0);
  return (
    <Card sx={{ p: 2.25 }} data-testid="solar-alarms">
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
        {T("Active alarms")}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {total ? T(total === 1 ? "1 alarm" : "{n} alarms", { n: total }) : T("None")}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 1, mt: 1.5 }}>
        {LEVELS.map(([k, l]) => (
          <Stack key={k} direction="row" sx={{ gap: 0.75, alignItems: "center", color: alarms[k] ? LEVEL_COLOR[k] : "text.disabled" }}>
            {LEVEL_ICON[k]}
            <Typography sx={{ fontWeight: 700, fontSize: 18, color: "text.primary" }}>{alarms[k]}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {TR(l)}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Card>
  );
}

/** Calls ``fn`` every ``ms`` while the page is showing (live figures, as FusionSolar refreshes them). */
export function useEvery(fn: () => unknown, ms = 60_000, on = true) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => document.visibilityState === "visible" && void latest.current(), ms);
    return () => clearInterval(timer);
  }, [ms, on]);
}

const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/**
 * Power through the day, every 5 minutes, as FusionSolar draws it: a plant's, all plants' together, or
 * one inverter's. Today's updates itself every minute; the arrows go back a day at a time.
 */
export function PowerPanel({ path, title = "Power", compact = false, testId = "power-chart" }: { path: string; title?: string; compact?: boolean; testId?: string }) {
  const [day, setDay] = useState(today);
  const { data, error, reload } = useApi<PowerSeries>(`${path}?date=${day}`);
  const isToday = day === today();
  useEvery(reload, 60_000, isToday);
  const sub = !data
    ? undefined
    : data.peakKw === null
      ? T("No readings for this day yet")
      : [isToday && data.latestKw !== null ? T("Now {kw}", { kw: power(data.latestKw) }) : null, T("Peak {kw} at {time}", { kw: power(data.peakKw), time: data.peakAt ?? "" }), data.by === "hour" ? T("hourly averages") : null]
          .filter(Boolean)
          .join(" · ");
  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "flex-end", maxWidth: "100%", mb: compact ? 0 : 0.5 }}>
        <IconButton aria-label={T("Earlier")} onClick={() => setDay((d) => shiftDate(d, "day", -1))}>
          <ChevronLeftRoundedIcon />
        </IconButton>
        <Typography sx={{ fontWeight: 600, flex: "0 1 auto", minWidth: 0, overflowWrap: "anywhere", textAlign: "center" }}>{isToday ? T("Today") : periodTitle(day, "day")}</Typography>
        <IconButton aria-label={T("Later")} disabled={isToday} onClick={() => setDay((d) => shiftDate(d, "day", 1))}>
          <ChevronRightRoundedIcon />
        </IconButton>
      </Stack>
      {error && <Alert severity="error">{error.message}</Alert>}
      {!data && !error && <Skeleton variant="rounded" height={compact ? 200 : 280} />}
      {data && (
        <ChartCard
          title={TR(title)}
          sub={sub}
          table={{ head: [T("Time"), "kW"], rows: data.points.filter((p) => p.kw !== null).map((p) => [p.label, p.kw ?? 0]) }}
          testId={testId}
        >
          <AreaChart
            points={data.points.map((p) => ({ label: p.label, value: p.kw }))}
            series={title}
            unit="kW"
            height={compact ? 170 : 230}
            tickEvery={data.by === "hour" ? 4 : 48}
          />
        </ChartCard>
      )}
    </Box>
  );
}

function weatherIcon(text: string): ReactNode {
  const t = text.toLowerCase();
  if (t.includes("thunder")) return <ThunderstormRoundedIcon />;
  if (t.includes("rain") || t.includes("shower")) return <UmbrellaRoundedIcon />;
  if (t.includes("night")) return <NightsStayRoundedIcon />;
  if (t.includes("cloud") || t.includes("haz") || t.includes("mist") || t.includes("fog")) return <CloudRoundedIcon />;
  return <WbSunnyRoundedIcon />;
}

/** Singapore's weather where the plant is: NEA's 2-hour forecast for its area, and the nearest temperature. */
export function WeatherNow({ w }: { w: PlantWeather | null | undefined }) {
  if (!w || (!w.forecast && w.temperatureC === null)) return null;
  const now = [w.forecast ? TR(w.forecast) : null, w.temperatureC !== null ? `${w.temperatureC.toFixed(1)} °C` : null].filter(Boolean).join(" · ");
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, rowGap: 0.25, mt: 1.5, px: 0.5, flexWrap: "wrap" }} data-testid="plant-weather">
      <Box sx={{ color: "primary.main", display: "grid" }}>{weatherIcon(w.forecast ?? "")}</Box>
      <Typography sx={{ fontWeight: 600 }}>{now}</Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}>
        {w.area && w.valid ? T("NEA forecast for {area}, {when}", { area: w.area, when: w.valid }) : T("From NEA")}
      </Typography>
    </Stack>
  );
}

/** One stage of the energy flow: an icon, what it's doing now, and a line under it. */
function FlowNode({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string | null }) {
  return (
    <Box sx={{ textAlign: "center", minWidth: 0, p: 1 }}>
      <Box sx={(t) => ({ width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", mx: "auto", color: "primary.main", bgcolor: alpha(t.palette.primary.main, 0.12) })}>{icon}</Box>
      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{value}</Typography>
      {sub && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", overflowWrap: "anywhere" }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

/** The line between two stages; it moves while power flows (not for those who'd rather it didn't). */
function FlowLine({ on }: { on: boolean }) {
  return (
    <Box
      aria-hidden
      sx={(t) => ({
        alignSelf: "center",
        justifySelf: "center",
        width: { xs: 3, sm: "100%" },
        height: { xs: 28, sm: 3 },
        minWidth: { sm: 40 },
        borderRadius: 2,
        backgroundImage: on
          ? {
              xs: `repeating-linear-gradient(180deg, ${t.palette.primary.main} 0 8px, transparent 8px 14px)`,
              sm: `repeating-linear-gradient(90deg, ${t.palette.primary.main} 0 8px, transparent 8px 14px)`,
            }
          : `linear-gradient(${t.palette.divider}, ${t.palette.divider})`,
        backgroundSize: { xs: "3px 14px", sm: "14px 3px" },
        animation: on ? { xs: "gha-flow-down 0.9s linear infinite", sm: "gha-flow-right 0.9s linear infinite" } : "none",
        "@keyframes gha-flow-right": { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "14px 0" } },
        "@keyframes gha-flow-down": { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "0 14px" } },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      })}
    />
  );
}

/**
 * Energy flow, as FusionSolar draws it, from what the plant reports: the panels' DC power into the
 * inverters, their AC output (and efficiency) out to the home and the grid. Without a meter, the split
 * between the home and the grid isn't known, so it's one stage; with one, today's split shows.
 */
export function EnergyFlow({ p }: { p: PlantDetail }) {
  const inverters = p.devices.filter((d) => d.kind === "inverter");
  const inputs = inverters.map((d) => d.readings?.inputKw).filter((v): v is number => v !== null && v !== undefined);
  const dc = p.live && inputs.length ? inputs.reduce((a, b) => a + b, 0) : null;
  const ac = p.live ? p.currentKw : null;
  const eff = dc && ac && dc > 0 ? Math.min(100, (ac / dc) * 100) : null;
  const split = p.feedInTodayKwh != null || p.usedTodayKwh != null;
  return (
    <Card sx={{ p: 2, mt: 1.5 }} data-testid="energy-flow">
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
        {T("Energy flow")}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) minmax(40px, 0.5fr) minmax(0, 1fr) minmax(40px, 0.5fr) minmax(0, 1fr)" }, alignItems: "center", mt: 1 }}>
        <FlowNode icon={<SolarPowerRoundedIcon />} label={T("Solar panels")} value={dc !== null ? power(dc) : p.live ? "—" : T("Not live")} sub={capacity(p.capacityKwp)} />
        <FlowLine on={(dc ?? ac ?? 0) > 0} />
        <FlowNode
          icon={<ElectricalServicesRoundedIcon />}
          label={T(inverters.length === 1 ? "Inverter" : "{n} inverters", { n: inverters.length })}
          value={ac !== null ? power(ac) : "—"}
          sub={eff !== null ? T("{pct}% efficient", { pct: eff.toFixed(1) }) : null}
        />
        <FlowLine on={(ac ?? 0) > 0} />
        <FlowNode
          icon={<HomeRoundedIcon />}
          label={T("Home and grid")}
          value={ac !== null ? power(ac) : "—"}
          sub={split ? T("Today: {grid} to the grid, {home} used", { grid: energy(p.feedInTodayKwh ?? 0), home: energy(p.usedTodayKwh ?? 0) }) : T("No meter, so the split isn't measured")}
        />
      </Box>
    </Card>
  );
}

/**
 * A plant's strings as FusionSolar's layout view would show its panels (these inverters have no
 * optimisers, so the string is the finest level): each string's power, and any making much less than
 * the others, the usual sign of shading, dirt or a loose connection.
 */
function StringTiles({ strings }: { strings: DeviceReadings["strings"] }) {
  const kw = strings.map((s) => (s.voltage !== null && s.current !== null ? (s.voltage * s.current) / 1000 : null));
  const known = kw.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  const max = known.length ? known[known.length - 1] : 0;
  const low = strings.filter((_, i) => median > 0.1 && kw[i] !== null && (kw[i] ?? 0) < 0.6 * median).map((s) => `PV${s.n}`);
  return (
    <>
      {low.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }} data-testid="strings-low">
          {T("{strings} making much less than the other strings: check for shading, dirty panels or a loose connection.", { strings: low.join(", ") })}
        </Alert>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 0.75, mb: 1 }} data-testid="string-tiles">
        {strings.map((s, i) => {
          const share = max > 0 && kw[i] !== null ? (kw[i] ?? 0) / max : 0;
          const isLow = low.includes(`PV${s.n}`);
          return (
            <Box
              key={s.n}
              sx={(t) => ({
                p: 1,
                borderRadius: 1.5,
                border: 1,
                borderColor: isLow ? "warning.main" : "divider",
                bgcolor: alpha(isLow ? t.palette.warning.main : t.palette.primary.main, 0.06 + 0.3 * share),
              })}
            >
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }}>
                PV{s.n}
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{kw[i] !== null ? power(kw[i]) : "—"}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                {reading(s.voltage, "V", 0)} · {reading(s.current, "A", 1)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

// ------------------------------------------------------------------ one plant

type PlantTab = "overview" | "energy" | "devices" | "alarms" | "report";
export const PLANT_TABS: Array<[PlantTab, string]> = [
  ["overview", "Overview"],
  ["energy", "Energy"],
  ["devices", "Devices"],
  ["alarms", "Alarms"],
  ["report", "Report"],
];

export function PlantOverview({ p, base }: { p: PlantDetail; base: string }) {
  return (
    <>
      <WeatherNow w={p.weather} />
      <EnergyFlow p={p} />
      <PowerPanel path={`${base}/power`} />
      <Box sx={{ ...TILE_GRID, mt: 1.5 }}>
        <StatTile label="Power now" value={p.live ? power(p.currentKw) : "—"} icon={<BoltRoundedIcon />} sub={p.live ? undefined : T("Not live just now")} testId="ptile-power" />
        <StatTile label="Yield today" value={energy(p.todayKwh)} icon={<WbSunnyRoundedIcon />} sub={p.todayRevenue !== null ? T("{amount} today", { amount: sgd(p.todayRevenue) }) : undefined} testId="ptile-today" />
        <StatTile label="Yield this month" value={energy(p.monthKwh)} icon={<SolarPowerRoundedIcon />} testId="ptile-month" />
        <StatTile label="Yield this year" value={energy(p.yearKwh)} icon={<SolarPowerRoundedIcon />} testId="ptile-year" />
        <StatTile label="Total yield" value={energy(p.totalKwh)} icon={<SavingsRoundedIcon />} sub={p.totalRevenue !== null ? T("{amount} in all", { amount: sgd(p.totalRevenue) }) : undefined} testId="ptile-total" />
      </Box>
      <Box sx={{ display: "grid", gap: 1.5, mt: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 1fr" } }}>
        <Card sx={{ p: 2.25 }} data-testid="plant-benefits">
          <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5, mb: 1.5 }}>
            {T("Environmental benefits")}
          </Typography>
          <Stack sx={{ gap: 1.5 }}>
            <Benefit icon={<FactoryRoundedIcon />} value={p.benefits.coalTons === null ? "—" : T("{n} tonnes", { n: p.benefits.coalTons })} label={T("Standard coal saved")} />
            <Benefit icon={<Co2RoundedIcon />} value={p.benefits.co2Tons === null ? "—" : T("{n} tonnes", { n: p.benefits.co2Tons })} label={T("CO₂ avoided")} />
            <Benefit icon={<ForestRoundedIcon />} value={p.benefits.trees === null ? "—" : String(p.benefits.trees)} label={T("Equivalent trees planted")} />
          </Stack>
        </Card>
        <Card sx={{ p: 2.25 }} data-testid="plant-facts">
          <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5, mb: 1 }}>
            {T("Plant")}
          </Typography>
          <Fact label={T("Status")} value={<HealthChip health={p.health} />} />
          <Fact label={T("Installed capacity")} value={capacity(p.capacityKwp)} />
          <Fact label={T("Grid connection date")} value={p.gridConnectedOn ?? "—"} />
          {p.feedInTodayKwh != null && <Fact label={T("Fed into the grid today")} value={energy(p.feedInTodayKwh)} />}
          {p.usedTodayKwh != null && <Fact label={T("Used today")} value={energy(p.usedTodayKwh)} />}
          <Fact label={T("Contract rate")} value={p.rate !== null ? T("{rate} per kWh", { rate: sgd(p.rate) }) : "—"} />
          {p.address && <Fact label={T("Address")} value={p.address} />}
        </Card>
      </Box>
    </>
  );
}

function Benefit({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
      <Box sx={{ color: "primary.main", display: "grid" }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
      </Box>
    </Stack>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2, rowGap: 0.25, py: 0.75, flexWrap: "wrap", borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Box sx={{ fontWeight: 600, textAlign: "right", ml: "auto", minWidth: 0, overflowWrap: "anywhere", fontSize: 14 }}>{value}</Box>
    </Stack>
  );
}

const PERIODS: Array<[EnergyPeriod, string]> = [
  ["day", "Day"],
  ["month", "Month"],
  ["year", "Year"],
  ["lifetime", "Lifetime"],
];

/** Yield by hour of a day, day of a month, month of a year, or by year; with the revenue it earned. */
export function EnergyPanel({ base }: { base: string }) {
  const [period, setPeriod] = useState<EnergyPeriod>("day");
  const [day, setDay] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  const { data, error } = useApi<EnergySeries>(`${base}/energy?period=${period}&date=${day}`);
  const hasRevenue = Boolean(data?.points.some((p) => p.revenue !== null));
  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" sx={{ gap: 1, rowGap: 1, alignItems: "center", flexWrap: "wrap", mb: 1.5 }}>
        {/* The four share the row; with large text their words shrink to fit (components/auto-fit). */}
        <ToggleButtonGroup exclusive size="small" value={period} onChange={(_, v: EnergyPeriod | null) => v && setPeriod(v)} aria-label={T("Period")} sx={{ flex: "1 1 260px", maxWidth: { xs: "100%", sm: 360 }, minWidth: 0 }}>
          {PERIODS.map(([v, l]) => (
            <ToggleButton key={v} value={v} data-testid={`energy-${v}`} sx={{ flex: 1, minWidth: 0, px: 0.75 }}>
              <Box component="span" data-fit sx={{ maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {T(l)}
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {period !== "lifetime" && (
          <Stack direction="row" sx={{ alignItems: "center", maxWidth: "100%", ml: { sm: "auto" } }}>
            <IconButton aria-label={T("Earlier")} onClick={() => setDay((d) => shiftDate(d, period, -1))}>
              <ChevronLeftRoundedIcon />
            </IconButton>
            <Typography sx={{ fontWeight: 600, flex: "0 1 auto", minWidth: { xs: 0, sm: 110 }, overflowWrap: "anywhere", textAlign: "center" }}>{periodTitle(day, period)}</Typography>
            <IconButton aria-label={T("Later")} onClick={() => setDay((d) => shiftDate(d, period, 1))}>
              <ChevronRightRoundedIcon />
            </IconButton>
          </Stack>
        )}
      </Stack>
      {error && <Alert severity="error">{error.message}</Alert>}
      {!data && !error && <Skeleton variant="rounded" height={260} />}
      {data && (
        <ChartCard
          title={T("Yield")}
          sub={data.totalKwh !== null ? energy(data.totalKwh) : T("No figures for this period yet")}
          table={{ head: [T("Period"), "kWh", ...(hasRevenue ? [T("Revenue (S$)")] : [])], rows: data.points.filter((p) => p.kwh !== null).map((p) => [p.label, p.kwh ?? 0, ...(hasRevenue ? [p.revenue ?? 0] : [])]) }}
          testId="energy-chart"
        >
          <ColumnChart data={data.points.map((p) => ({ label: p.label, values: [p.kwh ?? 0] }))} series={["Yield (kWh)"]} height={240} />
        </ChartCard>
      )}
    </Box>
  );
}

export function DevicesPanel({ p, base }: { p: PlantDetail; base: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!p.devices.length) {
    return (
      <Card sx={{ p: 3, mt: 1.5, textAlign: "center", color: "text.secondary" }} data-testid="devices-empty">
        {T("No devices brought in yet.")}
      </Card>
    );
  }
  const shown = open !== null ? p.devices[open] : null;
  return (
    <>
      <Stack sx={{ gap: 1, mt: 1.5 }} data-testid="devices">
        {p.devices.map((d, i) => (
          <Card key={`${d.serial ?? d.name}-${i}`} sx={{ p: 2 }} data-testid={`device-${d.kind}`}>
            <Stack direction="row" sx={{ gap: 1, rowGap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{d.name ?? TR(KIND_LABEL[d.kind])}</Typography>
              <Chip size="small" variant="outlined" label={TR(KIND_LABEL[d.kind])} />
              {d.state && <Chip size="small" label={TR(STATE_LABEL[d.state])} color={d.state === "producing" ? "success" : "default"} variant={d.state === "producing" ? "filled" : "outlined"} />}
              <Typography variant="body2" sx={{ color: "text.secondary", ml: "auto", minWidth: 0, overflowWrap: "anywhere" }}>
                {d.model ?? ""}
              </Typography>
            </Stack>
            {d.kind === "inverter" && (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 1, mt: 1 }}>
                <Fig label={T("Power now")} value={power(d.currentKw)} />
                <Fig label={T("Yield today")} value={energy(d.todayKwh)} />
                <Fig label={T("Total yield")} value={energy(d.totalKwh)} />
              </Box>
            )}
            <Stack direction="row" sx={{ gap: 1, rowGap: 0.5, alignItems: "center", flexWrap: "wrap", mt: 1 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 0, overflowWrap: "anywhere", mr: "auto" }}>
                {[d.serial ? T("Serial {sn}", { sn: d.serial }) : null, d.softwareVersion ? T("Software {v}", { v: d.softwareVersion }) : null].filter(Boolean).join(" · ")}
              </Typography>
              <Button size="small" onClick={() => setOpen(i)} data-testid="device-open">
                {T("Details")}
              </Button>
            </Stack>
          </Card>
        ))}
      </Stack>
      {shown && <DeviceDialog d={shown} base={base} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Everything FusionSolar shows about one device: its live readings, by group, and what it is. */
function DeviceDialog({ d, base, onClose }: { d: PlantDevice; base: string; onClose: () => void }) {
  const r = d.readings;
  const status = r ? inverterStatus(r.inverterState) : null;
  return (
    <MDialog title={d.name ?? TR(KIND_LABEL[d.kind])} onClose={onClose}>
      <Box data-testid="device-dialog">
        {d.liveAt && (
          <Typography variant="caption" component="p" sx={{ color: "text.secondary", mb: 1 }}>
            {T("Readings from {when}", { when: ago(d.liveAt) })}
          </Typography>
        )}
        {d.kind === "inverter" && !r && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {T("No live readings from this inverter just now.")}
          </Alert>
        )}
        {d.kind === "inverter" && <PowerPanel path={`${base}/devices/${d.id}/power`} title="Power" compact testId="device-power-chart" />}
        {r && (
          <>
            <DeviceSection title="Status">
              {status && <Fact label={T("Inverter status")} value={TR(status)} />}
              {d.state && <Fact label={T("Running state")} value={TR(STATE_LABEL[d.state])} />}
              {r.startedAt && <Fact label={T("Switched on")} value={dt2s(r.startedAt)} />}
              {r.stoppedAt && <Fact label={T("Switched off")} value={dt2s(r.stoppedAt)} />}
            </DeviceSection>
            <DeviceSection title="Output">
              <Fact label={T("Power now")} value={power(d.currentKw)} />
              <Fact label={T("Input power (DC)")} value={power(r.inputKw)} />
              <Fact label={T("Reactive power")} value={reading(r.reactiveKvar, "kvar", 3)} />
              <Fact label={T("Power factor")} value={reading(r.powerFactor, "", 3)} />
              <Fact label={T("Efficiency")} value={reading(r.efficiency, "%", 2)} />
              <Fact label={T("Grid frequency")} value={reading(r.frequencyHz, "Hz", 2)} />
              <Fact label={T("Inverter temperature")} value={reading(r.temperatureC, "°C")} />
              <Fact label={T("Yield today")} value={energy(d.todayKwh)} />
              <Fact label={T("Total yield")} value={energy(d.totalKwh)} />
            </DeviceSection>
            {(r.phases.length > 0 || r.lineVoltages.length > 0) && (
              <DeviceSection title="Grid">
                {r.phases.length > 0 && <PlainTable head={["Phase", "Voltage", "Current"]} rows={r.phases.map((x) => [x.phase, reading(x.voltage, "V"), reading(x.current, "A", 2)])} />}
                {r.lineVoltages.map((x) => (
                  <Fact key={x.between} label={T("Voltage {between}", { between: x.between })} value={reading(x.voltage, "V")} />
                ))}
              </DeviceSection>
            )}
            <DeviceSection title="PV strings">
              {r.strings.length > 0 && <StringTiles strings={r.strings} />}
              {r.strings.length > 0 ? (
                <PlainTable
                  head={["String", "Voltage", "Current", "Power"]}
                  rows={r.strings.map((x) => [`PV${x.n}`, reading(x.voltage, "V"), reading(x.current, "A", 2), x.voltage !== null && x.current !== null ? power((x.voltage * x.current) / 1000) : "—"])}
                />
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {T("The strings read nothing just now (at night they read zero).")}
                </Typography>
              )}
            </DeviceSection>
            {r.mppts.length > 0 && (
              <DeviceSection title="Energy by MPPT">
                <PlainTable head={["MPPT", "Total"]} rows={[...r.mppts.map((x) => [`MPPT ${x.n}`, energy(x.kwh)]), ...(r.mpptTotalKwh !== null ? [[T("All"), energy(r.mpptTotalKwh)]] : [])]} />
              </DeviceSection>
            )}
          </>
        )}
        <DeviceSection title="About">
          <Fact label={T("Type")} value={TR(KIND_LABEL[d.kind])} />
          {d.model && <Fact label={T("Model")} value={d.model} />}
          {d.serial && <Fact label={T("Serial number")} value={d.serial} />}
          {d.softwareVersion && <Fact label={T("Software version")} value={d.softwareVersion} />}
          {d.optimizers !== null && <Fact label={T("Optimisers")} value={String(d.optimizers)} />}
        </DeviceSection>
      </Box>
    </MDialog>
  );
}

function DeviceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ "& + &": { mt: 2 } }}>
      <Typography component="h3" sx={{ fontWeight: 600, fontSize: 14.5, mb: 0.5 }}>
        {TR(title)}
      </Typography>
      {children}
    </Box>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
    </Box>
  );
}

export function AlarmsPanel({ p }: { p: PlantDetail }) {
  if (!p.alarms.length) {
    return (
      <Card sx={{ p: 3, mt: 1.5, textAlign: "center", color: "text.secondary" }} data-testid="alarms-empty">
        {T("No alarms in the last 90 days.")}
      </Card>
    );
  }
  return (
    <Stack sx={{ gap: 1, mt: 1.5 }} data-testid="alarms">
      {p.alarms.map((a, i) => (
        <Card key={`${a.raisedAt}-${a.name}-${i}`} sx={{ p: 2, opacity: a.clearedAt ? 0.7 : 1 }}>
          <Stack direction="row" sx={{ gap: 1, rowGap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
            <Box sx={{ color: LEVEL_COLOR[a.level], display: "grid" }}>{LEVEL_ICON[a.level]}</Box>
            <Typography sx={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{TR(a.name)}</Typography>
            <Chip size="small" variant="outlined" label={TR(LEVEL_LABEL[a.level])} />
            {a.source === "app" && <Chip size="small" variant="outlined" label={T("Output check")} data-testid="alarm-output-check" />}
            <Chip size="small" label={a.clearedAt ? T("Cleared") : T("Active")} color={a.clearedAt ? "default" : "warning"} />
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
            {[a.device, T("Raised {when}", { when: dt2s(a.raisedAt) }), a.clearedAt ? T("Cleared {when}", { when: dt2s(a.clearedAt) }) : null].filter(Boolean).join(" · ")}
          </Typography>
          {a.cause && (
            <Typography variant="body2" sx={{ mt: 0.75, overflowWrap: "anywhere" }}>
              {TR(a.cause)}
            </Typography>
          )}
          {a.suggestion && (
            <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary", overflowWrap: "anywhere" }}>
              {T("What to do: {text}", { text: TR(a.suggestion) })}
            </Typography>
          )}
        </Card>
      ))}
    </Stack>
  );
}

type ReportRow = SolarReport["rows"][number];

/** The plant's yield as a table (by hour, day or month), with Excel for staff. */
export function ReportPanel({ base, exportable, plantName }: { base: string; exportable: boolean; plantName: string }) {
  const [by, setBy] = useState<ReportBy>("day");
  const { data, error } = useApi<SolarReport>(`${base}/report?by=${by}`);
  const cols = useMemo<TableCol<ReportRow>[]>(
    () => [
      { key: "period", label: "Period", get: (r) => r.period, width: 160 },
      { key: "kwh", label: "Yield (kWh)", type: "number", get: (r) => r.kwh, width: 120 },
      { key: "revenue", label: "Revenue (S$)", type: "number", get: (r) => r.revenue, width: 120 },
      { key: "specificYield", label: "Specific yield (kWh/kWp)", type: "number", get: (r) => r.specificYield, width: 150 },
      { key: "co2Kg", label: "CO₂ avoided (kg)", type: "number", get: (r) => r.co2Kg, width: 130 },
      { key: "coalKg", label: "Standard coal saved (kg)", type: "number", get: (r) => r.coalKg, width: 150 },
    ],
    []
  );
  return (
    <Box sx={{ mt: 1.5 }}>
      <Field select label={T("Report by")} value={by} onChange={(e) => setBy(e.target.value as ReportBy)} sx={{ maxWidth: 260, mb: 1.5 }} slotProps={{ htmlInput: { "data-testid": "report-by" } }}>
        <MenuItem value="hour">{T("Hour (today)")}</MenuItem>
        <MenuItem value="day">{T("Day (last 31 days)")}</MenuItem>
        <MenuItem value="month">{T("Month (last 12 months)")}</MenuItem>
      </Field>
      {error && <Alert severity="error">{error.message}</Alert>}
      {!data && !error && <Skeleton variant="rounded" height={200} />}
      {data && exportable && <DataTable rows={data.rows} cols={cols} rowKey={(r) => r.period} exportAs={{ what: "solar_report", title: plantName.slice(0, 31) }} testId="solar-report" />}
      {data && !exportable && (
        <Card sx={{ p: 1 }} data-testid="solar-report">
          <PlainTable
            head={["Period", "Yield (kWh)", "Revenue (S$)", "Specific yield (kWh/kWp)", "CO₂ avoided (kg)"]}
            rows={data.rows.map((r) => [r.period, r.kwh ?? "—", r.revenue ?? "—", r.specificYield ?? "—", r.co2Kg ?? "—"])}
          />
        </Card>
      )}
    </Box>
  );
}

// ------------------------------------------------------------------ linking a plant to a system

type SystemOption = { id: number; address: string; homeowner: { name: string | null } };

export function LinkDialog({ code, current, onClose, onDone }: { code: string; current: number | null; onClose: () => void; onDone: () => void }) {
  const fetcher = useFetcher();
  const { data } = useApi<{ systems: SystemOption[] }>("/maintenance");
  const [pick, setPick] = useState<string>(current === null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await fetcher(`/solar/plants/${encodeURIComponent(code)}/link`, { method: "POST", json: { systemId: pick ? Number(pick) : null } });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <MDialog title={T("Link to a system")} onClose={onClose}>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        {T("Which system in the app this FusionSolar plant is. Its monthly kWh then goes into that system's invoices.")}
      </Typography>
      <Field select label={T("System")} icon={<LinkRoundedIcon />} value={pick} onChange={(e) => setPick(e.target.value)} slotProps={{ select: { displayEmpty: true }, htmlInput: { "data-testid": "link-system" } }}>
        <MenuItem value="">{T("Not linked")}</MenuItem>
        {(data?.systems ?? []).map((s) => (
          <MenuItem key={s.id} value={String(s.id)}>
            {s.address}
            {s.homeowner.name ? ` · ${s.homeowner.name}` : ""}
          </MenuItem>
        ))}
      </Field>
      {err && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {err}
        </Alert>
      )}
      <Button variant="contained" size="large" fullWidth disabled={busy} onClick={() => void save()} sx={{ mt: 3 }} data-testid="link-save">
        {busy ? T("Saving…") : T("Save")}
      </Button>
    </MDialog>
  );
}

// ------------------------------------------------------------------ the plant screen (staff, and a homeowner's own)

/**
 * One plant, in tabs as FusionSolar has them: the overview, energy charts,
 * devices (each inverter's full readings), alarms and a report. `base` is where its data comes from
 * (/solar/plants/CODE for staff, /me/solar for a homeowner).
 */
export function PlantScreen(props: { base: string; staff: boolean; onBack?: () => void }) {
  // The open tab is in the address (?tab=devices), so a link or Back lands on it.
  return (
    <Suspense>
      <PlantTabs {...props} />
    </Suspense>
  );
}

function PlantTabs({ base, staff, onBack }: { base: string; staff: boolean; onBack?: () => void }) {
  const { data, error, reload } = useApi<PlantDetail | { plant: PlantDetail | null }>(base);
  const [tab, setTab] = useTab<PlantTab>(
    PLANT_TABS.map(([v]) => v),
    "overview"
  );
  const [linking, setLinking] = useState(false);
  const me = useMe();
  const p = data && "plant" in data ? data.plant : (data as PlantDetail | undefined);
  useEvery(reload);
  const canLink = staff && (me?.role === "project_manager" || me?.role === "superadmin");
  return (
    <>
      <TopBar
        title={p?.name ?? T(staff ? "Plant" : "My solar")}
        sub={p ? <HealthChip health={p.health} /> : undefined}
        onBack={onBack}
        action={
          canLink && p ? (
            <Button size="small" variant="contained" color="inherit" startIcon={<LinkRoundedIcon />} onClick={() => setLinking(true)} sx={{ color: "#073f2b", bgcolor: "#fff", "&:hover": { bgcolor: "#eafff4" } }} data-testid="plant-link">
              {p.systemId === null ? T("Link") : T("Change link")}
            </Button>
          ) : undefined
        }
        tabs={<SegTabs label={T("Plant")} value={tab} onChange={setTab} options={PLANT_TABS.map(([v, l]) => ({ value: v, label: l, count: v === "alarms" && p ? p.alarms.filter((a) => !a.clearedAt).length || undefined : undefined }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && <Skeleton variant="rounded" height={240} sx={{ mt: 2 }} />}
          {data && !p && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="my-solar-none">
              <SolarPowerRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No monitoring for your system yet")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {T("Once your system is connected, its output shows here: today, this month and since it was turned on.")}
              </Typography>
            </Card>
          )}
          {p && (
            <>
              <ConnectionNote connection={p.connection} staff={staff} />
              {tab === "overview" && <PlantOverview p={p} base={staff ? base : "/me/solar"} />}
              {tab === "energy" && <EnergyPanel base={staff ? base : "/me/solar"} />}
              {tab === "devices" && <DevicesPanel p={p} base={staff ? base : "/me/solar"} />}
              {tab === "alarms" && <AlarmsPanel p={p} />}
              {tab === "report" && <ReportPanel base={staff ? base : "/me/solar"} exportable={staff} plantName={p.name} />}
            </>
          )}
        </Page>
      </Box>
      {linking && p && (
        <LinkDialog
          code={p.code}
          current={p.systemId}
          onClose={() => setLinking(false)}
          onDone={() => {
            setLinking(false);
            void reload();
          }}
        />
      )}
    </>
  );
}
