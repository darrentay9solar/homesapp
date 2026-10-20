"use client";

import Chip from "@mui/material/Chip";
import { useMemo } from "react";

import { DataTable, type TableCol } from "@/components/data-table";
import { T, TR } from "@/lib/client/i18n";
import { type LogRow, type ProjectVisits, siteLog } from "@/lib/client/sites";

const TONE: Record<LogRow["status"], "success" | "error" | "warning" | "default" | "info"> = {
  "On time": "success",
  Late: "warning",
  "No check-in": "error",
  "Not scheduled": "default",
  Upcoming: "info",
  "Still on site": "info",
};

/**
 * A project's site log for its managers: every day on site in one table,
 * newest first (who came, when they came and left, how long, how many, how
 * far from the house), with Excel's filters and a download.
 */
export function SiteLog({ data, project }: { data: ProjectVisits; project: string }) {
  const rows = useMemo(() => siteLog(data), [data]);
  const cols = useMemo<TableCol<LogRow>[]>(
    () => [
      { key: "day", label: "Date", type: "date", get: (r) => r.day, width: 120 },
      { key: "status", label: "Status", get: (r) => TR(r.status), show: (r) => <Chip size="small" color={TONE[r.status]} variant={r.status === "Upcoming" ? "outlined" : "filled"} label={TR(r.status)} />, width: 130 },
      { key: "scheduled", label: "Scheduled", get: (r) => r.scheduled, width: 100 },
      { key: "works", label: "Works", get: (r) => r.works, width: 180 },
      { key: "who", label: "Checked in by", get: (r) => r.who, width: 150 },
      { key: "in", label: "In", get: (r) => r.inAt, width: 70 },
      { key: "out", label: "Out", get: (r) => r.outAt, width: 70 },
      { key: "hours", label: "Hours on site", type: "number", get: (r) => r.hours, width: 110 },
      { key: "crewIn", label: "Crew in", type: "number", get: (r) => r.crewIn, width: 80 },
      { key: "crewOut", label: "Crew still on site at check-out", type: "number", get: (r) => r.crewOut, width: 140 },
      { key: "metres", label: "Metres from the house", type: "number", get: (r) => r.metres, width: 130 },
    ],
    []
  );
  if (!rows.length) return null;
  return <DataTable rows={rows} cols={cols} rowKey={(r) => r.key} exportAs={{ what: "site_visits", title: `Site log ${project}`.slice(0, 31) }} title={T("Day-by-day site log")} testId="site-log" />;
}
