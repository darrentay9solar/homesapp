"use client";

import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import ConstructionRoundedIcon from "@mui/icons-material/ConstructionRounded";
import EcoRoundedIcon from "@mui/icons-material/EnergySavingsLeafRounded";
import HealthAndSafetyRoundedIcon from "@mui/icons-material/HealthAndSafetyRounded";
import HomeWorkRoundedIcon from "@mui/icons-material/HomeWorkRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import PaidRoundedIcon from "@mui/icons-material/PaidRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Suspense } from "react";

import { AreaChart, ChartCard, StatTile, TILE_GRID } from "@/components/charts";
import { Page } from "@/components/shell";
import { SegTabs, TopBar } from "@/components/topbar";
import { ago } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { locale, T } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";

type Kpis = {
  asOf: string;
  portfolio: { systems: number; byPlan: Array<{ plan: string; n: number }>; kwp: number; kwpKnown: number; inProgress: number; newIn12Months: number; kwpNewIn12Months: number; firstOn: string | null };
  generation: {
    lifetimeKwh: number | null;
    lifetimePlants: number;
    lastMonth: string;
    lastMonthKwh: number;
    twelveMonthKwh: number;
    specificYield: { value: number | null; kwh: number; kwp: number; days: number; systems: number };
    vsEstimate: { pct: number | null; actualKwh: number; estimatedKwh: number; systems: number };
  };
  revenue: {
    lastMonth: { month: string; amount: number; kwh: number; systems: number; noRate: number };
    runRate: { fromLastMonth: number; fromThreeMonths: number; months: string[] };
    contracted: { amount: number; systems: number; monthsLeft: number; avgYearsLeft: number | null; byActual: number; byEstimate: number; defaultYears: number };
    adminFees: { fee: number; toCome: number; toComeAmount: number; issued: number; paid: number };
    invoices: { count: number; monthly: number; issued: number; paid: number; outstanding: number; overdue: number; overdueCount: number; collectedPct: number | null };
    months: Array<{ month: string; kwh: number; amount: number; systems: number }>;
  };
  customers: { avgRate: number | null; spWithGst: number | null; spFrom: string | null; cheaperPct: number | null; saved12Months: number; savedKwh: number; co2Tons: number; trees: number; co2PerKwh: number; kgPerTree: number };
  operations: { plants: number; health: Record<"normal" | "faulty" | "disconnected" | "unknown", number>; normalPct: number | null; alarms: Record<"critical" | "major" | "minor" | "warning", number>; monitored: number; lastSync: string | null };
};
type Tab = "summary" | "revenue" | "generation" | "customers" | "operations";

const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const sgd = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : `S$${num(v, digits)}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${num(v, 1)}%`);
const month = (ym: string, short = false) => new Date(`${ym}-01T00:00:00+08:00`).toLocaleDateString(locale(), { month: short ? "short" : "long", year: "numeric", timeZone: "Asia/Singapore" });

/** One calculation: what it is, how it's worked out with the figures put in, and what it comes to. */
type Calc = { label: string; how: string; result: string };

