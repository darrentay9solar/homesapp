"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import SmartToyRoundedIcon from "@mui/icons-material/SmartToyRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Field, FieldError, MDialog, RoleAvatar, RoleChip } from "@/components/m";
import { EdgeCard } from "@/components/topbar";
import { ago, d2s } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { type Contacts, VIDEO_NAME, type VideoProvider, wallTime } from "@/lib/client/calendar";
import { DESIGN } from "@/lib/client/design";
import { locale, T, TR } from "@/lib/client/i18n";
import { type Answer, CALL_LINK, type Candidate, MAX_MESSAGE, type Message, statusText, statusTone, type Thread, type ThreadSummary, withDays } from "@/lib/client/support";

/** Where a conversation lives, in the app or the dev preview. */
export function useSupportHref() {
  const pathname = usePathname() ?? "";
  const base = pathname.startsWith("/dev-preview") ? "/dev-preview/support" : "/support";
  return (id?: number) => (id === undefined ? base : `${base}/${id}`);
}

/** A message's problem, if it has one: said under the box when Send is pressed. */
function messageProblem(body: string): string | null {
  const t = body.trim();
  if (!t) return T("Write your message first.");
  if (t.length > MAX_MESSAGE) return T("Keep a message under {n} characters.", { n: MAX_MESSAGE });
  return null;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });
}

// ------------------------------------------------------------------ the list

export function ThreadCard({ t, staff, onOpen }: { t: ThreadSummary; staff: boolean; onOpen: () => void }) {
  const tone = statusTone(t.status);
  const unread = t.unread ?? 0;
  return (
    <EdgeCard color={(th) => (tone === "warning" ? (th.vars ?? th).palette.warning.main : tone === "success" ? (th.vars ?? th).palette.success.main : tone === "info" ? (th.vars ?? th).palette.info.main : (th.vars ?? th).palette.divider)}>
      <ButtonBase onClick={onOpen} data-testid="support-thread" sx={{ display: "block", textAlign: "left", flex: 1, p: 1.75, pl: 2.25, borderRadius: `${DESIGN.radius.card}px` }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          {unread > 0 && <Box aria-label={T("Unread")} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main", flex: "0 0 auto" }} />}
          <Chip size="small" label={TR(statusText(t.status, staff))} color={tone === "default" ? "default" : tone} variant={tone === "warning" ? "filled" : "outlined"} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {ago(t.last?.at ?? t.createdAt)}
          </Typography>
        </Stack>
        <Typography sx={{ fontWeight: unread ? 700 : 600, fontSize: 15.5, mt: 0.75, overflowWrap: "anywhere" }}>{t.subject}</Typography>
        {t.last && (
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {t.last.kind === "assistant" ? `${T("Assistant")}: ` : t.last.by ? `${t.last.by}: ` : ""}
            {t.last.kind === "event" ? TR(t.last.body) : t.last.kind === "call" ? T("Video call") : t.last.body}
          </Typography>
        )}
        <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.75 }}>
          {[staff ? t.openedBy.name : null, t.project?.name, t.handledBy ? T("With {name}", { name: t.handledBy.name ?? "" }) : null].filter(Boolean).join(" · ")}
        </Typography>
      </ButtonBase>
    </EdgeCard>
  );
}

// ------------------------------------------------------------------ the chat (homeowners)

const STARTERS = ["When is my next maintenance check?", "How is my monthly bill worked out?", "My system seems to be making less power", "How do I see my system in the FusionSolar app?"];

/**
 * Help's chat window for a homeowner: the assistant says hello, offers a few
 * common questions, and takes theirs. Sending starts a conversation, which
 * carries on as a chat (Conversation): the assistant answers straight away,
 * and hands over to their project manager for anything it can't settle.
 */
