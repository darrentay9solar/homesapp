"use client";

import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CallMadeRoundedIcon from "@mui/icons-material/CallMadeRounded";
import CallReceivedRoundedIcon from "@mui/icons-material/CallReceivedRounded";
import CellTowerRoundedIcon from "@mui/icons-material/CellTowerRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import FactoryRoundedIcon from "@mui/icons-material/FactoryRounded";
import ReceiptRoundedIcon from "@mui/icons-material/ReceiptRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { Suspense, useState } from "react";

import { AreaChart, BarList, ChartCard, StatTile, TILE_GRID } from "@/components/charts";
import { Field } from "@/components/m";
import { Page } from "@/components/shell";
import { SegTabs, TopBar } from "@/components/topbar";
import { dt2s } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { locale, T } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";

type Figures = { withGst: number | null; withoutGst: number | null; selling: number | null; energy: number | null; network: number | null; mss: number | null; marketAdmin: number | null };
type Month = Figures & { month: string; partsFrom: "sp" | "ema" | null; source: string };
type Summary = Figures & { months: number; from: string | null; to: string | null; partsMonths: number };
type Tariffs = {
  current: {
    startsOn: string;
    endsOn: string | null;
    withGst: number | null;
    withoutGst: number | null;
    buying: number | null;
    selling: number | null;
    parts: { energy: number | null; network: number | null; mss: number | null; marketAdmin: number | null };
    gstRate: number;
    checkedAt: string;
  } | null;
  history: Month[];
  average12: Summary & { sellingMonths: number };
  average8y: Summary;
  range?: Summary;
  on?: (Month & { date: string }) | null;
  mine: { rateCents: number | null; monthKwh: number | null; savedSgd: number | null; cheaperCents: number | null } | null;
  source: { sp: string; history: string; parts: string };
};

type Tab = "quarter" | "year" | "years" | "find";

const cents = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(2)}¢`);
const monthName = (ym: string, opts: Intl.DateTimeFormatOptions) => new Date(`${ym}-01T00:00:00+08:00`).toLocaleDateString(locale(), { ...opts, timeZone: "Asia/Singapore" });
const day = (iso: string) => new Date(`${iso}T00:00:00+08:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
const sgToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** Every figure for a month, a day or an average: buying, before GST, selling, then the four parts. */
function FigureTiles({ f, testId, partsNote }: { f: Figures; testId: string; partsNote?: string }) {
  return (
    <>
      <Box sx={{ ...TILE_GRID }} data-testid={testId}>
        <StatTile label="Buying from SP, per kWh" value={cents(f.withGst)} icon={<CallReceivedRoundedIcon />} sub={T("With GST")} testId={`${testId}-buying`} />
        <StatTile label="Selling to SP, per kWh" value={cents(f.selling)} icon={<CallMadeRoundedIcon />} sub={T("The tariff less network costs, before GST")} testId={`${testId}-selling`} />
        <StatTile label="Tariff before GST, per kWh" value={cents(f.withoutGst)} icon={<BoltRoundedIcon />} testId={`${testId}-tariff`} />
        <StatTile label="Network costs, per kWh" value={cents(f.network)} icon={<CellTowerRoundedIcon />} testId={`${testId}-network`} />
      </Box>
      <Box sx={{ ...TILE_GRID, mt: 1.5 }}>
        <StatTile label="Energy costs, per kWh" value={cents(f.energy)} icon={<FactoryRoundedIcon />} testId={`${testId}-energy`} />
        <StatTile label="Market support services, per kWh" value={cents(f.mss)} icon={<ReceiptRoundedIcon />} testId={`${testId}-mss`} />
        <StatTile label="Market admin and power system operation, per kWh" value={cents(f.marketAdmin)} icon={<TuneRoundedIcon />} testId={`${testId}-admin`} />
      </Box>
      {partsNote && (
        <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1, px: 0.5 }}>
          {partsNote}
        </Typography>
      )}
    </>
  );
}

