/**
 * The privacy notice (app/privacy/page.tsx) and its version. The server has
 * the same version (api/_lib/privacy.py VERSION): change both together, and
 * everyone is asked to agree again.
 */
export const PRIVACY_VERSION = "2026-10-15";

/** The Data Protection Officer's email, shown in the notice (Vercel: NEXT_PUBLIC_DPO_EMAIL). */
export const DPO_EMAIL = process.env.NEXT_PUBLIC_DPO_EMAIL ?? "";

/** Whether this person still needs to agree to the current notice. */
export function needsPrivacyAgreement(p: { version: string | null; current: string } | undefined): boolean {
  return !!p && p.version !== p.current;
}
