"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import BusinessRoundedIcon from "@mui/icons-material/BusinessRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HandymanRoundedIcon from "@mui/icons-material/HandymanRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import TitleRoundedIcon from "@mui/icons-material/TitleRounded";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { alpha, type Theme } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Field, MDialog, RoleAvatar } from "@/components/m";
import { gradText } from "@/components/topbar";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import {
  addDays,
  addMonths,
  allBusy,
  type Block,
  type BusyPerson,
  busyNames,
  type Contacts,
  DAY_FROM,
  DAY_TO,
  dayLoad,
  dayText,
  DURATIONS,
  durationText,
  GOOGLE_MEET_NEW,
  googleCalendarUrl,
  hhmm,
  icsFile,
  layoutDay,
  linkKind,
  type Meeting,
  monthGrid,
  monthText,
  nextSlot,
  onDay,
  outlookUrl,
  type Place,
  PLACE_LABEL,
  RESPONSE_LABEL,
  type Span,
  sgDay,
  sgMinutes,
  slots,
  startOptions,
  STATUS_LABEL,
  STATUS_TONE,
  teamsNewUrl,
  today,
  wallTime,
  whenText,
} from "@/lib/client/calendar";
import { DESIGN } from "@/lib/client/design";
import { T, TR, useLang } from "@/lib/client/i18n";

/**
 * The calendar's pieces, in the style of Google Calendar on the app's
 * template: a mini month, a time grid in 30-minute rows, and the dialogs to
 * arrange a meeting, look at one, and block out time. Logic lives in
 * lib/client/calendar.ts; this file only draws it.
 */

const WEEK_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ------------------------------------------------------------------ mini month

export type DayMark = "some" | "full";

