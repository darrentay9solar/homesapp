"use client";

import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ConstructionRoundedIcon from "@mui/icons-material/ConstructionRounded";
import EditCalendarRoundedIcon from "@mui/icons-material/EditCalendarRounded";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import EngineeringRoundedIcon from "@mui/icons-material/EngineeringRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import RouterRoundedIcon from "@mui/icons-material/RouterRounded";
import SellRoundedIcon from "@mui/icons-material/SellRounded";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { ChartCard, ColumnChart, seriesColor } from "@/components/charts";
import { DetailRow } from "@/components/projects";
import { gradText } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { bucketLabel, num } from "@/lib/client/analytics";
import { T, TR } from "@/lib/client/i18n";
import { type Feedback, type Output, money, rateText, type Warranty } from "@/lib/client/records";

/** One card titled like the rest of the page, for project managers' extra information. */
function Titled({ title, sub, testId, children }: { title: string; sub?: string; testId?: string; children: ReactNode }) {
  return (
    <Card sx={{ px: 2, pt: 1.75, pb: 0.5, minWidth: 0 }} data-testid={testId}>
      <Typography component="h2" sx={[{ fontWeight: 600, fontSize: 17 }, gradText()]}>
        {TR(title)}
      </Typography>
      {sub && (
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
          {TR(sub)}
        </Typography>
      )}
      {children}
    </Card>
  );
}

type Row = { icon: ReactNode; k: string; v: ReactNode | null | undefined };

/**
 * The client record from 9 Solar Home's project list: everything the list
 * knows that the rest of the page doesn't already show. Empty rows are left out.
 */
export function ClientRecord({ rows, note }: { rows: Row[]; note?: string | null }) {
  const shown = rows.filter((r) => r.v !== null && r.v !== undefined && r.v !== "");
  if (!shown.length && !note) return null;
  return (
    <Titled title="Client record" sub="From 9 Solar Home's project list. Project managers only." testId="client-record">
      {note && (
        <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mt: 1.5 }}>
          {note}
        </Alert>
      )}
      <Box sx={{ mt: 0.5 }}>
        {shown.map((r) => (
          <DetailRow key={r.k} icon={r.icon} k={r.k}>
            {r.v}
          </DetailRow>
        ))}
      </Box>
    </Titled>
  );
}

/** The record's rows a system and a project share. */
export function recordRows(r: {
  projectCode: string | null;
  salutation?: string | null;
  email: string | null;
  signedOn: string | null;
  salesperson: string | null;
  referrer: string | null;
  plan: string | null;
  ratePerKwh: number | null;
}): Row[] {
  return [
    { icon: <BadgeOutlinedIcon />, k: "Project code", v: r.projectCode },
    { icon: <EmailOutlinedIcon />, k: "Email", v: r.email },
    { icon: <EditCalendarRoundedIcon />, k: "Signed", v: r.signedOn ? d2s(r.signedOn) : null },
    { icon: <SellRoundedIcon />, k: "Salesperson", v: r.salesperson },
    { icon: <HandshakeRoundedIcon />, k: "Referred by", v: r.referrer },
    { icon: <ReceiptLongRoundedIcon />, k: "Solar plan", v: r.plan },
    { icon: <PaidOutlinedIcon />, k: "Rate", v: r.ratePerKwh !== null ? T("{rate} per kWh", { rate: rateText(r.ratePerKwh) ?? "" }) : null },
  ];
}

export const serialRows = (inverters: string[], dongles: string[]): Row[] => [
  { icon: <QrCode2RoundedIcon />, k: "Inverter serial no.", v: inverters.join(", ") || null },
  { icon: <RouterRoundedIcon />, k: "Dongle serial no.", v: dongles.join(", ") || null },
];

export const installRows = (epc: string | null, start: string | null, end: string | null, billing: string | null): Row[] => [
  { icon: <EngineeringRoundedIcon />, k: "EPC", v: epc },
  { icon: <ConstructionRoundedIcon />, k: "Installation", v: start || end ? [start ? d2s(start) : "?", end ? d2s(end) : "?"].join(" – ") : null },
  { icon: <CalendarMonthRoundedIcon />, k: "Billing period", v: billing ? TR(billing) : null },
];

/** Each inverter's warranty and price: managers only. */
export function WarrantyCard({ warranties }: { warranties: Warranty[] }) {
  if (!warranties.length) return null;
  return (
    <Titled title="Inverter warranty" sub="From 9 Solar Home's inverter list. Project managers only." testId="inverter-warranty">
      <Stack sx={{ gap: 1.25, py: 1.5 }}>
        {warranties.map((w) => (
          <Stack key={w.model} direction="row" sx={{ gap: 1.5, alignItems: "flex-start" }}>
            <ShieldOutlinedIcon sx={{ color: w.known ? "primary.main" : "text.secondary", mt: "2px" }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{w.model}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {!w.known
                  ? T("Not in the inverter list")
                  : [
                      w.years ? (w.until ? T("{n}-year warranty, until {date}", { n: w.years, date: d2s(w.until) }) : T("{n}-year warranty", { n: w.years })) : null,
                      w.priceExGst !== null ? T("{price} before GST", { price: money(w.priceExGst) ?? "" }) : null,
                      w.priceInclGst !== null ? T("{price} with GST", { price: money(w.priceInclGst) ?? "" }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </Titled>
  );
}

/** What the homeowner said. */
export function FeedbackCard({ feedback }: { feedback: Feedback[] }) {
  if (!feedback.length) return null;
  return (
    <Titled title="Homeowner feedback" testId="client-feedback">
      <Stack sx={{ gap: 1.25, py: 1.5 }}>
        {feedback.map((f) => (
          <Typography key={f.id} variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            “{f.body}”
          </Typography>
        ))}
      </Stack>
    </Titled>
  );
}

/** kWh each month against the monthly estimate. */
export function OutputCard({ output, billing }: { output: Output; billing: Array<{ month: string; period: string }> }) {
  if (!output.months.length && !billing.length) return null;
  const est = output.estMonthlyKwh;
  const sub = [
    est ? T("Estimate {n} kWh a month", { n: num(est, 0) }) : null,
    output.months.length ? T("{n} kWh over {m} months", { n: num(output.total, 0), m: output.months.length }) : null,
    output.ofEstimate !== null ? T("{pct} of the estimate on average", { pct: `${Math.round(output.ofEstimate * 100)}%` }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const period = new Map(billing.map((b) => [b.month.slice(0, 7), b.period]));
  const months = Array.from(new Set([...output.months.map((m) => m.month.slice(0, 7)), ...period.keys()])).sort();
  const kwh = new Map(output.months.map((m) => [m.month.slice(0, 7), m.kwh]));
  return (
    <ChartCard
      title="Solar output"
      sub={sub}
      legend={est ? [{ label: "kWh", color: (th) => seriesColor(th, 0) }, { label: "Estimate", color: (th) => seriesColor(th, 1) }] : undefined}
      table={{ head: ["Month", "kWh", "Estimate", "Billing period"], rows: months.map((m) => [bucketLabel(m), kwh.get(m) ?? "—", est ?? "—", period.get(m) ? TR(period.get(m) ?? "") : "—"]) }}
      testId="system-output"
    >
      {output.months.length ? (
        <ColumnChart data={output.months.map((m) => ({ label: bucketLabel(m.month.slice(0, 7)), values: est ? [m.kwh, est] : [m.kwh] }))} series={est ? ["kWh", "Estimate"] : ["kWh"]} />
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {T("No monthly output recorded yet.")}
        </Typography>
      )}
    </ChartCard>
  );
}
