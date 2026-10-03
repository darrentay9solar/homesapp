import { NextResponse } from "next/server";

import { type FileCategory, fileCategoryEnum } from "@/db/schema";
import { canAccessProject, canUploadCategory } from "@/lib/access";
import { requireAccount } from "@/lib/account";
import { bad, failure, forbidden } from "@/lib/api";
import { asActor } from "@/lib/db";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, deleteObject, headObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Step 2 of an upload: the browser says the PUT finished.
 *
 *   POST /api/uploads/complete
 *   { projectId, category, key, fileName }
 *   → { fileId }
 *
 * Trusts nothing it is told about the file. The key must be one this
 * project and category could have been issued; the size and type come from
 * R2 itself. Only then is the project_files row written — as the uploader,
 * so the audit log records who added it.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAccount();
    const body = (await request.json().catch(() => null)) as {
      projectId?: number;
      category?: string;
      key?: string;
      fileName?: string;
    } | null;

    const projectId = Number(body?.projectId);
    const category = body?.category as FileCategory;
    const key = String(body?.key ?? "");
    const fileName = String(body?.fileName ?? "").trim().slice(0, 200) || "file";

    if (!Number.isInteger(projectId) || projectId <= 0) return bad("projectId is required.");
    if (!fileCategoryEnum.enumValues.includes(category)) return bad("Unknown file category.");

    // Exactly the shape /api/uploads issues — nothing else in the bucket.
    const expected = new RegExp(
      `^projects/${projectId}/${category}/[0-9a-f-]{36}\\.(${Object.values(ALLOWED_TYPES).join("|")})$`
    );
    if (!expected.test(key)) return bad("That upload key doesn't belong to this project.");

    if (!canUploadCategory(user, category)) return forbidden("Your role can't upload this kind of file.");
    if (!(await canAccessProject(user, projectId))) return forbidden("You don't have access to this project.");

    const head = await headObject(key);
    if (!head) return bad("The file never arrived. Please upload it again.");
    if (head.size > MAX_UPLOAD_BYTES || !head.contentType || !ALLOWED_TYPES[head.contentType]) {
      await deleteObject(key);
      return bad("That file is too large or not an allowed type.");
    }

    const [row] = await asActor<{ file_id: number }>(user.uid, (tx) => [
      tx`insert into project_files (project_id, category, url, file_name, content_type,
                                    size_bytes, uploaded_by)
         values (${projectId}, ${category}, ${key}, ${fileName}, ${head.contentType},
                 ${head.size}, ${user.uid})
         returning file_id`,
    ]);

    return NextResponse.json({ fileId: row.file_id });
  } catch (err) {
    return failure(err, "uploads");
  }
}
