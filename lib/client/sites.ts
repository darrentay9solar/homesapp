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

export type VisitState = "upcoming" | "today" | "attended" | "missed" | "past";
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
  if (code === 1) return T("Location is blocked for GetHomeApps. Allow location in your browser or phone settings, then try again.");
  if (code === 3) return T("Couldn't get a GPS fix in time. Move to open sky, away from walls, and try again.");
  if (code === null) return T("This device can't share its location. Use a phone with GPS.");
  return T("Your location isn't available right now. Try again in a moment.");
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

export const STATE_LABEL: Record<VisitState, string> = { upcoming: "Upcoming", today: "Today", attended: "Attended", missed: "No check-in", past: "Past" };

// ------------------------------------------------------------- the day-by-day site log

/** One line of a project's site log: a check-in, or a scheduled visit nobody (yet) checked in for. */
export type LogRow = {
  key: string;
  /** The day, Singapore time (YYYY-MM-DD). */
  day: string;
  scheduled: string | null;
  works: string | null;
  who: string | null;
  inAt: string | null;
  outAt: string | null;
  hours: number | null;
  crewIn: number | null;
  crewOut: number | null;
  metres: number | null;
  /** English; translated where it's shown. */
  status: "On time" | "Late" | "No check-in" | "Not scheduled" | "Upcoming" | "Still on site";
};

const sgDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const sgTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });

/**
 * Every day on site, newest first: each check-in with when the crew came and
 * left, how long they stayed and how many were there; and each scheduled
 * visit nobody checked in for. Late is an hour or more after a visit's start
 * time, as the alerts count it.
 */
export function siteLog(data: Pick<ProjectVisits, "visits" | "unscheduled">): LogRow[] {
  const rows: LogRow[] = [];
  const line = (c: CheckIn, v: Visit | null): LogRow => {
    const hours = c.outAt ? Math.round(((Date.parse(c.outAt) - Date.parse(c.inAt)) / 3_600_000) * 10) / 10 : null;
    let status: LogRow["status"] = v ? "On time" : "Not scheduled";
    if (v?.time) {
      const [hh, mm] = v.time.split(":").map(Number);
      const start = Date.parse(`${v.date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`);
      if (Date.parse(c.inAt) - start >= 3_600_000) status = "Late";
    }
    if (!c.outAt) status = status === "Late" ? "Late" : "Still on site";
    return {
      key: `c${c.id}`,
      day: sgDay(c.inAt),
      scheduled: v?.time ?? null,
      works: v?.note ?? null,
      who: c.by.name,
      inAt: sgTime(c.inAt),
      outAt: c.outAt ? sgTime(c.outAt) : null,
      hours,
      crewIn: c.crewIn,
      crewOut: c.crewOut,
      metres: c.distance === null ? null : Math.round(c.distance),
      status,
    };
  };
  for (const v of data.visits) {
    if (v.checkIns.length) rows.push(...v.checkIns.map((c) => line(c, v)));
    else
      rows.push({
        key: `v${v.id}`,
        day: v.date,
        scheduled: v.time,
        works: v.note,
        who: null,
        inAt: null,
        outAt: null,
        hours: null,
        crewIn: null,
        crewOut: null,
        metres: null,
        status: v.state === "upcoming" || v.state === "today" ? "Upcoming" : "No check-in",
      });
  }
  rows.push(...data.unscheduled.map((c) => line(c, null)));
  return rows.sort((a, b) => b.day.localeCompare(a.day) || (b.inAt ?? "").localeCompare(a.inAt ?? ""));
}
