/**
 * Which company's app this is. One codebase runs two sites, each with its own database, sign-in and
 * settings (docs/editions.md):
 *
 *   home      9 Solar Home's GetHomeApps (the default)
 *   fintech   9 Solar Fintech's GetApps: no homeowners, no site check-in or location, no Maintenance;
 *             "Project Manager" reads "HQ Staff" and "EPC Team" reads "EPC Project Manager"
 *
 * Set by NEXT_PUBLIC_EDITION on the site's hosting (Vercel), and EDITION for the API (api/_lib/edition.py).
 */
export type Edition = "home" | "fintech";

export const EDITION: Edition = process.env.NEXT_PUBLIC_EDITION === "fintech" ? "fintech" : "home";

/** What this edition has. */
export const FEATURES = {
  homeowners: EDITION === "home",
  checkIn: EDITION === "home",
  maintenance: EDITION === "home",
} as const;

/** The names, for the few places that show them outside a translated sentence. */
export const BRAND = EDITION === "fintech" ? { app: "GetApps", company: "9 Solar Fintech" } : { app: "GetHomeApps", company: "9 Solar Home" };

// The words each edition shows differently, applied to every piece of text the app shows (after
// translation). Order matters: "Project Manager" becomes "HQ Staff" before "EPC Team" becomes "EPC
// Project Manager", so the new role name isn't renamed again.
const SWAPS: Array<[RegExp, string]> =
  EDITION === "fintech"
    ? [
        [/GetHomeApps/g, "GetApps"],
        [/GETHOMEAPPS/g, "GETAPPS"],
        [/9 SOLAR HOME · 九太阳家/g, "9 SOLAR FINTECH"],
        [/ · 九太阳家/g, ""],
        [/九太阳家/g, "9 Solar Fintech"],
        [/9 Solar Home/g, "9 Solar Fintech"],
        [/9 SOLAR HOME/g, "9 SOLAR FINTECH"],
        // Not after "EPC ": the new role name stays as it is when text passes through twice.
        [/(?<!EPC )Project [Mm]anagers/g, "HQ Staff"],
        [/(?<!EPC )project managers/g, "HQ staff"],
        [/(?<!EPC )Project [Mm]anager/g, "HQ Staff"],
        [/(?<!EPC )project manager/g, "HQ staff"],
        [/(?<!EPC )项目经理/g, "总部员工"],
        [/EPC [Tt]eams?/g, "EPC Project Manager"],
        [/EPC 团队/g, "EPC 项目经理"],
      ]
    : [];

/** Text as this edition shows it. */
export function rebrand(text: string): string {
  let out = text;
  for (const [from, to] of SWAPS) out = out.replace(from, to);
  return out;
}
