/**
 * Notification preferences, as the server stores them (api/_lib/prefs.py),
 * and the arithmetic the settings screen needs: pausing until a time, and
 * describing the current state in a line.
 */

export type Category = "approvals" | "visits" | "late" | "milestones" | "people" | "account";
export type Prefs = {
  pausedUntil: string | null;
  quiet: { on: boolean; from: string; to: string };
  urgent: boolean;
  mute: Category[];
  channels: { push: boolean; email: boolean; mobile: boolean };
};

export const DEFAULT_PREFS: Prefs = {
  pausedUntil: null,
  quiet: { on: false, from: "22:00", to: "07:00" },
  urgent: true,
  mute: [],
  channels: { push: true, email: true, mobile: true },
};

/** The categories, in the order the screen lists them, with who they matter to. */
export const CATEGORIES: Array<{ key: Category; label: string; sub: string; pm?: boolean }> = [
  { key: "approvals", label: "Approvals", sub: "Projects to approve, approved or declined" },
  { key: "visits", label: "Site visits", sub: "Visits scheduled for you, and the reminder an hour before" },
  { key: "late", label: "Crews running late", sub: "No check-in an hour after a visit's start, or a late arrival" },
  { key: "milestones", label: "Milestones and handover", sub: "A milestone completed, or a project ready for handover" },
  { key: "people", label: "People to review", sub: "New account and role requests", pm: true },
  { key: "account", label: "Your account", sub: "Your account or role approved, and changes reverted" },
];

export type PauseChoice = "off" | "1h" | "8h" | "morning" | "week";

/** When a pause chosen now ends, in Singapore time. "morning" is 8 am tomorrow. */
export function pauseUntil(choice: PauseChoice, now = new Date()): string | null {
  const h = 3_600_000;
  if (choice === "off") return null;
  if (choice === "1h") return new Date(now.getTime() + h).toISOString();
  if (choice === "8h") return new Date(now.getTime() + 8 * h).toISOString();
  if (choice === "week") return new Date(now.getTime() + 7 * 24 * h).toISOString();
  // 8:00 tomorrow, Singapore (UTC+8): 00:00 UTC the next Singapore day.
  const sg = new Date(now.getTime() + 8 * h);
  const tomorrow = Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate() + 1, 0, 0);
  return new Date(tomorrow).toISOString();
}

export function isPaused(p: Prefs, now = new Date()): boolean {
  return Boolean(p.pausedUntil && new Date(p.pausedUntil) > now);
}

/** True while it's inside the quiet hours (Singapore time); handles overnight ranges like 22:00 → 07:00. */
export function inQuietHours(p: Prefs, now = new Date()): boolean {
  if (!p.quiet.on) return false;
  const sg = new Date(now.getTime() + 8 * 3_600_000);
  const minutes = sg.getUTCHours() * 60 + sg.getUTCMinutes();
  const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const [a, b] = [m(p.quiet.from), m(p.quiet.to)];
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** One line for the settings row: what's happening now. Keys are English, translated by the caller. */
export function summary(p: Prefs, now = new Date()): { key: string; params?: Record<string, string> } {
  if (isPaused(p, now)) return { key: "Paused until {time}", params: { time: p.pausedUntil! } };
  const off = Object.values(p.channels).every((v) => !v);
  if (off) return { key: "Phone, email and WhatsApp are off; alerts stay in the app" };
  if (p.quiet.on) return { key: "Quiet from {from} to {to}", params: { from: p.quiet.from, to: p.quiet.to } };
  if (p.mute.length) return { key: "{n} kinds of alert silenced", params: { n: String(p.mute.length) } };
  return { key: "Everything on" };
}
