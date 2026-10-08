"use client";

import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { RoleAvatar } from "@/components/m";
import { Page } from "@/components/shell";
import { EdgeCard, GRID, SearchBox, SegTabs, TopBar } from "@/components/topbar";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { isAdmin, type Role, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { type FileTab, fileSize, filterFiles, type MyFile, tabCounts } from "@/lib/client/files";
import { locale, T, TR } from "@/lib/client/i18n";

type Scope = "mine" | "all";
type Everyone = MyFile & { uploader: { uid: number; name: string; role: Role; avatar: string | null } | null };

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }) : "";
}

function FileCard({ f }: { f: MyFile | Everyone }) {
  const photo = f.kind === "photo";
  const by = "uploader" in f ? f.uploader : null;
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
          {f.projectName} · {TR(f.categoryLabel)}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {f.removed
            ? f.removed.by
              ? T("Removed {date} by {name}", { date: when(f.removed.at), name: f.removed.by })
              : T("Removed {date}", { date: when(f.removed.at) })
            : `${when(f.uploadedAt)} · ${fileSize(f.size)}`}
        </Typography>
        {by && (
          <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", mt: 0.5 }}>
            <RoleAvatar name={by.name} role={by.role} size={20} src={by.avatar} />
            <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>
              {by.name}
            </Typography>
          </Stack>
        )}
      </Box>
      {f.removed ? <Chip size="small" label={T("Removed")} color="warning" variant="outlined" /> : <OpenInNewRoundedIcon sx={{ color: "text.secondary", fontSize: 20 }} />}
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

/** Everyone's files, for project managers: searched on the server, newest first, 100 at a time. */
function useEveryone(q: string, tab: FileTab, on: boolean) {
  const fetcher = useFetcher();
  const [files, setFiles] = useState<Everyone[] | null>(null);
  const [more, setMore] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const kind = tab === "photo" ? "image" : tab === "document" ? "document" : "all";

  useEffect(() => {
    if (!on) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await fetcher<{ files: Everyone[]; more: boolean; counts: Record<string, number> }>(`/all-files?q=${encodeURIComponent(q)}&kind=${kind}`);
        if (stale) return;
        setFiles(r.files);
        setMore(r.more);
        setCounts(r.counts);
        setError(null);
      } catch (e) {
        if (!stale) setError(e instanceof ApiError ? e.message : T("Couldn't load the files."));
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [on, q, kind, fetcher]);

  async function older() {
    const last = files?.[files.length - 1];
    if (!last) return;
    const r = await fetcher<{ files: Everyone[]; more: boolean }>(`/all-files?q=${encodeURIComponent(q)}&kind=${kind}&before=${last.id}`);
    setFiles((f) => [...(f ?? []), ...r.files]);
    setMore(r.more);
  }
  return { files, more, counts, error, older };
}

/**
 * Files. Everyone sees what they've uploaded, on any project, including ones
 * later removed. Project managers can switch to everyone's files and search them.
 */
export default function FilesPage() {
  const me = useMe();
  const pm = isAdmin(me?.role);
  const [scope, setScope] = useState<Scope>("mine");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<FileTab>("all");
  const mine = useApi<{ files: MyFile[] }>(me && scope === "mine" ? "/my-files" : null);
  const all = useEveryone(q, tab, pm && scope === "all");
  if (!me) return null;

  const everyone = scope === "all";
  const myFiles = mine.data?.files ?? [];
  const shown: Array<MyFile | Everyone> = everyone ? (all.files ?? []) : filterFiles(myFiles, q, tab);
  const loaded = everyone ? all.files !== null : mine.data !== null;
  const error = everyone ? all.error : mine.error?.message ?? null;
  const counts = everyone
    ? { all: (all.counts.image ?? 0) + (all.counts.document ?? 0), photo: all.counts.image ?? 0, document: all.counts.document ?? 0, removed: 0 }
    : tabCounts(myFiles);
  const TABS: Array<[FileTab, string]> = [
    ["all", "All"],
    ["photo", "Photos"],
    ["document", "Documents"],
    ...(everyone ? [] : ([["removed", "Removed"]] as Array<[FileTab, string]>)),
  ];

  return (
    <>
      <TopBar
        title={pm ? "Files" : "My Files"}
        sub={everyone ? "Every project's photos and documents" : "Everything you've uploaded"}
        action={
          pm ? (
            <Button
              onClick={() => {
                setScope(everyone ? "mine" : "all");
                if (tab === "removed") setTab("all");
              }}
              data-testid="files-scope"
              sx={{ color: "#073f2b", bgcolor: "#fff", height: 36, px: 1.5, "&:hover": { bgcolor: "#eafff4" } }}
            >
              {everyone ? T("Just mine") : T("Everyone's")}
            </Button>
          ) : undefined
        }
        search={<SearchBox value={q} onChange={setQ} placeholder={everyone ? "Search by file, project, person or slot" : "Search files, projects or slots"} testId="files-search" />}
        tabs={<SegTabs label="Filter files" value={tab} onChange={setTab} options={TABS.map(([v, l]) => ({ value: v, label: l, count: counts[v] }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          {!loaded && !error && (
            <Box sx={{ ...GRID, mt: 3 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={80} />
              ))}
            </Box>
          )}
          {loaded && !everyone && myFiles.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="files-empty">
              <FolderOpenRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nothing uploaded yet")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {T("Photos and documents you add to a project's milestones will appear here.")}
              </Typography>
            </Card>
          )}
          {loaded && (everyone || myFiles.length > 0) && shown.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="files-none-match">
              {tab === "removed" ? <DeleteSweepOutlinedIcon sx={{ fontSize: 36, color: "text.disabled" }} /> : <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />}
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{tab === "removed" && !q ? T("Nothing removed") : T("No files match")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {tab === "removed" && !q ? T("None of your uploads has been taken off a project.") : T("Try a file name, project or slot, e.g. “jalan panels” or “pdf”.")}
              </Typography>
            </Card>
          )}
          {/* One list, newest first; each card says which project it's on. Photos and documents are the tabs. */}
          {shown.length > 0 && (
            <Box sx={{ ...GRID, mt: 2 }} data-testid="files-list">
              {shown.map((f) => (
                <FileCard key={`${f.id}-${f.removed ? "r" : "o"}`} f={f} />
              ))}
            </Box>
          )}
          {everyone && all.more && (
            <Stack sx={{ alignItems: "center", mt: 2.5 }}>
              <Button onClick={() => void all.older()}>{T("Show more")}</Button>
            </Stack>
          )}
          {tab === "removed" && counts.removed > 0 && (
            <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 3 }}>
              {T("Removed files are kept. A project manager can restore one from the audit log.")}
            </Typography>
          )}
        </Page>
      </Box>
    </>
  );
}
