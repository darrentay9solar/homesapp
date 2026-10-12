/**
 * Calendars and meetings: the shapes /calendar and /meetings return, and the
 * pure logic behind the screens. Every calendar runs in 30-minute slots,
 * Singapore time (no daylight saving, so a fixed +08:00), whatever the
 * device's own time zone. No React here, so it can be unit tested
 * (tests/calendar.test.ts).
 */

import type { Role } from "./app-state";
import { currentLang, type Lang, locale } from "./i18n";

export type Response = "pending" | "accepted" | "declined";
export type MeetingStatus = "waiting" | "confirmed" | "declined" | "cancelled";
export type Place = "online" | "site" | "office" | "phone";

export type MeetingPerson = { uid: number; name: string; role: Role; response: Response };
export type Meeting = {
  id: number;
  title: string;
  kind: "meeting" | "maintenance_check";
  startsAt: string;
  endsAt: string;
  place: Place;
  location: string | null;
  onlineLink: string | null;
  notes: string | null;
  organiser: { uid: number; name: string };
  project: { id: number; name: string | null } | null;
  system: { id: number; address: string | null } | null;
  checkKey: "six_month" | "one_year" | null;
  status: MeetingStatus;
  people: MeetingPerson[];
  myResponse: Response | null;
  canEdit: boolean;
  canRespond: boolean;
};
export type Block = { id: number; startsAt: string; endsAt: string; note: string | null };
export type CalendarData = { me: number; from: string; to: string; meetings: Meeting[]; blocks: Block[]; toAnswer: number };
export type Contact = { uid: number; name: string; role: Role; roleLabel: string };
export type Contacts = { people: Contact[]; projects: Array<{ id: number; name: string; address: string | null }> };
export type Span = { startsAt: string; endsAt: string };
export type BusyPerson = { uid: number; name: string | null; busy: Span[] };

export const SLOT = 30;
/** The hours a day view shows; meetings outside them still list, and the grid scrolls. */
export const DAY_FROM = 7 * 60;
export const DAY_TO = 21 * 60;
/** Working hours: a day is "full" when they're all taken. */
export const WORK_FROM = 9 * 60;
export const WORK_TO = 18 * 60;
export const DURATIONS = [30, 60, 90, 120, 180];

const OFFSET = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ days and times

/** "YYYY-MM-DD" of an instant in Singapore. */
export function sgDay(at: string | number | Date): string {
  return new Date(new Date(at).getTime() + OFFSET).toISOString().slice(0, 10);
}

/** Minutes since Singapore midnight of an instant, on the given day (so a meeting ending at midnight reads 1440). */
export function sgMinutes(at: string | number | Date, day?: string): number {
  const t = new Date(at).getTime();
  const base = Date.parse(`${day ?? sgDay(t)}T00:00:00+08:00`);
  return Math.round((t - base) / 60_000);
}

