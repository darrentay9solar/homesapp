"use client";

import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import ElectricalServicesRoundedIcon from "@mui/icons-material/ElectricalServicesRounded";
import PaymentsRoundedIcon from "@mui/icons-material/PaymentsRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { BarList, StatTile, TILE_GRID } from "@/components/charts";
import { DataTable, type TableCol } from "@/components/data-table";
import { Page } from "@/components/shell";
import { MapView, type Pin } from "@/components/map";
import { AlarmsCard, BenefitsCard, ConnectionNote, EnergyPanel, HealthCard, HealthChip, PowerPanel, useEvery } from "@/components/solar";
import { GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { T, TR } from "@/lib/client/i18n";
import { capacity, energy, HEALTH, HEALTH_LABEL, type PlantRow, power, sgd, type SolarOverview } from "@/lib/client/solar";
import { useTab } from "@/lib/client/tabs";

type Tab = "overview" | "map" | "table";
const ORDER = { faulty: 0, disconnected: 1, unknown: 2, normal: 3 } as const;

/**
 * Solar: everything FusionSolar shows, for every plant 9 Solar Home looks after
 * (the plants of the systems this person runs, for a project manager).
 */
function SolarScreen() {
  const router = useRouter();
  const preview = usePathname().startsWith("/dev-preview");
  const { data, error, reload } = useApi<SolarOverview>("/solar");
  useEvery(reload); // live, as FusionSolar is
  const [tab, setTab] = useTab<Tab>(["overview", "map", "table"], "overview");
  const [q, setQ] = useState("");
  const open = (p: PlantRow) => router.push(`${preview ? "/dev-preview" : ""}/solar/${encodeURIComponent(p.code)}`);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (data?.plants ?? [])
      .filter((p) => !words || [p.name, p.address, p.homeowner, p.projectCode].some((v) => v?.toLowerCase().includes(words)))
      .sort((a, b) => ORDER[a.health] - ORDER[b.health] || a.name.localeCompare(b.name));
  }, [data, q]);
  const k = data?.kpis;
  return (
    <>
      <TopBar
        title={T("FusionSolar")}
        search={tab === "overview" ? <SearchBox value={q} onChange={setQ} placeholder={T("Search plants, addresses, homeowners")} testId="solar-search" /> : undefined}
        tabs={
          <SegTabs
            label={T("FusionSolar")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview" as const, label: "Overview" },
              { value: "map" as const, label: "Map" },
              { value: "table" as const, label: "Table" },
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
          {!data && !error && (
            <Box sx={{ ...TILE_GRID, mt: 2 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={110} />
              ))}
            </Box>
          )}
          {data && <ConnectionNote connection={data.connection} staff />}
          {data && tab === "table" && <PlantsTable plants={data.plants} onOpen={open} />}
          {data && tab === "map" && <PlantsMap plants={data.plants} onOpen={open} />}
          {data && tab === "overview" && k && (
            <>
              <Box sx={{ ...TILE_GRID, mt: 1.5 }}>
                <StatTile label="Power now" value={power(k.currentKw)} icon={<BoltRoundedIcon />} testId="stile-power" />
                <StatTile label="Yield today" value={energy(k.todayKwh)} icon={<WbSunnyRoundedIcon />} testId="stile-today" />
                <StatTile label="Revenue today" value={sgd(k.todayRevenue)} icon={<PaymentsRoundedIcon />} sub={T("At each contract's rate")} testId="stile-revenue" />
                <StatTile label="Inverter rated power" value={k.inverterRatedKw != null ? power(k.inverterRatedKw) : "—"} icon={<ElectricalServicesRoundedIcon />} testId="stile-rated" />
                <StatTile label="Total yield" value={energy(k.totalKwh)} icon={<SavingsRoundedIcon />} testId="stile-total" />
                <StatTile label="Installed capacity" value={capacity(k.capacityKwp)} icon={<SolarPowerRoundedIcon />} sub={T(data.plants.length === 1 ? "1 plant" : "{n} plants", { n: data.plants.length })} testId="stile-capacity" />
              </Box>
              {/* FusionSolar's home page: every plant's power through the day, and yield by day, month or year. */}
              <PowerPanel path="/solar/power" title="Power (all plants)" testId="all-power-chart" />
              <EnergyPanel base="/solar" />
              <Box sx={{ display: "grid", gap: 1.5, mt: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 1fr" } }}>
                <HealthCard health={data.health} />
                <AlarmsCard alarms={data.alarms} />
                <Ranking plants={data.plants} onOpen={open} />
                {data.benefits && <BenefitsCard benefits={data.benefits} title="Environmental benefits (all plants)" testId="all-benefits" />}
              </Box>
              {data.unlinked > 0 && (
                <Alert severity="info" sx={{ mt: 1.5 }} data-testid="solar-unlinked">
                  {T(data.unlinked === 1 ? "1 plant isn't linked to a system in the app yet: open it and choose Link." : "{n} plants aren't linked to a system in the app yet: open each and choose Link.", { n: data.unlinked })}
                </Alert>
              )}
              <Heading title={T("Plants")} count={shown.length} />
              {shown.length === 0 ? (
                <Card sx={{ p: 4, textAlign: "center", color: "text.secondary" }} data-testid="solar-empty">
                  {data.plants.length ? T("Nothing matches") : T("No plants brought in from FusionSolar yet.")}
                </Card>
              ) : (
                <Box sx={GRID} data-testid="solar-grid">
                  {shown.map((p) => (
                    <PlantCard key={p.code} p={p} onOpen={() => open(p)} />
                  ))}
                </Box>
              )}
            </>
          )}
        </Page>
      </Box>
    </>
  );
}

/**
 * Plants ranked by today's yield for each kWp installed (FusionSolar's plant ranking): the best and,
 * more usefully, the worst, so a plant that's struggling shows up even when it isn't alarming.
 */
function Ranking({ plants, onOpen }: { plants: PlantRow[]; onOpen: (p: PlantRow) => void }) {
  const [worst, setWorst] = useState(true);
  const ranked = plants.filter((p) => p.specificYield !== null && (p.capacityKwp ?? 0) > 0).sort((a, b) => (a.specificYield ?? 0) - (b.specificYield ?? 0));
  const rows = (worst ? ranked : [...ranked].reverse()).slice(0, 5);
  const byCode = new Map(plants.map((p) => [p.code, p]));
  return (
    <Card sx={{ p: 2.25 }} data-testid="solar-ranking">
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, rowGap: 0.5, flexWrap: "wrap", mb: 1 }}>
        <Box sx={{ mr: "auto", minWidth: 0 }}>
          <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
            {T("Plant ranking")}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {T("Today's yield for each kWp installed")}
          </Typography>
        </Box>
        <ButtonBase onClick={() => setWorst((w) => !w)} data-testid="ranking-flip" sx={{ fontFamily: "inherit", color: "primary.main", fontWeight: 600, fontSize: 13.5, px: 1, py: 0.5, borderRadius: 1 }}>
          {worst ? T("Show the best") : T("Show the lowest")}
        </ButtonBase>
      </Stack>
      <BarList
        rows={rows.map((p) => ({ key: p.code, label: p.name, value: p.specificYield ?? 0, note: capacity(p.capacityKwp) }))}
        format={(v) => `${v.toFixed(2)} kWh/kWp`}
        onPick={(code) => {
          const p = byCode.get(code);
          if (p) onOpen(p);
        }}
        emptyText="No plant has a size and today's yield yet."
      />
    </Card>
  );
}