/** How many of the months the parts are known for, said when it isn't all of them. */
function partsNote(s: Summary): string | undefined {
  if (!s.months || s.partsMonths >= s.months) return undefined;
  return s.partsMonths ? T("The parts and selling price are averaged over the {n} months they're known for.", { n: s.partsMonths }) : T("The parts aren't known for these months.");
}

/** Months as a chart of the tariff with GST, and as a table of every figure. */
function MonthsCard({ months, title, testId }: { months: Month[]; title: string; testId: string }) {
  const long = months.length > 24;
  return (
    <ChartCard
      title={title}
      sub={months.length ? T("{from} to {to}", { from: monthName(months[0].month, { month: "short", year: "numeric" }), to: monthName(months[months.length - 1].month, { month: "short", year: "numeric" }) }) : undefined}
      table={{
        head: [T("Month"), T("With GST (¢)"), T("Before GST (¢)"), T("Selling to SP (¢)"), T("Energy (¢)"), T("Network (¢)"), T("MSS (¢)"), T("Market admin and PSO (¢)")],
        rows: [...months].reverse().map((m) => [monthName(m.month, { month: "short", year: "numeric" }), m.withGst ?? "—", m.withoutGst ?? "—", m.selling ?? "—", m.energy ?? "—", m.network ?? "—", m.mss ?? "—", m.marketAdmin ?? "—"]),
      }}
      testId={testId}
    >
      <AreaChart points={months.map((m) => ({ label: monthName(m.month, long ? { year: "numeric" } : { month: "short" }), value: m.withGst }))} series="With GST (¢ per kWh)" unit="¢" tickEvery={long ? 12 : 1} />
    </ChartCard>
  );
}

/** Between two dates (the averages over them), or one date (the tariff in force that day). */
function ByDate({ first }: { first: string }) {
  const [mode, setMode] = useState<"between" | "on">("between");
  const today = sgToday();
  const [from, setFrom] = useState(() => `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`);
  const [to, setTo] = useState(today);
  const [on, setOn] = useState(today);
  const bad = mode === "between" && from > to;
  const q = mode === "between" ? (bad ? null : `/tariffs?from=${from}&to=${to}`) : on ? `/tariffs?on=${on}` : null;
  const { data, error } = useApi<Tariffs>(q);
  return (
    <>
      <Stack direction="row" sx={{ gap: 1.5, rowGap: 1.25, flexWrap: "wrap", alignItems: "center", mt: 2, mb: 1.5 }}>
        <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v: "between" | "on" | null) => v && setMode(v)} aria-label={T("Find")}>
          <ToggleButton value="between" data-testid="sp-between">
            {T("Between two dates")}
          </ToggleButton>
          <ToggleButton value="on" data-testid="sp-on">
            {T("On one date")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 220px))" }, mb: 2 }}>
        {mode === "between" ? (
          <>
            <Field label="From" type="date" icon={<EventRoundedIcon />} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ htmlInput: { min: first, max: today, "data-testid": "sp-from" } }} />
            <Field label="To" type="date" icon={<EventRoundedIcon />} value={to} onChange={(e) => setTo(e.target.value)} error={bad} helperText={bad ? "From comes after To." : undefined} slotProps={{ htmlInput: { min: first, max: today, "data-testid": "sp-to" } }} />
          </>
        ) : (
          <Field label="Date" type="date" icon={<EventRoundedIcon />} value={on} onChange={(e) => setOn(e.target.value)} slotProps={{ htmlInput: { min: first, max: today, "data-testid": "sp-date" } }} />
        )}
      </Box>
      {error && <Alert severity="error">{error.message}</Alert>}
      {q && !data && !error && <Skeleton variant="rounded" height={220} />}
      {data && mode === "between" && data.range && (
        data.range.months ? (
          <>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.25 }} data-testid="sp-range-note">
              {T("Averages over {n} months, {from} to {to}.", { n: data.range.months, from: monthName(data.range.from ?? "", { month: "short", year: "numeric" }), to: monthName(data.range.to ?? "", { month: "short", year: "numeric" }) })}
            </Typography>
            <FigureTiles f={data.range} testId="sp-range" partsNote={partsNote(data.range)} />
            <Box sx={{ mt: 1.5 }}>
              <MonthsCard months={data.history.filter((m) => m.month >= (data.range?.from ?? "") && m.month <= (data.range?.to ?? ""))} title={T("Each month between them")} testId="sp-range-months" />
            </Box>
          </>
        ) : (
          <Alert severity="info">{T("No tariff is known between those dates.")}</Alert>
        )
      )}
      {data && mode === "on" && (
        data.on ? (
          <>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.25 }} data-testid="sp-on-note">
              {T("The tariff in force on {date} (SP's tariff for {month}).", { date: day(data.on.date), month: monthName(data.on.month, { month: "long", year: "numeric" }) })}
            </Typography>
            <FigureTiles f={data.on} testId="sp-on-figures" partsNote={data.on.network === null ? T("The parts aren't known for this month.") : undefined} />
          </>
        ) : (
          <Alert severity="info">{T("No tariff is known for that date.")}</Alert>
        )
      )}
    </>
  );
}

