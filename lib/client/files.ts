/** My Files: what the signed-in person uploaded, and how the screen searches it. */

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
      [f.name, f.projectName, f.categoryLabel, f.kind === "photo" ? "photo picture image" : "document", ext, f.contentType, f.removed ? "removed" : null],
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