export function today(now: number = Date.now()): string {
  return sgDay(now);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week a day is in. */
export function weekStart(day: string): string {
  return addDays(day, -weekday(day));
}

export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Six rows of seven days, Monday first, covering the month a day is in. */
export function monthGrid(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`;
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function addMonths(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** "09:30" from minutes since midnight. */
export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** What the API takes: a Singapore wall-clock time, "2026-10-12T09:30". 1440 is the next midnight. */
export function wallTime(day: string, minutes: number): string {
  if (minutes >= 1440) return wallTime(addDays(day, Math.floor(minutes / 1440)), minutes % 1440);
  return `${day}T${hhmm(minutes)}`;
}

/** The 30-minute marks of a day, from and to (to excluded). */
export function slots(from = DAY_FROM, to = DAY_TO): number[] {
  const out: number[] = [];
  for (let m = from; m < to; m += SLOT) out.push(m);
  return out;
}

/** The next 30-minute mark at or after now, as [day, minutes]. */
export function nextSlot(now: number = Date.now()): [string, number] {
  const day = sgDay(now);
  const m = Math.ceil(sgMinutes(now, day) / SLOT) * SLOT;
  return m >= 1440 ? [addDays(day, 1), 0] : [day, m];
}

/** "1 hr 30 min", "30 min". */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hr` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ on a day

export type Placed<T> = { item: T; top: number; height: number; col: number; cols: number };

/**
 * Where each event sits in a day column: minutes from the top of the day
 * (clipped to the day), and side-by-side columns where events overlap, the
 * way a calendar app lays them out.
 */
export function layoutDay<T extends Span>(items: T[], day: string): Array<Placed<T>> {
  const spans = items
    .map((item) => ({ item, s: Math.max(0, sgMinutes(item.startsAt, day)), e: Math.min(1440, sgMinutes(item.endsAt, day)) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Array<Placed<T>> = [];
  let group: Array<{ x: (typeof spans)[number]; col: number }> = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) out.push({ item: g.x.item, top: g.x.s, height: g.x.e - g.x.s, col: g.col, cols });
    group = [];
  };
  for (const x of spans) {
    if (x.s >= groupEnd && group.length) flush();
    const taken = new Set(group.filter((g) => g.x.e > x.s).map((g) => g.col));
    let col = 0;
    while (taken.has(col)) col++;
    group.push({ x, col });
    groupEnd = Math.max(groupEnd, x.e);
  }
  if (group.length) flush();
  return out;
}

/** The parts of a day (minutes) that a set of busy spans covers, merged. */
export function busyMinutes(spans: Span[], day: string): Array<[number, number]> {
  const parts = spans
    .map((s) => [Math.max(0, sgMinutes(s.startsAt, day)), Math.min(1440, sgMinutes(s.endsAt, day))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]);
    else out.push([...p]);
  }
  return out;
}

export function overlaps(parts: Array<[number, number]>, from: number, to: number): boolean {
  return parts.some(([a, b]) => a < to && b > from);
}

/** For a mini month: nothing booked, some of working hours taken, or all of them. */
export function dayLoad(spans: Span[], day: string): "free" | "some" | "full" {
  const parts = busyMinutes(spans, day);
  const inWork = parts.map(([a, b]) => [Math.max(a, WORK_FROM), Math.min(b, WORK_TO)] as [number, number]).filter(([a, b]) => b > a);
  const taken = inWork.reduce((n, [a, b]) => n + (b - a), 0);
  if (taken >= WORK_TO - WORK_FROM) return "full";
  return taken > 0 ? "some" : "free";
}

export type StartOption = { minutes: number; free: boolean; why: "past" | "busy" | null };

/**
 * Every start time on a day for a meeting of this length, and whether it's
 * free for everyone: not past, and nobody's busy at any part of it.
 */
export function startOptions(day: string, duration: number, busy: Span[], now: number = Date.now(), from = DAY_FROM, to = DAY_TO): StartOption[] {
  const parts = busyMinutes(busy, day);
  const [nowDay, nowMin] = nextSlot(now);
  return slots(from, to - duration + SLOT).map((m) => {
    const past = day < nowDay || (day === nowDay && m < nowMin);
    const taken = overlaps(parts, m, m + duration);
    return { minutes: m, free: !past && !taken, why: past ? "past" : taken ? "busy" : null };
  });
}

/** Everyone's busy spans together. */
export function allBusy(people: BusyPerson[], except?: number): Span[] {
  return people.filter((p) => p.uid !== except).flatMap((p) => p.busy);
}

/** Who among these people is busy for a meeting from..to on a day. */
export function busyNames(people: BusyPerson[], day: string, from: number, to: number): string[] {
  return people.filter((p) => overlaps(busyMinutes(p.busy, day), from, to)).map((p) => p.name ?? "");
}

// ------------------------------------------------------------------ how it reads

/** "Mon 12 Oct", in the person's language. */
export function dayText(day: string, lang: Lang = currentLang(), opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: "UTC", ...opts }).format(new Date(`${day}T00:00:00Z`));
}

/** "October 2026". */
export function monthText(day: string, lang: Lang = currentLang()): string {
  return dayText(day, lang, { month: "long", year: "numeric" });
}

/** "Mon 12 Oct · 09:30 – 10:30". */
export function whenText(m: Span, lang: Lang = currentLang()): string {
  const day = sgDay(m.startsAt);
  const endDay = sgDay(Date.parse(m.endsAt) - 1);
  const end = endDay === day ? hhmm(sgMinutes(m.endsAt, day)) : `${dayText(endDay, lang)} ${hhmm(sgMinutes(m.endsAt, endDay))}`;
  return `${dayText(day, lang)} · ${hhmm(sgMinutes(m.startsAt, day))} – ${end}`;
}

