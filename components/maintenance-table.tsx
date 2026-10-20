"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { DataTable, type TableCol } from "@/components/data-table";
import { useMaintenanceHref } from "@/components/maintenance";
import { T } from "@/lib/client/i18n";
import { checkLabel, inverterText, kwpText, type MaintenanceSystem, phaseText, planText, ppaText } from "@/lib/client/maintenance";

/**
 * Every system as a table with Excel's filters (the Maintenance page's Table
 * tab): turned on between two dates, the next check due in a month, a plan,
 * a manager... and Download gives exactly those rows.
 */
export function MaintenanceTable({ systems }: { systems: MaintenanceSystem[] }) {
  const router = useRouter();
  const href = useMaintenanceHref();
  const cols = useMemo<TableCol<MaintenanceSystem>[]>(
    () => [
      { key: "address", label: "Address", get: (s) => s.address, width: 220 },
      { key: "postal", label: "Postal Code", get: (s) => s.postalCode, width: 100 },
      { key: "homeowner", label: "Homeowner", get: (s) => s.homeowner.name, width: 160 },
      { key: "pm", label: "Project manager", get: (s) => s.pm.name ?? T("Unassigned"), width: 150 },
      { key: "ppa", label: "PPA", get: (s) => ppaText(s), width: 120 },
      { key: "plan", label: "Maintenance Plan", get: (s) => planText(s), width: 180 },
      { key: "kwp", label: "kWp DC", type: "number", get: (s) => s.kwp, width: 90 },
      { key: "panels", label: "No. of Panels", type: "number", get: (s) => s.panelCount || null, width: 100 },
      { key: "phase", label: "1P or 3P", get: (s) => phaseText(s.phase), width: 110 },
      { key: "inverter", label: "Inverter", get: (s) => inverterText(s.inverters), width: 180 },
      { key: "on", label: "Turn On Date", type: "date", get: (s) => s.turnedOn, width: 120 },
      { key: "next", label: "Next check", get: (s) => (s.next ? checkLabel(s.next.key) : null), width: 120 },
      { key: "nextDue", label: "Next check due", type: "date", get: (s) => s.next?.due ?? null, width: 130 },
      { key: "done", label: "Checks done", type: "number", get: (s) => s.checks.filter((c) => c.state === "done").length, width: 100 },
      { key: "overdue", label: "Overdue", get: (s) => (s.checks.some((c) => c.state === "overdue") ? T("Yes") : T("No")), width: 90 },
      { key: "urgent", label: "Urgent Maintenance", get: (s) => (s.urgent ? s.urgentNote || T("Yes") : T("No")), width: 160 },
      { key: "size", label: "System size", get: (s) => kwpText(s.kwp), width: 100 },
      { key: "source", label: "Source", get: (s) => (s.project ? T("Project") : s.imported ? T("Project listing") : T("Added")), width: 120 },
    ],
    []
  );
  return <DataTable rows={systems} cols={cols} rowKey={(s) => s.id} onOpen={(s) => router.push(href(s.id))} exportAs={{ what: "maintenance", title: "Maintenance" }} testId="maintenance-table" />;
}
