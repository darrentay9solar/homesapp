import { NextResponse } from "next/server";

import { canAccessProject } from "@/lib/access";
import { requireAccount } from "@/lib/account";
import { failure } from "@/lib/api";
import { sql } from "@/lib/db";
import { presignDownload } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Opens one stored file: GET /api/files/123 → a redirect to a five-minute
 * signed R2 link, issued only after checking the viewer may see the project.
 *
 * Use this path in <img src> and links. It never goes stale the way a stored
 * signed URL would, and it is never public the way a public bucket would be.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const user = await requireAccount();
    const fileId = Number((await ctx.params).fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const [file] = (await sql()`
      select project_id, url, file_name from project_files where file_id = ${fileId}`) as Array<{
      project_id: number;
      url: string;
      file_name: string;
    }>;

    // The same answer whether the file is missing or forbidden: which file
    // ids exist is not something to reveal to people outside the project.
    if (!file || !(await canAccessProject(user, file.project_id))) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const location = await presignDownload(file.url, { fileName: file.file_name });
    return NextResponse.redirect(location, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return failure(err, "files");
  }
}
