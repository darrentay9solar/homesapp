"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { useMaintenanceHref } from "@/components/maintenance";
import { ImportListDialog } from "@/components/import-list";
import { ImportPhotosDialog } from "@/components/import-photos";
import { NewProjectDialog, ProjectCard, useProjectHref } from "@/components/projects";
import { ProjectsTable } from "@/components/projects-table";
import { Page } from "@/components/shell";
import { ExportButton, GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { isAdmin, useMe } from "@/lib/client/app-state";
import { filterProjects, type ProjectList, sortProjects, type Tab, TABS } from "@/lib/client/projects";

import { T } from "@/lib/client/i18n";
import { useFlagged, WarningsSwitch } from "@/lib/client/warnings";
import { useTab } from "@/lib/client/tabs";
/**
 * Projects. Project managers see every project and can create one; contractor
 * admins and EPC crew see the projects they're on; a homeowner goes straight
 * to their own project. Project managers and superadmins open on the
 * dashboard instead: "/" takes them there, and their list is /projects. Admin
 * (finance) opens on Payments.
 */
function ProjectsScreen() {
  const flagged = useFlagged();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  // Managers open on the dashboard, Admin (finance) on Payments.
  const opening = pathname !== "/" ? null : isAdmin(me?.role) ? "/dashboard" : me?.role === "finance" ? "/finance" : null;
  const toDashboard = opening !== null;
  useEffect(() => {
    if (opening) router.replace(opening);
  }, [opening, router]);
  const href = useProjectHref();
  const maintenance = useMaintenanceHref();
  const { data, error, reload } = useApi<ProjectList>(me && !toDashboard ? "/projects" : null);
  // The open tab is in the address (?tab=table), as on every screen.
  const [tab, setTab] = useTab<Tab | "table">([...TABS.map(([v]) => v), "table"], "all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<false | "list" | "photos">(false);

  const homeowner = me?.role === "homeowner";
  const only = homeowner && data?.projects.length === 1 ? data.projects[0] : null;
  useEffect(() => {
    if (only) router.replace(href(only.id));
  }, [only, router, href]);

  const all = useMemo(() => sortProjects(data?.projects ?? []), [data]);
  if (!me || only || toDashboard) return null;

  // The Table tab (staff): every project, handed-over ones too, with Excel's filters on each column.
  const staff = isAdmin(me.role) || me.role === "finance";
  const table = tab === "table" && staff;
  const shown = filterProjects(all, { query: q, tab: tab === "table" ? "all" : tab });
  const count = (t: Tab) => filterProjects(all, { tab: t }).length;
  const red = all.filter((p) => p.attention).length;
  // A homeowner isn't shown whether a project is on time, so no Attention tab or verdict chip.
  const tabs: Array<[Tab | "table", string]> = [...(homeowner ? TABS.filter(([v]) => v !== "attention") : TABS), ...(staff ? ([["table", "Table"]] as Array<["table", string]>) : [])];
  return (
    <>
      <TopBar
        title={T("Projects")}
        action={
          data?.canCreate && (
            <>
              <ExportButton path="/export/projects.xlsx" name="GetHomeApps projects.xlsx" label="Download projects and maintenance (Excel)" testId="export-projects" />
              {me.role === "superadmin" && (
                <Tooltip title={T("Import from Excel")}>
                  <IconButton aria-label={T("Import from Excel")} onClick={() => setImporting("list")} data-testid="import-projects" sx={{ color: "#fff" }}>
                    <UploadFileRoundedIcon />
                  </IconButton>
                </Tooltip>
              )}
              <Button
                onClick={() => setCreating(true)}
                startIcon={<AddRoundedIcon />}
                sx={{ color: "#073f2b", bgcolor: "#fff", px: { xs: 1.5, sm: 2 }, height: 36, "&:hover": { bgcolor: "#eafff4" } }}
              >
                <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                  {T("Create project")}
                </Box>
                <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                  {T("New")}
                </Box>
              </Button>
            </>
          )
        }
        search={table ? undefined : <SearchBox value={q} onChange={setQ} placeholder={T("Search projects, people, places")} testId="projects-search" />}
        tabs={<SegTabs label={T("Filter projects")} value={tab} onChange={setTab} options={tabs.map(([v, l]) => ({ value: v, label: l, count: data && v !== "table" ? count(v) : undefined }))} />}
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
                <Skeleton key={i} variant="rounded" height={230} />
              ))}
            </Box>
          )}

          {table && <ProjectsTable />}
          {data && !table && (
            <>
              <Heading
                title={tab === "all" ? T("Projects") : (TABS.find(([v]) => v === tab)?.[1] ?? T("Projects"))}
                count={shown.length}
                action={
                  all.length > 0 &&
                  !homeowner && (
                    <Stack direction="row" sx={{ gap: 1, rowGap: 0.5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {flagged(true) &&
                        (red ? (
                          <Chip size="small" color="error" label={T(red === 1 ? "{n} needs attention" : "{n} need attention", { n: red })} onClick={() => setTab("attention")} />
                        ) : (
                          <Chip size="small" color="success" variant="outlined" label={T("All on track")} />
                        ))}
                      <WarningsSwitch />
                    </Stack>
                  )
                }
              />
              {shown.length === 0 ? (
                <Card sx={{ p: 4, textAlign: "center" }} data-testid="projects-empty">
                  {all.length === 0 ? (
                    <>
                      <SolarPowerRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>
                        {homeowner ? T("No project is linked to your account yet") : data.canCreate ? T("No projects yet") : T("No projects assigned to you yet")}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {data.canCreate ? T("Create the first one to get started.") : T("You'll be notified when 9 Solar Home adds you to one.")}
                      </Typography>
                      {data.canCreate && (
                        <Button variant="contained" startIcon={<AddRoundedIcon />} sx={{ mt: 2 }} onClick={() => setCreating(true)}>
                          {T("Create project")}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nothing matches")}</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {T("Try a project, homeowner, contractor or postal code, or words like “late”.")}
                      </Typography>
                    </>
                  )}
                </Card>
              ) : (
                <Box sx={GRID} data-testid="projects-grid">
                  {shown.map((p) => (
                    <ProjectCard key={p.id} p={p} />
                  ))}
                </Box>
              )}
              {data.canCreate && (tab === "all" || tab === "completed") && !q && (data.handedOver ?? 0) > 0 && (
                <Card sx={{ mt: 2 }} data-testid="handed-over">
                  <CardActionArea component={Link} href={maintenance()} sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.5, justifyContent: "flex-start" }}>
                    <HandymanRoundedIcon sx={{ color: "primary.main" }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {T(data.handedOver === 1 ? "{n} handed-over project" : "{n} handed-over projects", { n: data.handedOver ?? 0 })}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {T("Their development is done. They're kept on the Maintenance page, with their systems and checks.")}
                      </Typography>
                    </Box>
                    <ChevronRightRoundedIcon sx={{ color: "text.secondary" }} />
                  </CardActionArea>
                </Card>
              )}
            </>
          )}
        </Page>
      </Box>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
      {importing === "list" && <ImportListDialog onClose={() => setImporting(false)} onDone={reload} onPhotos={() => setImporting("photos")} />}
      {importing === "photos" && <ImportPhotosDialog onClose={() => setImporting(false)} onDone={reload} />}
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsScreen />
    </Suspense>
  );
}
