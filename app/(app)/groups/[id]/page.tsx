"use client";

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import {
  FigureTiles,
  GroupAction,
  GroupDialog,
  Phases,
  SpCounts,
  StageBar,
  useAct,
} from "@/components/groups";
import { MDialog } from "@/components/m";
import { useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { d2s } from "@/components/ui";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { T, TR } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";
import {
  filterGroupProjects,
  type GroupDetail,
  type GroupFilter,
  NO_FILTER,
} from "@/lib/client/workflow";

/** One group (a contract): its projects with a filter for each column, the figures across them, and its phases. */
function GroupScreen() {
  const me = useMe();
  const router = useRouter();
  const href = useProjectHref();
  const { id } = useParams<{ id: string }>();
  const {
    data: g,
    error,
    reload,
  } = useApi<GroupDetail>(me ? `/project-groups/${id}` : null);
  const [tab, setTab] = useTab<"projects" | "overview" | "phases">(
    ["projects", "overview", "phases"],
    "projects",
  );
  const [f, setF] = useState<GroupFilter>(NO_FILTER);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { act, busy } = useAct();
  const shown = useMemo(
    () => (g ? filterGroupProjects(g.projects, f) : []),
    [g, f],
  );
  if (!me) return null;
  const set = (k: keyof GroupFilter) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const filtered = Object.values(f).some(Boolean);
  const phaseName = (pid: number | null) =>
    g?.phases.find((p) => p.id === pid)?.name ?? "—";

  return (
    <>
      <TopBar
        title={g?.name ?? T("Group")}
        sub={
          g
            ? [g.contractRef, g.client].filter(Boolean).join(" · ") || undefined
            : undefined
        }
        onBack={() => router.back()}
        action={
          g?.canManage && (
            <>
              <GroupAction
                label="Edit group"
                icon={<EditRoundedIcon />}
                onClick={() => setEditing(true)}
                testId="group-edit"
              />
              <GroupAction
                label="Remove group"
                icon={<DeleteOutlineRoundedIcon />}
                onClick={() => setRemoving(true)}
                testId="group-remove"
              />
            </>
          )
        }
        search={
          g && tab !== "phases" ? (
            <SearchBox
              value={f.q}
              onChange={(q) => setF((x) => ({ ...x, q }))}
              placeholder={T("Search this group's projects")}
              testId="group-search"
            />
          ) : undefined
        }
        tabs={
          <SegTabs
            label={T("Group")}
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "projects",
                label: "Projects",
                count: g?.projects.length,
              },
              { value: "overview", label: "Overview" },
              { value: "phases", label: "Phases", count: g?.phases.length },
            ]}
          />
        }
      />
      <Box
        sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}
      >
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {TR(error.message)}
            </Alert>
          )}
          {!g && !error && (
            <Skeleton variant="rounded" height={300} sx={{ mt: 2 }} />
          )}
          {g && (
            <>
              {g.notes && (
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    mt: 2,
                    whiteSpace: "pre-line",
                  }}
                >
                  {g.notes}
                </Typography>
              )}
              {tab === "phases" && (
                <Card sx={{ p: 2, mt: 2 }}>
                  <Phases
                    gid={g.id}
                    phases={g.phases}
                    counts={g.figures.byPhase}
                    manage={g.canManage}
                    onChanged={reload}
                  />
                  {g.canManage && (
                    <Typography
                      variant="caption"
                      component="p"
                      sx={{ color: "text.secondary", mt: 1.5 }}
                    >
                      {T("Tap a phase to rename or remove it.")}
                    </Typography>
                  )}
                </Card>
              )}
              {tab !== "phases" && (
                <>
                  <Stack
                    direction="row"
                    sx={{
                      gap: 1.25,
                      mt: 2,
                      mb: 1.25,
                      flexWrap: "wrap",
                      "& > *": { flex: "1 1 150px", minWidth: 0 },
                    }}
                    data-testid="group-filters"
                  >
                    <TextField
                      select
                      size="small"
                      label={T("Phase")}
                      value={f.phase}
                      onChange={set("phase")}
                      slotProps={{
                        htmlInput: { "data-testid": "filter-phase" },
                      }}
                    >
                      <MenuItem value="">{T("Any phase")}</MenuItem>
                      {g.phases.map((p) => (
                        <MenuItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </MenuItem>
                      ))}
                      <MenuItem value="none">{T("No phase")}</MenuItem>
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={T("Stage")}
                      value={f.stage}
                      onChange={set("stage")}
                      slotProps={{
                        htmlInput: { "data-testid": "filter-stage" },
                      }}
                    >
                      <MenuItem value="">{T("Any stage")}</MenuItem>
                      {g.stages.map((s) => (
                        <MenuItem key={s.key} value={s.key}>
                          {TR(s.label)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={T("SP milestone")}
                      value={f.sp}
                      onChange={(e) =>
                        setF((x) => ({
                          ...x,
                          sp: e.target.value,
                          spDone: e.target.value ? x.spDone || "done" : "",
                        }))
                      }
                      slotProps={{ htmlInput: { "data-testid": "filter-sp" } }}
                    >
                      <MenuItem value="">{T("Any")}</MenuItem>
                      {g.spItems.map((i) => (
                        <MenuItem key={i.key} value={i.key}>
                          {TR(i.label)}
                        </MenuItem>
                      ))}
                    </TextField>
                    {f.sp && (
                      <TextField
                        select
                        size="small"
                        label={T("SP milestone is")}
                        value={f.spDone}
                        onChange={set("spDone")}
                      >
                        <MenuItem value="done">{T("Done")}</MenuItem>
                        <MenuItem value="not">{T("Not done")}</MenuItem>
                      </TextField>
                    )}
                    <TextField
                      select
                      size="small"
                      label={T("Timing")}
                      value={f.late}
                      onChange={set("late")}
                      slotProps={{
                        htmlInput: { "data-testid": "filter-late" },
                      }}
                    >
                      <MenuItem value="">{T("Any")}</MenuItem>
                      <MenuItem value="late">{T("Late")}</MenuItem>
                      <MenuItem value="ontime">{T("On time")}</MenuItem>
                    </TextField>
                    {filtered && (
                      <Button
                        size="small"
                        onClick={() => setF(NO_FILTER)}
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
                        sx={{ color: "text.secondary", mb: 1.25 }}
                      >
                        {filtered
                          ? T("Across the projects shown")
                          : T("Across the group")}
                      </Typography>
                      <FigureTiles
                        f={{
                          projects: shown.length,
                          complete: shown.filter((p) => p.complete).length,
                          late: shown.filter((p) => p.lateDays > 0).length,
                          progress: shown.length
                            ? Math.round(
                                shown.reduce((a, p) => a + p.progress, 0) /
                                  shown.length,
                              )
                            : 0,
                        }}
                      />
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
                            byStage={Object.fromEntries(
                              g.stages.map((s) => [
                                s.key,
                                shown.filter((p) => p.stage === s.key).length,
                              ]),
                            )}
                            total={shown.length}
                          />
                        </Card>
                        <Card sx={{ p: 2 }}>
                          <Typography sx={{ fontWeight: 600, mb: 1.25 }}>
                            {T("SP Milestones")}
                          </Typography>
                          <SpCounts
                            sp={Object.fromEntries(
                              g.spItems.map((i) => [
                                i.key,
                                shown.filter((p) => p.sp[i.key]).length,
                              ]),
                            )}
                            items={g.spItems}
                            total={shown.length}
                          />
                        </Card>
                      </Box>
                    </>
                  )}

                  {tab === "projects" && (
                    <Heading title={T("Projects")} count={shown.length} />
                  )}
                  {tab !== "projects" ? null : shown.length === 0 ? (
                    <Card
                      sx={{ p: 3, textAlign: "center" }}
                      data-testid="group-projects-empty"
                    >
                      <Typography sx={{ fontWeight: 600 }}>
                        {g.projects.length
                          ? T("Nothing matches")
                          : T("No projects in this group yet")}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ color: "text.secondary", mt: 0.5 }}
                      >
                        {g.projects.length
                          ? T("Try another word or clear the filters.")
                          : T(
                              "Choose this group when creating a project, or in a project's Edit.",
                            )}
                      </Typography>
                    </Card>
                  ) : (
                    <Card
                      sx={{ overflowX: "auto" }}
                      data-testid="group-projects"
                    >
                      <Table size="small" sx={{ minWidth: 760 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>{T("Project")}</TableCell>
                            <TableCell>{T("Phase")}</TableCell>
                            <TableCell>{T("Stage")}</TableCell>
                            <TableCell>{T("Progress")}</TableCell>
                            <TableCell>{T("SP")}</TableCell>
                            <TableCell>{T("Target completion")}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {shown.map((p) => (
                            <TableRow
                              key={p.id}
                              hover
                              onClick={() => router.push(href(p.id))}
                              sx={{ cursor: "pointer" }}
                              data-testid="group-project"
                            >
                              <TableCell sx={{ maxWidth: 240 }}>
                                <Typography
                                  noWrap
                                  sx={{ fontWeight: 600, fontSize: 14 }}
                                >
                                  {p.name}
                                </Typography>
                                <Typography
                                  noWrap
                                  variant="caption"
                                  sx={{
                                    color: "text.secondary",
                                    display: "block",
                                  }}
                                >
                                  {p.pm ?? "—"}
                                </Typography>
                              </TableCell>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                {phaseName(p.phaseId)}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  color={p.complete ? "success" : "info"}
                                  label={TR(p.stageLabel)}
                                />
                              </TableCell>
                              <TableCell sx={{ minWidth: 120 }}>
                                <Stack
                                  direction="row"
                                  sx={{ gap: 1, alignItems: "center" }}
                                >
                                  <LinearProgress
                                    variant="determinate"
                                    value={p.progress}
                                    color={p.lateDays > 0 ? "error" : "primary"}
                                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                                  />
                                  <Typography
                                    variant="caption"
                                    sx={{ fontWeight: 600 }}
                                  >
                                    {p.progress}%
                                  </Typography>
                                </Stack>
                              </TableCell>
                              <TableCell>
                                <Stack direction="row" sx={{ gap: 0.25 }}>
                                  {g.spItems.map((i) => (
                                    <Tooltip
                                      key={i.key}
                                      title={`${TR(i.label)}: ${p.sp[i.key] ? T("Done") : T("Not done")}`}
                                    >
                                      {p.sp[i.key] ? (
                                        <CheckCircleRoundedIcon
                                          sx={{
                                            fontSize: 17,
                                            color: "success.main",
                                          }}
                                        />
                                      ) : (
                                        <RadioButtonUncheckedRoundedIcon
                                          sx={{
                                            fontSize: 17,
                                            color: "text.disabled",
                                          }}
                                        />
                                      )}
                                    </Tooltip>
                                  ))}
                                </Stack>
                              </TableCell>
                              <TableCell>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    color:
                                      p.lateDays > 0 ? "error.main" : "inherit",
                                    fontWeight: p.lateDays > 0 ? 600 : 400,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {p.endDate ? d2s(p.endDate) : "—"}
                                </Typography>
                                {p.lateDays > 0 && (
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: "error.main",
                                      display: "block",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {T("{n} days late", { n: p.lateDays })}
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </Page>
      </Box>
      {editing && g && (
        <GroupDialog
          group={g}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
      {removing && g && (
        <MDialog
          title={T("Remove Group")}
          heading={T("Remove {name}?", { name: g.name })}
          subtitle={
            g.projects.length
              ? T("Move its projects out of the group first.")
              : T("Its phases go with it. The audit log keeps a record.")
          }
          onClose={() => setRemoving(false)}
          maxWidth="xs"
        >
          <Button
            fullWidth
            size="large"
            variant="contained"
            color="error"
            disabled={busy || g.projects.length > 0}
            onClick={async () => {
              if (await act(`/project-groups/${g.id}`, { method: "DELETE" }))
                router.push(
                  window.location.pathname.startsWith("/dev-preview")
                    ? "/dev-preview/groups"
                    : "/groups",
                );
            }}
          >
            {T("Remove group")}
          </Button>
          <Button
            fullWidth
            size="large"
            sx={{ mt: 1 }}
            onClick={() => setRemoving(false)}
          >
            {T("Cancel")}
          </Button>
        </MDialog>
      )}
    </>
  );
}

export default function GroupPage() {
  return (
    <Suspense>
      <GroupScreen />
    </Suspense>
  );
}
