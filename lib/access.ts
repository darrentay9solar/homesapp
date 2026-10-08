import type { FileCategory, User } from "@/db/schema";
import { sql } from "@/lib/db";

/**
 * Who may see and change a project.
 *
 *   superadmin       every project
 *   project manager  the projects they run (projects.project_manager_id)
 *   homeowner        their own project
 *   contractor/EPC   projects they are named on, directly or through any of
 *                    their contractor groups
 *
 * This is the application-side check. The same rule still needs to become
 * row level security on projects and project_files (flagged earlier as the
 * next database job), at which point this becomes the polite first line
 * rather than the only one.
 */
export async function canAccessProject(user: User, projectId: number): Promise<boolean> {
  if (!user.active) return false;
  if (user.userType === "superadmin") return true;

  const [row] = (await sql()`
    select exists (
      select 1 from projects p
       where p.project_id = ${projectId}
         and (
           (${user.userType} = 'project_manager' and p.project_manager_id = ${user.uid})
           or p.homeowner_id = ${user.uid}
           or exists (select 1 from project_assignments a
                       where a.project_id = p.project_id and a.user_id = ${user.uid})
           or exists (select 1 from contractor_group_members m
                       where m.group_id = p.contractor_group_id and m.user_id = ${user.uid})
         )
    ) as ok`) as Array<{ ok: boolean }>;
  return Boolean(row?.ok);
}

/**
 * Which file slots each role may upload into. Homeowners supply their own
 * paperwork; everything about the installation itself comes from the crew
 * and the office.
 */
const HOMEOWNER_UPLOADS: FileCategory[] = ["utility_bill", "gst_proof", "moc_change"];

export function canUploadCategory(user: User, category: FileCategory): boolean {
  if (user.userType === "homeowner") return HOMEOWNER_UPLOADS.includes(category);
  return true;
}
