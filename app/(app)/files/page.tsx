"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloudUploadRoundedIcon from "@mui/icons-material/CloudUploadRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DriveFileMoveRoundedIcon from "@mui/icons-material/DriveFileMoveRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import FolderZipRoundedIcon from "@mui/icons-material/FolderZipRounded";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type DragEvent, Suspense, useMemo, useRef, useState } from "react";

import { Field, MDialog, RoleAvatar } from "@/components/m";
import { Page } from "@/components/shell";
import { EdgeCard, GRID, SearchBox, SegTabs, TopBar, gradText } from "@/components/topbar";
import { ApiError, useApi, useDownload, useFetcher } from "@/lib/client/api";
import { isAdmin, useApp, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { fileSize, type LibFile, type Library, type LibTab, libraryFiles, type LooseFile, type Place, projectFolders, sectionFolders, slotsFor } from "@/lib/client/files";
import { locale, T, TR } from "@/lib/client/i18n";
import { useTab } from "@/lib/client/tabs";
import { type Destination, downloadZip, expandZips, MAX_BYTES, uploadOne } from "@/lib/client/uploads";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.zip,application/zip";
const TOP: Place = { projectId: null, section: null };

type Picked = { files: File[]; skipped: string[] };
const NONE: Picked = { files: [], skipped: [] };

/** What was dropped or chosen, with zips opened and anything too big set aside. */
async function prepare(list: File[]): Promise<Picked> {
  const { files, skipped } = await expandZips(list);
  return { files: files.filter((f) => f.size <= MAX_BYTES), skipped: [...skipped, ...files.filter((f) => f.size > MAX_BYTES).map((f) => f.name)] };
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }) : "";
}

/** A file's thumbnail or type icon. */
function Thumb({ kind, src }: { kind: "photo" | "document"; src: string | null }) {
  return (
    <Box sx={{ width: 48, height: 48, flex: "0 0 auto", borderRadius: `${DESIGN.radius.iconTile}px`, overflow: "hidden", display: "grid", placeItems: "center", bgcolor: "action.hover", color: kind === "photo" ? "primary.main" : "error.main" }}>
      {kind === "photo" && src ? <Box component="img" src={src} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : kind === "photo" ? <ImageOutlinedIcon /> : <PictureAsPdfOutlinedIcon />}
    </Box>
  );
}

/** One file: tick it (for a zip), open it, download it; for one with no project yet, assign or remove it. */
function FileRow({
  name,
  kind,
  open,
  lines,
  by,
  picked,
  onPick,
  actions,
  testId,
}: {
  name: string;
  kind: "photo" | "document";
  open: string;
  lines: string[];
  by: LibFile["uploader"];
  picked?: boolean;
  onPick?: () => void;
  actions: React.ReactNode;
  testId: string;
}) {
  return (
    <EdgeCard color={(t) => (kind === "photo" ? t.palette.primary.main : t.palette.error.main)}>
      {/* A long file name wraps rather than being cut short; on a narrow phone the buttons go under it. */}
      <Stack direction="row" sx={{ gap: 1, rowGap: 0.5, alignItems: "center", flexWrap: "wrap", p: 1.25, pl: onPick ? 0.75 : 2, flex: 1, minWidth: 0 }} data-testid={testId}>
        {onPick && <Checkbox checked={Boolean(picked)} onChange={onPick} slotProps={{ input: { "aria-label": T("Select {name}", { name }) } }} />}
        <Box component="a" href={open} target="_blank" rel="noopener" sx={{ display: "flex", gap: 1.5, alignItems: "center", color: "inherit", textDecoration: "none", flex: "1 1 160px", minWidth: 0 }}>
          <Thumb kind={kind} src={kind === "photo" ? open : null} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={[{ fontWeight: 600, fontSize: 15, overflowWrap: "anywhere" }, gradText()]}>
              {name}
            </Typography>
            {lines.map((l) => (
              <Typography key={l} variant="caption" component="div" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
                {l}
              </Typography>
            ))}
            {by && (
              <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", mt: 0.25 }}>
                <RoleAvatar name={by.name} role={by.role} size={18} src={by.avatar} />
                <Typography variant="caption" sx={{ color: "text.secondary", overflowWrap: "anywhere", minWidth: 0 }}>
                  {by.name}
                </Typography>
              </Stack>
            )}
          </Box>
        </Box>
        <Stack direction="row" sx={{ flex: "0 0 auto", ml: "auto" }}>
          {actions}
        </Stack>
      </Stack>
    </EdgeCard>
  );
}

