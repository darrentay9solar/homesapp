/**
 * Site visits and GPS check-in on the browser side: shapes, the phone's
 * location, and wording. The rules themselves are the server's.
 */

import { locale, T } from "./i18n";

export type CheckIn = {
  id: number;
  visitId: number | null;
  by: { uid: number; name: string | null };
  inAt: string;
  crewIn: number;
  distance: number | null;
  outAt: string | null;
  crewOut: number | null;
  outDistance: number | null;
};

export type VisitState = "upcoming" | "today" | "attended" | "missed";
export type Visit = { id: number; date: string; time: string | null; note: string | null; by: string | null; state: VisitState; checkIns: CheckIn[] };

export type ProjectVisits = {
  visits: Visit[];
  unscheduled: CheckIn[];
  canSchedule: boolean;
  canCheckIn: boolean;
  myOpenCheckIn: CheckIn | null;
  site: { located: boolean; radius: number; lat: number | null; lng: number | null };
  status: string;
};

export type SiteRow = {
  id: number;
  name: string;
  address: string;
  postalCode: string | null;
  located: boolean;
  radius: number;
  site: { lat: number; lng: number } | null;
  today: Array<{ id: number; time: string | null; note: string | null }>;
  next: { date: string; time: string | null; note: string | null } | null;
  open: CheckIn | null;
  canCheckIn: boolean;
};

export type Fix = { lat: number; lng: number; accuracy: number };

/** The most a fix may be off by and still count (must match the database's geo_max_accuracy_m). */
export const MAX_ACCURACY_M = 50;

/** Why the browser couldn't give a location, in words a crew member can act on. */
export function locationProblem(code: number | null): string {
  if (code === 1) return "Location is blocked for GetHomeApps. Allow location in your browser or phone settings, then try again.";
  if (code === 3) return "Couldn't get a GPS fix in time. Move to open sky, away from walls, and try again.";
  if (code === null) return "This device can't share its location. Use a phone with GPS.";
  return "Your location isn't available right now. Try again in a moment.";
}

/** One fresh, high-accuracy reading of where the phone is. Never a cached one. */
export function getFix(timeoutMs = 20_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error(locationProblem(null)));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(locationProblem(e.code))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/** "Accurate to 12 m", with a warning when it's too rough to count. */
export function describeFix(f: Fix): { text: string; good: boolean } {
  const m = Math.round(f.accuracy);
  return f.accuracy <= MAX_ACCURACY_M
    ? { text: T("Location found · accurate to {m} m", { m }), good: true }
    : { text: T("Location is rough (±{m} m). Step outside or away from walls for a better fix.", { m }), good: false };
}

const SG = "Asia/Singapore";
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: SG });

/** "Mon, 12 Oct" — how a visit's day reads in a list. */
export function visitDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00+08:00`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", timeZone: SG });
}

/** One line per check-in: who, when they arrived and left, and with how many. */
export function describeCheckIn(c: CheckIn): string {
  const who = c.by.name ?? T("Crew");
  const arrived =
    c.distance !== null
      ? T("{name} in {time} ({n} crew, {m} m)", { name: who, time: hhmm(c.inAt), n: c.crewIn, m: Math.round(c.distance) })
      : T("{name} in {time} ({n} crew)", { name: who, time: hhmm(c.inAt), n: c.crewIn });
  return c.outAt
    ? T("{arrived} · out {time} ({n} still on site)", { arrived, time: hhmm(c.outAt), n: c.crewOut ?? 0 })
    : T("{arrived} · still on site", { arrived });
}

export const STATE_LABEL: Record<VisitState, string> = { upcoming: "Upcoming", today: "Today", attended: "Attended", missed: "No check-in" };