/** Every plant on the map of Singapore, coloured by its status; tap one for its figures. */
function PlantsMap({ plants, onOpen }: { plants: PlantRow[]; onOpen: (p: PlantRow) => void }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const colour = { normal: theme.palette.success.main, faulty: theme.palette.error.main, disconnected: theme.palette.text.disabled, unknown: theme.palette.text.disabled };
  const placed = plants.filter((p) => p.latitude != null && p.longitude != null);
  const pins: Pin[] = placed.map((p) => ({ id: p.code, lat: p.latitude as number, lng: p.longitude as number, kind: "site", label: p.name, color: colour[p.health], dim: p.health === "disconnected" }));
  const shown = placed.find((p) => p.code === picked) ?? null;
  return (
    <Box sx={{ mt: 1.5 }} data-testid="solar-map">
      <Stack direction="row" sx={{ gap: 2, rowGap: 0.5, flexWrap: "wrap", mb: 1 }}>
        {HEALTH.filter(([k]) => k !== "unknown").map(([k, l]) => (
          <Stack key={k} direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: colour[k] }} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {TR(l)}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <MapView pins={pins} picked={picked} onPick={setPicked} height={{ xs: 380, md: 520 }} testId="solar-map-view" />
      {placed.length < plants.length && (
        <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1 }}>
          {T("{n} plants have no location in FusionSolar, so aren't on the map.", { n: plants.length - placed.length })}
        </Typography>
      )}
      {shown && (
        <Box sx={{ mt: 1.5, maxWidth: 520 }}>
          <PlantCard p={shown} onOpen={() => onOpen(shown)} />
        </Box>
      )}
    </Box>
  );
}

