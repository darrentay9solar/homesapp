"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import FolderSpecialOutlinedIcon from "@mui/icons-material/FolderSpecialOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import {
  ChecklistsPanel,
  FigureTiles,
  GroupDialog,
  SP_ITEMS,
  SpCounts,
  StageBar,
} from "@/components/groups";
import { Page } from "@/components/shell";
import { GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";
import {
  type GroupFigures,
  type GroupList,
  STAGES,
} from "@/lib/client/workflow";

/**
 * GetApps' groups: each contract with its phases and projects, and the figures across them (projects at each
 * stage, the SP approvals, late, average progress), with filters; and the Works checklists the workflow uses.
 */
function GroupsScreen() {
  const me = useMe();
  const router = useRouter();
  const { data, error, reload } = useApi<GroupList>(
    me ? "/project-groups" : null,
  );
  const [tab, setTab] = useTab<"groups" | "overview" | "checklists">(
    ["groups", "overview", "checklists"],
    "groups",
  );
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [late, setLate] = useState("");
  const [creating, setCreating] = useState(false);
  const preview =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/dev-preview");
  const href = (id: number) => `${preview ? "/dev-preview" : ""}/groups/${id}`;

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.groups ?? []).filter(
      (g) =>
        words.every((w) =>
          [
            g.name,
            g.contractRef ?? "",
            g.client ?? "",
            ...g.phases.map((p) => p.name),
          ]
            .join(" ")
            .toLowerCase()
            .includes(w),
        ) &&
        (!stage || (g.figures.byStage[stage] ?? 0) > 0) &&
        (!late ||
          (late === "late" ? g.figures.late > 0 : g.figures.late === 0)),
    );
  }, [data, q, stage, late]);

  // Across the groups shown.
  const total: GroupFigures = useMemo(() => {
    const n = shown.reduce((a, g) => a + g.figures.projects, 0);
    const sum = (
      f: (g: GroupFigures) => Record<string, number>,
      keys: string[],
    ) =>
      Object.fromEntries(
        keys.map((k) => [
          k,
          shown.reduce((a, g) => a + (f(g.figures)[k] ?? 0), 0),
        ]),
      );
    return {
      projects: n,
      complete: shown.reduce((a, g) => a + g.figures.complete, 0),
      late: shown.reduce((a, g) => a + g.figures.late, 0),
      progress: n
        ? Math.round(
            shown.reduce(
              (a, g) => a + g.figures.progress * g.figures.projects,
              0,
            ) / n,
          )
        : 0,
      byStage: sum(
        (f) => f.byStage,
        STAGES.map(([k]) => k),
      ),
      sp: sum(
        (f) => f.sp,
        SP_ITEMS.map((i) => i.key),
      ),
      byPhase: {},
    };
  }, [shown]);

  if (!me) return null;
  const manage = Boolean(data?.canManage);
  const filtered = Boolean(q || stage || late);
  return (
    <>
      <TopBar
        title={T("Groups")}
        action={
          manage &&
          tab !== "checklists" && (
            <Button
              onClick={() => setCreating(true)}
              startIcon={<AddRoundedIcon />}
              data-testid="group-new"
              sx={{
                color: "#073f2b",
                bgcolor: "#fff",
                px: { xs: 1.5, sm: 2 },
                height: 36,
                "&:hover": { bgcolor: "#eafff4" },
              }}
            >
              {T("New group")}
            </Button>
          )
        }
        search={
          tab !== "checklists" ? (
            <SearchBox
              value={q}
              onChange={setQ}
              placeholder={T("Search groups, contracts, clients, phases")}
              testId="groups-search"
            />
          ) : undefined
        }
        tabs={
          <SegTabs
            label={T("Groups")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "groups", label: "Groups", count: data?.groups.length },
              { value: "overview", label: "Overview" },
              { value: "checklists", label: "Works checklists" },
            ]}
          />
        }
      />
      <Box
        sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}
      >
        <Page>
          {tab === "checklists" && (
            <Box sx={{ mt: 2 }}>
              <ChecklistsPanel />
            </Box>
          )}
          {tab !== "checklists" && error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {TR(error.message)}
            </Alert>
          )}
          {tab !== "checklists" && !data && !error && (
            <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />
          )}
          {tab !== "checklists" && data && (
            <>
              <Stack
                direction="row"
                sx={{
                  gap: 1.25,
                  mt: 2,
                  flexWrap: "wrap",
                  "& > *": { flex: "1 1 180px", minWidth: 0 },
                }}
              >
                <TextField
                  select
                  size="small"
                  label={T("Projects at stage")}
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  slotProps={{ htmlInput: { "data-testid": "filter-stage" } }}
                >
                  <MenuItem value="">{T("Any stage")}</MenuItem>
                  {STAGES.map(([k, l]) => (
                    <MenuItem key={k} value={k}>
                      {TR(l)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={T("Late projects")}
                  value={late}
                  onChange={(e) => setLate(e.target.value)}
                  slotProps={{ htmlInput: { "data-testid": "filter-late" } }}
                >
                  <MenuItem value="">{T("Any")}</MenuItem>
                  <MenuItem value="late">{T("With late projects")}</MenuItem>
                  <MenuItem value="ontime">{T("None late")}</MenuItem>
                </TextField>
                {filtered && (
                  <Button
                    size="small"
                    onClick={() => {
                      setQ("");
                      setStage("");
                      setLate("");
                    }}
                    sx={{ flex: "0 0 auto !important" }}
                  >
                    {T("Clear filters")}
                  </Button>
                )}
              </Stack>

              {tab === "overview" && (
                <>
                  <Typography
                    variant="body2"
                    sx={{ color: "text.secondary", mt: 2.5, mb: 1.25 }}
                  >
                    {filtered
                      ? T("Across the groups shown")
                      : T("Across every group")}
                  </Typography>
                  <FigureTiles f={total} />
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.25,
                      mt: 1.25,
                      gridTemplateColumns: {
                        xs: "minmax(0, 1fr)",
                        lg: "repeat(2, minmax(0, 1fr))",
                      },
                    }}
                  >
                    <Card sx={{ p: 2 }}>
                      <Typography sx={{ fontWeight: 600, mb: 1.25 }}>
                        {T("Projects by stage")}
                      </Typography>
                      <StageBar
                        byStage={total.byStage}
                        total={total.projects}
                      />
                    </Card>
                    <Card sx={{ p: 2 }}>
                      <Typography sx={{ fontWeight: 600, mb: 1.25 }}>
                        {T("SP Milestones")}
                      </Typography>
                      <SpCounts
                        sp={total.sp}
                        items={SP_ITEMS}
                        total={total.projects}
                      />
                    </Card>
                  </Box>
                </>
              )}

              {tab === "groups" && (
                <Heading title={T("Groups")} count={shown.length} />
              )}
              {tab !== "groups" ? null : shown.length === 0 ? (
                <Card
                  sx={{ p: 4, textAlign: "center" }}
                  data-testid="groups-empty"
                >
                  <FolderSpecialOutlinedIcon
                    sx={{ fontSize: 40, color: "primary.main" }}
                  />
                  <Typography sx={{ fontWeight: 600, mt: 1 }}>
                    {data.groups.length
                      ? T("Nothing matches")
                      : T("No groups yet")}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: "text.secondary", mt: 0.5 }}
                  >
                    {data.groups.length
                      ? T("Try another word or clear the filters.")
                      : T(
                          "A group is a contract: its projects, in as many phases as it needs.",
                        )}
                  </Typography>
                  {manage && !data.groups.length && (
                    <Button
                      variant="contained"
                      startIcon={<AddRoundedIcon />}
                      sx={{ mt: 2 }}
                      onClick={() => setCreating(true)}
                    >
                      {T("New group")}
                    </Button>
                  )}
                </Card>
              ) : (
                <Box sx={GRID} data-testid="groups-grid">
                  {shown.map((g) => (
                    <Card key={g.id} data-testid="group-card">
                      <CardActionArea
                        onClick={() => router.push(href(g.id))}
                        sx={{
                          p: 2,
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          justifyContent: "flex-start",
                        }}
                      >
                        <Stack
                          direction="row"
                          sx={{ gap: 1, alignItems: "flex-start" }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              noWrap
                              sx={{ fontWeight: 600, fontSize: 16 }}
                            >
                              {g.name}
                            </Typography>
                            <Typography
                              noWrap
                              variant="body2"
                              sx={{ color: "text.secondary", fontSize: 13 }}
                            >
                              {[g.contractRef, g.client]
                                .filter(Boolean)
                                .join(" · ") || T("No contract details yet")}
                            </Typography>
                          </Box>
                          {g.figures.late > 0 ? (
                            <Chip
                              size="small"
                              color="error"
                              label={T("{n} late", { n: g.figures.late })}
                            />
                          ) : (
                            <Chip
                              size="small"
                              variant="outlined"
                              color="success"
                              label={T("On time")}
                            />
                          )}
                        </Stack>
                        <Stack
                          direction="row"
                          sx={{ gap: 0.75, flexWrap: "wrap", mt: 1.25 }}
                        >
                          <Chip
                            size="small"
                            variant="outlined"
                            label={
                              g.figures.projects === 1
                                ? T("1 project")
                                : T("{n} projects", { n: g.figures.projects })
                            }
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={
                              g.phases.length === 1
                                ? T("1 phase")
                                : T("{n} phases", { n: g.phases.length })
                            }
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={T("{n} completed", {
                              n: g.figures.complete,
                            })}
                          />
                        </Stack>
                        <Box sx={{ mt: 1.5 }}>
                          <StageBar
                            byStage={g.figures.byStage}
                            total={g.figures.projects}
                            legend={false}
                          />
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={g.figures.progress}
                          sx={{ mt: 1.5, height: 6, borderRadius: 3 }}
                        />
                        <Typography
                          variant="caption"
                          sx={{ color: "text.secondary", mt: 0.5 }}
                        >
                          {T("{n}% complete on average", {
                            n: g.figures.progress,
                          })}
                        </Typography>
                      </CardActionArea>
                    </Card>
                  ))}
                </Box>
              )}
            </>
          )}
        </Page>
      </Box>
      {creating && (
        <GroupDialog
          onClose={() => setCreating(false)}
          onSaved={async (id) => (id ? router.push(href(id)) : reload())}
        />
      )}
    </>
  );
}

export default function GroupsPage() {
  return (
    <Suspense>
      <GroupsScreen />
    </Suspense>
  );
}
