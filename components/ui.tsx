/** Small formatting helpers shared by the screens: initials, dates and "how long ago", in the current language. */

import { locale, T } from "@/lib/client/i18n";

export function initials(name: string | null | undefined): string {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** "29 Jul 2026" (or "2026年7月29日") — dates as people in Singapore write them. */
export function d2s(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00+08:00`) : new Date(d);
  return date.toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
}

/** "just now", "5 min ago", "2 h ago", "3 d ago", then a date. */
export function ago(d: string | Date | null | undefined): string {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return T("just now");
  if (s < 3600) return T("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return T("{n} h ago", { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return T("{n} d ago", { n: Math.floor(s / 86400) });
  return d2s(d);
}

/** "29 Jul 2026 14:05" in Singapore time, whatever the device's clock says. */
export function dt2s(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d)
    .toLocaleString(locale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" })
    .replace(",", "");
}