function PlantCard({ p, onOpen }: { p: PlantRow; onOpen: () => void }) {
  return (
    <Card>
      <ButtonBase onClick={onOpen} data-testid="plant-card" sx={{ width: "100%", p: 2, display: "block", textAlign: "left", fontFamily: "inherit" }}>
        <Stack direction="row" sx={{ gap: 1, rowGap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15.5, minWidth: 0, overflowWrap: "anywhere", flex: "1 1 140px" }}>{p.name}</Typography>
          <HealthChip health={p.health} />
        </Stack>
        <Typography variant="caption" component="div" sx={{ color: "text.secondary", mt: 0.25, overflowWrap: "anywhere" }}>
          {[p.homeowner, p.projectCode, capacity(p.capacityKwp)].filter(Boolean).join(" · ")}
          {p.systemId === null ? ` · ${T("Not linked")}` : ""}
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1, mt: 1.25 }}>
          <Mini label={T("Power now")} value={p.live ? power(p.currentKw) : "—"} />
          <Mini label={T("Today")} value={energy(p.todayKwh)} />
          <Mini label={T("Total")} value={energy(p.totalKwh)} />
        </Box>
      </ButtonBase>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}

function PlantsTable({ plants, onOpen }: { plants: PlantRow[]; onOpen: (p: PlantRow) => void }) {
  const cols = useMemo<TableCol<PlantRow>[]>(
    () => [
      { key: "status", label: "Status", get: (p) => TR(HEALTH_LABEL[p.health]), width: 120 },
      { key: "name", label: "Plant", get: (p) => p.name, width: 200 },
      { key: "homeowner", label: "Homeowner", get: (p) => p.homeowner ?? null, width: 150 },
      { key: "grid", label: "Grid connection", type: "date", get: (p) => p.gridConnectedOn, width: 130 },
      { key: "kwp", label: "Capacity (kWp)", type: "number", get: (p) => p.capacityKwp, width: 120 },
      { key: "power", label: "Power now (kW)", type: "number", get: (p) => (p.live ? p.currentKw : null), width: 130 },
      { key: "specific", label: "Specific yield (kWh/kWp)", type: "number", get: (p) => p.specificYield, width: 170 },
      { key: "today", label: "Yield today (kWh)", type: "number", get: (p) => p.todayKwh, width: 140 },
      { key: "total", label: "Total yield (kWh)", type: "number", get: (p) => p.totalKwh, width: 140 },
      { key: "revenue", label: "Revenue today (S$)", type: "number", get: (p) => p.todayRevenue, width: 150 },
      { key: "linked", label: "Linked system", get: (p) => (p.systemId === null ? T("Not linked") : (p.projectCode ?? T("Linked"))), width: 140 },
    ],
    []
  );
  return <DataTable rows={plants} cols={cols} rowKey={(p) => p.code} onOpen={onOpen} exportAs={{ what: "solar", title: "Solar plants" }} testId="solar-table" />;
}

export default function SolarPage() {
  return (
    <Suspense>
      <SolarScreen />
    </Suspense>
  );
}
