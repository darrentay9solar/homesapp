"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useMaintenanceHref } from "@/components/maintenance";
import { NewProjectDialog, ProjectCard, useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { isAdmin, useMe } from "@/lib/client/app-state";
import { filterProjects, type ProjectList, sortProjects, type Tab, TABS } from "@/lib/client/projects";

import { T } from "@/lib/client/i18n";
/**
 * Projects. Project managers see every project and can create one; contractor
 * admins and EPC crew see the projects they're on; a homeowner goes straight
 * to their own project. Project managers and superadmins open on the
 * dashboard instead: "/" takes them there, and their list is /projects.
 */
export default function ProjectsPage() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const toDashboard = isAdmin(me?.role) && pathname === "/";
  useEffect(() => {
    if (toDashboard) router.replace("/dashboard");
  }, [toDashboard, router]);
  const href = useProjectHref();
  const maintenance = useMaintenanceHref();
  const { data, error } = useApi<ProjectList>(me && !toDashboard ? "/projects" : null);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const homeowner = me?.role === "homeowner";
  const only = homeowner && data?.projects.length === 1 ? data.projects[0] : null;
  useEffect(() => {
    if (only) router.replace(href(only.id));
  }, [only, router, href]);

  const all = useMemo(() => sortProjects(data?.projects ?? []), [data]);
  if (!me || only || toDashboard) return null;

  const shown = filterProjects(all, { query: q, tab });
  const count = (t: Tab) => filterProjects(all, { tab: t }).length;
  const red = all.filter((p) => p.attention).length;
  return (
    <>
      <TopBar
        title={T("Projects")}
        action={
          data?.canCreate && (
            <>
              {/* Maintenance isn't on the phone's bottom bar (five tabs fit): it's here instead. */}
              <IconButton component={Link} href={maintenance()} aria-label={T("Maintenance")} data-testid="maintenance-link" sx={{ color: "#fff", display: { lg: "none" } }}>
                <HandymanRoundedIcon />
              </IconButton>
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
        search={<SearchBox value={q} onChange={setQ} placeholder={T("Search projects, people, places")} testId="projects-search" />}
        tabs={<SegTabs label={T("Filter projects")} value={tab} onChange={setTab} options={TABS.map(([v, l]) => ({ value: v, label: l, count: data ? count(v) : undefined }))} />}
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

          {data && (
            <>
              <Heading
                title={tab === "all" ? T("Projects") : (TABS.find(([v]) => v === tab)?.[1] ?? T("Projects"))}
                count={shown.length}
                action={
                  all.length > 0 &&
                  (red ? (
                    <Chip size="small" color="error" label={T(red === 1 ? "{n} needs attention" : "{n} need attention", { n: red })} onClick={() => setTab("attention")} />
                  ) : (
                    <Chip size="small" color="success" variant="outlined" label={T("All on track")} />
                  ))
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
    </>
  );
}