export function ChatStart({ name, projects, ai, onStarted }: { name: string | null; projects: Array<{ id: number; name: string }>; ai: boolean; onStarted: (id: number) => void }) {
  const fetcher = useFetcher();
  const [pid, setPid] = useState<string>(projects.length === 1 ? String(projects[0].id) : "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(message: string) {
    const problem = messageProblem(message) ?? (projects.length > 1 && !pid ? T("Choose the project it's about.") : null);
    if (problem) return setErr(problem);
    setBusy(true);
    setErr(null);
    try {
      const r = await fetcher<{ id: number }>("/support", { method: "POST", json: { message, projectId: pid ? Number(pid) : null } });
      onStarted(r.id);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : T("Something went wrong. Please try again."));
      setBusy(false);
    }
  }

  return (
    <Card sx={{ mt: 2, overflow: "hidden" }} data-testid="chat-start">
      <Stack direction="row" sx={{ gap: 1.25, alignItems: "center", px: 2, py: 1.5, background: DESIGN.headerGradient, color: "#fff" }}>
        <SmartToyRoundedIcon />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>{T("9 Solar Home assistant")}</Typography>
          <Typography variant="caption" sx={{ opacity: 0.85 }}>
            {ai ? T("Answers straight away, any time. Your project manager takes over when needed.") : T("Answers common questions straight away. Your project manager takes over when needed.")}
          </Typography>
        </Box>
      </Stack>
      <Stack sx={{ p: 2, gap: 1.5 }}>
        <Box sx={{ alignSelf: "flex-start", maxWidth: "85%", bgcolor: "action.hover", px: 1.75, py: 1.25, borderRadius: `${DESIGN.radius.card}px`, borderTopLeftRadius: 4 }}>
          <Typography variant="body2">{name ? T("Hi {name}! Ask me anything about your solar system, your bills or the app.", { name }) : T("Hi! Ask me anything about your solar system, your bills or the app.")}</Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
          {STARTERS.map((q) => (
            <Chip key={q} label={T(q)} variant="outlined" color="primary" disabled={busy} onClick={() => void send(T(q))} data-testid="chat-starter" />
          ))}
        </Stack>
        {projects.length > 1 && (
          <Field select size="small" label={T("About")} value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => (
              <MenuItem key={p.id} value={String(p.id)}>
                {p.name}
              </MenuItem>
            ))}
          </Field>
        )}
        {err && <Alert severity="error">{err}</Alert>}
        <Stack direction="row" sx={{ gap: 1, alignItems: "flex-end" }}>
          <Field
            placeholder={T("Type your question")}
            multiline
            maxRows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            slotProps={{ htmlInput: { maxLength: MAX_MESSAGE + 200, "aria-label": T("Type your question"), "data-testid": "chat-text" } }}
            sx={{ flex: 1 }}
          />
          <IconButton color="primary" disabled={busy || !text.trim()} onClick={() => void send(text)} aria-label={T("Send")} data-testid="chat-send" sx={{ mb: 0.5 }}>
            <SendRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>
    </Card>
  );
}

// ------------------------------------------------------------------ asking

export function AskDialog({ projects, assistant, onClose, onAsked }: { projects: Array<{ id: number; name: string }>; assistant: boolean; onClose: () => void; onAsked: (id: number) => void }) {
  const fetcher = useFetcher();
  const [pid, setPid] = useState<string>(projects.length === 1 ? String(projects[0].id) : "");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problem = messageProblem(text);
  const projectProblem = projects.length > 1 && !pid ? T("Choose the project it's about.") : null;

  async function send() {
    if (problem || projectProblem) return setTried(true);
    setBusy(true);
    setErr(null);
    try {
      const r = await fetcher<{ id: number }>("/support", { method: "POST", json: { message: text, projectId: pid ? Number(pid) : null } });
      onAsked(r.id);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MDialog
      title={T("Ask a question")}
      heading={assistant ? T("How can we help?") : T("What do you need help with?")}
      subtitle={assistant ? T("Our assistant answers common questions straight away. If it can't, your project manager will.") : T("Your project manager gets it straight away and answers here.")}
      onClose={onClose}
    >
      <Stack sx={{ gap: 2.5 }}>
        {projects.length > 1 && (
          <Field select label={T("About")} value={pid} onChange={(e) => setPid(e.target.value)} error={tried && Boolean(projectProblem)} helperText={tried ? (projectProblem ?? undefined) : undefined} data-testid="ask-project">
            {projects.map((p) => (
              <MenuItem key={p.id} value={String(p.id)}>
                {p.name}
              </MenuItem>
            ))}
          </Field>
        )}
        <Field
          label={T("Your question")}
          multiline
          minRows={3}
          maxRows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={T("e.g. When is my next maintenance check?")}
          error={tried && Boolean(problem)}
          helperText={tried ? (problem ?? undefined) : undefined}
          slotProps={{ htmlInput: { maxLength: MAX_MESSAGE + 200, "data-testid": "ask-text" } }}
        />
      </Stack>
      {err && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {err}
        </Alert>
      )}
      <Button fullWidth size="large" variant="contained" disabled={busy} startIcon={<SendRoundedIcon />} sx={{ mt: 3 }} onClick={() => void send()} data-testid="ask-send">
        {busy ? T("Sending…") : T("Ask")}
      </Button>
    </MDialog>
  );
}

