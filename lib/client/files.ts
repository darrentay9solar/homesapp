/** My Files: what the signed-in person uploaded, and how the screen searches it. */

import type { Role } from "./app-state";
import { translate } from "./i18n";
import { matchesAll } from "./search";

export type MyFile = {
  id: number;
  name: string;
  category: string | null;
  categoryLabel: string;
  projectId: number;
  projectName: string;
  contentType: string | null;
  kind: "photo" | "document";
  size: number | null;
  uploadedAt: string | null;
  removed: { at: string; by: string | null } | null;
};

export type FileTab = "all" | "photo" | "document" | "removed";

/**
 * Every word must appear somewhere in the file's name, project, slot or type
 * ("jalan panels", "pdf sunbird"). The tab narrows to photos, documents, or
 * files removed from their project; removed files appear only on their tab.
 */
export function filterFiles(files: MyFile[], query: string, tab: FileTab): MyFile[] {
  return files.filter((f) => {
    if (tab === "removed" ? !f.removed : f.removed) return false;
    if (tab === "photo" && f.kind !== "photo") return false;
    if (tab === "document" && f.kind !== "document") return false;
    const ext = f.name.includes(".") ? (f.name.split(".").pop() ?? "") : "";
    return matchesAll(
      [
        f.name,
        f.projectName,
        f.categoryLabel,
        translate(f.categoryLabel, "zh"), // so Chinese words find it too
        f.kind === "photo" ? "photo picture image 照片 图片" : "document 文件 文档",
        ext,
        f.contentType,
        f.removed ? "removed 已移除" : null,
      ],
      query
    );
  });
}

export function tabCounts(files: MyFile[]): Record<FileTab, number> {
  const on = files.filter((f) => !f.removed);
  return {
    all: on.length,
    photo: on.filter((f) => f.kind === "photo").length,
    document: on.filter((f) => f.kind === "document").length,
    removed: files.length - on.length,
  };
}

export function fileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ------------------------------------------------------------- the library (My Files, like a shared drive)

export type Person = { uid: number; name: string; role: Role; avatar: string | null };
/** A file on a project: everyone on the project sees it (GET /library). */
export type LibFile = {
  id: number;
  name: string;
  category: string;
  categoryLabel: string;
  /** The milestone section its slot is in ("pre1"... "post"), and that section's name. */
  section: string | null;
  sectionLabel: string;
  projectId: number;
  projectName: string | null;
  contentType: string | null;
  kind: "photo" | "document";
  size: number | null;
  uploadedAt: string;
  mine: boolean;
  uploader: Person | null;
};
/** A file with no project yet (staff only). */
export type LooseFile = { id: number; name: string; contentType: string | null; kind: "photo" | "document"; size: number | null; note: string | null; uploadedAt: string; uploader: Person | null };
export type Slot = { key: string; label: string; section: string; kind: "file" | "photos" };
export type Library = {
  files: LibFile[];
  projects: Array<{ id: number; name: string; status: string }>;
  sections: Array<{ key: string; label: string }>;
  slots: Slot[];
  /** null for anyone but staff. */
  unassigned: LooseFile[] | null;
};

export type LibTab = "all" | "photo" | "document" | "mine" | "unassigned";
/** Where you are in the folders: everything, one project, or one of its milestone sections. */
export type Place = { projectId: number | null; section: string | null };

/** The library's files on this tab, in this folder, matching every word of the search. */
export function libraryFiles(lib: Library, tab: LibTab, place: Place, query: string): LibFile[] {
  return lib.files.filter((f) => {
    if (tab === "photo" && f.kind !== "photo") return false;
    if (tab === "document" && f.kind !== "document") return false;
    if (tab === "mine" && !f.mine) return false;
    if (place.projectId !== null && f.projectId !== place.projectId) return false;
    if (place.section !== null && f.section !== place.section) return false;
    const ext = f.name.includes(".") ? (f.name.split(".").pop() ?? "") : "";
    return matchesAll(
      [f.name, f.projectName, f.categoryLabel, translate(f.categoryLabel, "zh"), f.sectionLabel, f.uploader?.name, f.kind === "photo" ? "photo picture image 照片 图片" : "document 文件 文档", ext],
      query
    );
  });
}

/** The folders a list of files makes: one per project (newest activity first), or, inside a project, one per milestone section in order. */
export function projectFolders(files: LibFile[]): Array<{ id: number; name: string; count: number; last: string }> {
  const out = new Map<number, { id: number; name: string; count: number; last: string }>();
  for (const f of files) {
    const g = out.get(f.projectId) ?? { id: f.projectId, name: f.projectName ?? `#${f.projectId}`, count: 0, last: "" };
    g.count += 1;
    if (f.uploadedAt > g.last) g.last = f.uploadedAt;
    out.set(f.projectId, g);
  }
  return [...out.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export function sectionFolders(files: LibFile[], sections: Library["sections"]): Array<{ key: string; label: string; count: number }> {
  return sections.map((s) => ({ ...s, count: files.filter((f) => f.section === s.key).length })).filter((s) => s.count > 0);
}

/** The slots a file may go in: photos only where photos go; a document only where documents go. */
export function slotsFor(slots: Slot[], kind: "photo" | "document"): Slot[] {
  return kind === "photo" ? slots : slots.filter((s) => s.kind === "file");
}

/**
 * What a file inside a zip is, by its name, if it's one the app keeps (photos and PDFs); null otherwise,
 * and for the hidden copies a Mac adds to a zip ("__MACOSX/...", "._photo.jpg").
 */
export function typeByName(name: string): string | null {
  const base = name.split("/").pop() ?? "";
  if (name.startsWith("__MACOSX/") || base.startsWith("._") || !base.includes(".")) return null;
  const ext = (base.split(".").pop() ?? "").toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" } as Record<string, string>)[ext] ?? null;
}

/** A name that's safe and distinct inside a zip: the folder path kept, a repeat numbered ("bill (2).pdf"). */
export function zipEntryName(path: string, taken: Set<string>): string {
  const clean = path.replace(/[\\:*?"<>|]/g, "_");
  let name = clean;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const dot = clean.lastIndexOf(".");
    name = dot > clean.lastIndexOf("/") ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Newest first, grouped by project in the order each project was last touched. */
export function byProject(files: MyFile[]): Array<{ projectId: number; projectName: string; files: MyFile[] }> {
  const sorted = [...files].sort((a, b) => (b.removed?.at ?? b.uploadedAt ?? "").localeCompare(a.removed?.at ?? a.uploadedAt ?? ""));
  const groups = new Map<number, { projectId: number; projectName: string; files: MyFile[] }>();
  for (const f of sorted) {
    const g = groups.get(f.projectId) ?? { projectId: f.projectId, projectName: f.projectName, files: [] };
    g.files.push(f);
    groups.set(f.projectId, g);
  }
  return [...groups.values()];
}
