"use client";

import EventRoundedIcon from "@mui/icons-material/EventRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { StatTile, TILE_GRID } from "@/components/charts";
import { ImportListDialog } from "@/components/import-list";
import { ImportPhotosDialog } from "@/components/import-photos";
import { Page } from "@/components/shell";
import { SystemCard } from "@/components/maintenance";
import { MaintenanceTable } from "@/components/maintenance-table";
import { ExportButton, GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { BRAND } from "@/lib/client/edition";
import { kwp as kwpFigure, num } from "@/lib/client/analytics";
import { useApi } from "@/lib/client/api";
import { isAdmin, useMe } from "@/lib/client/app-state";
import { T } from "@/lib/client/i18n";
import { filterSystems, inMTab, type MaintenanceList, MTABS, type MTab, sortSystems } from "@/lib/client/maintenance";
import { useFlagged, WarningsSwitch } from "@/lib/client/warnings";
import { useTab } from "@/lib/client/tabs";

/**
 * Maintenance, for project managers and superadmins: every system 9 Solar
 * Home looks after once it's turned on. Handed-over projects arrive here by
 * themselves; systems from before the app were imported from the project
 * listing and are assigned to a manager later. What needs a visit (urgent,
 * a check overdue) is red and first.
 */
function MaintenanceScreen() {
  const flagged = useFlagged();
  const me = useMe();
  const router = useRouter();
  const admin = isAdmin(me?.role);
  useEffect(() => {
    if (me && !admin) router.replace("/");
  }, [me, admin, router]);
  const { data, error, reload } = useApi<MaintenanceList>(admin ? "/maintenance" : null);
  // Download and import, as on Projects: the same workbook (projects in progress, handed over, maintenance).
  const [importing, setImporting] = useState<false | "list" | "photos">(false);
  const office = me?.role === "project_manager" || me?.role === "superadmin";
  // The open tab is in the address (?tab=table); Table is every system with Excel's filters.
  const [tab, setTab] = useTab<MTab | "table">([...MTABS.map(([v]) => v), "table"], "all");
  const table = tab === "table";
  const [q, setQ] = useState("");
  const all = useMemo(() => sortSystems(data?.systems ?? []), [data]);
  if (!me || !admin) return null;

  const shown = filterSystems(all, { query: q, tab: table ? "all" : tab });
  const count = (t: MTab) => all.filter((s) => inMTab(s, t)).length;
  const capacity = all.reduce((a, s) => a + (s.kwp ?? 0), 0);
  const pick = (t: MTab) => setTab(tab === t ? "all" : t);
  return (
    <>
      <TopBar
        title={T("Maintenance")}
        action={
          office && (
            <>
              <ExportButton path="/export/projects.xlsx" name={`${BRAND.app} projects.xlsx`} label="Download projects and maintenance (Excel)" testId="export-maintenance" />
              {me?.role === "superadmin" && (
                <Tooltip title={T("Import from Excel")}>
                  <IconButton aria-label={T("Import from Excel")} onClick={() => setImporting("list")} data-testid="import-maintenance" sx={{ color: "#fff" }}>
                    <UploadFileRoundedIcon />
                  </IconButton>
                </Tooltip>
              )}
            </>
          )
        }
        search={table ? undefined : <SearchBox value={q} onChange={setQ} placeholder={T("Search addresses, inverters, homeowners")} testId="maintenance-search" />}
        tabs={
          <SegTabs
            label={T("Filter systems")}
            value={tab}
            onChange={setTab}
            options={[...MTABS.map(([v, l]) => ({ value: v as MTab | "table", label: l, count: data ? count(v) : undefined })), { value: "table" as const, label: "Table" }]}
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
            <Box sx={{ ...GRID, mt: 3 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={190} />
              ))}
            </Box>
          )}
          {data && table && <MaintenanceTable systems={all} />}
          {data && !table && (
            <>
              <Box sx={{ ...TILE_GRID, mt: 1.5, mb: 1 }}>
                <StatTile label="Systems looked after" value={num(all.length)} icon={<SolarPowerRoundedIcon />} sub={kwpFigure(capacity)} />
                <StatTile label="Need attention" value={num(count("attention"))} icon={<WarningAmberRoundedIcon />} tone={flagged(true) ? (count("attention") ? "bad" : "good") : undefined} sub={T("Urgent, or a check overdue")} open={tab === "attention"} onClick={() => pick("attention")} testId="mtile-attention" />
                <StatTile label="Checks due in 30 days" value={num(count("due"))} icon={<EventRoundedIcon />} tone={count("due") ? "warn" : undefined} sub={T("Yearly checks, from the second year")} open={tab === "due"} onClick={() => pick("due")} testId="mtile-due" />
                <StatTile label="Unassigned" value={num(count("unassigned"))} icon={<PersonOffRoundedIcon />} sub={data.canAssign ? T("Give each one a project manager") : T("A superadmin assigns them")} open={tab === "unassigned"} onClick={() => pick("unassigned")} testId="mtile-unassigned" />
              </Box>
              <Heading title={tab === "all" ? T("Systems") : (MTABS.find(([v]) => v === tab)?.[1] ?? T("Systems"))} count={shown.length} action={office && all.length > 0 ? <WarningsSwitch /> : undefined} />
              {shown.length === 0 ? (
                <Card sx={{ p: 4, textAlign: "center" }} data-testid="maintenance-empty">
                  {all.length === 0 ? (
                    <>
                      <HandymanRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No systems to look after yet")}</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {T("A project comes here once it's signed off and handed over.")}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nothing matches")}</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {T("Try an address, postal code, inverter model, or words like “urgent” or “overdue”.")}
                      </Typography>
                    </>
                  )}
                </Card>
              ) : (
                <Box sx={GRID} data-testid="maintenance-grid">
                  {shown.map((s) => (
                    <SystemCard key={s.id} s={s} />
                  ))}
                </Box>
              )}
            </>
          )}
        </Page>
      </Box>
      {importing === "list" && <ImportListDialog onClose={() => setImporting(false)} onDone={reload} onPhotos={() => setImporting("photos")} />}
      {importing === "photos" && <ImportPhotosDialog onClose={() => setImporting(false)} onDone={reload} />}
    </>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense>
      <MaintenanceScreen />
    </Suspense>
  );
}