// ------------------------------------------------------------------ one conversation

function Bubble({ m, mine }: { m: Message; mine: boolean }) {
  if (m.kind === "event") {
    return (
      <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", my: 0.5, px: 2 }} data-testid="support-event">
        {TR(m.body)} · {clock(m.at)}
      </Typography>
    );
  }
  if (m.kind === "call") {
    // A video call from whoever handles it: one button that opens the meeting in a new tab.
    return (
      <Card sx={(t) => ({ p: 1.75, alignSelf: "stretch", borderColor: (t.vars ?? t).palette.primary.main })} data-testid="support-call">
        <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <VideocamRoundedIcon sx={{ color: "primary.main" }} />
          <Box sx={{ flex: "1 1 160px", minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{T("{name} started a video call", { name: m.by?.name ?? "" })}</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {clock(m.at)}
            </Typography>
          </Box>
          <Button variant="contained" component="a" href={m.body} target="_blank" rel="noopener noreferrer" startIcon={<VideocamRoundedIcon />}>
            {T("Join")}
          </Button>
        </Stack>
      </Card>
    );
  }
  const bot = m.kind === "assistant";
  return (
    <Stack sx={{ alignItems: mine ? "flex-end" : "flex-start", gap: 0.5 }} data-testid={bot ? "support-assistant" : "support-message"}>
      {!mine && (
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, px: 0.5 }}>
          {bot ? <SmartToyRoundedIcon sx={{ fontSize: 18, color: "primary.main" }} /> : m.by && <RoleAvatar name={m.by.name} role={m.by.role} size={22} />}
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {bot ? T("Assistant") : m.by?.name}
          </Typography>
        </Stack>
      )}
      <Box
        sx={(t) => ({
          maxWidth: "min(85%, 560px)",
          px: 1.75,
          py: 1.25,
          borderRadius: `${DESIGN.radius.card}px`,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 15,
          lineHeight: 1.5,
          ...(mine
            ? { bgcolor: (t.vars ?? t).palette.primary.main, color: (t.vars ?? t).palette.primary.contrastText, borderBottomRightRadius: 6 }
            : bot
              ? { bgcolor: t.vars ? `rgb(${t.vars.palette.primary.mainChannel} / 0.1)` : "rgba(10,154,99,0.1)", color: (t.vars ?? t).palette.text.primary, borderBottomLeftRadius: 6 }
              : { bgcolor: (t.vars ?? t).palette.background.paper, color: (t.vars ?? t).palette.text.primary, border: `1px solid ${(t.vars ?? t).palette.divider}`, borderBottomLeftRadius: 6 }),
        })}
      >
        {m.body}
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", px: 0.5 }}>
        {clock(m.at)}
      </Typography>
    </Stack>
  );
}