export const STATUS_TONE: Record<MeetingStatus, "success" | "warning" | "error" | "default"> = {
  confirmed: "success",
  waiting: "warning",
  declined: "error",
  cancelled: "default",
};
export const STATUS_LABEL: Record<MeetingStatus, string> = {
  confirmed: "Confirmed",
  waiting: "Waiting for answers",
  declined: "Someone declined",
  cancelled: "Cancelled",
};
export const RESPONSE_LABEL: Record<Response, string> = { pending: "Not answered", accepted: "Accepted", declined: "Declined" };
export const PLACE_LABEL: Record<Place, string> = { online: "Online", site: "On site", office: "At the office", phone: "Phone call" };

/** Meetings that are mine to answer first, then the rest by time. */
export function sortUpcoming(ms: Meeting[]): Meeting[] {
  return [...ms].sort((a, b) => Number(b.canRespond && b.myResponse === "pending") - Number(a.canRespond && a.myResponse === "pending") || a.startsAt.localeCompare(b.startsAt));
}

/** Meetings and blocks touching a day. */
export function onDay<T extends Span>(items: T[], day: string): T[] {
  const s = Date.parse(`${day}T00:00:00+08:00`);
  const e = s + DAY_MS;
  return items.filter((x) => Date.parse(x.startsAt) < e && Date.parse(x.endsAt) > s);
}

// ------------------------------------------------------------------ elsewhere

/** "20261012T013000Z": UTC, as calendar links and .ics files want it. */
export function utcStamp(at: string): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function details(m: Meeting): string {
  return [m.notes, m.onlineLink ? `Join: ${m.onlineLink}` : null, m.project?.name ? `Project: ${m.project.name}` : null, "Arranged in GetHomeApps"].filter(Boolean).join("\n");
}

function where(m: Meeting): string {
  return m.place === "online" ? (m.onlineLink ?? "Online") : (m.location ?? "");
}

/** Add it to Google Calendar (opens Google's own "new event" page, filled in). */
export function googleCalendarUrl(m: Meeting): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: m.title, dates: `${utcStamp(m.startsAt)}/${utcStamp(m.endsAt)}`, details: details(m), location: where(m), ctz: "Asia/Singapore" });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Add it to Outlook / Teams calendar (Microsoft's "new event" page, filled in). */
export function outlookUrl(m: Meeting): string {
  const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: m.title, startdt: new Date(m.startsAt).toISOString(), enddt: new Date(m.endsAt).toISOString(), body: details(m), location: where(m) });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${q}`;
}

/** Start a Teams meeting for these times, to paste its link back. No names or emails leave the app. */
export function teamsNewUrl(title: string, startsAt: string, endsAt: string): string {
  const q = new URLSearchParams({ subject: title, startTime: new Date(startsAt).toISOString(), endTime: new Date(endsAt).toISOString() });
  return `https://teams.microsoft.com/l/meeting/new?${q}`;
}

/** A new Google Meet room, to paste its link back. */
export const GOOGLE_MEET_NEW = "https://meet.google.com/new";

/** Which service a pasted link is, for its button. */
export function linkKind(link: string | null): "teams" | "meet" | "zoom" | "other" | null {
  if (!link) return null;
  if (/^https:\/\/([a-z0-9-]+\.)*teams\.(microsoft|live)\.com\//i.test(link)) return "teams";
  if (/^https:\/\/meet\.google\.com\//i.test(link)) return "meet";
  if (/^https:\/\/([a-z0-9-]+\.)*zoom\.us\//i.test(link)) return "zoom";
  return "other";
}

function icsText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** An .ics file, for any calendar app (Apple Calendar, Outlook on a laptop). */
export function icsFile(m: Meeting, now: number = Date.now()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//9 Solar Home//GetHomeApps//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:meeting-${m.id}@gethomeapps`,
    `DTSTAMP:${utcStamp(new Date(now).toISOString())}`,
    `DTSTART:${utcStamp(m.startsAt)}`,
    `DTEND:${utcStamp(m.endsAt)}`,
    `SUMMARY:${icsText(m.title)}`,
    `DESCRIPTION:${icsText(details(m))}`,
    `LOCATION:${icsText(where(m))}`,
    m.onlineLink ? `URL:${m.onlineLink}` : null,
    m.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
