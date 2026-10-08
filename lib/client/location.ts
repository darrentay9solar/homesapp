/**
 * Places on the map: distances, how a distance or a last-seen time reads, and
 * when a sharing phone should send its position again.
 */

import { T } from "./i18n";

export type LatLng = { lat: number; lng: number };

/** Singapore, for a map with nothing on it yet. */
export const SINGAPORE: LatLng = { lat: 1.3521, lng: 103.8198 };

/** Metres between two points (haversine; plenty accurate across Singapore). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "40 m", "850 m", "1.2 km", "12 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return T("{m} m", { m: Math.max(0, Math.round(m / 10) * 10) });
  return T("{km} km", { km: m < 10_000 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)) });
}

/** "{distance} away", or "You're here" inside the site's check-in radius. */
export function awayText(m: number, radius: number): string {
  return m <= radius ? T("You're at this site") : T("{distance} away", { distance: formatDistance(m) });
}

// ------------------------------------------------------------ sharing

/** Send again after this long even when standing still, so "last seen" stays fresh. */
export const SEND_EVERY_MS = 2 * 60_000;
/** ...or sooner, once they've moved this far. */
export const SEND_AFTER_MOVING_M = 100;
/** Never more often than this, however much the GPS jitters. */
export const MIN_GAP_MS = 20_000;
/** A fix this rough isn't worth sending. */
export const MAX_SHARE_ACCURACY_M = 1000;

export type Sent = { at: number; pos: LatLng } | null;

/** Whether a new fix should go to the server, given what was sent last. */
export function shouldSend(last: Sent, fix: LatLng & { accuracy?: number | null }, now: number): boolean {
  if (fix.accuracy != null && fix.accuracy > MAX_SHARE_ACCURACY_M) return false;
  if (!last) return true;
  const gap = now - last.at;
  if (gap < MIN_GAP_MS) return false;
  return gap >= SEND_EVERY_MS || distanceM(last.pos, fix) >= SEND_AFTER_MOVING_M;
}

/** How old a shared position is: "Just now", "5 min ago", "2 h ago", "3 d ago". Old ones are flagged stale. */
export function seenAgo(iso: string, now = Date.now()): { text: string; stale: boolean } {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  const stale = mins > 30;
  if (mins < 1) return { text: T("Just now"), stale };
  if (mins < 60) return { text: T("{n} min ago", { n: mins }), stale };
  const h = Math.round(mins / 60);
  if (h < 24) return { text: T("{n} h ago", { n: h }), stale };
  return { text: T("{n} d ago", { n: Math.round(h / 24) }), stale };
}
