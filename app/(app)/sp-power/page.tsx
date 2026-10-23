"use client";

import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import CallMadeRoundedIcon from "@mui/icons-material/CallMadeRounded";
import CallReceivedRoundedIcon from "@mui/icons-material/CallReceivedRounded";
import CellTowerRoundedIcon from "@mui/icons-material/CellTowerRounded";
import EventRepeatRoundedIcon from "@mui/icons-material/EventRepeatRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { AreaChart, BarList, ChartCard, StatTile, TILE_GRID } from "@/components/charts";
import { Page } from "@/components/shell";
import { Heading, TopBar } from "@/components/topbar";
import { dt2s } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { locale, T } from "@/lib/client/i18n";

type Month = { month: string; withoutGst: number | null; withGst: number | null; selling: number | null; source: string };
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
  average12: { months: number; withGst: number | null; withoutGst: number | null; selling: number | null; sellingMonths: number };
  mine: { rateCents: number | null; monthKwh: number | null; savedSgd: number | null; cheaperCents: number | null } | null;
  source: { sp: string; history: string };
};

const cents = (v: number | null | undefined) => (v === null || v === undefined ? "—" : T("{n}¢ per kWh", { n: v.toFixed(2) }));
const monthName = (ym: string, opts: Intl.DateTimeFormatOptions) => new Date(`${ym}-01T00:00:00+08:00`).toLocaleDateString(locale(), { ...opts, timeZone: "Asia/Singapore" });
const day = (iso: string) => new Date(`${iso}T00:00:00+08:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });

type Range = "12" | "60" | "all";

/**
 * SP Power: SP Group's household electricity tariff this quarter, what it's made of, what SP pays for solar
 * sent to the grid, the 12 months' average and the history (api/_lib/tariff.py). Everyone signed in sees it;
 * a homeowner also sees what their own solar costs beside it.
 */
export default function SpPowerPage() {
  const { data, error } = useApi<Tariffs>("/tariffs");
  const [range, setRange] = useState<Range>("60");
  const c = data?.current;
  const a = data?.average12;
  const shown = useMemo(() => {
    const h = data?.history ?? [];
    return range === "all" ? h : h.slice(-Number(range));
  }, [data, range]);
  const parts = c
    ? [
        { key: "energy", label: T("Energy costs"), value: c.parts.energy ?? 0, note: T("Generating the electricity") },
        { key: "network", label: T("Network costs"), value: c.parts.network ?? 0, note: T("SP Group's grid") },
        { key: "mss", label: T("Market support services"), value: c.parts.mss ?? 0, note: T("Meter reading, billing") },
        { key: "admin", label: T("Market admin and power system operation"), value: c.parts.marketAdmin ?? 0 },
      ].filter((p) => p.value > 0)
    : [];
  return (
    <>
      <TopBar title={T("SP Power")} sub={c ? T("SP Group's electricity tariff, {from} to {to}", { from: day(c.startsOn), to: c.endsOn ? day(c.endsOn) : "…" }) : undefined} />
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
          {data && c && (
            <>
              <Heading title="This quarter" />
              <Typography variant="body2" sx={{ color: "text.secondary", mt: -0.75, mb: 1.25 }}>
                {T("Updated by SP Group each quarter; read from its tariff page.")}
              </Typography>
              <Box sx={{ ...TILE_GRID }}>
                <StatTile label="Buying from SP" value={cents(c.buying)} icon={<CallReceivedRoundedIcon />} sub={T("The tariff a home pays, with {gst}% GST", { gst: c.gstRate })} testId="sp-buying" />
                <StatTile label="Selling to SP" value={cents(c.selling)} icon={<CallMadeRoundedIcon />} sub={T("What SP pays for solar sent to the grid: the tariff less network costs, before GST")} testId="sp-selling" />
                <StatTile label="Tariff before GST" value={cents(c.withoutGst)} icon={<BoltRoundedIcon />} testId="sp-tariff" />
                <StatTile label="Network costs" value={cents(c.parts.network)} icon={<CellTowerRoundedIcon />} sub={T("Kept by SP Group for its grid, so not paid for solar sent to it")} testId="sp-network" />
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

              <Box sx={{ display: "grid", gap: 1.5, mt: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 1fr" } }}>
                <ChartCard title={T("What the tariff is made of")} sub={T("{n}¢ per kWh before GST", { n: (c.withoutGst ?? 0).toFixed(2) })} table={{ head: [T("Part"), T("¢ per kWh")], rows: parts.map((p) => [p.label, p.value]) }} testId="sp-parts">
                  <BarList rows={parts} format={(v) => `${v.toFixed(2)}¢`} />
                </ChartCard>
                <Card sx={{ p: 2.25 }} data-testid="sp-average">
                  <Typography component="h2" sx={{ fontWeight: 600, fontSize: 15.5 }}>
                    {T("The last 12 months")}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.25 }}>
                    {T("Averages over {n} months.", { n: a?.months ?? 0 })}
                  </Typography>
                  <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                    <StatTile label="Buying, with GST" value={cents(a?.withGst)} icon={<EventRepeatRoundedIcon />} testId="sp-avg-buying" />
                    <StatTile label="Before GST" value={cents(a?.withoutGst)} icon={<EventRepeatRoundedIcon />} testId="sp-avg-tariff" />
                    <StatTile
                      label="Selling to SP"
                      value={cents(a?.selling)}
                      icon={<EventRepeatRoundedIcon />}
                      sub={a && a.sellingMonths < (a.months || 0) ? T("Over the {n} months SP's network costs are known", { n: a.sellingMonths }) : undefined}
                      testId="sp-avg-selling"
                    />
                  </Box>
                </Card>
              </Box>

              <Heading
                title="History"
                action={
                  <ToggleButtonGroup exclusive size="small" value={range} onChange={(_, v: Range | null) => v && setRange(v)} aria-label={T("Period")}>
                    <ToggleButton value="12">{T("12 months")}</ToggleButton>
                    <ToggleButton value="60">{T("5 years")}</ToggleButton>
                    <ToggleButton value="all">{T("All")}</ToggleButton>
                  </ToggleButtonGroup>
                }
              />
              <ChartCard
                title={T("Household tariff each month, with GST")}
                sub={shown.length ? T("{from} to {to}", { from: monthName(shown[0].month, { month: "short", year: "numeric" }), to: monthName(shown[shown.length - 1].month, { month: "short", year: "numeric" }) }) : undefined}
                table={{
                  head: [T("Month"), T("With GST (¢)"), T("Before GST (¢)"), T("Selling to SP (¢)")],
                  rows: [...shown].reverse().map((m) => [monthName(m.month, { month: "short", year: "numeric" }), m.withGst ?? "—", m.withoutGst ?? "—", m.selling ?? "—"]),
                }}
                testId="sp-history"
              >
                <AreaChart
                  points={shown.map((m) => ({ label: monthName(m.month, shown.length > 24 ? { year: "numeric" } : { month: "short" }), value: m.withGst }))}
                  series="With GST (¢ per kWh)"
                  unit="¢"
                  tickEvery={shown.length > 24 ? 12 : 1}
                />
              </ChartCard>
              <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1.5, px: 0.5 }}>
                {T("From SP Group's tariff page (checked {when}) and, for earlier months, SP Group's figures on data.gov.sg.", { when: dt2s(c.checkedAt) })}{" "}
                <Link href={data.source.sp} target="_blank" rel="noopener">
                  {T("SP Group's tariffs")}
                </Link>
              </Typography>
            </>
          )}
        </Page>
      </Box>
    </>
  );
}