function Composer({ onSend, placeholder }: { onSend: (body: string) => Promise<boolean>; placeholder: string }) {
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = messageProblem(text);
  async function send() {
    if (problem) return setTried(true);
    setBusy(true);
    if (await onSend(text)) {
      setText("");
      setTried(false);
    }
    setBusy(false);
  }
  return (
    <Card sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "flex-end" }}>
        <Field
          multiline
          minRows={1}
          maxRows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={T("Your message")}
          error={tried && Boolean(problem)}
          onKeyDown={(e) => {
            // Ctrl or ⌘ + Enter sends; Enter alone is a new line, as on a phone.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
          }}
          slotProps={{ htmlInput: { maxLength: MAX_MESSAGE + 200, "data-testid": "support-input" } }}
        />
        <Button variant="contained" size="large" disabled={busy} onClick={() => void send()} startIcon={<SendRoundedIcon />} sx={{ flex: "0 0 auto" }} data-testid="support-send">
          {busy ? T("Sending…") : T("Send")}
        </Button>
      </Stack>
      {tried && problem && <FieldError sx={{ mt: 1 }}>{problem}</FieldError>}
    </Card>
  );
}

/**
 * One conversation: what was said, a box to say more, and (for whoever
 * looks after it) the people in it, with Add someone, Hand to another
 * manager and Mark settled.
 */
