"use client";

import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";

import { useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { EdgeCard, GRID, Heading, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { byProject, type FileTab, fileSize, filterFiles, type MyFile, tabCounts } from "@/lib/client/files";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-SG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

function FileCard({ f }: { f: MyFile }) {
  const photo = f.kind === "photo";
  const body = (
    <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", p: 1.5, pl: 2.25, flex: 1, minWidth: 0 }}>
      <Box
        sx={{
          width: 52,
          height: 52,
          flex: "0 0 auto",
          borderRadius: `${DESIGN.radius.iconTile}px`,
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
          bgcolor: "action.hover",
          color: photo ? "primary.main" : "error.main",
        }}
      >
        {photo && !f.removed ? (
          <Box component="img" src={`/api/py/files/${f.id}`} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : photo ? (
          <ImageOutlinedIcon />
        ) : (
          <PictureAsPdfOutlinedIcon />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>
          {f.name}
        </Typography>
        <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
          {f.categoryLabel}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {f.removed ? `Removed ${when(f.removed.at)}${f.removed.by ? ` by ${f.removed.by}` : ""}` : `${when(f.uploadedAt)} · ${fileSize(f.size)}`}
        </Typography>
      </Box>
      {f.removed ? <Chip size="small" label="Removed" color="warning" variant="outlined" /> : <OpenInNewRoundedIcon sx={{ color: "text.secondary", fontSize: 20 }} />}
    </Stack>
  );
  return (
    <EdgeCard color={(t) => (f.removed ? t.palette.warning.main : photo ? t.palette.primary.main : t.palette.error.main)} dim={Boolean(f.removed)}>
      {f.removed ? (
        body
      ) : (
        <Box component="a" href={`/api/py/files/${f.id}`} target="_blank" rel="noopener" data-testid="file-card" sx={{ display: "flex", color: "inherit", textDecoration: "none", flex: 1, minWidth: 0 }}>
          {body}
        </Box>
      )}
    </EdgeCard>
  );
}

/** Every photo and document you've uploaded, on any project — including ones later removed. */
export default function FilesPage() {
  const me = useMe();
  const href = useProjectHref();
  const { data, error } = useApi<{ files: MyFile[] }>(me ? "/my-files" : null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<FileTab>("all");
  if (!me) return null;

  const files = data?.files ?? [];
  const counts = tabCounts(files);
  const shown = filterFiles(files, q, tab);
  const groups = byProject(shown);
  const TABS: Array<[FileTab, string]> = [
    ["all", "All"],
    ["photo", "Photos"],
    ["document", "Documents"],
    ["removed", "Removed"],
  ];

  return (
    <>
      <TopBar
        title="My Files"
        sub="Everything you've uploaded"
        search={<SearchBox value={q} onChange={setQ} placeholder="Search files, projects or slots" testId="files-search" />}
        tabs={<SegTabs label="Filter files" value={tab} onChange={setTab} options={TABS.map(([v, l]) => ({ value: v, label: l, count: counts[v] }))} />}
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
                <Skeleton key={i} variant="rounded" height={80} />
              ))}
            </Box>
          )}
          {data && files.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="files-empty">
              <FolderOpenRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>Nothing uploaded yet</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                Photos and documents you add to a project&apos;s milestones will appear here.
              </Typography>
            </Card>
          )}
          {data && files.length > 0 && shown.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="files-none-match">
              {tab === "removed" ? <DeleteSweepOutlinedIcon sx={{ fontSize: 36, color: "text.disabled" }} /> : <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />}
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{tab === "removed" && !q ? "Nothing removed" : "No files match"}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {tab === "removed" && !q ? "None of your uploads has been taken off a project." : "Try a file name, project or slot, e.g. “jalan panels” or “pdf”."}
              </Typography>
            </Card>
          )}
          {groups.map((g) => (
            <Box key={g.projectId} data-testid="files-group">
              <Heading
                title={g.projectName}
                count={g.files.length}
                action={
                  <Typography component={Link} href={href(g.projectId)} variant="body2" sx={{ color: "primary.main", fontWeight: 600, textDecoration: "none" }}>
                    Open project
                  </Typography>
                }
              />
              <Box sx={GRID}>
                {g.files.map((f) => (
                  <FileCard key={`${f.id}-${f.removed ? "r" : "o"}`} f={f} />
                ))}
              </Box>
            </Box>
          ))}
          {tab === "removed" && counts.removed > 0 && (
            <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 3 }}>
              Removed files are kept. A project manager can restore one from the audit log.
            </Typography>
          )}
        </Page>
      </Box>
    </>
  );
}
