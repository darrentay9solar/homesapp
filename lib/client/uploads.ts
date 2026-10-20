/**
 * Uploading and zipping for My Files. An upload is the app's usual two steps:
 * ask for a five-minute link, send the file straight to storage, then say it
 * arrived (the API checks what actually landed). Zips are made and opened
 * here in the browser, so nothing large goes through the API.
 */

import { unzipSync, zipSync } from "fflate";

import { ApiError, type Fetcher } from "./api";
import { typeByName, zipEntryName } from "./files";

/** Where an upload goes: a project's slot, or Unassigned (staff only). */
export type Destination = { kind: "project"; projectId: number; category: string } | { kind: "unassigned" };

export const MAX_BYTES = 25 * 1024 * 1024;

/** One file to Destination; resolves with the API's message. */
export async function uploadOne(fetcher: Fetcher, to: Destination, file: File): Promise<string> {
  const type = file.type || typeByName(file.name) || "";
  const link =
    to.kind === "project"
      ? await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>(`/projects/${to.projectId}/files/upload-link`, {
          method: "POST",
          json: { category: to.category, fileName: file.name, contentType: type, size: file.size },
        })
      : await fetcher<{ key: string; uploadUrl: string; headers: Record<string, string> }>("/unassigned-files/upload-link", {
          method: "POST",
          json: { fileName: file.name, contentType: type, size: file.size },
        });
  const put = await fetch(link.uploadUrl, { method: "PUT", body: file, headers: link.headers });
  if (!put.ok) throw new ApiError("The upload didn't go through. Please try again.", put.status);
  const done =
    to.kind === "project"
      ? await fetcher<{ message: string }>(`/projects/${to.projectId}/files`, { method: "POST", json: { category: to.category, key: link.key, fileName: file.name } })
      : await fetcher<{ message: string }>("/unassigned-files", { method: "POST", json: { key: link.key, fileName: file.name } });
  return done.message;
}

/**
 * The files a person dropped or chose, with any zip opened: its photos and
 * PDFs come out as files of their own (named by their path inside the zip),
 * anything else is counted as left out.
 */
export async function expandZips(files: File[]): Promise<{ files: File[]; skipped: string[] }> {
  const out: File[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const zip = /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
    if (!zip) {
      if (typeByName(f.name) || f.type) out.push(f);
      else skipped.push(f.name);
      continue;
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
    } catch {
      skipped.push(f.name);
      continue;
    }
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith("/")) continue; // a folder
      const type = typeByName(path);
      if (!type) {
        if (!path.startsWith("__MACOSX/") && !(path.split("/").pop() ?? "").startsWith("._")) skipped.push(path);
        continue;
      }
      const name = path.split("/").pop() ?? path;
      out.push(new File([data as BlobPart], name, { type }));
    }
  }
  return { files: out, skipped };
}

/**
 * Downloads files as one zip, foldered as given ("Jalan Kayu/Milestone 1/Utility Bill/bill.pdf").
 * Each file is read through the app's own link, which checks access first.
 */
export async function downloadZip(items: Array<{ url: string; path: string }>, zipName: string, onProgress?: (done: number) => void): Promise<number> {
  const entries: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  let n = 0;
  for (const it of items) {
    const res = await fetch(it.url, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new ApiError(`Couldn't read ${it.path.split("/").pop()}.`, res.status);
    entries[zipEntryName(it.path, taken)] = new Uint8Array(await res.arrayBuffer());
    n += 1;
    onProgress?.(n);
  }
  // Photos and PDFs are compressed already: stored as they are, the zip is quick to make.
  const zipped = zipSync(entries, { level: 0 });
  const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return n;
}