/**
 * SP Power: SP Group's household electricity tariff this quarter, what it's made of and what SP pays for solar
 * sent to the grid; the last 12 months and 8 years, month by month and on average; and any dates' averages,
 * or any one day's figures (api/_lib/tariff.py). Everyone signed in sees it; a homeowner also sees their own
 * solar beside it.
 */
function SpPowerScreen() {
  const { data, error } = useApi<Tariffs>("/tariffs");
  const [tab, setTab] = useTab<Tab>(["quarter", "year", "years", "find"], "quarter");
  const c = data?.current;
  const parts = c
    ? [
        { key: "energy", label: T("Energy costs"), value: c.parts.energy ?? 0, note: T("Generating the electricity") },
        { key: "network", label: T("Network costs"), value: c.parts.network ?? 0, note: T("SP Group's grid") },
        { key: "mss", label: T("Market support services"), value: c.parts.mss ?? 0, note: T("Meter reading, billing") },
        { key: "admin", label: T("Market admin and power system operation"), value: c.parts.marketAdmin ?? 0 },
      ].filter((p) => p.value > 0)
    : [];
  const months = data?.history ?? [];
  return (
    <>
      <TopBar
        title={T("SP Power")}
        sub={c ? T("SP Group's electricity tariff, {from} to {to}", { from: day(c.startsOn), to: c.endsOn ? day(c.endsOn) : "…" }) : undefined}
        tabs={
          <SegTabs
            label={T("SP Power")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "quarter" as const, label: "This quarter" },
              { value: "year" as const, label: "12 months" },
              { value: "years" as const, label: "8 years" },
              { value: "find" as const, label: "By date" },
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
          {data && !c && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {T("SP Group's tariff hasn't been read yet. It's read twice a day; check back soon.")}
            </Alert>
          )}
          {data && c && tab === "quarter" && (
            <>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 2, mb: 1.25 }}>
                {T("Updated by SP Group each quarter; read from its tariff page.")}
              </Typography>
              <Box sx={{ ...TILE_GRID }}>
                <StatTile label="Buying from SP, per kWh" value={cents(c.buying)} icon={<CallReceivedRoundedIcon />} sub={T("The tariff a home pays, with {gst}% GST", { gst: c.gstRate })} testId="sp-buying" />
                <StatTile label="Selling to SP, per kWh" value={cents(c.selling)} icon={<CallMadeRoundedIcon />} sub={T("What SP pays for solar sent to the grid: the tariff less network costs, before GST")} testId="sp-selling" />
                <StatTile label="Tariff before GST, per kWh" value={cents(c.withoutGst)} icon={<BoltRoundedIcon />} testId="sp-tariff" />
                <StatTile label="Network costs, per kWh" value={cents(c.parts.network)} icon={<CellTowerRoundedIcon />} sub={T("Kept by SP Group for its grid, so not paid for solar sent to it")} testId="sp-network" />
              </Box>
              {data.mine && data.mine.rateCents !== null && (
                <Card sx={{ p: 2.25, mt: 1.5 }} data-testid="sp-mine">
                  <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
                    {T("Your solar beside SP")}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                    {data.mine.cheaperCents !== null && data.mine.cheaperCents > 0
                      ? T("Your solar costs {rate}¢ per kWh: {less}¢ less than buying from SP.", { rate: data.mine.rateCents.toFixed(2), less: data.mine.cheaperCents.toFixed(2) })
                      : T("Your solar costs {rate}¢ per kWh.", { rate: data.mine.rateCents.toFixed(2) })}
                  </Typography>
                  {data.mine.monthKwh !== null && data.mine.savedSgd !== null && (
                    <Box sx={{ ...TILE_GRID, mt: 1.5 }}>
                      <StatTile label="Your solar this month" value={`${data.mine.monthKwh.toLocaleString(locale())} kWh`} icon={<BoltRoundedIcon />} testId="sp-mine-kwh" />
                      <StatTile label="Saved on SP's tariff" value={`S$${data.mine.savedSgd.toFixed(2)}`} icon={<SavingsRoundedIcon />} tone={data.mine.savedSgd > 0 ? "good" : "neutral"} testId="sp-mine-saved" />
                    </Box>
                  )}
                </Card>
              )}
              <Box sx={{ mt: 1.5 }}>
                <ChartCard title={T("What the tariff is made of")} sub={T("{n}¢ per kWh before GST", { n: (c.withoutGst ?? 0).toFixed(2) })} table={{ head: [T("Part"), T("¢ per kWh")], rows: parts.map((p) => [p.label, p.value]) }} testId="sp-parts">
                  <BarList rows={parts} format={(v) => `${v.toFixed(2)}¢`} />
                </ChartCard>
              </Box>
            </>
          )}
          {data && c && tab === "year" && (
            <>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 2, mb: 1.25 }} data-testid="sp-year-note">
                {T("Averages over the last {n} months.", { n: data.average12.months })}
              </Typography>
              <FigureTiles f={data.average12} testId="sp-avg12" partsNote={partsNote(data.average12)} />
              <Box sx={{ mt: 1.5 }}>
                <MonthsCard months={months.slice(-12)} title={T("Each month, with GST")} testId="sp-months12" />
              </Box>
            </>
          )}
          {data && c && tab === "years" && (
            <>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 2, mb: 1.25 }} data-testid="sp-years-note">
                {T("Averages over the last {n} months.", { n: data.average8y.months })}
              </Typography>
              <FigureTiles f={data.average8y} testId="sp-avg8" partsNote={partsNote(data.average8y)} />
              <Box sx={{ mt: 1.5 }}>
                <MonthsCard months={months.slice(-96)} title={T("Each month, with GST")} testId="sp-months96" />
              </Box>
            </>
          )}
          {data && c && tab === "find" && <ByDate first={months[0] ? `${months[0].month}-01` : "2012-01-01"} />}
          {data && c && (
            <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 2, px: 0.5 }}>
              {T("From SP Group's tariff page (checked {when}) and its earlier quarters' pages; months before them from SP Group's figures on data.gov.sg, with EMA's yearly parts for 2018 to mid-2021.", { when: dt2s(c.checkedAt) })}{" "}
              <Link href={data.source.sp} target="_blank" rel="noopener">
                {T("SP Group's tariffs")}
              </Link>
            </Typography>
          )}
        </Page>
      </Box>
    </>
  );
}

export default function SpPowerPage() {
  return (
    <Suspense>
      <SpPowerScreen />
    </Suspense>
  );
}
