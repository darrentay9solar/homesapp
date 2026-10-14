/**
 * Support: the shapes /support returns, and the small decisions the screens
 * share (which tab a conversation sits in, how a status reads, when to show
 * a day above the messages).
 */
import type { Role } from "./app-state";

export type SupportStatus = "assistant" | "waiting" | "open" | "settled";

export type ThreadSummary = {
  id: number;
  subject: string;
  status: SupportStatus;
  statusLabel: string;
  project: { id: number; name: string } | null;
  openedBy: { uid: number; name: string | null; role: Role };
  handledBy: { uid: number; name: string | null } | null;
  askedAt: string | null;
  answeredAt: string | null;
  settledAt: string | null;
  createdAt: string;
  mine: boolean;
  last?: { body: string; kind: MessageKind; at: string | null; by: string | null } | null;
  unread?: number;
};

export type Inbox = {
  threads: ThreadSummary[];
  staff: boolean;
  superadmin: boolean;
  canAsk: boolean;
  /** Homeowners talk with the assistant first; anyone else goes straight to a person. */
  assistant: boolean;
  /** Claude answers (otherwise the closest answer from the list). */
  ai: boolean;
  projects: Array<{ id: number; name: string }>;
};

/** call: a video call link (Google Meet, Teams or Zoom) from whoever handles it. */
export type MessageKind = "text" | "assistant" | "event" | "call";

export type Message = {
  id: number;
  kind: MessageKind;
  body: string;
  at: string;
  by: { uid: number; name: string | null; role: Role } | null;
};

export type Member = { uid: number; name: string | null; role: Role; roleLabel: string; asker: boolean; handler: boolean };

export type Thread = ThreadSummary & {
  messages: Message[];
  members: Member[];
  can: { write: boolean; askPerson: boolean; add: boolean; remove: boolean; settle: boolean; reopen: boolean; assign: boolean; call: boolean };
};

export type Answer = {
  id: number;
  question: string;
  answer: string;
  questionZh: string | null;
  answerZh: string | null;
  position: number;
  active: boolean;
  updatedAt: string | null;
};

export type Candidate = { uid: number; name: string; email: string; role: Role; roleLabel: string; onProject: boolean };

/** The inbox's tabs. "Waiting" first: people waiting for a first answer. */
export type SupportTab = "waiting" | "open" | "assistant" | "settled" | "all";

export function tabOf(t: ThreadSummary): SupportTab {
  return t.status;
}

export function inTab(threads: ThreadSummary[], tab: SupportTab): ThreadSummary[] {
  return tab === "all" ? threads : threads.filter((t) => tabOf(t) === tab);
}

/** The tone a status reads in: waiting is the one that needs someone. */
export function statusTone(s: SupportStatus): "warning" | "success" | "default" | "info" {
  return s === "waiting" ? "warning" : s === "open" ? "info" : s === "settled" ? "success" : "default";
}

/** The status in the words the asker would use (a manager sees the plain one). */
export function statusText(s: SupportStatus, staff: boolean): string {
  if (staff) return { assistant: "With the assistant", waiting: "Waiting for a person", open: "In progress", settled: "Settled" }[s];
  return { assistant: "With the assistant", waiting: "Waiting for your project manager", open: "Your project manager is on it", settled: "Settled" }[s];
}

/** Singapore day of a time, for the day labels between messages. */
export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

/** Messages with a day label wherever the day changes. */
export function withDays(messages: Message[]): Array<{ day: string; messages: Message[] }> {
  const out: Array<{ day: string; messages: Message[] }> = [];
  for (const m of messages) {
    const d = dayKey(m.at);
    if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, messages: [] });
    out[out.length - 1].messages.push(m);
  }
  return out;
}

/** A message's text is limited (the server says the same). */
export const MAX_MESSAGE = 2000;

/** The services a call link may point at (the server checks the same). */
export const CALL_LINK = /^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)\/[^\s<>"']{1,500}$/i;
