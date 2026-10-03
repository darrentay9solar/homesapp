import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { type FileCategory, fileCategoryEnum } from "@/db/schema";
import { canAccessProject, canUploadCategory } from "@/lib/access";
import { requireAccount } from "@/lib/account";
import { bad, failure, forbidden } from "@/lib/api";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, presignUpload } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Step 1 of an upload: ask for a link to PUT one file to.
 *
 *   POST /api/uploads
 *   { projectId, category, fileName, contentType, size }
 *   → { key, uploadUrl, expiresIn }
 *
 * The browser then PUTs the file to uploadUrl with the same Content-Type,
 * and calls /api/uploads/complete with the key. Nothing is recorded until
 * that second call confirms the bytes are actually in R2.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAccount();
    const body = (await request.json().catch(() => null)) as {
      projectId?: number;
      category?: string;
      fileName?: string;
      contentType?: string;
      size?: number;
    } | null;

    const projectId = Number(body?.projectId);
    const category = body?.category as FileCategory;
    const contentType = String(body?.contentType ?? "");
    const size = Number(body?.size);

    if (!Number.isInteger(projectId) || projectId <= 0) return bad("projectId is required.");
    if (!fileCategoryEnum.enumValues.includes(category)) return bad("Unknown file category.");
    if (!ALLOWED_TYPES[contentType]) return bad("Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be uploaded.");
    if (!Number.isFinite(size) || size <= 0) return bad("File size is required.");
    if (size > MAX_UPLOAD_BYTES) return bad(`Files must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);

    if (!canUploadCategory(user, category)) return forbidden("Your role can't upload this kind of file.");
    if (!(await canAccessProject(user, projectId))) return forbidden("You don't have access to this project.");

    // The key is chosen here, never by the client, so one project's upload
    // can never overwrite another's — or anything else in the bucket.
    const key = `projects/${projectId}/${category}/${randomUUID()}.${ALLOWED_TYPES[contentType]}`;
    const expiresIn = 300;
    const uploadUrl = await presignUpload(key, contentType, size, expiresIn);

    return NextResponse.json({ key, uploadUrl, expiresIn });
  } catch (err) {
    return failure(err, "uploads");
  }
}