function Calculations({ rows, testId }: { rows: Calc[]; testId: string }) {
  return (
    <Card sx={{ p: 2, mt: 1.5 }} data-testid={testId}>
      <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
        {T("How each figure is worked out")}
      </Typography>
      <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
        {rows.map((r) => (
          <Box key={r.label} sx={{ py: 1.25, minWidth: 0 }}>
            <Stack direction="row" sx={{ gap: 1, rowGap: 0.25, flexWrap: "wrap", alignItems: "baseline" }}>
              <Typography sx={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{r.label}</Typography>
              <Typography sx={{ fontWeight: 600, ml: "auto", minWidth: 0, overflowWrap: "anywhere" }}>{r.result}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25, overflowWrap: "anywhere" }}>
              {r.how}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Card>
  );
}

function revenueRows(k: Kpis): Calc[] {
  const r = k.revenue;
  const c = r.contracted;
  return [
    {
      label: T("Monthly revenue"),
      how: T("Each system's kWh for {month} × its rate per kWh, to the cent, added up: {systems} systems, {kwh} kWh.", { month: month(r.lastMonth.month), systems: r.lastMonth.systems - r.lastMonth.noRate, kwh: num(r.lastMonth.kwh) }) + (r.lastMonth.noRate ? ` ${T("{n} without a rate aren't counted.", { n: r.lastMonth.noRate })}` : ""),
      result: sgd(r.lastMonth.amount, 2),
    },
    { label: T("Yearly run-rate, from last month"), how: T("{amount} × 12", { amount: sgd(r.lastMonth.amount, 2) }), result: sgd(r.runRate.fromLastMonth) },
    {
      label: T("Yearly run-rate, from three months"),
      how: T("The average of {months} × 12. Lower than last month's while new systems are still being turned on.", { months: r.runRate.months.map((m) => month(m, true)).join(", ") }),
      result: sgd(r.runRate.fromThreeMonths),
    },
    {
      label: T("Still to come from the contracts"),
      how: T(
        "For each PPA system with a rate: the months left in its own contract × its usual month's kWh × its rate. Its usual month is its average over the last 12 months ({actual} systems), or the client record's estimate where it has under 3 months ({estimate}). A system with no term of its own takes {years} years. An estimate: nothing taken off for panels ageing, weather or the time value of money.",
        { actual: c.byActual, estimate: c.byEstimate, years: c.defaultYears },
      ),
      result: sgd(c.amount),
    },
    { label: T("Contract time left, on average"), how: T("{months} months left ÷ {systems} systems ÷ 12", { months: num(c.monthsLeft), systems: c.systems }), result: T("{n} years", { n: num(c.avgYearsLeft, 1) }) },
    { label: T("Admin fees to come"), how: T("{n} installs in progress × the {fee} admin fee", { n: r.adminFees.toCome, fee: sgd(r.adminFees.fee) }), result: sgd(r.adminFees.toComeAmount) },
    {
      label: T("Collected"),
      how: T("Paid ÷ invoiced, of every invoice not voided: {paid} of {issued} ({n} invoices; {monthly} of them monthly).", { paid: sgd(r.invoices.paid, 2), issued: sgd(r.invoices.issued, 2), n: r.invoices.count, monthly: r.invoices.monthly }),
      result: pct(r.invoices.collectedPct),
    },
    { label: T("Outstanding"), how: T("Issued and not yet paid; {amount} of it past its due date ({n} invoices).", { amount: sgd(r.invoices.overdue, 2), n: r.invoices.overdueCount }), result: sgd(r.invoices.outstanding, 2) },
  ];
}

function generationRows(k: Kpis): Calc[] {
  const g = k.generation;
  return [
    { label: T("Generated since turned on"), how: T("FusionSolar's lifetime yield for each of the {n} plants, added up.", { n: g.lifetimePlants }), result: T("{n} MWh", { n: num((g.lifetimeKwh ?? 0) / 1000, 1) }) },
    { label: T("Generated last month"), how: T("Each system's kWh for {month} as invoiced (the client list to August 2026, FusionSolar from September), added up.", { month: month(g.lastMonth) }), result: T("{n} kWh", { n: num(g.lastMonthKwh) }) },
    { label: T("Generated in 12 months"), how: T("The same, for each of the last 12 finished months."), result: T("{n} kWh", { n: num(g.twelveMonthKwh) }) },
    {
      label: T("kWh per kWp a day"),
      how: T("{kwh} kWh ÷ {kwp} kWp ÷ {days} days, for the {n} systems with both a size and last month's kWh. About 3.2 to 3.6 is usual in Singapore.", { kwh: num(g.specificYield.kwh), kwp: num(g.specificYield.kwp, 1), days: g.specificYield.days, n: g.specificYield.systems }),
      result: num(g.specificYield.value, 2),
    },
    {
      label: T("Beside the estimate"),
      how: T("{actual} kWh made ÷ {estimate} kWh the client records estimate, for the {n} systems with both, last month.", { actual: num(g.vsEstimate.actualKwh), estimate: num(g.vsEstimate.estimatedKwh), n: g.vsEstimate.systems }),
      result: pct(g.vsEstimate.pct),
    },
  ];
}

function customerRows(k: Kpis): Calc[] {
  const c = k.customers;
  return [
    { label: T("What customers pay per kWh"), how: T("Last month's billing ÷ the kWh it was for (each system's rate, weighted by its kWh)."), result: c.avgRate === null ? "—" : `S$${c.avgRate.toFixed(4)}` },
    { label: T("SP's tariff per kWh, with GST"), how: T("SP Group's tariff from {date}, for homes.", { date: c.spFrom ?? "—" }), result: c.spWithGst === null ? "—" : `${c.spWithGst.toFixed(2)}¢` },
    { label: T("Cheaper than SP"), how: T("(SP's tariff − what customers pay) ÷ SP's tariff"), result: pct(c.cheaperPct) },
    { label: T("Customers saved in 12 months"), how: T("For each system and month: its kWh × (SP's tariff that month with GST − its rate), added up over {kwh} kWh.", { kwh: num(c.savedKwh) }), result: sgd(c.saved12Months) },
    { label: T("CO2 avoided"), how: T("Lifetime kWh × {kg} kg of CO2 a kWh (the factor FusionSolar uses) ÷ 1,000", { kg: c.co2PerKwh }), result: T("{n} tonnes", { n: num(c.co2Tons, 1) }) },
    { label: T("As trees planted"), how: T("CO2 avoided ÷ {kg} kg a tree takes in a year", { kg: c.kgPerTree }), result: num(c.trees) },
  ];
}

function operationRows(k: Kpis): Calc[] {
  const o = k.operations;
  return [
    { label: T("Plants running normally"), how: T("{normal} of {n} plants FusionSolar reports as normal ({faulty} faulty, {off} disconnected).", { normal: o.health.normal, n: o.plants, faulty: o.health.faulty, off: o.health.disconnected }), result: pct(o.normalPct) },
    { label: T("Active alarms"), how: T("FusionSolar's and the app's own, not yet cleared: {critical} critical, {major} major, {minor} minor, {warning} warnings.", o.alarms), result: num(o.alarms.critical + o.alarms.major + o.alarms.minor + o.alarms.warning) },
    { label: T("Systems on FusionSolar"), how: T("Systems linked to a FusionSolar plant, of {n}.", { n: k.portfolio.systems }), result: num(o.monitored) },
  ];
}

function KpiScreen() {
  const { data: k, error } = useApi<Kpis>("/kpis");
  const [tab, setTab] = useTab<Tab>(["summary", "revenue", "generation", "customers", "operations"], "summary");
  return (
    <>
      <TopBar
        title={T("Projected Analytics")}
        tabs={
          <SegTabs
            label={T("Projected Analytics")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "summary" as const, label: "Summary" },
              { value: "revenue" as const, label: "Revenue" },
              { value: "generation" as const, label: "Generation" },
              { value: "customers" as const, label: "Customers" },
              { value: "operations" as const, label: "Operations" },
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
          {!k && !error && (
            <Box sx={{ ...TILE_GRID, mt: 2 }}>
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={120} />
              ))}
            </Box>
          )}
          {k && tab === "summary" && (
            <Box sx={{ mt: 2 }}>
              <Box sx={TILE_GRID} data-testid="kpi-summary">
                <StatTile label="Systems running" value={num(k.portfolio.systems)} sub={T("{kwp} kWp installed", { kwp: num(k.portfolio.kwp, 1) })} icon={<HomeWorkRoundedIcon />} testId="kpi-systems" />
                <StatTile label="Installs in progress" value={num(k.portfolio.inProgress)} sub={T("{n} turned on in 12 months", { n: k.portfolio.newIn12Months })} icon={<ConstructionRoundedIcon />} testId="kpi-pipeline" />
                <StatTile label="Monthly revenue" value={sgd(k.revenue.lastMonth.amount)} sub={month(k.revenue.lastMonth.month)} icon={<PaidRoundedIcon />} testId="kpi-mrr" />
                <StatTile label="Yearly run-rate" value={sgd(k.revenue.runRate.fromLastMonth)} sub={T("Last month × 12")} icon={<TrendingUpRoundedIcon />} testId="kpi-arr" />
                <StatTile label="Still to come from the contracts" value={sgd(k.revenue.contracted.amount)} sub={T("{n} years left on average", { n: num(k.revenue.contracted.avgYearsLeft, 1) })} icon={<AccountBalanceRoundedIcon />} testId="kpi-contracted" />
                <StatTile label="Generated since turned on" value={T("{n} MWh", { n: num((k.generation.lifetimeKwh ?? 0) / 1000, 1) })} icon={<SolarPowerRoundedIcon />} testId="kpi-lifetime" />
                <StatTile label="Cheaper than SP" value={pct(k.customers.cheaperPct)} sub={T("{n} saved in 12 months", { n: sgd(k.customers.saved12Months) })} icon={<SavingsRoundedIcon />} tone="good" testId="kpi-cheaper" />
                <StatTile label="CO2 avoided" value={T("{n} t", { n: num(k.customers.co2Tons, 1) })} sub={T("{n} trees' worth", { n: num(k.customers.trees) })} icon={<EcoRoundedIcon />} testId="kpi-co2" />
              </Box>
            </Box>
          )}
          {k && tab === "revenue" && (
            <Box sx={{ mt: 2 }}>
              <Box sx={TILE_GRID}>
                <StatTile label="Monthly revenue" value={sgd(k.revenue.lastMonth.amount)} sub={month(k.revenue.lastMonth.month)} icon={<PaidRoundedIcon />} />
                <StatTile label="Yearly run-rate" value={sgd(k.revenue.runRate.fromLastMonth)} sub={T("{n} from three months", { n: sgd(k.revenue.runRate.fromThreeMonths) })} icon={<TrendingUpRoundedIcon />} />
                <StatTile label="Admin fees to come" value={sgd(k.revenue.adminFees.toComeAmount)} sub={T("{n} installs in progress", { n: k.revenue.adminFees.toCome })} icon={<ReceiptLongRoundedIcon />} />
                <StatTile label="Collected" value={pct(k.revenue.invoices.collectedPct)} sub={T("{n} outstanding", { n: sgd(k.revenue.invoices.outstanding) })} icon={<AccountBalanceRoundedIcon />} />
              </Box>
              {k.revenue.invoices.monthly === 0 && (
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  {T("No monthly invoices have been issued in the app yet, so revenue here is worked out from each month's kWh and rate; collected and outstanding cover only what has been invoiced.")}
                </Alert>
              )}
              <ChartCard
                title={T("Revenue by month")}
                sub={T("Each month's kWh × each system's rate")}
                table={{ head: [T("Month"), T("Systems"), T("kWh"), T("Revenue (S$)")], rows: [...k.revenue.months].reverse().map((m) => [month(m.month, true), m.systems, num(m.kwh), num(m.amount, 2)]) }}
                testId="kpi-revenue-chart"
              >
                <AreaChart points={k.revenue.months.map((m) => ({ label: month(m.month, true).split(" ")[0], value: m.amount }))} series="Revenue (S$)" unit="S$" />
              </ChartCard>
              <Calculations rows={revenueRows(k)} testId="kpi-revenue-how" />
            </Box>
          )}
          {k && tab === "generation" && (
            <Box sx={{ mt: 2 }}>
              <Box sx={TILE_GRID}>
                <StatTile label="Generated since turned on" value={T("{n} MWh", { n: num((k.generation.lifetimeKwh ?? 0) / 1000, 1) })} icon={<SolarPowerRoundedIcon />} />
                <StatTile label="Generated in 12 months" value={T("{n} MWh", { n: num(k.generation.twelveMonthKwh / 1000, 1) })} icon={<BoltRoundedIcon />} />
                <StatTile label="kWh per kWp a day" value={num(k.generation.specificYield.value, 2)} sub={month(k.generation.lastMonth)} icon={<SpeedRoundedIcon />} />
                <StatTile label="Beside the estimate" value={pct(k.generation.vsEstimate.pct)} sub={month(k.generation.lastMonth)} icon={<TrendingUpRoundedIcon />} />
              </Box>
              <Calculations rows={generationRows(k)} testId="kpi-generation-how" />
            </Box>
          )}
          {k && tab === "customers" && (
            <Box sx={{ mt: 2 }}>
              <Box sx={TILE_GRID}>
                <StatTile label="Cheaper than SP" value={pct(k.customers.cheaperPct)} tone="good" icon={<SavingsRoundedIcon />} />
                <StatTile label="Customers saved in 12 months" value={sgd(k.customers.saved12Months)} icon={<PaidRoundedIcon />} />
                <StatTile label="CO2 avoided" value={T("{n} t", { n: num(k.customers.co2Tons, 1) })} icon={<EcoRoundedIcon />} />
                <StatTile label="As trees planted" value={num(k.customers.trees)} icon={<EcoRoundedIcon />} />
              </Box>
              <Calculations rows={customerRows(k)} testId="kpi-customers-how" />
            </Box>
          )}
          {k && tab === "operations" && (
            <Box sx={{ mt: 2 }}>
              <Box sx={TILE_GRID}>
                <StatTile label="Plants running normally" value={pct(k.operations.normalPct)} sub={T("{n} plants", { n: k.operations.plants })} tone={k.operations.normalPct !== null && k.operations.normalPct < 90 ? "warn" : "good"} icon={<HealthAndSafetyRoundedIcon />} />
                <StatTile label="Active alarms" value={num(k.operations.alarms.critical + k.operations.alarms.major + k.operations.alarms.minor + k.operations.alarms.warning)} icon={<NotificationsActiveRoundedIcon />} />
                <StatTile label="Systems on FusionSolar" value={T("{n} of {all}", { n: k.operations.monitored, all: k.portfolio.systems })} icon={<SolarPowerRoundedIcon />} />
                <StatTile label="Figures updated" value={k.operations.lastSync ? ago(k.operations.lastSync) : "—"} icon={<BoltRoundedIcon />} />
              </Box>
              <Calculations rows={operationRows(k)} testId="kpi-operations-how" />
            </Box>
          )}
        </Page>
      </Box>
    </>
  );
}

export default function KpiPage() {
  return (
    <Suspense>
      <KpiScreen />
    </Suspense>
  );
}