/** A folder: a project, or a milestone section in one. */
function Folder({ name, count, onOpen, testId }: { name: string; count: number; onOpen: () => void; testId: string }) {
  return (
    <Card>
      <ButtonBase onClick={onOpen} data-testid={testId} sx={{ width: "100%", p: 2, display: "flex", gap: 1.5, alignItems: "center", justifyContent: "flex-start", textAlign: "left", fontFamily: "inherit" }}>
        <FolderRoundedIcon sx={{ color: "warning.main", fontSize: 34 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
            {name}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {T(count === 1 ? "1 file" : "{n} files", { n: count })}
          </Typography>
        </Box>
        <ChevronRightRoundedIcon sx={{ color: "text.secondary" }} />
      </ButtonBase>
    </Card>
  );
}

/** Where to put files: a project's slot, or (staff) Unassigned. Takes photos, PDFs and zips of them; drop them in or choose them. */
function UploadDialog({ lib, staff, start, first, onClose, onDone }: { lib: Library; staff: boolean; start: Place; first: Picked; onClose: () => void; onDone: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  // Files dropped on the page arrive already unpacked (prepare), so the dialog opens with them in it.
  const [files, setFiles] = useState<File[]>(first.files);
  const [skipped, setSkipped] = useState<string[]>(first.skipped);
  const [where, setWhere] = useState<"project" | "unassigned">(start.projectId !== null || !staff ? "project" : "unassigned");
  const [pid, setPid] = useState(start.projectId !== null ? String(start.projectId) : "");
  const sectionSlots = lib.slots.filter((s) => !start.section || s.section === start.section);
  const [slot, setSlot] = useState(sectionSlots[0]?.key ?? "");
  const [busy, setBusy] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function add(list: File[]) {
    const got = await prepare(list);
    setFiles((x) => [...x, ...got.files]);
    setSkipped((x) => [...x, ...got.skipped]);
  }

  const problem = files.length === 0 ? T("Choose the files to upload.") : where === "project" && (!pid || !slot) ? T("Choose the project and where on it they go.") : null;
  async function send() {
    const to: Destination = where === "unassigned" ? { kind: "unassigned" } : { kind: "project", projectId: Number(pid), category: slot };
    let ok = 0;
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(i);
      try {
        await uploadOne(fetcher, to, files[i]);
        ok += 1;
      } catch (e) {
        failed.push(`${files[i].name}: ${e instanceof ApiError ? e.message : T("didn't upload")}`);
      }
    }
    setBusy(null);
    if (failed.length) toast(T("{n} uploaded; {m} didn't: {list}", { n: ok, m: failed.length, list: failed.join("; ") }), "bad");
    else toast(T(ok === 1 ? "1 file uploaded." : "{n} files uploaded.", { n: ok }));
    await onDone();
    if (!failed.length) onClose();
  }

  return (
    <MDialog title={T("Upload Files")} heading={T("Photos and PDFs, or a zip of them")} subtitle={T("Drop them here or choose them. A zip is opened and each photo or PDF in it is uploaded.")} onClose={onClose}>
      <Stack sx={{ gap: 2 }}>
        <Box
          onDragOver={(e: DragEvent) => e.preventDefault()}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            void add(Array.from(e.dataTransfer.files));
          }}
          sx={{ border: 2, borderStyle: "dashed", borderColor: "divider", borderRadius: `${DESIGN.radius.card}px`, p: 3, textAlign: "center" }}
          data-testid="upload-drop"
        >
          <CloudUploadRoundedIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Typography sx={{ fontWeight: 600 }}>{T("Drag files or a zip here")}</Typography>
          <Button startIcon={<AddRoundedIcon />} onClick={() => input.current?.click()} sx={{ mt: 1 }}>
            {T("Choose files")}
          </Button>
          <input ref={input} type="file" hidden multiple accept={ACCEPT} onChange={(e) => void add(Array.from(e.target.files ?? []))} data-testid="upload-input" />
        </Box>
        {files.length > 0 && (
          <Box sx={{ maxHeight: 180, overflowY: "auto" }}>
            {files.map((f, i) => (
              <Stack key={`${f.name}-${i}`} direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: busy === i ? 700 : 400 }}>
                  {f.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {fileSize(f.size)}
                </Typography>
                <IconButton size="small" aria-label={T("Remove {name}", { name: f.name })} disabled={busy !== null} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Box>
        )}
        {skipped.length > 0 && <Alert severity="warning">{T("Left out (not a photo or PDF, or over 25 MB): {list}", { list: skipped.slice(0, 8).join(", ") + (skipped.length > 8 ? "…" : "") })}</Alert>}
        {staff && (
          <Field select label={T("Upload to")} value={where} onChange={(e) => setWhere(e.target.value as "project" | "unassigned")}>
            <MenuItem value="project">{T("A project")}</MenuItem>
            <MenuItem value="unassigned">{T("Unassigned (no project yet)")}</MenuItem>
          </Field>
        )}
        {where === "project" && (
          <>
            <Field select label={T("Project")} value={pid} onChange={(e) => setPid(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="" disabled>
                {T("Choose a project")}
              </MenuItem>
              {lib.projects.map((p) => (
                <MenuItem key={p.id} value={String(p.id)}>
                  {p.name}
                </MenuItem>
              ))}
            </Field>
            <SlotField lib={lib} value={slot} onChange={setSlot} />
          </>
        )}
        {busy !== null && <LinearProgress variant="determinate" value={(busy / files.length) * 100} />}
        <Button variant="contained" size="large" disabled={Boolean(problem) || busy !== null} onClick={() => void send()} data-testid="upload-send">
          {busy !== null ? T("Uploading {n} of {total}…", { n: busy + 1, total: files.length }) : T(files.length === 1 ? "Upload 1 file" : "Upload {n} files", { n: files.length })}
        </Button>
        {problem && files.length > 0 && (
          <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
            {problem}
          </Typography>
        )}
      </Stack>
    </MDialog>
  );
}

/** A project's slots, by milestone section. */
function SlotField({ lib, value, onChange, kind }: { lib: Library; value: string; onChange: (v: string) => void; kind?: "photo" | "document" }) {
  const slots = kind ? slotsFor(lib.slots, kind) : lib.slots;
  return (
    <Field select label={T("Milestone and slot")} value={value} onChange={(e) => onChange(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
      <MenuItem value="" disabled>
        {T("Choose where it goes")}
      </MenuItem>
      {lib.sections.flatMap((s) => {
        const here = slots.filter((x) => x.section === s.key);
        return here.length
          ? [
              <MenuItem key={`h-${s.key}`} disabled sx={{ fontWeight: 700, opacity: "1 !important", fontSize: 13 }}>
                {TR(s.label)}
              </MenuItem>,
              ...here.map((x) => (
                <MenuItem key={x.key} value={x.key} sx={{ pl: 3 }}>
                  {TR(x.label)}
                </MenuItem>
              )),
            ]
          : [];
      })}
    </Field>
  );
}

/** A file with no project yet goes onto one: the project, then the milestone slot it belongs in. */
function AssignDialog({ lib, f, onClose, onDone }: { lib: Library; f: LooseFile; onClose: () => void; onDone: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [pid, setPid] = useState("");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await fetcher<{ message: string }>(`/unassigned-files/${f.id}/assign`, { method: "POST", json: { projectId: Number(pid), category: slot } });
      toast(r.message);
      await onDone();
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <MDialog title={T("Assign to a Project")} heading={f.name} subtitle={T("It goes where it would if it were uploaded there, under the same rules.")} onClose={onClose} maxWidth="xs">
      <Stack sx={{ gap: 2 }}>
        <Field select label={T("Project")} value={pid} onChange={(e) => setPid(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "assign-project" } }}>
          <MenuItem value="" disabled>
            {T("Choose a project")}
          </MenuItem>
          {lib.projects.map((p) => (
            <MenuItem key={p.id} value={String(p.id)}>
              {p.name}
            </MenuItem>
          ))}
        </Field>
        <SlotField lib={lib} value={slot} onChange={setSlot} kind={f.kind} />
        <Button variant="contained" size="large" disabled={!pid || !slot || busy} onClick={() => void save()} data-testid="assign-save">
          {T("Assign")}
        </Button>
      </Stack>
    </MDialog>
  );
}

/**
 * My Files, like a shared drive: every file on the projects you're on, in
 * folders by project and milestone section; tick files (or a whole folder)
 * to download them as a zip; drop files or a zip anywhere to upload. Staff
 * also keep files with no project yet (Unassigned) and assign them later.
 */
function FilesScreen() {
  const me = useMe();
  const staff = isAdmin(me?.role);
  const fetcher = useFetcher();
  const download = useDownload();
  const { toast } = useApp();
  const { data, error, reload } = useApi<Library>(me ? "/library" : null);
  const TABS: Array<[LibTab, string]> = [
    ["all", "All"],
    ["photo", "Photos"],
    ["document", "Documents"],
    ["mine", "Uploaded by me"],
    ...(staff ? ([["unassigned", "Unassigned"]] as Array<[LibTab, string]>) : []),
  ];
  const [tab, setTab] = useTab<LibTab>(["all", "photo", "document", "mine", "unassigned"], "all");
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<Place>(TOP);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [upload, setUpload] = useState<Picked | null>(null);
  const [assign, setAssign] = useState<LooseFile | null>(null);
  const [zipping, setZipping] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const shown = useMemo(() => (data ? libraryFiles(data, tab === "unassigned" ? "all" : tab, place, q) : []), [data, tab, place, q]);
  if (!me) return null;
  const canUpload = me.role !== "homeowner" && me.role !== "finance";
  const loose = tab === "unassigned" && staff;
  // Folders until a section is open (or a search is typed): projects, then a project's milestone sections.
  const folders = !loose && !q.trim() && place.section === null;
  const projectName = place.projectId !== null ? (data?.projects.find((p) => p.id === place.projectId)?.name ?? "") : "";
  const sectionName = place.section ? TR(data?.sections.find((s) => s.key === place.section)?.label ?? "") : "";
  const go = (p: Place) => {
    setPlace(p);
    setPicked(new Set());
  };

  async function zip(list: LibFile[], name: string) {
    setZipping(T("Zipping 0 of {n}…", { n: list.length }));
    try {
      const n = await downloadZip(
        list.map((f) => ({ url: `/api/py/files/${f.id}`, path: [f.projectName ?? `#${f.projectId}`, TR(f.sectionLabel), TR(f.categoryLabel), f.name].join("/") })),
        name,
        (done) => setZipping(T("Zipping {done} of {n}…", { done, n: list.length }))
      );
      toast(T(n === 1 ? "1 file zipped and downloaded." : "{n} files zipped and downloaded.", { n }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setZipping(null);
    }
  }

  async function removeLoose(f: LooseFile) {
    if (!confirm(T("Remove {name}? It can be restored from the audit log.", { name: f.name }))) return;
    try {
      toast((await fetcher<{ message: string }>(`/unassigned-files/${f.id}`, { method: "DELETE" })).message);
      await reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    }
  }

  async function listToExcel() {
    try {
      await download("/export/table.xlsx", "Files.xlsx", {
        what: "files",
        title: "Files",
        head: ["File", "Project", "Milestone", "Slot", "Type", "Size (KB)", "Uploaded", "Uploaded by"],
        rows: shown.map((f) => [f.name, f.projectName, TR(f.sectionLabel), TR(f.categoryLabel), f.kind === "photo" ? T("Photo") : T("Document"), f.size ? Math.round(f.size / 1024) : null, f.uploadedAt.slice(0, 10), f.uploader?.name ?? null]),
      });
      toast(T("Downloaded. Open it in Excel."));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    }
  }

  const pickedFiles = shown.filter((f) => picked.has(f.id));
  const zipLabel = place.section ? `${projectName} - ${sectionName}` : place.projectId !== null ? projectName : T("Files");
  const counts: Record<LibTab, number | undefined> = data
    ? { all: data.files.length, photo: data.files.filter((f) => f.kind === "photo").length, document: data.files.filter((f) => f.kind === "document").length, mine: data.files.filter((f) => f.mine).length, unassigned: data.unassigned?.length ?? 0 }
    : { all: undefined, photo: undefined, document: undefined, mine: undefined, unassigned: undefined };

  return (
    <Box
      sx={{ display: "contents" }}
      onDragOver={(e: DragEvent) => {
        if (!canUpload || upload || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent) => {
        if (!canUpload || upload) return;
        e.preventDefault();
        setDragging(false);
        void prepare(Array.from(e.dataTransfer.files)).then(setUpload);
      }}
    >
      <TopBar
        title={staff ? "Files" : "My Files"}
        sub={loose ? "Files not on a project yet: assign each to its project and milestone" : "Every file on your projects, by project and milestone"}
        action={
          canUpload && data ? (
            <Button onClick={() => setUpload(NONE)} startIcon={<CloudUploadRoundedIcon />} data-testid="files-upload" sx={{ color: "#073f2b", bgcolor: "#fff", height: 36, px: { xs: 1.5, sm: 2 }, "&:hover": { bgcolor: "#eafff4" } }}>
              {T("Upload")}
            </Button>
          ) : undefined
        }
        search={<SearchBox value={q} onChange={setQ} placeholder="Search files, projects, milestones or people" testId="files-search" />}
        tabs={<SegTabs label="Filter files" value={staff || tab !== "unassigned" ? tab : "all"} onChange={(t) => { setTab(t); setPicked(new Set()); }} options={TABS.map(([v, l]) => ({ value: v, label: l, count: counts[v] }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {dragging && (
            <Alert severity="info" icon={<CloudUploadRoundedIcon />} sx={{ mt: 2 }}>
              {T("Drop to upload")}
            </Alert>
          )}
          {!data && !error && (
            <Box sx={{ ...GRID, mt: 3 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={80} />
              ))}
            </Box>
          )}

          {data && !loose && (
            <>
              {/* Where you are, and what you can do with what's here. */}
              <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, mt: 2, flexWrap: "wrap" }} data-testid="files-path">
                <Button size="small" onClick={() => go(TOP)} startIcon={<FolderOpenRoundedIcon />} sx={{ fontWeight: place.projectId === null ? 700 : 500 }}>
                  {T("All projects")}
                </Button>
                {place.projectId !== null && (
                  <>
                    <ChevronRightRoundedIcon sx={{ color: "text.secondary", fontSize: 18 }} />
                    <Button size="small" onClick={() => go({ projectId: place.projectId, section: null })} sx={{ fontWeight: place.section ? 500 : 700, maxWidth: 220 }}>
                      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {projectName}
                      </Box>
                    </Button>
                  </>
                )}
                {place.section && (
                  <>
                    <ChevronRightRoundedIcon sx={{ color: "text.secondary", fontSize: 18 }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, px: 0.5 }}>
                      {sectionName}
                    </Typography>
                  </>
                )}
                <Box sx={{ flex: 1 }} />
                {/* The template's own field size (as every other picker), and on a narrow phone it takes the row. */}
                <Field
                  select
                  label={T("Project")}
                  value={place.projectId === null ? "" : String(place.projectId)}
                  onChange={(e) => go({ projectId: e.target.value ? Number(e.target.value) : null, section: null })}
                  slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "files-project" } }}
                  sx={{ flex: "1 1 180px", minWidth: 0, maxWidth: { sm: 260 } }}
                >
                  <MenuItem value="">{T("All projects")}</MenuItem>
                  {data.projects.map((p) => (
                    <MenuItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Field>
              </Stack>
              <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: "wrap" }}>
                <Button size="small" variant="outlined" startIcon={<FolderZipRoundedIcon />} disabled={!shown.length || zipping !== null} onClick={() => void zip(shown, zipLabel)} data-testid="files-zip-all">
                  {T(place.projectId === null && !q.trim() ? "Download all (ZIP)" : "Download these (ZIP)")}
                </Button>
                {pickedFiles.length > 0 && (
                  <Button size="small" variant="contained" startIcon={<FolderZipRoundedIcon />} disabled={zipping !== null} onClick={() => void zip(pickedFiles, zipLabel)} data-testid="files-zip-picked">
                    {T(pickedFiles.length === 1 ? "Download 1 selected (ZIP)" : "Download {n} selected (ZIP)", { n: pickedFiles.length })}
                  </Button>
                )}
                {staff && (
                  <Button size="small" startIcon={<FileDownloadRoundedIcon />} disabled={!shown.length} onClick={() => void listToExcel()} data-testid="files-excel">
                    {T("List (Excel)")}
                  </Button>
                )}
                {zipping && (
                  <Typography variant="body2" sx={{ color: "text.secondary", alignSelf: "center" }}>
                    {zipping}
                  </Typography>
                )}
              </Stack>

              {data.files.length === 0 && (
                <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="files-empty">
                  <FolderOpenRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                  <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No files yet")}</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                    {T("Photos and documents added to your projects' milestones appear here, in a folder for each project.")}
                  </Typography>
                </Card>
              )}
              {data.files.length > 0 && shown.length === 0 && (
                <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="files-none-match">
                  <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
                  <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No files match")}</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                    {T("Try a file name, project, milestone or person, e.g. “jalan panels” or “pdf”.")}
                  </Typography>
                </Card>
              )}

              {folders && place.projectId === null && shown.length > 0 && (
                <Box sx={{ ...GRID, mt: 2 }} data-testid="files-folders">
                  {projectFolders(shown).map((p) => (
                    <Folder key={p.id} name={p.name} count={p.count} onOpen={() => go({ projectId: p.id, section: null })} testId="folder-project" />
                  ))}
                </Box>
              )}
              {folders && place.projectId !== null && shown.length > 0 && (
                <Box sx={{ ...GRID, mt: 2 }} data-testid="files-folders">
                  {sectionFolders(shown, data.sections).map((s) => (
                    <Folder key={s.key} name={TR(s.label)} count={s.count} onOpen={() => go({ projectId: place.projectId, section: s.key })} testId="folder-section" />
                  ))}
                </Box>
              )}
              {!folders && shown.length > 0 && (
                <Box sx={{ ...GRID, mt: 2 }} data-testid="files-list">
                  {shown.map((f) => (
                    <FileRow
                      key={f.id}
                      name={f.name}
                      kind={f.kind}
                      open={`/api/py/files/${f.id}`}
                      lines={[`${f.projectName ?? ""} · ${TR(f.categoryLabel)}`, `${when(f.uploadedAt)} · ${fileSize(f.size)}`]}
                      by={f.uploader}
                      picked={picked.has(f.id)}
                      onPick={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(f.id)) n.delete(f.id);
                          else n.add(f.id);
                          return n;
                        })
                      }
                      testId="file-card"
                      actions={
                        <Tooltip title={T("Download")}>
                          <IconButton component="a" href={`/api/py/files/${f.id}?download=1`} aria-label={T("Download {name}", { name: f.name })} data-testid="file-download">
                            <FileDownloadRoundedIcon />
                          </IconButton>
                        </Tooltip>
                      }
                    />
                  ))}
                </Box>
              )}
            </>
          )}

          {data && loose && (
            <>
              {(data.unassigned ?? []).length === 0 ? (
                <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="unassigned-empty">
                  <DriveFileMoveRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
                  <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nothing waiting for a project")}</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                    {T("Upload files here before you know their project; assign each to its project and milestone later.")}
                  </Typography>
                  <Button variant="contained" startIcon={<CloudUploadRoundedIcon />} sx={{ mt: 2 }} onClick={() => setUpload(NONE)}>
                    {T("Upload")}
                  </Button>
                </Card>
              ) : (
                <Box sx={{ ...GRID, mt: 2 }} data-testid="unassigned-list">
                  {(data.unassigned ?? [])
                    .filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()))
                    .map((f) => (
                      <FileRow
                        key={f.id}
                        name={f.name}
                        kind={f.kind}
                        open={`/api/py/unassigned-files/${f.id}`}
                        lines={[f.note ?? T("No project yet"), `${when(f.uploadedAt)} · ${fileSize(f.size)}`]}
                        by={f.uploader}
                        testId="unassigned-card"
                        actions={
                          <>
                            <Tooltip title={T("Assign to a project")}>
                              <IconButton onClick={() => setAssign(f)} aria-label={T("Assign {name} to a project", { name: f.name })} data-testid="unassigned-assign" color="primary">
                                <DriveFileMoveRoundedIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={T("Download")}>
                              <IconButton component="a" href={`/api/py/unassigned-files/${f.id}?download=1`} aria-label={T("Download {name}", { name: f.name })}>
                                <FileDownloadRoundedIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={T("Remove")}>
                              <IconButton onClick={() => void removeLoose(f)} aria-label={T("Remove {name}", { name: f.name })}>
                                <DeleteOutlineRoundedIcon />
                              </IconButton>
                            </Tooltip>
                          </>
                        }
                      />
                    ))}
                </Box>
              )}
            </>
          )}
          {canUpload && data && (
            <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 3 }}>
              {T("Drag photos, PDFs or a zip onto this page to upload them.")}
            </Typography>
          )}
        </Page>
      </Box>
      {upload && data && <UploadDialog lib={data} staff={staff} start={loose ? TOP : place} first={upload} onClose={() => setUpload(null)} onDone={reload} />}
      {assign && data && <AssignDialog lib={data} f={assign} onClose={() => setAssign(null)} onDone={reload} />}
    </Box>
  );
}

export default function FilesPage() {
  return (
    <Suspense>
      <FilesScreen />
    </Suspense>
  );
}
