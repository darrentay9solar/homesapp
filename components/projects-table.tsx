"use client";

import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { DataTable, type TableCol } from "@/components/data-table";
import { StatusChip, useProjectHref } from "@/components/projects";
import { useApi } from "@/lib/client/api";
import { T, TR } from "@/lib/client/i18n";
import type { ProjectList, ProjectRow } from "@/lib/client/projects";

const yes = (b: boolean) => (b ? "Yes" : "No");

/**
 * Every project, handed-over ones too, as a table with Excel's filters: for
 * finding, say, the projects handed over between two dates, and downloading
 * exactly those. Staff only (the Projects page's Table tab).
 */
export function ProjectsTable() {
  const { data, error } = useApi<ProjectList>("/projects?handed=1");
  const href = useProjectHref();
  const router = useRouter();
  const cols = useMemo<TableCol<ProjectRow>[]>(
    () => [
      { key: "code", label: "Project Code", get: (p) => p.projectCode ?? null, width: 110 },
      { key: "name", label: "Project", get: (p) => p.name, width: 200 },
      { key: "status", label: "Status", get: (p) => TR(p.statusLabel), show: (p) => <StatusChip p={p} />, width: 150 },
      { key: "homeowner", label: "Homeowner", get: (p) => p.homeowner.name, width: 160 },
      { key: "pm", label: "Project manager", get: (p) => p.pm.name, width: 150 },
      { key: "contractor", label: "Contractor", get: (p) => (p.contractor.label === "—" ? null : p.contractor.label), width: 160 },
      { key: "postal", label: "Postal Code", get: (p) => p.postalCode, width: 100 },
      { key: "created", label: "Created", type: "date", get: (p) => p.createdAt, width: 120 },
      { key: "start", label: "Start date", type: "date", get: (p) => p.startDate, width: 120 },
      { key: "end", label: "Target end date", type: "date", get: (p) => p.endDate, width: 130 },
      { key: "signed", label: "Handover signed on", type: "date", get: (p) => p.signedAt ?? null, width: 150 },
      { key: "closed", label: "Handed over on", type: "date", get: (p) => p.closedAt ?? null, width: 140 },
      { key: "progress", label: "Progress (%)", type: "number", get: (p) => p.progress, width: 110 },
      { key: "milestone", label: "Current milestone", get: (p) => (p.milestone === 3 ? T("All milestones") : T("Milestone {n}", { n: p.currentMilestone })), width: 140 },
      { key: "days", label: "Days running", type: "number", get: (p) => p.daysElapsed, width: 110 },
      { key: "late", label: "Late", get: (p) => T(yes(p.flags.some((f) => f.kind === "overdue"))), width: 80 },
    ],
    []
  );
  if (error) return <Alert severity="error" sx={{ mt: 2 }}>{error.message}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={320} sx={{ mt: 2 }} />;
  return <DataTable rows={data.projects} cols={cols} rowKey={(p) => p.id} onOpen={(p) => router.push(href(p.id))} exportAs={{ what: "projects", title: "Projects" }} testId="projects-table" />;
}