export function Conversation({ t, me, staff, reload }: { t: Thread; me: number; staff: boolean; reload: () => Promise<void> }) {
  const fetcher = useFetcher();
  const { toast, reloadMe } = useApp();
  const [dialog, setDialog] = useState<"add" | "assign" | "call" | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, init: RequestInit & { json?: unknown } = { method: "POST" }): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetcher<{ message?: string }>(`/support/${t.id}${path}`, init);
      if (r?.message) toast(r.message);
      await reload();
      return true;
    } catch (x) {
      toast(x instanceof ApiError ? x.message : T("Something went wrong. Please try again."), "bad");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Read up to the newest message whenever more arrive.
  const newest = t.messages[t.messages.length - 1]?.id ?? 0;
  useEffect(() => {
    if (!newest) return;
    void fetcher(`/support/${t.id}/read`, { method: "POST" }).then(() => reloadMe(), () => undefined);
  }, [newest, t.id, fetcher, reloadMe]);

  const days = withDays(t.messages);
  const asker = t.members.find((m) => m.asker);
  return (
    <Stack sx={{ gap: 2, mt: 1.5 }}>
      <Card sx={{ p: { xs: 1.5, sm: 2.25 } }} data-testid="support-messages">
        <Stack sx={{ gap: 1.5 }}>
          {days.map((d) => (
            <Stack key={d.day} sx={{ gap: 1.5 }}>
              <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", fontWeight: 600 }}>
                {d2s(d.day)}
              </Typography>
              {d.messages.map((m) => (
                <Bubble key={m.id} m={m} mine={m.by?.uid === me} />
              ))}
            </Stack>
          ))}
        </Stack>
      </Card>

      {t.can.askPerson && (
        <Alert
          severity="info"
          icon={<SupportAgentRoundedIcon />}
          action={
            <Button color="inherit" variant="outlined" disabled={busy} onClick={() => void act("/ask-person")} data-testid="ask-person" sx={{ whiteSpace: "nowrap" }}>
              {T("Talk to a person")}
            </Button>
          }
        >
          {T("Not what you needed? Your project manager can help.")}
        </Alert>
      )}
      {t.status === "waiting" && !staff && (
        <Alert severity="warning" data-testid="support-waiting">
          {t.handledBy?.name ? T("{name} has been asked to help. You'll get an alert when they answer.", { name: t.handledBy.name }) : T("9 Solar Home has been asked to help. You'll get an alert when they answer.")}
        </Alert>
      )}

      {t.can.write ? (
        <Composer
          placeholder={t.status === "assistant" ? T("Ask the assistant another question") : t.status === "settled" ? T("Write to reopen the conversation") : T("Write a message")}
          onSend={(body) => act("/messages", { method: "POST", json: { body } })}
        />
      ) : (
        t.status === "settled" && (
          <Alert severity="success" icon={<TaskAltRoundedIcon />}>
            {T("This conversation is settled.")}
          </Alert>
        )
      )}

      <Card sx={{ p: { xs: 1.75, sm: 2.25 } }} data-testid="support-people">
        <Typography sx={{ fontWeight: 600 }}>{T("In this conversation")}</Typography>
        <Stack sx={{ gap: 1, mt: 1.25 }}>
          {t.members.map((m) => (
            <Stack key={m.uid} direction="row" sx={{ alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
              <RoleAvatar name={m.name} role={m.role} size={34} />
              <Box sx={{ flex: "1 1 100px", minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {m.name}
                </Typography>
                <Stack direction="row" sx={{ gap: 0.5, mt: 0.25, flexWrap: "wrap" }}>
                  <RoleChip role={m.role} />
                  {m.asker && <Chip size="small" variant="outlined" label={T("Asked")} />}
                  {m.handler && <Chip size="small" variant="outlined" color="primary" label={T("Handling it")} />}
                </Stack>
              </Box>
              {t.can.remove && !m.asker && m.uid !== me && (
                <IconButton aria-label={T("Take {name} out", { name: m.name ?? "" })} disabled={busy} onClick={() => void act(`/members/${m.uid}`, { method: "DELETE" })}>
                  <CloseRoundedIcon />
                </IconButton>
              )}
            </Stack>
          ))}
          {t.status === "assistant" && (
            <Stack direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
              <Box sx={{ width: 34, height: 34, display: "grid", placeItems: "center" }}>
                <SmartToyRoundedIcon sx={{ color: "primary.main" }} />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {T("Assistant")}
              </Typography>
            </Stack>
          )}
        </Stack>
        {(t.can.add || t.can.assign || t.can.call || t.can.settle || t.can.reopen) && (
          <Stack direction="row" sx={{ gap: 1, mt: 2, flexWrap: "wrap" }}>
            {t.can.add && (
              <Button variant="contained" startIcon={<PersonAddAltRoundedIcon />} disabled={busy} onClick={() => setDialog("add")} data-testid="support-add">
                {T("Add someone")}
              </Button>
            )}
            {t.can.call && (
              <Button variant="outlined" startIcon={<VideocamRoundedIcon />} disabled={busy} onClick={() => setDialog("call")} data-testid="support-call-start">
                {T("Video call")}
              </Button>
            )}
            {t.can.assign && (
              <Button variant="outlined" startIcon={<SwapHorizRoundedIcon />} disabled={busy} onClick={() => setDialog("assign")}>
                {T("Hand to another manager")}
              </Button>
            )}
            {t.can.settle && t.status !== "assistant" && (
              <Button variant="outlined" color="success" startIcon={<TaskAltRoundedIcon />} disabled={busy} onClick={() => void act("/settle")} data-testid="support-settle">
                {T("Mark settled")}
              </Button>
            )}
            {t.can.reopen && (
              <Button variant="outlined" startIcon={<ReplayRoundedIcon />} disabled={busy} onClick={() => void act("/reopen")}>
                {T("Reopen")}
              </Button>
            )}
          </Stack>
        )}
        {staff && asker && (
          <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 1.5 }}>
            {T("Anyone with an account can be added, on the project or not. They see this whole conversation.")}
          </Typography>
        )}
      </Card>

      {dialog === "add" && <AddPersonDialog tid={t.id} onClose={() => setDialog(null)} onAdd={async (uid) => (await act("/members", { method: "POST", json: { uid } })) && setDialog(null)} />}
      {dialog === "call" && <CallDialog onClose={() => setDialog(null)} onSend={async (link) => (await act("/call", { method: "POST", json: { link } })) && setDialog(null)} />}
      {dialog === "assign" && <AssignDialog tid={t.id} current={t.handledBy?.uid ?? null} onClose={() => setDialog(null)} onPick={async (uid) => (await act("/assign", { method: "POST", json: { uid } })) && setDialog(null)} />}
    </Stack>
  );
}

/**
 * Start a video call: make a Google Meet (or a Teams or Zoom meeting) in
 * another tab, paste its link here, and everyone in the conversation gets a
 * Join button and an alert. To arrange a time instead, use the Calendar.
 */
/** Where each service starts a call now, when the company's account isn't connected here. */
const CALL_NOW: Record<VideoProvider, string> = {
  teams: "https://teams.microsoft.com/l/meeting/new",
  meet: "https://meet.google.com/new",
  zoom: "https://zoom.us/start/videomeeting",
};

/**
 * A video call in a support conversation, on Teams, Google Meet or Zoom. With
 * the company's account connected (YOUR_STEPS.md step 12) a meeting is made
 * for now and its link sent at once; otherwise the service opens to start
 * one, and its link is pasted back here.
 */
function CallDialog({ onClose, onSend }: { onClose: () => void; onSend: (link: string) => void }) {
  const [link, setLink] = useState("");
  const [tried, setTried] = useState(false);
  const [making, setMaking] = useState<VideoProvider | null>(null);
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { data: contacts } = useApi<Contacts>("/calendar/contacts");
  const connected = contacts?.video ?? [];
  const problem = !link.trim() ? T("Paste the meeting's link.") : CALL_LINK.test(link.trim()) ? null : T("Paste a Google Meet, Microsoft Teams or Zoom link, starting with https://.");

  async function make(p: VideoProvider) {
    if (!connected.includes(p)) {
      window.open(CALL_NOW[p], "_blank", "noopener,noreferrer");
      return;
    }
    // A call now: from this half hour, for an hour.
    const now = new Date();
    const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    const [h, m] = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).split(":").map(Number);
    const from = h * 60 + (m < 30 ? 0 : 30);
    setMaking(p);
    try {
      const r = await fetcher<{ link: string }>("/calendar/video-link", { method: "POST", json: { provider: p, title: T("Support call"), startsAt: wallTime(day, from), endsAt: wallTime(day, from + 60) } });
      onSend(r.link);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setMaking(null);
    }
  }

  return (
    <MDialog title={T("Video call")} heading={T("Talk it through face to face")} subtitle={T("Start a call on Teams, Google Meet or Zoom. Everyone in this conversation can join with one tap.")} onClose={onClose}>
      <Stack sx={{ gap: 2.5 }}>
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", "& > *": { flex: "1 1 120px" } }}>
          {(["teams", "meet", "zoom"] as VideoProvider[]).map((p) => (
            <Button key={p} variant="outlined" size="large" startIcon={<VideocamRoundedIcon />} endIcon={connected.includes(p) ? undefined : <OpenInNewRoundedIcon />} disabled={making !== null} onClick={() => void make(p)} data-testid={`call-new-${p}`}>
              {making === p ? T("Setting up…") : VIDEO_NAME[p]}
            </Button>
          ))}
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary", mt: -1.5 }}>
          {connected.length === 3 ? T("The call is made and its link sent straight away.") : T("A service marked with an arrow opens in a new tab: start the call there, copy its link and paste it below.")}
        </Typography>
        <Field
          label={T("Meeting link")}
          placeholder="https://meet.google.com/abc-defg-hij"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          error={tried && Boolean(problem)}
          helperText={tried ? (problem ?? undefined) : T("Google Meet, Microsoft Teams or Zoom.")}
          slotProps={{ htmlInput: { inputMode: "url", autoComplete: "off", "data-testid": "call-link" } }}
        />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {T("To arrange a time instead, use the Calendar: New meeting, with the same people.")}
        </Typography>
      </Stack>
      <Button fullWidth size="large" variant="contained" sx={{ mt: 3 }} startIcon={<SendRoundedIcon />} onClick={() => (problem ? setTried(true) : onSend(link.trim()))} data-testid="call-send">
        {T("Send the link")}
      </Button>
    </MDialog>
  );
}

function PersonPicker({ tid, only, onPick, empty }: { tid: number; only?: (c: Candidate) => boolean; onPick: (uid: number) => void; empty: string }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  // Searches as they type, a moment after they stop.
  useEffect(() => {
    const h = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(h);
  }, [q]);
  const { data } = useApi<{ people: Candidate[] }>(`/support/people?thread=${tid}&q=${encodeURIComponent(query)}`);
  const list = (data?.people ?? []).filter((c) => !only || only(c));
  return (
    <>
      <Field label={T("Search by name or email")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus slotProps={{ htmlInput: { "data-testid": "support-people-search" } }} />
      <Stack sx={{ gap: 0.5, mt: 2 }}>
        {!data && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} variant="rounded" height={52} />)}
        {data && !list.length && (
          <Typography variant="body2" sx={{ color: "text.secondary", py: 1 }}>
            {TR(empty)}
          </Typography>
        )}
        {list.map((c) => (
          <ButtonBase key={c.uid} onClick={() => onPick(c.uid)} data-testid="support-candidate" sx={(t) => ({ display: "flex", gap: 1.25, alignItems: "center", textAlign: "left", p: 1, borderRadius: `${DESIGN.radius.listItem}px`, "&:hover": { bgcolor: (t.vars ?? t).palette.action.hover } })}>
            <RoleAvatar name={c.name} role={c.role} size={36} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {c.name}
              </Typography>
              <Typography variant="caption" noWrap component="p" sx={{ color: "text.secondary" }}>
                {TR(c.roleLabel)}
                {c.onProject ? ` · ${T("On the project")}` : ""}
              </Typography>
            </Box>
            <AddRoundedIcon sx={{ color: "primary.main" }} />
          </ButtonBase>
        ))}
      </Stack>
    </>
  );
}

