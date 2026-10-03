import { AwsClient } from "aws4fetch";

/**
 * File storage on Cloudflare R2 — photos, signed forms, the As Built PV
 * Layout, everything in project_files.
 *
 * The bucket is private. Nothing in it has a public URL; every upload and
 * every view goes through a short-lived signed link that the server issues
 * only after checking the person may touch that project. So project_files
 * stores the object KEY, not a URL — a stored URL would either be public or
 * already expired.
 *
 * Files go straight from the phone to R2, never through Vercel: a function
 * on the Hobby tier accepts a request body of about 4.5 MB, and one panel
 * photo can be larger than that.
 *
 * R2 speaks the S3 API, so signing is plain AWS Signature V4. aws4fetch does
 * that in ~6 KB, where the AWS SDK would add megabytes for the same result.
 */

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "File storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY and R2_BUCKET (see docs/r2.md)."
    );
    this.name = "StorageNotConfiguredError";
  }
}

function config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new StorageNotConfiguredError();
  }
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
    base: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
    bucket,
  };
}

export function storageConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

/** Images and PDFs only. Anything else in a solar project file is a mistake. */
export const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/** 25 MB. A phone photo is 2–8 MB; a scanned multi-page PDF fits too. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/**
 * A link the browser can PUT one file to, valid for `seconds`.
 *
 * Content-Type and Content-Length are both signed, so R2 itself refuses an
 * upload whose type or size differs from what was approved — a "photo"
 * cannot turn out to be an HTML page, or 5 GB. (aws4fetch leaves both out of
 * the signature by default; `allHeaders` puts them in. Browsers set
 * Content-Length from the File automatically, so it matches.)
 */
export async function presignUpload(
  key: string,
  contentType: string,
  sizeBytes: number,
  seconds = 300
): Promise<string> {
  const { client, base } = config();
  const url = new URL(`${base}/${encodeKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(sizeBytes) },
    }),
    { aws: { signQuery: true, allHeaders: true } }
  );
  return signed.url;
}

/** A link to view or download one file, valid for `seconds`. */
export async function presignDownload(
  key: string,
  opts: { seconds?: number; fileName?: string } = {}
): Promise<string> {
  const { client, base } = config();
  const url = new URL(`${base}/${encodeKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(opts.seconds ?? 300));
  if (opts.fileName) {
    // Shown inline (photos open in the browser) but saved under its real name.
    url.searchParams.set(
      "response-content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`
    );
  }
  const signed = await client.sign(new Request(url, { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}

/**
 * What R2 actually holds at a key, or null if nothing arrived.
 *
 * Checked before a project_files row is written: the browser says "done",
 * but only R2 knows whether the bytes landed and how large they really are.
 */
export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  const { client, base } = config();
  const res = await client.fetch(`${base}/${encodeKey(key)}`, { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  return {
    size: Number(res.headers.get("content-length") ?? 0),
    contentType: res.headers.get("content-type"),
  };
}

export async function deleteObject(key: string): Promise<void> {
  const { client, base } = config();
  const res = await client.fetch(`${base}/${encodeKey(key)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
}
