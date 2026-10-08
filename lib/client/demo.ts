/**
 * The demonstration site (api/_lib/demo.py): visitors try the app as a sample
 * person, without a password. Only where NEXT_PUBLIC_DEMO_MODE=1 is set, which
 * is the demo Vercel project alone; the server also checks its own database.
 */

export const DEMO_SITE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
export const DEMO_COOKIE = "gha-demo";

/** The sample person this browser is trying the app as, if any. */
export function demoAs(): string | null {
  if (!DEMO_SITE || typeof document === "undefined") return null;
  const m = new RegExp(`(?:^|;\s*)${DEMO_COOKIE}=(\d+)`).exec(document.cookie);
  return m ? m[1] : null;
}

export function enterDemo(uid: number): void {
  document.cookie = `${DEMO_COOKIE}=${uid}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
}

export function leaveDemo(): void {
  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