function AddPersonDialog({ tid, onClose, onAdd }: { tid: number; onClose: () => void; onAdd: (uid: number) => void }) {
  return (
    <MDialog title={T("Add someone")} heading={T("Who can help clarify it?")} subtitle={T("The project's team comes first; anyone with an account can be added. They're told, and see the whole conversation.")} onClose={onClose}>
      <PersonPicker tid={tid} onPick={onAdd} empty="No one else by that name." />
    </MDialog>
  );
}

function AssignDialog({ tid, current, onClose, onPick }: { tid: number; current: number | null; onClose: () => void; onPick: (uid: number) => void }) {
  return (
    <MDialog title={T("Hand to another manager")} heading={T("Who should handle it?")} subtitle={T("They're told straight away and join the conversation.")} onClose={onClose}>
      <PersonPicker tid={tid} only={(c) => (c.role === "project_manager" || c.role === "superadmin") && c.uid !== current} onPick={onPick} empty="No other project manager by that name." />
    </MDialog>
  );
}

// ------------------------------------------------------------------ the assistant's answers

/**
 * The answers the assistant gives, kept by project managers: add, change,
 * turn off. Turned-off answers stay on record (and in the audit log).
 */
export function AnswersPanel() {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { data, error, reload } = useApi<{ answers: Answer[]; ai: boolean; starterLeft: number }>("/support/answers");
  const [editing, setEditing] = useState<Answer | "new" | null>(null);

  async function post(path: string, init: RequestInit & { json?: unknown }) {
    try {
      const r = await fetcher<{ message?: string }>(path, init);
      if (r?.message) toast(r.message);
      await reload();
      return true;
    } catch (x) {
      toast(x instanceof ApiError ? x.message : T("Something went wrong. Please try again."), "bad");
      return false;
    }
  }

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={220} />;
  const on = data.answers.filter((a) => a.active);
  const off = data.answers.filter((a) => !a.active);
  return (
    <Stack sx={{ gap: 2 }} data-testid="support-answers">
      <Alert severity="info">
        {data.ai
          ? T("The assistant (Claude) answers homeowners from these answers and their own project, and hands anything else to their project manager.")
          : T("The assistant gives the closest of these answers. Connect Claude (an Anthropic key) and it will answer in its own words, from these answers and the homeowner's project.")}
      </Alert>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditing("new")} data-testid="answer-add">
          {T("Add an answer")}
        </Button>
        {data.starterLeft > 0 && (
          <Button variant="outlined" onClick={() => void post("/support/answers/starter", { method: "POST" })} data-testid="answer-starter">
            {T("Add {n} starter answers about the app", { n: data.starterLeft })}
          </Button>
        )}
      </Stack>
      {!data.answers.length && (
        <Card sx={{ p: 3, textAlign: "center" }}>
          <Typography sx={{ fontWeight: 600 }}>{T("No answers yet")}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            {T("Add the questions homeowners ask most, with 9 Solar Home's answers: warranty, billing, cleaning, what to do when generation is low.")}
          </Typography>
        </Card>
      )}
      {[...on, ...off].map((a) => (
        <Card key={a.id} sx={{ p: 2, opacity: a.active ? 1 : 0.7 }} data-testid="answer-card">
          <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{a.question}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {a.answer}
              </Typography>
              {(a.questionZh || a.answerZh) && (
                <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.75 }}>
                  {T("Also in Chinese")}
                </Typography>
              )}
            </Box>
            <FormControlLabel
              sx={{ mr: 0 }}
              control={<Switch checked={a.active} onChange={(e) => void post(`/support/answers/${a.id}`, { method: "PATCH", json: { active: e.target.checked } })} />}
              label={a.active ? T("On") : T("Off")}
            />
          </Stack>
          <Button size="small" sx={{ mt: 1 }} onClick={() => setEditing(a)}>
            {T("Edit")}
          </Button>
        </Card>
      ))}
      {editing && (
        <AnswerDialog
          a={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (json) => {
            const ok = editing === "new" ? await post("/support/answers", { method: "POST", json }) : await post(`/support/answers/${editing.id}`, { method: "PATCH", json });
            if (ok) setEditing(null);
          }}
        />
      )}
    </Stack>
  );
}

