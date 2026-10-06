"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { NewProjectDialog, ProjectCard, useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { filterProjects, type ProjectList, sortProjects, type Tab, TABS } from "@/lib/client/projects";

/**
 * Projects. Project managers see every project and can create one; contractor
 * admins and EPC crew see the projects they're on; a homeowner goes straight
 * to their own project.
 */
export default function ProjectsPage() {
  const me = useMe();
  const router = useRouter();
  const href = useProjectHref();
  const { data, error } = useApi<ProjectList>(me ? "/projects" : null);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const homeowner = me?.role === "homeowner";
  const only = homeowner && data?.projects.length === 1 ? data.projects[0] : null;
  useEffect(() => {
    if (only) router.replace(href(only.id));
  }, [only, router, href]);

  const all = useMemo(() => sortProjects(data?.projects ?? []), [data]);
  if (!me || only) return null;

  const shown = filterProjects(all, { query: q, tab });
  const count = (t: Tab) => filterProjects(all, { tab: t }).length;
  const red = all.filter((p) => p.attention).length;
  const title = homeowner ? "My Projects" : me.role === "project_manager" ? "All Projects" : "Assigned Projects";

  return (
    <>
      <TopBar
        title={title}
        sub={`${me.roleLabel} · ${me.fullName ?? me.email}`}
        action={
          data?.canCreate && (
            <Button
              onClick={() => setCreating(true)}
              startIcon={<AddRoundedIcon />}
              sx={{ color: "#073f2b", bgcolor: "#fff", px: { xs: 1.5, sm: 2 }, height: 36, "&:hover": { bgcolor: "#eafff4" } }}
            >
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                Create project
              </Box>
              <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                New
              </Box>
            </Button>
          )
        }
        search={<SearchBox value={q} onChange={setQ} placeholder="Search projects, people, places" testId="projects-search" />}
        tabs={<SegTabs label="Filter projects" value={tab} onChange={setTab} options={TABS.map(([v, l]) => ({ value: v, label: l, count: data ? count(v) : undefined }))} />}
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
                title={tab === "all" ? "Projects" : (TABS.find(([v]) => v === tab)?.[1] ?? "Projects")}
                count={shown.length}
                action={
                  all.length > 0 &&
                  (red ? (
                    <Chip size="small" color="error" label={`${red} need${red === 1 ? "s" : ""} attention`} onClick={() => setTab("attention")} />
                  ) : (
                    <Chip size="small" color="success" variant="outlined" label="All on track" />
                  ))
                }
              />
              {shown.length === 0 ? (
                <Card sx={{ p: 4, textAlign: "center" }} data-testid="projects-empty">
                  {all.length === 0 ? (
                    <>
                      <SolarPowerRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>
                        {homeowner ? "No project is linked to your account yet" : data.canCreate ? "No projects yet" : "No projects assigned to you yet"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {data.canCreate ? "Create the first one to get started." : "You'll be notified when 9 Solar Home adds you to one."}
                      </Typography>
                      {data.canCreate && (
                        <Button variant="contained" startIcon={<AddRoundedIcon />} sx={{ mt: 2 }} onClick={() => setCreating(true)}>
                          Create project
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
                      <Typography sx={{ fontWeight: 600, mt: 1 }}>Nothing matches</Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        Try a project, homeowner, contractor or postal code, or words like &ldquo;late&rdquo;.
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
            </>
          )}
        </Page>
      </Box>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}