/** A month of days to pick from. Marks: some of the day taken (a dot), or all of working hours (struck through). */
export function MiniMonth({
  month,
  onMonth,
  selected,
  onSelect,
  marks = {},
  min,
  testId,
}: {
  month: string;
  onMonth: (m: string) => void;
  selected: string;
  onSelect: (d: string) => void;
  marks?: Record<string, DayMark>;
  min?: string;
  testId?: string;
}) {
  const { lang } = useLang();
  const now = today();
  const days = monthGrid(month);
  const inMonth = (d: string) => d.slice(0, 7) === month.slice(0, 7);
  return (
    <Box data-testid={testId}>
      <Stack direction="row" sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography sx={{ flex: 1, fontWeight: 600, fontSize: 15, pl: 0.5 }}>{monthText(month, lang)}</Typography>
        <IconButton size="small" aria-label={T("Previous month")} onClick={() => onMonth(addMonths(month, -1))}>
          <ChevronLeftRoundedIcon />
        </IconButton>
        <IconButton size="small" aria-label={T("Next month")} onClick={() => onMonth(addMonths(month, 1))}>
          <ChevronRightRoundedIcon />
        </IconButton>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", rowGap: 0.25, textAlign: "center" }}>
        {WEEK_LETTERS.map((w) => (
          <Typography key={w} variant="caption" sx={{ color: "text.secondary", fontWeight: 600, fontSize: 11, py: 0.5 }}>
            {TR(w)}
          </Typography>
        ))}
        {days.map((d) => {
          const mark = marks[d];
          const off = Boolean(min && d < min);
          const isSel = d === selected;
          return (
            <ButtonBase
              key={d}
              disabled={off}
              onClick={() => onSelect(d)}
              aria-label={`${dayText(d, lang, { weekday: "long", day: "numeric", month: "long" })}${mark === "full" ? `, ${T("fully booked")}` : mark === "some" ? `, ${T("partly booked")}` : ""}`}
              aria-pressed={isSel}
              data-day={d}
              sx={(t) => ({
                mx: "auto",
                width: 36,
                height: 36,
                borderRadius: "50%",
                flexDirection: "column",
                fontSize: 13,
                fontWeight: isSel || d === now ? 700 : 500,
                fontFamily: "inherit",
                color: isSel ? t.palette.primary.contrastText : !inMonth(d) || off ? t.palette.text.disabled : mark === "full" ? t.palette.error.main : t.palette.text.primary,
                bgcolor: isSel ? t.palette.primary.main : "transparent",
                border: d === now && !isSel ? `1.5px solid ${t.palette.primary.main}` : "1.5px solid transparent",
                textDecoration: mark === "full" && !isSel ? "line-through" : "none",
                position: "relative",
                "&:hover": { bgcolor: isSel ? t.palette.primary.main : alpha(t.palette.primary.main, 0.1) },
              })}
            >
              {Number(d.slice(8))}
              {mark === "some" && <Box component="span" sx={(t) => ({ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: "50%", bgcolor: isSel ? t.palette.primary.contrastText : t.palette.warning.main })} />}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

/** For a phone: the week as a strip of days to tap, with a dot on days that have something. */
export function WeekStrip({ days, selected, onSelect, busyDays }: { days: string[]; selected: string; onSelect: (d: string) => void; busyDays: Set<string> }) {
  const { lang } = useLang();
  const now = today();
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 0.5 }} data-testid="week-strip">
      {days.map((d) => {
        const sel = d === selected;
        return (
          <ButtonBase
            key={d}
            onClick={() => onSelect(d)}
            aria-pressed={sel}
            aria-label={dayText(d, lang, { weekday: "long", day: "numeric", month: "long" })}
            sx={(t) => ({
              flexDirection: "column",
              py: 0.75,
              borderRadius: `${DESIGN.radius.listItem}px`,
              fontFamily: "inherit",
              bgcolor: sel ? t.palette.primary.main : "transparent",
              color: sel ? t.palette.primary.contrastText : t.palette.text.primary,
              border: `1px solid ${sel ? t.palette.primary.main : d === now ? t.palette.primary.main : t.palette.divider}`,
            })}
          >
            <Box component="span" sx={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
              {dayText(d, lang, { weekday: "short" })}
            </Box>
            <Box component="span" sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>
              {Number(d.slice(8))}
            </Box>
            <Box component="span" sx={(t) => ({ width: 5, height: 5, borderRadius: "50%", bgcolor: busyDays.has(d) ? (sel ? t.palette.primary.contrastText : t.palette.primary.main) : "transparent" })} />
          </ButtonBase>
        );
      })}
    </Box>
  );
}

// ------------------------------------------------------------------ time grid

const ROW = 26;

function meetingColor(t: Theme, m: Meeting): string {
  if (m.status === "declined") return t.palette.error.main;
  return m.kind === "maintenance_check" ? t.palette.warning.main : t.palette.primary.main;
}

/**
 * Days side by side in 30-minute rows, 07:00 to 21:00 (further when a meeting
 * runs outside them). Meetings are coloured blocks; an invitation not yet
 * answered is dashed; blocked-out time is hatched. Tapping an empty half-hour
 * starts a meeting there.
 */
export function TimeGrid({
  days,
  meetings,
  blocks,
  onMeeting,
  onBlock,
  onSlot,
  now = Date.now(),
  height,
}: {
  days: string[];
  meetings: Meeting[];
  blocks: Block[];
  onMeeting: (m: Meeting) => void;
  onBlock: (b: Block) => void;
  onSlot?: (day: string, minutes: number) => void;
  now?: number;
  height?: number | string | Record<string, number | string>;
}) {
  const { lang } = useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    let from = DAY_FROM;
    let to = DAY_TO;
    for (const d of days)
      for (const m of onDay(meetings, d)) {
        from = Math.min(from, Math.floor(Math.max(0, sgMinutes(m.startsAt, d)) / 60) * 60);
        to = Math.max(to, Math.ceil(Math.min(1440, sgMinutes(m.endsAt, d)) / 60) * 60);
      }
    return [from, to] as const;
  }, [days, meetings]);
  const [from, to] = shown;
  const rows = slots(from, to);
  const nowDay = sgDay(now);
  const nowMin = sgMinutes(now, nowDay);
  const y = (m: number) => ((Math.min(Math.max(m, from), to) - from) / 30) * ROW;

  // Open at the working day (or now), not at seven in the morning.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = days.includes(nowDay) && nowMin > 9 * 60 ? nowMin - 60 : 8 * 60;
    el.scrollTop = Math.max(0, y(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per set of days
  }, [days.join()]);

  const many = days.length > 1;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: `${DESIGN.radius.card}px`, overflow: "hidden", bgcolor: "background.paper" }} data-testid="time-grid">
      {many && (
        <Box sx={{ display: "grid", gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, borderBottom: 1, borderColor: "divider" }}>
          <Box />
          {days.map((d) => {
            const isToday = d === nowDay;
            return (
              <Stack key={d} sx={{ alignItems: "center", py: 1, borderLeft: 1, borderColor: "divider" }}>
                <Typography variant="caption" sx={{ color: isToday ? "primary.main" : "text.secondary", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>
                  {dayText(d, lang, { weekday: "short" })}
                </Typography>
                <Box sx={(t) => ({ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, bgcolor: isToday ? t.palette.primary.main : "transparent", color: isToday ? t.palette.primary.contrastText : t.palette.text.primary })}>
                  {Number(d.slice(8))}
                </Box>
              </Stack>
            );
          })}
        </Box>
      )}
      <Box ref={scroller} sx={{ overflowY: "auto", height: height ?? { xs: "calc(100dvh - 330px)", lg: "calc(100dvh - 260px)" }, minHeight: 320 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, position: "relative" }}>
          {/* Hours down the side. */}
          <Box sx={{ position: "relative", height: rows.length * ROW }}>
            {rows
              .filter((m) => m % 60 === 0)
              .map((m) => (
                <Typography key={m} variant="caption" sx={{ position: "absolute", top: y(m) + 2, right: 8, fontSize: 11, color: "text.secondary", lineHeight: 1 }}>
                  {hhmm(m)}
                </Typography>
              ))}
          </Box>
          {days.map((d) => {
            const placedMeetings = layoutDay(onDay(meetings, d), d);
            const placedBlocks = layoutDay(onDay(blocks, d), d);
            return (
              <Box
                key={d}
                data-grid-day={d}
                onClick={(e) => {
                  if (!onSlot || e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  onSlot(d, from + Math.floor((e.clientY - r.top) / ROW) * 30);
                }}
                sx={(t) => ({
                  position: "relative",
                  height: rows.length * ROW,
                  borderLeft: 1,
                  borderColor: "divider",
                  cursor: onSlot ? "copy" : "default",
                  // An hour line, and a fainter half-hour line.
                  backgroundImage: `repeating-linear-gradient(to bottom, ${t.palette.divider} 0 1px, transparent 1px ${ROW}px, ${alpha(t.palette.divider, 0.45)} ${ROW}px ${ROW + 1}px, transparent ${ROW + 1}px ${ROW * 2}px)`,
                  bgcolor: d === nowDay ? alpha(t.palette.primary.main, 0.025) : "transparent",
                })}
              >
                {placedBlocks.map((p) => (
                  <ButtonBase
                    key={`b${p.item.id}`}
                    onClick={() => onBlock(p.item)}
                    data-testid="grid-block"
                    sx={(t) => ({
                      position: "absolute",
                      top: y(p.top),
                      height: Math.max(y(p.top + p.height) - y(p.top), 0),
                      left: 2,
                      right: 2,
                      borderRadius: "6px",
                      alignItems: "flex-start",
                      justifyContent: "flex-start",
                      overflow: "hidden",
                      px: 0.75,
                      pt: 0.25,
                      fontFamily: "inherit",
                      color: t.palette.text.secondary,
                      backgroundImage: `repeating-linear-gradient(135deg, ${alpha(t.palette.text.primary, 0.09)} 0 6px, transparent 6px 12px)`,
                      border: `1px solid ${alpha(t.palette.text.primary, 0.12)}`,
                      display: y(p.top + p.height) - y(p.top) > 0 ? "flex" : "none",
                    })}
                  >
                    <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 600 }}>
                      {p.item.note || T("Blocked")}
                    </Typography>
                  </ButtonBase>
                ))}
                {placedMeetings.map((p) => {
                  const m = p.item;
                  const h = y(p.top + p.height) - y(p.top);
                  const pending = m.myResponse === "pending" || m.status === "waiting";
                  return (
                    <ButtonBase
                      key={`m${m.id}`}
                      onClick={() => onMeeting(m)}
                      data-testid="grid-meeting"
                      aria-label={`${m.title}, ${whenText(m, lang)}, ${TR(STATUS_LABEL[m.status])}`}
                      sx={(t) => {
                        const c = meetingColor(t, m);
                        return {
                          position: "absolute",
                          top: y(p.top) + 1,
                          height: Math.max(h - 2, 14),
                          left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                          width: `calc(${100 / p.cols}% - 4px)`,
                          borderRadius: "6px",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          justifyContent: "flex-start",
                          overflow: "hidden",
                          textAlign: "left",
                          px: 0.75,
                          py: h > 30 ? 0.4 : 0,
                          fontFamily: "inherit",
                          bgcolor: alpha(c, pending ? 0.1 : t.palette.mode === "dark" ? 0.32 : 0.18),
                          borderLeft: `3px solid ${c}`,
                          outline: pending ? `1.5px dashed ${alpha(c, 0.8)}` : "none",
                          outlineOffset: -1.5,
                          color: t.palette.text.primary,
                          zIndex: 1,
                          "&:hover": { bgcolor: alpha(c, 0.28) },
                        };
                      }}
                    >
                      <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, lineHeight: h > 30 ? 1.3 : `${Math.max(h - 2, 14)}px`, width: "100%" }}>
                        {h <= 30 ? `${hhmm(Math.max(0, sgMinutes(m.startsAt, d)))} ${m.title}` : m.title}
                      </Typography>
                      {h > 30 && (
                        <Typography noWrap sx={{ fontSize: 11, color: "text.secondary", width: "100%" }}>
                          {hhmm(Math.max(0, sgMinutes(m.startsAt, d)))} – {hhmm(Math.min(1440, sgMinutes(m.endsAt, d)))}
                        </Typography>
                      )}
                    </ButtonBase>
                  );
                })}
                {d === nowDay && nowMin >= from && nowMin <= to && (
                  <Box aria-hidden data-allow-overlap sx={(t) => ({ position: "absolute", left: 0, right: 0, top: y(nowMin), height: 2, bgcolor: t.palette.error.main, zIndex: 2, pointerEvents: "none", "&::before": { content: '""', position: "absolute", left: -5, top: -4, width: 10, height: 10, borderRadius: "50%", bgcolor: t.palette.error.main } })} />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

/** What the colours mean. */
export function Legend() {
  const items: Array<[string, (t: Theme) => object]> = [
    ["Confirmed", (t) => ({ bgcolor: alpha(t.palette.primary.main, 0.25), borderLeft: `3px solid ${t.palette.primary.main}` })],
    ["Waiting for answers", (t) => ({ outline: `1.5px dashed ${t.palette.primary.main}`, outlineOffset: -1.5 })],
    ["Maintenance check", (t) => ({ bgcolor: alpha(t.palette.warning.main, 0.25), borderLeft: `3px solid ${t.palette.warning.main}` })],
    ["Blocked out", (t) => ({ backgroundImage: `repeating-linear-gradient(135deg, ${alpha(t.palette.text.primary, 0.2)} 0 3px, transparent 3px 6px)` })],
  ];
  return (
    <Stack sx={{ gap: 0.75 }}>
      {items.map(([label, sx]) => (
        <Stack key={label} direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <Box sx={(t) => ({ width: 18, height: 12, borderRadius: "3px", ...sx(t) })} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {TR(label)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// ------------------------------------------------------------------ a meeting in a list

export function MeetingRow({ m, onClick }: { m: Meeting; onClick: () => void }) {
  const { lang } = useLang();
  const ask = m.canRespond && m.myResponse === "pending";
  return (
    <ButtonBase
      onClick={onClick}
      data-testid="meeting-row"
      sx={(t) => ({
        width: "100%",
        textAlign: "left",
        justifyContent: "flex-start",
        alignItems: "stretch",
        gap: 1.5,
        p: 1.5,
        borderRadius: `${DESIGN.radius.listItem}px`,
        border: 1,
        borderColor: ask ? t.palette.warning.main : t.palette.divider,
        bgcolor: ask ? alpha(t.palette.warning.main, 0.08) : t.palette.background.paper,
        fontFamily: "inherit",
      })}
    >
      <Box sx={(t) => ({ width: 4, borderRadius: 2, bgcolor: meetingColor(t, m), flex: "0 0 auto" })} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={[{ fontWeight: 600, fontSize: 15 }, gradText()]}>
          {m.title}
        </Typography>
        <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
          {whenText(m, lang)}
        </Typography>
        <Stack direction="row" sx={{ gap: 0.75, mt: 0.75, flexWrap: "wrap" }}>
          <Chip size="small" color={ask ? "warning" : STATUS_TONE[m.status]} variant={m.status === "confirmed" ? "filled" : "outlined"} label={ask ? T("Your answer is needed") : TR(STATUS_LABEL[m.status])} />
          <Chip size="small" variant="outlined" label={TR(PLACE_LABEL[m.place])} />
          {m.kind === "maintenance_check" && <Chip size="small" variant="outlined" color="warning" icon={<HandymanRoundedIcon />} label={T("Maintenance check")} />}
        </Stack>
      </Box>
    </ButtonBase>
  );
}

// ------------------------------------------------------------------ arranging

export type MeetingDraft = {
  title?: string;
  people?: number[];
  day?: string;
  minutes?: number;
  duration?: number;
  place?: Place;
  location?: string;
  projectId?: number | null;
  systemId?: number;
  checkKey?: "six_month" | "one_year";
};

const PLACE_ICON: Record<Place, ReactNode> = {
  online: <VideocamRoundedIcon />,
  site: <SolarPowerRoundedIcon />,
  office: <BusinessRoundedIcon />,
  phone: <PhoneRoundedIcon />,
};

/**
 * Arrange a meeting, or change one: who, then a day on a month that shows
 * when they're busy, how long, and a start time from the half-hours free for
 * everyone; then where (online with a Teams or Google Meet link, on site, at
 * the office, a call), and what it's about.
 */
export function MeetingDialog({ draft = {}, edit, onClose, onSaved }: { draft?: MeetingDraft; edit?: Meeting; onClose: () => void; onSaved: (m: Meeting) => void }) {
  const fetcher = useFetcher();
  const { me, toast } = useApp();
  const { lang } = useLang();
  const myUid = me?.user?.uid ?? 0;
  const { data: contacts } = useApi<Contacts>("/calendar/contacts");
  const [first] = useState(() => nextSlot());
  const startDay = edit ? sgDay(edit.startsAt) : (draft.day ?? (first[1] > 17 * 60 ? addDays(first[0], 1) : first[0]));
  const [title, setTitle] = useState(edit?.title ?? draft.title ?? "");
  const [people, setPeople] = useState<number[]>(edit ? edit.people.map((p) => p.uid).filter((u) => u !== edit.organiser.uid) : (draft.people ?? []));
  const [day, setDay] = useState(startDay);
  const [month, setMonth] = useState(startDay);
  const [duration, setDuration] = useState(edit ? (Date.parse(edit.endsAt) - Date.parse(edit.startsAt)) / 60_000 : (draft.duration ?? 60));
  const [start, setStart] = useState<number | null>(edit ? sgMinutes(edit.startsAt) : (draft.minutes ?? null));
  const [place, setPlace] = useState<Place>(edit?.place ?? draft.place ?? "online");
  const [link, setLink] = useState(edit?.onlineLink ?? "");
  const [location, setLocation] = useState(edit?.location ?? draft.location ?? "");
  const [projectId, setProjectId] = useState<number | "">(edit?.project?.id ?? draft.projectId ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Everyone's busy time over the month on show (and the organiser's own).
  const grid = monthGrid(month);
  const who = [myUid, ...people].filter(Boolean);
  const { data: busyData } = useApi<{ people: BusyPerson[] }>(who.length ? `/calendar/busy?people=${who.join(",")}&from=${grid[0]}&to=${grid[41]}` : null);
  const others = useMemo<BusyPerson[]>(() => {
    // Editing: this meeting's own time isn't "busy".
    const list = busyData?.people ?? [];
    if (!edit) return list;
    return list.map((p) => ({ ...p, busy: p.busy.filter((s) => !(s.startsAt === edit.startsAt && s.endsAt === edit.endsAt)) }));
  }, [busyData, edit]);
  const spans = allBusy(others);
  const marks = useMemo(() => {
    const out: Record<string, DayMark> = {};
    for (const d of grid) {
      const load = dayLoad(spans, d);
      if (load !== "free") out[d] = load;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- grid follows month
  }, [spans, month]);
  const options = startOptions(day, duration, spans);
  const chosen = options.find((o) => o.minutes === start);
  const clash = start !== null && chosen && !chosen.free ? (chosen.why === "past" ? T("That time has passed.") : T("Busy then: {names}", { names: busyNames(others, day, start, start + duration).join(", ") })) : null;

  const contactList = contacts?.people ?? [];
  const nameOf = (uid: number) => contactList.find((c) => c.uid === uid)?.name ?? edit?.people.find((p) => p.uid === uid)?.name ?? String(uid);
  const linkBad = place === "online" && link.trim() !== "" && !/^https:\/\/\S+$/.test(link.trim());
  const ready = title.trim() && people.length > 0 && start !== null && !clash && !linkBad;

  const startsAt = start === null ? "" : wallTime(day, start);
  const endsAt = start === null ? "" : wallTime(day, start + duration);
  const save = async () => {
    if (!ready || start === null) return;
    setBusy(true);
    setError(null);
    const body = { title: title.trim(), people, startsAt, endsAt, place, location: place === "online" ? null : location, onlineLink: place === "online" ? link.trim() || null : null, notes };
    try {
      const r = edit
        ? await fetcher<{ message: string; meeting: Meeting }>(`/meetings/${edit.id}`, { method: "PATCH", json: body })
        : await fetcher<{ message: string; meeting: Meeting }>("/meetings", { method: "POST", json: { ...body, projectId: projectId === "" ? null : projectId, systemId: draft.systemId ?? null, checkKey: draft.checkKey ?? null } });
      toast(r.message);
      onSaved(r.meeting);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MDialog title={edit ? T("Change Meeting") : draft.checkKey ? T("Book a Check") : T("New Meeting")} onClose={onClose} maxWidth="md">
      <Box data-testid="meeting-dialog" sx={{ display: "grid", gap: { xs: 2.5, md: 4 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) minmax(0, 1fr)" }, pt: 1 }}>
        <Stack sx={{ gap: 2.5, minWidth: 0 }}>
          <Field label={T("Title")} icon={<TitleRoundedIcon />} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={T("What's it about?")} slotProps={{ htmlInput: { maxLength: 120, "data-testid": "meeting-title" } }} />
          <Autocomplete
            multiple
            options={contactList.map((c) => c.uid)}
            value={people}
            onChange={(_, v) => setPeople(v)}
            getOptionLabel={(uid) => nameOf(uid)}
            filterSelectedOptions
            noOptionsText={T("Nobody to invite yet")}
            renderOption={(props, uid) => {
              const c = contactList.find((x) => x.uid === uid);
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <Box component="li" key={key} {...rest} sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                  {c && <RoleAvatar name={c.name} role={c.role} size={28} />}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>
                      {nameOf(uid)}
                    </Typography>
                    {c && (
                      <Typography noWrap variant="caption" sx={{ color: "text.secondary" }}>
                        {TR(c.roleLabel)}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => <TextField {...params} label={T("Invite")} placeholder={people.length ? "" : T("Add people")} slotProps={{ ...params.slotProps, inputLabel: { ...params.slotProps.inputLabel, shrink: true }, htmlInput: { ...params.slotProps.htmlInput, "data-testid": "meeting-people" } }} />}
          />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {T("Day")}
            </Typography>
            <MiniMonth month={month} onMonth={setMonth} selected={day} onSelect={(d) => { setDay(d); setStart(null); }} marks={marks} min={today()} testId="meeting-month" />
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
              {T("A dot: someone is busy part of that day. Struck through: busy all working day.")}
            </Typography>
          </Box>
        </Stack>

        <Stack sx={{ gap: 2.5, minWidth: 0 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {T("How long")}
            </Typography>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
              {DURATIONS.map((d) => (
                <Chip key={d} label={TR(durationText(d))} color={d === duration ? "primary" : "default"} variant={d === duration ? "filled" : "outlined"} onClick={() => setDuration(d)} data-testid={`duration-${d}`} />
              ))}
            </Stack>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {T("Start time on {day}", { day: dayText(day, lang) })}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(68px, 1fr))", gap: 0.75, maxHeight: 208, overflowY: "auto", pr: 0.5 }} data-testid="start-times">
              {options.map((o) => {
                const sel = o.minutes === start;
                const label = hhmm(o.minutes);
                const tip = o.why === "busy" ? T("Busy then: {names}", { names: busyNames(others, day, o.minutes, o.minutes + duration).join(", ") }) : o.why === "past" ? T("That time has passed.") : "";
                const chip = (
                  <Chip
                    label={label}
                    disabled={!o.free}
                    color={sel ? "primary" : "default"}
                    variant={sel ? "filled" : "outlined"}
                    onClick={() => setStart(o.minutes)}
                    aria-label={o.free ? label : `${label}, ${tip}`}
                    sx={{ width: "100%", textDecoration: o.why === "busy" ? "line-through" : "none" }}
                  />
                );
                return tip ? (
                  <Tooltip key={o.minutes} title={tip}>
                    <span>{chip}</span>
                  </Tooltip>
                ) : (
                  <Box key={o.minutes}>{chip}</Box>
                );
              })}
            </Box>
            {start !== null && !clash && (
              <Typography variant="body2" sx={{ mt: 1, color: "success.main", fontWeight: 600 }} data-testid="meeting-when">
                {whenText({ startsAt: `${startsAt}:00+08:00`, endsAt: `${endsAt}:00+08:00` }, lang)}
              </Typography>
            )}
            {clash && (
              <Typography variant="body2" sx={{ mt: 1, color: "error.main" }}>
                {clash}
              </Typography>
            )}
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {T("Where")}
            </Typography>
            <ToggleButtonGroup exclusive fullWidth size="small" value={place} onChange={(_, v: Place | null) => v && setPlace(v)} aria-label={T("Where")}>
              {(Object.keys(PLACE_LABEL) as Place[]).map((p) => (
                <ToggleButton key={p} value={p} sx={{ gap: 0.5, px: 0.5, fontSize: 12.5 }} data-testid={`place-${p}`}>
                  {PLACE_ICON[p]}
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                    {TR(PLACE_LABEL[p])}
                  </Box>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {place === "online" ? (
              <Box sx={{ mt: 1.5 }}>
                <Field label={T("Meeting link")} icon={<LinkRoundedIcon />} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" error={linkBad} helperText={linkBad ? T("Paste the meeting link as it starts: https://") : T("Start one, then paste its link here.")} slotProps={{ htmlInput: { inputMode: "url", "data-testid": "meeting-link" } }} />
                <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: "wrap" }}>
                  <Button size="small" variant="outlined" startIcon={<VideocamRoundedIcon />} endIcon={<OpenInNewRoundedIcon />} disabled={start === null} href={start === null ? "#" : teamsNewUrl(title.trim() || T("Meeting"), `${startsAt}:00+08:00`, `${endsAt}:00+08:00`)} target="_blank" rel="noopener noreferrer">
                    {T("New Teams meeting")}
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<VideocamRoundedIcon />} endIcon={<OpenInNewRoundedIcon />} href={GOOGLE_MEET_NEW} target="_blank" rel="noopener noreferrer">
                    {T("New Google Meet")}
                  </Button>
                </Stack>
              </Box>
            ) : (
              <Box sx={{ mt: 1.5 }}>
                <Field label={place === "phone" ? T("Number to call") : T("Address")} icon={place === "phone" ? <PhoneRoundedIcon /> : <PlaceRoundedIcon />} value={location} onChange={(e) => setLocation(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
              </Box>
            )}
          </Box>
          {!edit && !draft.systemId && (contacts?.projects.length ?? 0) > 0 && (
            <Field select label={T("About a project")} icon={<SolarPowerRoundedIcon />} value={projectId} onChange={(e) => setProjectId(e.target.value === "" ? "" : Number(e.target.value))}>
              <MenuItem value="">{T("No project")}</MenuItem>
              {contacts?.projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Field>
          )}
          <Field label={T("Notes")} icon={<NotesRoundedIcon />} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        </Stack>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1, mt: 3, justifyContent: "flex-end" }}>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
        <Button size="large" variant="contained" disabled={!ready || busy} onClick={() => void save()} data-testid="send-meeting">
          {edit ? T("Save changes") : T("Send invitations")}
        </Button>
      </Stack>
    </MDialog>
  );
}

// ------------------------------------------------------------------ one meeting

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start", py: 0.75 }}>
      <Box sx={{ color: "text.secondary", display: "grid", pt: "1px", "& svg": { fontSize: 20 } }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One meeting: when, where, who has answered; accept or decline; join; put it in another calendar. */
export function MeetingDetails({ m, onClose, onChanged, onEdit }: { m: Meeting; onClose: () => void; onChanged: () => Promise<void> | void; onEdit: () => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const act = async (path: string, json?: unknown) => {
    setBusy(true);
    try {
      const r = await fetcher<{ message: string }>(path, { method: "POST", json });
      toast(r.message);
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  };
  const service = linkKind(m.onlineLink);
  const over = Date.parse(m.endsAt) < Date.now();
  return (
    <MDialog title={m.kind === "maintenance_check" ? T("Maintenance Check") : T("Meeting")} heading={m.title} subtitle={whenText(m, lang)} onClose={onClose}>
      <Stack direction="row" sx={{ justifyContent: "center", gap: 1, mt: -1.5, mb: 2, flexWrap: "wrap" }} data-testid="meeting-details">
        <Chip color={STATUS_TONE[m.status]} variant={m.status === "confirmed" ? "filled" : "outlined"} label={TR(STATUS_LABEL[m.status])} />
        {m.myResponse && m.canRespond && <Chip variant="outlined" label={T("You: {answer}", { answer: TR(RESPONSE_LABEL[m.myResponse]) })} />}
      </Stack>

      {m.canRespond && m.myResponse === "pending" && !over && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {T("{name} asked to meet. Accepting holds the time in your calendar.", { name: m.organiser.name })}
        </Alert>
      )}

      <Line icon={<AccessTimeRoundedIcon />}>
        <Typography sx={{ fontWeight: 600 }}>{whenText(m, lang)}</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {TR(durationText((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000))}
        </Typography>
      </Line>
      <Line icon={PLACE_ICON[m.place]}>
        <Typography sx={{ fontWeight: 600 }}>{TR(PLACE_LABEL[m.place])}</Typography>
        {m.place === "online" ? (
          m.onlineLink ? (
            <Button variant="contained" size="small" startIcon={<VideocamRoundedIcon />} href={m.onlineLink} target="_blank" rel="noopener noreferrer" sx={{ mt: 0.75 }} data-testid="join-meeting">
              {service === "teams" ? T("Join on Teams") : service === "meet" ? T("Join on Google Meet") : T("Join the meeting")}
            </Button>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {T("The link will be added before the meeting.")}
            </Typography>
          )
        ) : (
          m.location && (
            <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
              {m.location}
            </Typography>
          )
        )}
      </Line>
      {(m.project || m.system) && (
        <Line icon={m.system ? <HandymanRoundedIcon /> : <SolarPowerRoundedIcon />}>
          <Typography sx={{ fontWeight: 600 }}>{m.system?.address ?? m.project?.name}</Typography>
          {m.checkKey && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {m.checkKey === "six_month" ? T("6-month check") : T("1-year check")}
            </Typography>
          )}
        </Line>
      )}
      {m.notes && (
        <Line icon={<NotesRoundedIcon />}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {m.notes}
          </Typography>
        </Line>
      )}
      <Line icon={<GroupsRoundedIcon />}>
        <Stack sx={{ gap: 1 }}>
          {m.people.map((p) => (
            <Stack key={p.uid} direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
              <RoleAvatar name={p.name} role={p.role} size={30} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>
                  {p.name}
                </Typography>
                {p.uid === m.organiser.uid && (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {T("Arranged it")}
                  </Typography>
                )}
              </Box>
              <Chip size="small" variant="outlined" color={p.response === "accepted" ? "success" : p.response === "declined" ? "error" : "default"} label={TR(RESPONSE_LABEL[p.response])} />
            </Stack>
          ))}
        </Stack>
      </Line>

      {m.status !== "cancelled" && (
        <Stack direction="row" sx={{ gap: 1, mt: 2, flexWrap: "wrap" }}>
          <Button size="small" variant="outlined" startIcon={<EventRoundedIcon />} href={googleCalendarUrl(m)} target="_blank" rel="noopener noreferrer">
            {T("Google Calendar")}
          </Button>
          <Button size="small" variant="outlined" startIcon={<EventRoundedIcon />} href={outlookUrl(m)} target="_blank" rel="noopener noreferrer">
            {T("Outlook / Teams")}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => download(`meeting-${m.id}.ics`, icsFile(m))}>
            {T(".ics file")}
          </Button>
        </Stack>
      )}

      <Stack sx={{ gap: 1, mt: 3 }}>
        {m.canRespond && !over && m.myResponse !== "accepted" && (
          <Button size="large" variant="contained" startIcon={<CheckRoundedIcon />} disabled={busy} onClick={() => void act(`/meetings/${m.id}/respond`, { response: "accepted" })} data-testid="accept-meeting">
            {T("Accept")}
          </Button>
        )}
        {m.canRespond && !over && m.myResponse !== "declined" && (
          <Button size="large" variant="outlined" color="error" startIcon={<CloseRoundedIcon />} disabled={busy} onClick={() => void act(`/meetings/${m.id}/respond`, { response: "declined" })} data-testid="decline-meeting">
            {T("Decline")}
          </Button>
        )}
        {m.canEdit && !over && (
          <Button size="large" variant="outlined" startIcon={<EditRoundedIcon />} onClick={onEdit} data-testid="edit-meeting">
            {T("Change time, people or place")}
          </Button>
        )}
        {m.canEdit && !over && (sure ? (
          <Button size="large" variant="contained" color="error" disabled={busy} onClick={() => void act(`/meetings/${m.id}/cancel`)} data-testid="confirm-cancel-meeting">
            {T("Yes, cancel it and tell everyone")}
          </Button>
        ) : (
          <Button size="large" color="error" onClick={() => setSure(true)} data-testid="cancel-meeting">
            {T("Cancel the meeting")}
          </Button>
        ))}
      </Stack>
    </MDialog>
  );
}

// ------------------------------------------------------------------ blocking out time

const BLOCK_STARTS = slots(0, 1440);

/** Block out an afternoon, or several whole days at once (leave, a course). */
export function BlockDialog({ day, onClose, onSaved }: { day: string; onClose: () => void; onSaved: () => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const min = today();
  const [fromDate, setFrom] = useState(day < min ? min : day);
  const [toDate, setTo] = useState(day < min ? min : day);
  const [whole, setWhole] = useState<"days" | "hours">("hours");
  const [startTime, setStartTime] = useState("13:00");
  const [endTime, setEndTime] = useState("18:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bad = toDate < fromDate ? T("The end date is before the start date.") : whole === "hours" && endTime !== "24:00" && endTime <= startTime ? T("The block ends after it starts.") : null;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetcher<{ message: string }>("/calendar/blocks", { method: "POST", json: { fromDate, toDate, note, ...(whole === "hours" ? { startTime, endTime } : {}) } });
      toast(r.message);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <MDialog title={T("Block Out Time")} heading={T("When can't you meet?")} subtitle={T("Nobody can book you then. Pick a range of days to block them all at once.")} onClose={onClose} maxWidth="xs">
      <Stack sx={{ gap: 2.5 }} data-testid="block-dialog">
        <Stack direction="row" sx={{ gap: 1.5 }}>
          <Field label={T("From")} type="date" value={fromDate} onChange={(e) => { setFrom(e.target.value); if (toDate < e.target.value) setTo(e.target.value); }} slotProps={{ htmlInput: { min, "data-testid": "block-from" } }} />
          <Field label={T("To")} type="date" value={toDate} onChange={(e) => setTo(e.target.value)} slotProps={{ htmlInput: { min: fromDate, "data-testid": "block-to" } }} />
        </Stack>
        <ToggleButtonGroup exclusive fullWidth value={whole} onChange={(_, v: "days" | "hours" | null) => v && setWhole(v)} aria-label={T("How much of each day")}>
          <ToggleButton value="hours" data-testid="block-hours">{T("Part of each day")}</ToggleButton>
          <ToggleButton value="days" data-testid="block-days">{T("Whole days")}</ToggleButton>
        </ToggleButtonGroup>
        {whole === "hours" && (
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <Field select label={T("From")} icon={<AccessTimeRoundedIcon />} value={startTime} onChange={(e) => setStartTime(e.target.value)}>
              {BLOCK_STARTS.map((m) => (
                <MenuItem key={m} value={hhmm(m)}>
                  {hhmm(m)}
                </MenuItem>
              ))}
            </Field>
            <Field select label={T("Until")} icon={<AccessTimeRoundedIcon />} value={endTime} onChange={(e) => setEndTime(e.target.value)}>
              {[...BLOCK_STARTS.slice(1), 1440].map((m) => (
                <MenuItem key={m} value={hhmm(m)}>
                  {m === 1440 ? T("End of day") : hhmm(m)}
                </MenuItem>
              ))}
            </Field>
          </Stack>
        )}
        <Field label={T("Note (only you see it)")} icon={<NotesRoundedIcon />} value={note} onChange={(e) => setNote(e.target.value)} placeholder={T("Leave, training…")} slotProps={{ htmlInput: { maxLength: 200 } }} />
        {(bad || error) && <Alert severity="error">{bad ?? error}</Alert>}
        <Button size="large" variant="contained" startIcon={<EventBusyRoundedIcon />} disabled={busy || Boolean(bad)} onClick={() => void save()} data-testid="save-block">
          {T("Block out")}
        </Button>
      </Stack>
    </MDialog>
  );
}

/** Blocked-out time: what it is, and freeing it again. */
export function BlockDetails({ b, onClose, onFreed }: { b: Block; onClose: () => void; onFreed: () => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  const free = async () => {
    setBusy(true);
    try {
      const r = await fetcher<{ message: string }>(`/calendar/blocks/${b.id}`, { method: "DELETE" });
      toast(r.message);
      onFreed();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <MDialog title={T("Blocked Out")} heading={b.note || T("Blocked out")} subtitle={whenText(b, lang)} onClose={onClose} maxWidth="xs">
      <Button size="large" fullWidth variant="outlined" disabled={busy} onClick={() => void free()} data-testid="free-block">
        {T("Free this time")}
      </Button>
    </MDialog>
  );
}

/** How many of a list of meetings fall on each day, for dots. */
export function daysWith(items: Span[]): Set<string> {
  const out = new Set<string>();
  for (const x of items) {
    let d = sgDay(x.startsAt);
    const last = sgDay(Date.parse(x.endsAt) - 1);
    while (d <= last) {
      out.add(d);
      d = addDays(d, 1);
    }
  }
  return out;
}