function AnswerDialog({ a, onClose, onSave }: { a: Answer | null; onClose: () => void; onSave: (json: Record<string, string>) => void }) {
  const [f, setF] = useState({ question: a?.question ?? "", answer: a?.answer ?? "", questionZh: a?.questionZh ?? "", answerZh: a?.answerZh ?? "" });
  const [tried, setTried] = useState(false);
  const problem = {
    question: f.question.trim() ? (f.question.length > 300 ? T("Keep the question under {n} characters.", { n: 300 }) : null) : T("Write the question."),
    answer: f.answer.trim() ? (f.answer.length > 3000 ? T("Keep the answer under {n} characters.", { n: 3000 }) : null) : T("Write the answer."),
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <MDialog title={a ? T("Edit answer") : T("New answer")} heading={T("A question homeowners ask")} subtitle={T("The assistant uses it straight away. Chinese is optional: without it, Claude translates.")} onClose={onClose}>
      <Stack sx={{ gap: 2.5 }}>
        <Field label={T("Question")} required value={f.question} onChange={set("question")} error={tried && Boolean(problem.question)} helperText={tried ? (problem.question ?? undefined) : undefined} slotProps={{ htmlInput: { "data-testid": "answer-question" } }} />
        <Field label={T("Answer")} required multiline minRows={3} value={f.answer} onChange={set("answer")} error={tried && Boolean(problem.answer)} helperText={tried ? (problem.answer ?? undefined) : undefined} slotProps={{ htmlInput: { "data-testid": "answer-answer" } }} />
        <Field label={T("Question in Chinese (optional)")} value={f.questionZh} onChange={set("questionZh")} />
        <Field label={T("Answer in Chinese (optional)")} multiline minRows={2} value={f.answerZh} onChange={set("answerZh")} />
      </Stack>
      <Button fullWidth size="large" variant="contained" sx={{ mt: 3 }} onClick={() => (problem.question || problem.answer ? setTried(true) : onSave(f))} data-testid="answer-save">
        {T("Save")}
      </Button>
    </MDialog>
  );
}
