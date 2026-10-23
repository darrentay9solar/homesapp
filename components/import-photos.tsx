"use client";

import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { unzipSync } from "fflate";
import { useRef, useState } from "react";

import { MDialog } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { typeByName } from "@/lib/client/files";
import { T, TR } from "@/lib/client/i18n";
import { uploadOne } from "@/lib/client/uploads";

type Planned = { path: string; category: "panel_pictures" | "inverter_pictures"; skip: string | null };
type FolderPlan = { folder: string; code: string | null; project: { id: number; name: string; status: string } | null; problem: string | null; files: Planned[] };
type Plan = { folders: FolderPlan[]; matched: number; photos: number; panels: number; inverters: number };
type Item = { folder: string; path: string; file: File };

const CODE = /^9SH\d{4,}\s*-/i;

/** Each file under its project-code folder ("9SH0001-23 Lorong Biawak"), wherever that sits in the path. */
export function byFolder(paths: Array<{ path: string; file: File }>): Item[] {
  return paths
    .filter(({ path }) => !path.startsWith("__MACOSX/") && !(path.split("/").pop() ?? "").startsWith("."))
    .map(({ path, file }) => {
      const parts = path.split("/").filter(Boolean);
      const i = parts.findIndex((p) => CODE.test(p));
      const at = i >= 0 ? i : Math.max(0, parts.length - 2);
      return { folder: parts[at] ?? path, path: parts.slice(at + 1).join("/") || file.name, file };
    });
}

/**
 * Projects → Import photos (superadmins): the installed photos kept in folders named by project code
 * and address. Each folder is matched to its project (the code, and the address must agree), each photo
 * sorted into panel or inverter pictures, and anything already uploaded left out. Checked first; then
 * each photo goes straight to storage, as any project file does.
 */
export function ImportPhotosDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> | void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  async function check(next: Item[]) {
    setItems(next);
    setPlan(null);
    setError(null);
    setBusy(T("Checking…"));
    try {
      const groups = new Map<string, Item[]>();
      for (const it of next) groups.set(it.folder, [...(groups.get(it.folder) ?? []), it]);
      const folders = [...groups].map(([folder, list]) => ({
        folder,
        files: list.map((x) => ({ path: x.path, name: x.file.name, size: x.file.size, type: x.file.type || typeByName(x.file.name) || "" })),
      }));
      setPlan(await fetcher<Plan>("/import/photos/check", { method: "POST", json: { folders } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  async function fromZip(f: File) {
    setBusy(T("Opening the zip…"));
    try {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      const files = Object.entries(entries)
        .filter(([p]) => !p.endsWith("/"))
        .map(([p, data]) => ({ path: p, file: new File([data as BlobPart], p.split("/").pop() ?? p, { type: typeByName(p) ?? "" }) }));
      await check(byFolder(files));
    } catch {
      setBusy(null);
      setError(T("That zip couldn't be opened."));
    }
  }

  async function upload() {
    if (!plan || !items) return;
    const where = new Map(plan.folders.filter((f) => f.project).map((f) => [f.folder, f]));
    const todo = items.flatMap((it) => {
      const f = where.get(it.folder);
      const p = f?.files.find((x) => x.path === it.path);
      return f?.project && p && !p.skip ? [{ it, pid: f.project.id, category: p.category }] : [];
    });
    setSent(0);
    setBusy(T("Uploading…"));
    let failed = 0;
    for (const [i, x] of todo.entries()) {
      try {
        await uploadOne(fetcher, { kind: "project", projectId: x.pid, category: x.category }, x.it.file);
      } catch {
        failed += 1;
      }
      setSent(i + 1);
    }
    setBusy(null);
    toast(failed ? T("{n} photos uploaded; {m} didn't go through. Run it again to retry them.", { n: todo.length - failed, m: failed }) : T("{n} photos uploaded to their projects.", { n: todo.length }), failed ? "bad" : undefined);
    await onDone();
    if (!failed) onClose();
    else await check(items);
  }

  const problems = plan?.folders.filter((f) => f.problem) ?? [];
  const skipped = new Map<string, number>();
  for (const f of plan?.folders ?? []) for (const x of f.files) if (x.skip && f.project) skipped.set(x.skip, (skipped.get(x.skip) ?? 0) + 1);
  const uploading = busy === T("Uploading…");
  return (
    <MDialog title={T("Import photos")} heading={T("Installed photos, by project folder")} subtitle={T("Folders named by project code and address (9SH0001-23 Lorong Biawak). Each photo goes into its project's panel or inverter pictures. It's checked first, and nothing is uploaded until you import.")} onClose={busy ? () => undefined : onClose}>
      <Stack sx={{ gap: 2 }}>
        <Box sx={{ border: 2, borderStyle: "dashed", borderColor: "divider", borderRadius: `${DESIGN.radius.card}px`, p: 3, textAlign: "center" }}>
          <AddPhotoAlternateOutlinedIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Typography sx={{ fontWeight: 600 }}>{items ? T("{n} files chosen", { n: items.length }) : T("Choose the photos")}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {T("The zip as downloaded, or the folder holding the project folders.")}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, mt: 1, justifyContent: "center", flexWrap: "wrap" }}>
            <Button disabled={Boolean(busy)} onClick={() => zipInput.current?.click()} data-testid="photos-zip">
              {T("Choose a zip")}
            </Button>
            <Button disabled={Boolean(busy)} onClick={() => folderInput.current?.click()} data-testid="photos-folder">
              {T("Choose a folder")}
            </Button>
          </Stack>
          <input ref={zipInput} type="file" hidden accept=".zip,application/zip" onChange={(e) => e.target.files?.[0] && void fromZip(e.target.files[0])} />
          <input
            ref={folderInput}
            type="file"
            hidden
            multiple
            {...({ webkitdirectory: "" } as object)}
            onChange={(e) => void check(byFolder(Array.from(e.target.files ?? []).map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))))}
          />
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {busy && !uploading && <LinearProgress aria-label={busy} />}
        {plan && (
          <Alert severity={plan.photos ? "success" : "info"} icon={<CheckCircleRoundedIcon />} data-testid="photos-check">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {T("Folders matched to their projects: {a} of {b}.", { a: plan.matched, b: plan.folders.length })}
            </Typography>
            <Typography variant="body2">{T("Photos to upload: {n} ({a} panels, {b} inverters).", { n: plan.photos, a: plan.panels, b: plan.inverters })}</Typography>
            {[...skipped].map(([why, n]) => (
              <Typography key={why} variant="body2">
                {T("Left out: {n} · {why}", { n, why: TR(why) })}
              </Typography>
            ))}
          </Alert>
        )}
        {problems.length > 0 && (
          <Alert severity="warning" data-testid="photos-problems">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {T("Folders left out: {n}", { n: problems.length })}
            </Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {problems.slice(0, 15).map((f) => (
                <Typography key={f.folder} component="li" variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  {f.folder}: {TR(f.problem ?? "")}
                </Typography>
              ))}
            </Box>
          </Alert>
        )}
        {uploading && plan && (
          <Box>
            <LinearProgress variant="determinate" value={plan.photos ? (sent / plan.photos) * 100 : 0} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {T("Uploading {a} of {b}…", { a: sent, b: plan.photos })}
            </Typography>
          </Box>
        )}
        <Button fullWidth size="large" variant="contained" disabled={!plan?.photos || Boolean(busy)} onClick={() => void upload()} data-testid="photos-import">
          {uploading ? T("Uploading…") : T("Import {n} photos", { n: plan?.photos ?? 0 })}
        </Button>
      </Stack>
    </MDialog>
  );
}
