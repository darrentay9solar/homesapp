"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
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
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import RepeatRoundedIcon from "@mui/icons-material/RepeatRounded";
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
import Typography from "@mui/material/Typography";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Field, FieldError, MDialog, RoleAvatar } from "@/components/m";
import { gradText } from "@/components/topbar";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import {
  addDays,
  addMonths,
  allBusy,
  type Block,
  type BusyPerson,
  busyMinutes,
  busyNames,
  type Contacts,
  DAY_TIMES,
  DEFAULT_REMINDERS,
  DAY_FROM,
  DAY_TO,
  dayText,
  durationText,
  endOptions,
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
  MAX_REMINDER,
  MAX_REMINDERS,
  overlaps,
  type Place,
  PLACE_LABEL,
  reminderParts,
  reminderWords,
  type ReminderUnit,
  type Repeat,
  REPEATS,
  repeatWords,
  RESPONSE_LABEL,
  scheduleUrl,
  type Span,
  sgDay,
  sgMinutes,
  slots,
  STATUS_LABEL,
  STATUS_TONE,
  today,
  UNIT_MINUTES,
  VIDEO_NAME,
  type VideoProvider,
  wallTime,
  whenText,
} from "@/lib/client/calendar";
import { DESIGN } from "@/lib/client/design";
import { T, TR, useLang } from "@/lib/client/i18n";
import { FIX_FIELDS } from "@/lib/client/rules";

/**
 * The calendar's pieces, in the style of Google Calendar on the app's
 * template: a mini month, a time grid in 30-minute rows, and the dialogs to
 * arrange a meeting, look at one, and block out time. Logic lives in
 * lib/client/calendar.ts; this file only draws it.
 */

const WEEK_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The time now, kept fresh each minute (for the now line, and what's over). */
export function useNow(every = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

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
                color: isSel ? pal(t).primary.contrastText : !inMonth(d) || off ? pal(t).text.disabled : mark === "full" ? pal(t).error.main : pal(t).text.primary,
                bgcolor: isSel ? pal(t).primary.main : "transparent",
                border: d === now && !isSel ? `1.5px solid ${pal(t).primary.main}` : "1.5px solid transparent",
                textDecoration: mark === "full" && !isSel ? "line-through" : "none",
                position: "relative",
                "&:hover": { bgcolor: isSel ? pal(t).primary.main : tint(t, "primary", 0.1) },
              })}
            >
              {Number(d.slice(8))}
              {mark === "some" && <Box component="span" sx={(t) => ({ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: "50%", bgcolor: isSel ? pal(t).primary.contrastText : pal(t).warning.main })} />}
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
              bgcolor: sel ? pal(t).primary.main : "transparent",
              color: sel ? pal(t).primary.contrastText : pal(t).text.primary,
              border: `1px solid ${sel ? pal(t).primary.main : d === now ? pal(t).primary.main : pal(t).divider}`,
            })}
          >
            <Box component="span" sx={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
              {dayText(d, lang, { weekday: "short" })}
            </Box>
            <Box component="span" sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>
              {Number(d.slice(8))}
            </Box>
            <Box component="span" sx={(t) => ({ width: 5, height: 5, borderRadius: "50%", bgcolor: busyDays.has(d) ? (sel ? pal(t).primary.contrastText : pal(t).primary.main) : "transparent" })} />
          </ButtonBase>
        );
      })}
    </Box>
  );
}

// ------------------------------------------------------------------ time grid

const ROW = 26;

type Tone = "primary" | "warning" | "error" | "success";

/** The theme's own colour variables, so each scheme gets its own (t.palette is the light scheme's). */
const pal = (t: Theme) => (t.vars ?? t).palette;

/** A see-through tint of a theme colour, in either scheme. */
function tint(t: Theme, c: Tone | "text", a: number): string {
  const v = t.vars?.palette;
  if (v) return `rgb(${c === "text" ? v.text.primaryChannel : v[c].mainChannel} / ${a})`;
  return alpha(c === "text" ? t.palette.text.primary : t.palette[c].main, a);
}

function meetingTone(m: Meeting): Tone {
  if (m.status === "declined") return "error";
  return m.kind === "maintenance_check" ? "warning" : "primary";
}

function meetingColor(t: Theme, m: Meeting): string {
  return pal(t)[meetingTone(m)].main;
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
  now: nowProp,
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
  const ticking = useNow();
  const now = nowProp ?? ticking;
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
                <Box sx={(t) => ({ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, bgcolor: isToday ? pal(t).primary.main : "transparent", color: isToday ? pal(t).primary.contrastText : pal(t).text.primary })}>
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
                  backgroundImage: `repeating-linear-gradient(to bottom, ${pal(t).divider} 0 1px, transparent 1px ${ROW}px, ${tint(t, "text", 0.035)} ${ROW}px ${ROW + 1}px, transparent ${ROW + 1}px ${ROW * 2}px)`,
                  bgcolor: d === nowDay ? tint(t, "primary", 0.025) : "transparent",
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
                      color: pal(t).text.secondary,
                      backgroundImage: `repeating-linear-gradient(135deg, ${tint(t, "text", 0.09)} 0 6px, transparent 6px 12px)`,
                      border: `1px solid ${tint(t, "text", 0.12)}`,
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
                        const tone = meetingTone(m);
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
                          bgcolor: tint(t, tone, pending ? 0.1 : 0.18),
                          ...(!pending && t.applyStyles("dark", { bgcolor: tint(t, tone, 0.32) })),
                          borderLeft: `3px solid ${c}`,
                          outline: pending ? `1.5px dashed ${c}` : "none",
                          outlineOffset: -1.5,
                          color: pal(t).text.primary,
                          zIndex: 1,
                          "&:hover": { bgcolor: tint(t, tone, 0.28) },
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
                  <Box aria-hidden data-allow-overlap sx={(t) => ({ position: "absolute", left: 0, right: 0, top: y(nowMin), height: 2, bgcolor: pal(t).error.main, zIndex: 2, pointerEvents: "none", "&::before": { content: '""', position: "absolute", left: -5, top: -4, width: 10, height: 10, borderRadius: "50%", bgcolor: pal(t).error.main } })} />
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
    ["Confirmed", (t) => ({ bgcolor: tint(t, "primary", 0.25), borderLeft: `3px solid ${pal(t).primary.main}` })],
    ["Waiting for answers", (t) => ({ outline: `1.5px dashed ${pal(t).primary.main}`, outlineOffset: -1.5 })],
    ["Maintenance check", (t) => ({ bgcolor: tint(t, "warning", 0.25), borderLeft: `3px solid ${pal(t).warning.main}` })],
    ["Blocked out", (t) => ({ backgroundImage: `repeating-linear-gradient(135deg, ${tint(t, "text", 0.2)} 0 3px, transparent 3px 6px)` })],
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
        borderColor: ask ? pal(t).warning.main : pal(t).divider,
        bgcolor: ask ? tint(t, "warning", 0.08) : pal(t).background.paper,
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
  postalCode?: string;
  projectId?: number | null;
  systemId?: number;
  checkKey?: "six_month" | "one_year";
};

const PLACE_ICON: Record<Place, ReactNode> = {
  online: <VideocamRoundedIcon />,
  physical: <PlaceRoundedIcon />,
  phone: <PhoneRoundedIcon />,
};

const UNITS: ReminderUnit[] = ["minutes", "hours", "days", "weeks"];
const unitText = (u: ReminderUnit): string => ({ minutes: T("minutes before"), hours: T("hours before"), days: T("days before"), weeks: T("weeks before") })[u];
type Ends = "never" | "on" | "after";

/** "10:30 (1 hr 30 min)" for an end time, the way Google Calendar lists them. */
function endLabel(start: number, end: number): string {
  const next = end >= 1440 ? ` ${T("(next day)")}` : "";
  return `${hhmm(end % 1440)}${next} (${TR(durationText(end - start))})`;
}

/** The video services' buttons: a meeting set up for this time, or their own scheduling page to set one up. */
function VideoButtons({ connected, making, disabled, onPick }: { connected: VideoProvider[]; making: VideoProvider | null; disabled: boolean; onPick: (p: VideoProvider) => void }) {
  return (
    <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: "wrap" }}>
      {(["teams", "meet", "zoom"] as VideoProvider[]).map((p) => (
        <Button key={p} size="small" variant="outlined" startIcon={<VideocamRoundedIcon />} endIcon={connected.includes(p) ? undefined : <OpenInNewRoundedIcon />} disabled={disabled || making !== null} onClick={() => onPick(p)} data-testid={`video-${p}`}>
          {making === p ? T("Setting up…") : VIDEO_NAME[p]}
        </Button>
      ))}
    </Stack>
  );
}

/**
 * Arrange a meeting, or change one, the way Google Calendar does it: a
 * title and who's invited; a date and a start and end time on the half hour
 * (times someone's busy at can't be chosen); whether and how it repeats; when
 * everyone's reminded (an hour before unless changed; up to five); where:
 * online, at a physical address (its postal code fills the address, or a
 * project's, a joiner's or your own address), or a call, with a Teams,
 * Google Meet or Zoom link set up for that time; and what it's about.
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
  const [start, setStart] = useState<number>(edit ? sgMinutes(edit.startsAt) : (draft.minutes ?? (startDay === first[0] && first[1] >= 8 * 60 ? first[1] : 9 * 60)));
  const [duration, setDuration] = useState(edit ? (Date.parse(edit.endsAt) - Date.parse(edit.startsAt)) / 60_000 : (draft.duration ?? 60));
  const [rule, setRule] = useState<Repeat | "">("");
  const [ends, setEnds] = useState<Ends>("never");
  const [until, setUntil] = useState(addDays(startDay, 7 * 12));
  const [count, setCount] = useState("10");
  const [reminders, setReminders] = useState<number[]>(edit?.reminders ?? DEFAULT_REMINDERS);
  const [place, setPlace] = useState<Place>(edit?.place ?? draft.place ?? "online");
  const [link, setLink] = useState(edit?.onlineLink ?? "");
  const [location, setLocation] = useState(edit?.location ?? draft.location ?? "");
  const [postal, setPostal] = useState(edit?.postalCode ?? draft.postalCode ?? "");
  const [found, setFound] = useState<{ postal: string; address: string | null; error: string | null } | null>(null);
  const [projectId, setProjectId] = useState<number | "">(edit?.project?.id ?? draft.projectId ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [scope, setScope] = useState<"one" | "following">("one");
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState<VideoProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const series = Boolean(edit?.seriesId && edit.laterInSeries > 0);

  // Everyone's busy time on the day chosen (and the organiser's own).
  const who = [myUid, ...people].filter(Boolean);
  const { data: busyData } = useApi<{ people: BusyPerson[] }>(who.length && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `/calendar/busy?people=${who.join(",")}&from=${day}&to=${addDays(day, 1)}` : null);
  const others = useMemo<BusyPerson[]>(() => {
    // Editing: this meeting's own time isn't "busy".
    const list = busyData?.people ?? [];
    if (!edit) return list;
    return list.map((p) => ({ ...p, busy: p.busy.filter((s) => !(s.startsAt === edit.startsAt && s.endsAt === edit.endsAt)) }));
  }, [busyData, edit]);
  const spans = allBusy(others);
  const now = useNow();
  const [nowDay, nowMin] = nextSlot(now);
  const past = (m: number) => day < nowDay || (day === nowDay && m < nowMin);
  const taken = (m: number, len = duration) => overlaps(busyMinutes(spans, day), m, m + len);
  const end = start + duration;
  const clash = !/^\d{4}-\d{2}-\d{2}$/.test(day) ? T("Choose a date.") : past(start) && !(edit && day === sgDay(edit.startsAt) && start === sgMinutes(edit.startsAt)) ? T("That time has passed.") : taken(start) ? T("Busy then: {names}", { names: busyNames(others, day, start, end).join(", ") }) : null;
  // Who's busy that day, so a free time is easy to find.
  const busyThatDay = others
    .filter((p) => p.uid !== myUid || people.length === 0)
    .flatMap((p) => busyMinutes(p.busy, day).map(([a, b]) => `${p.uid === myUid ? T("You") : (p.name ?? "")} ${hhmm(a)}–${hhmm(b % 1440 === 0 && b > 0 ? 1440 : b)}`));

  const contactList = useMemo(() => contacts?.people ?? [], [contacts]);
  const nameOf = (uid: number) => contactList.find((c) => c.uid === uid)?.name ?? edit?.people.find((p) => p.uid === uid)?.name ?? String(uid);
  const linkBad = link.trim() !== "" && !/^https:\/\/\S+$/.test(link.trim());
  const postalBad = place === "physical" && postal !== "" && !/^\d{6}$/.test(postal);
  const countN = Number(count);
  const repeatBad = rule !== "" && ((ends === "on" && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= day)) || (ends === "after" && !(Number.isInteger(countN) && countN >= 2 && countN <= 200)));
  const reminderBad = reminders.some((r) => !Number.isFinite(r) || r < 0 || r > MAX_REMINDER);
  // Pressing Send with something missing marks it, instead of a grey button.
  const [tried, setTried] = useState(false);
  const problem = {
    title: title.trim() ? null : T("Give the meeting a title."),
    people: people.length ? null : T("Invite at least one person."),
  };
  const ready = !problem.title && !problem.people && !clash && !linkBad && !postalBad && !repeatBad && !reminderBad;

  // A complete postal code is looked up once; what it finds fills an empty address (or one it filled before).
  useEffect(() => {
    if (place !== "physical" || !/^\d{6}$/.test(postal) || found?.postal === postal) return;
    let live = true;
    fetcher<{ address: string }>(`/calendar/geocode?postal=${postal}`).then(
      (r) => {
        if (!live) return;
        setFound({ postal, address: r.address, error: null });
        setLocation((x) => (!x.trim() || x === found?.address ? r.address : x));
      },
      (e: unknown) => live && setFound({ postal, address: null, error: e instanceof ApiError ? e.message : T("Couldn't look that up.") })
    );
    return () => {
      live = false;
    };
  }, [place, postal, found, fetcher]);

  // Addresses to meet at: the project's, a joiner's (managers see them), or your own.
  const addresses = useMemo(() => {
    const out: Array<{ key: string; label: string; address: string; postal: string | null }> = [];
    const proj = contacts?.projects.find((p) => p.id === projectId);
    if (proj?.address) out.push({ key: "project", label: T("Project: {name}", { name: proj.name }), address: proj.address, postal: proj.postalCode ?? null });
    for (const uid of people) {
      const c = contactList.find((x) => x.uid === uid);
      if (c?.address) out.push({ key: `person-${uid}`, label: T("{name}'s address", { name: c.name }), address: c.address, postal: c.postalCode ?? null });
    }
    if (contacts?.me?.address) out.push({ key: "me", label: T("My address"), address: contacts.me.address, postal: contacts.me.postalCode });
    return out;
  }, [contacts, contactList, people, projectId]);

  const startsAt = /^\d{4}-\d{2}-\d{2}$/.test(day) ? wallTime(day, start) : "";
  const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(day) ? wallTime(day, end) : "";
  const connected = contacts?.video ?? [];

  const makeVideo = async (provider: VideoProvider) => {
    if (!startsAt) return setTried(true);
    if (!connected.includes(provider)) {
      window.open(scheduleUrl(provider, title.trim() || T("Meeting"), `${startsAt}:00+08:00`, `${endsAt}:00+08:00`), "_blank", "noopener,noreferrer");
      return;
    }
    setMaking(provider);
    setError(null);
    try {
      const r = await fetcher<{ link: string }>("/calendar/video-link", { method: "POST", json: { provider, title: title.trim(), startsAt, endsAt } });
      setLink(r.link);
      toast(T("{service} meeting set up for that time.", { service: VIDEO_NAME[provider] }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setMaking(null);
    }
  };

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const body = {
      title: title.trim(), people, startsAt, endsAt, place,
      location: place === "online" ? null : location, postalCode: place === "physical" ? postal || null : null,
      onlineLink: link.trim() || null, notes, reminders,
    };  // prettier-ignore
    try {
      const r = edit
        ? await fetcher<{ message: string; meeting: Meeting }>(`/meetings/${edit.id}`, { method: "PATCH", json: { ...body, scope } })
        : await fetcher<{ message: string; meeting: Meeting }>("/meetings", {
            method: "POST",
            json: {
              ...body, projectId: projectId === "" ? null : projectId, systemId: draft.systemId ?? null, checkKey: draft.checkKey ?? null,
              repeat: rule || null, repeatUntil: rule && ends === "on" ? until : null, repeatCount: rule && ends === "after" ? countN : null,
            },  // prettier-ignore
          });
      toast(r.message);
      onSaved(r.meeting);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const videoField = (optional: boolean) => (
    <Box sx={{ mt: 1.5 }}>
      <Field
        label={optional ? T("Video call link (optional)") : T("Meeting link")}
        icon={<LinkRoundedIcon />}
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="https://"
        error={linkBad}
        helperText={linkBad ? T("Paste the meeting link as it starts: https://") : connected.length ? T("Pick a service to set up a meeting for this time, or paste a link.") : T("Set one up for this time in Teams, Google Meet or Zoom, then paste its link here.")}
        slotProps={{ htmlInput: { inputMode: "url", "data-testid": optional ? "meeting-video-link" : "meeting-link" } }}
      />
      <VideoButtons connected={connected} making={making} disabled={!startsAt} onPick={(p) => void makeVideo(p)} />
    </Box>
  );

  return (
    <MDialog title={edit ? T("Change Meeting") : draft.checkKey ? T("Book a Check") : T("New Meeting")} onClose={onClose} maxWidth="md">
      <Box data-testid="meeting-dialog" sx={{ display: "grid", gap: { xs: 2.5, md: 4 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) minmax(0, 1fr)" }, pt: 1 }}>
        <Stack sx={{ gap: 2.5, minWidth: 0 }}>
          <Field label={T("Title")} icon={<TitleRoundedIcon />} value={title} onChange={(e) => setTitle(e.target.value)} error={tried && Boolean(problem.title)} helperText={tried ? (problem.title ?? undefined) : undefined} placeholder={T("What's it about?")} slotProps={{ htmlInput: { maxLength: 120, "data-testid": "meeting-title" } }} />
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
            renderInput={(params) => <TextField {...params} label={T("Invite")} placeholder={people.length ? "" : T("Add people")} error={tried && Boolean(problem.people)} helperText={tried ? (problem.people ?? undefined) : undefined} slotProps={{ ...params.slotProps, inputLabel: { ...params.slotProps.inputLabel, shrink: true }, htmlInput: { ...params.slotProps.htmlInput, "data-testid": "meeting-people" } }} />}
          />

          <Field label={T("Date")} type="date" icon={<EventRoundedIcon />} value={day} onChange={(e) => setDay(e.target.value)} slotProps={{ htmlInput: { min: today(), "data-testid": "meeting-date" } }} />
          <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", "& > *": { flex: "1 1 150px", minWidth: 0 } }}>
            <Field
              select
              label={T("Starts")}
              icon={<AccessTimeRoundedIcon />}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
              sx={{ flex: 1, minWidth: 0 }}
              slotProps={{ htmlInput: { "data-testid": "meeting-start" }, select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
            >
              {DAY_TIMES.map((m) => {
                const off = past(m) && !(edit && day === sgDay(edit.startsAt) && m === sgMinutes(edit.startsAt));
                const full = !off && taken(m);
                return (
                  <MenuItem key={m} value={m} disabled={off || full} sx={{ textDecoration: full ? "line-through" : "none" }}>
                    {hhmm(m)}
                    {full ? ` · ${T("busy")}` : ""}
                  </MenuItem>
                );
              })}
            </Field>
            <Field select label={T("Ends")} value={end} onChange={(e) => setDuration(Number(e.target.value) - start)} sx={{ flex: 1, minWidth: 0 }} slotProps={{ htmlInput: { "data-testid": "meeting-end" }, select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}>
              {endOptions(start).map((m) => (
                <MenuItem key={m} value={m} disabled={taken(start, m - start)}>
                  {endLabel(start, m)}
                </MenuItem>
              ))}
            </Field>
          </Stack>
          <Box sx={{ mt: -1 }}>
            {clash ? (
              <Typography variant="body2" sx={{ color: "error.main" }} data-testid="meeting-clash">
                {clash}
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ color: "success.main", fontWeight: 600 }} data-testid="meeting-when">
                {whenText({ startsAt: `${startsAt}:00+08:00`, endsAt: `${endsAt}:00+08:00` }, lang)}
              </Typography>
            )}
            {busyThatDay.length > 0 && (
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
                {T("Busy that day: {list}", { list: busyThatDay.join(" · ") })}
              </Typography>
            )}
          </Box>

          {!edit && !draft.checkKey && (
            <Box>
              <Field select label={T("Repeat")} icon={<RepeatRoundedIcon />} value={rule} onChange={(e) => setRule(e.target.value as Repeat | "")} slotProps={{ htmlInput: { "data-testid": "meeting-repeat" }, select: { displayEmpty: true } }}>
                <MenuItem value="">{T("Does not repeat")}</MenuItem>
                {REPEATS.map((r) => {
                  const [phrase, vars] = repeatWords(r, day, lang);
                  return (
                    <MenuItem key={r} value={r}>
                      {T(phrase, { ...vars, nth: vars.nth ? T(vars.nth) : "" })}
                    </MenuItem>
                  );
                })}
              </Field>
              {rule !== "" && (
                <Stack direction="row" sx={{ gap: 1.5, mt: 1.5 }}>
                  <Field select label={T("Ends")} value={ends} onChange={(e) => setEnds(e.target.value as Ends)} sx={{ flex: 1, minWidth: 0 }} slotProps={{ htmlInput: { "data-testid": "meeting-repeat-ends" } }}>
                    <MenuItem value="never">{T("Never (set up 6 months ahead)")}</MenuItem>
                    <MenuItem value="on">{T("On a date")}</MenuItem>
                    <MenuItem value="after">{T("After a number of times")}</MenuItem>
                  </Field>
                  {ends === "on" && <Field label={T("Last date")} type="date" value={until} onChange={(e) => setUntil(e.target.value)} error={repeatBad} sx={{ flex: 1, minWidth: 0 }} slotProps={{ htmlInput: { min: addDays(day, 1), max: addDays(day, 366) } }} />}
                  {ends === "after" && <Field label={T("Times")} type="number" value={count} onChange={(e) => setCount(e.target.value)} error={repeatBad} helperText={repeatBad ? T("2 to 200") : undefined} sx={{ flex: 1, minWidth: 0 }} slotProps={{ htmlInput: { min: 2, max: 200, inputMode: "numeric" } }} />}
                </Stack>
              )}
            </Box>
          )}
          {edit?.repeat && (
            <Typography variant="body2" sx={{ color: "text.secondary", display: "flex", gap: 0.75, alignItems: "center" }}>
              <RepeatRoundedIcon fontSize="small" />
              {(() => {
                const [phrase, vars] = repeatWords(edit.repeat, sgDay(edit.startsAt), lang);
                return T(phrase, { ...vars, nth: vars.nth ? T(vars.nth) : "" });
              })()}
            </Typography>
          )}

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {T("Notifications")}
            </Typography>
            <Stack sx={{ gap: 1 }} data-testid="meeting-reminders">
              {reminders.map((r, i) => {
                const [n, unit] = reminderParts(r);
                const set = (v: number) => setReminders((xs) => xs.map((x, j) => (j === i ? v : x)));
                return (
                  <Stack key={i} direction="row" sx={{ gap: 1, alignItems: "center" }}>
                    <NotificationsRoundedIcon sx={{ color: "text.secondary" }} fontSize="small" />
                    <TextField size="small" type="number" value={n} onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)) * UNIT_MINUTES[unit])} sx={{ width: 84 }} slotProps={{ htmlInput: { min: 0, inputMode: "numeric", "aria-label": T("How long before") } }} />
                    <TextField size="small" select value={unit} onChange={(e) => set(n * UNIT_MINUTES[e.target.value as ReminderUnit])} sx={{ flex: 1, minWidth: 0 }} slotProps={{ htmlInput: { "aria-label": T("Unit") } }}>
                      {UNITS.map((u) => (
                        <MenuItem key={u} value={u}>
                          {unitText(u)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <IconButton aria-label={T("Remove this notification")} onClick={() => setReminders((xs) => xs.filter((_, j) => j !== i))} size="small">
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                );
              })}
              {reminderBad && <FieldError>{T("A notification goes at most 4 weeks before the meeting.")}</FieldError>}
              {reminders.length === 0 && (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {T("No notifications. Nobody is reminded.")}
                </Typography>
              )}
              {reminders.length < MAX_REMINDERS && (
                <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setReminders((xs) => [...xs, 30])} sx={{ alignSelf: "flex-start" }} data-testid="add-reminder">
                  {T("Add notification")}
                </Button>
              )}
            </Stack>
          </Box>
        </Stack>

        <Stack sx={{ gap: 2.5, minWidth: 0 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {T("Where")}
            </Typography>
            <ToggleButtonGroup exclusive fullWidth size="small" value={place} onChange={(_, v: Place | null) => v && setPlace(v)} aria-label={T("Where")}>
              {(Object.keys(PLACE_LABEL) as Place[]).map((p) => (
                <ToggleButton key={p} value={p} sx={{ gap: 0.5, px: 0.5, minWidth: 0, fontSize: 12.5, lineHeight: 1.2, flexDirection: { xs: "column", sm: "row" } }} data-testid={`place-${p}`}>
                  {PLACE_ICON[p]}
                  <Box component="span" data-fit sx={{ maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {TR(PLACE_LABEL[p])}
                  </Box>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {place === "online" && videoField(false)}
            {place === "physical" && (
              <Stack sx={{ mt: 1.5, gap: 1.5 }}>
                {addresses.length > 0 && (
                  <Field select label={T("Use an address")} icon={<HomeRoundedIcon />} value="" onChange={(e) => {
                    const a = addresses.find((x) => x.key === e.target.value);
                    if (!a) return;
                    setLocation(a.address);
                    setPostal(a.postal ?? "");
                    setFound(a.postal ? { postal: a.postal, address: a.address, error: null } : null);
                  }} slotProps={{ htmlInput: { "data-testid": "meeting-address-from" }, select: { displayEmpty: true } }}>
                    <MenuItem value="" disabled>
                      {T("Choose whose address")}
                    </MenuItem>
                    {addresses.map((a) => (
                      <MenuItem key={a.key} value={a.key}>
                        {a.label}
                      </MenuItem>
                    ))}
                  </Field>
                )}
                <Field
                  label={T("Postal code")}
                  icon={<PlaceRoundedIcon />}
                  value={postal}
                  onChange={(e) => setPostal(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  error={postalBad || Boolean(found?.postal === postal && found.error)}
                  helperText={postalBad ? T("A Singapore postal code is 6 digits.") : found?.postal === postal ? (found.error ?? T("Found on OneMap.")) : T("6 digits — fills in the address")}
                  slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6, "data-testid": "meeting-postal" } }}
                />
                <Field label={T("Address")} icon={<HomeRoundedIcon />} value={location} onChange={(e) => setLocation(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300, "data-testid": "meeting-address" } }} />
                {/* Someone who can't be there joins by video. */}
                {videoField(true)}
              </Stack>
            )}
            {place === "phone" && (
              <Box sx={{ mt: 1.5 }}>
                <Field label={T("Number to call")} icon={<PhoneRoundedIcon />} value={location} onChange={(e) => setLocation(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
              </Box>
            )}
          </Box>
          {!edit && !draft.systemId && (contacts?.projects.length ?? 0) > 0 && (
            <Field select label={T("About a project")} icon={<SolarPowerRoundedIcon />} value={projectId} onChange={(e) => setProjectId(e.target.value === "" ? "" : Number(e.target.value))} slotProps={{ select: { displayEmpty: true } }}>
              <MenuItem value="">{T("No project")}</MenuItem>
              {contacts?.projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Field>
          )}
          <Field label={T("Notes")} icon={<NotesRoundedIcon />} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          {series && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
                {T("Change")}
              </Typography>
              <ToggleButtonGroup exclusive fullWidth size="small" value={scope} onChange={(_, v: "one" | "following" | null) => v && setScope(v)} aria-label={T("Change")}>
                <ToggleButton value="one" data-testid="scope-one">
                  {T("This meeting")}
                </ToggleButton>
                <ToggleButton value="following" data-testid="scope-following">
                  {T("This and the following")}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
        </Stack>
      </Box>
      {(error || (tried && !ready)) && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error ?? T(FIX_FIELDS)}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 1, mt: 3, justifyContent: "flex-end" }}>
        <Button size="large" onClick={onClose}>
          {T("Cancel")}
        </Button>
        <Button size="large" variant="contained" disabled={busy} onClick={() => (ready ? void save() : setTried(true))} data-testid="send-meeting">
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
  const over = Date.parse(m.endsAt) < useNow();
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
              {service === "teams" ? T("Join on Teams") : service === "meet" ? T("Join on Google Meet") : service === "zoom" ? T("Join on Zoom") : T("Join the meeting")}
            </Button>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {T("The link will be added before the meeting.")}
            </Typography>
          )
        ) : (
          <>
            {(m.location || m.postalCode) && (
              <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
                {[m.location, m.postalCode && !(m.location ?? "").includes(m.postalCode) ? `Singapore ${m.postalCode}` : null].filter(Boolean).join(", ")}
              </Typography>
            )}
            {m.onlineLink && (
              <Button variant="outlined" size="small" startIcon={<VideocamRoundedIcon />} href={m.onlineLink} target="_blank" rel="noopener noreferrer" sx={{ mt: 0.75 }} data-testid="join-meeting">
                {service === "teams" ? T("Join on Teams") : service === "meet" ? T("Join on Google Meet") : service === "zoom" ? T("Join on Zoom") : T("Join by video")}
              </Button>
            )}
          </>
        )}
      </Line>
      {m.repeat && (
        <Line icon={<RepeatRoundedIcon />}>
          <Typography sx={{ fontWeight: 600 }}>
            {(() => {
              const [phrase, vars] = repeatWords(m.repeat, sgDay(m.startsAt), lang);
              return T(phrase, { ...vars, nth: vars.nth ? T(vars.nth) : "" });
            })()}
          </Typography>
          {m.laterInSeries > 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {T("{n} more after this one", { n: String(m.laterInSeries) })}
            </Typography>
          )}
        </Line>
      )}
      <Line icon={<NotificationsRoundedIcon />}>
        <Typography variant="body2" data-testid="meeting-reminder-list">
          {m.reminders.length
            ? m.reminders
                .map((r) => {
                  const [phrase, vars] = reminderWords(r);
                  return T(phrase, vars);
                })
                .join(", ")
            : T("No notifications")}
        </Typography>
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
            {m.laterInSeries > 0 ? T("Accept this one") : T("Accept")}
          </Button>
        )}
        {m.canRespond && !over && m.laterInSeries > 0 && (
          <Button size="large" variant="outlined" startIcon={<CheckRoundedIcon />} disabled={busy} onClick={() => void act(`/meetings/${m.id}/respond`, { response: "accepted", series: true })} data-testid="accept-series">
            {T("Accept this and the following")}
          </Button>
        )}
        {m.canRespond && !over && m.myResponse !== "declined" && (
          <Button size="large" variant="outlined" color="error" startIcon={<CloseRoundedIcon />} disabled={busy} onClick={() => void act(`/meetings/${m.id}/respond`, { response: "declined" })} data-testid="decline-meeting">
            {m.laterInSeries > 0 ? T("Decline this one") : T("Decline")}
          </Button>
        )}
        {m.canRespond && !over && m.laterInSeries > 0 && (
          <Button size="large" color="error" startIcon={<CloseRoundedIcon />} disabled={busy} onClick={() => void act(`/meetings/${m.id}/respond`, { response: "declined", series: true })} data-testid="decline-series">
            {T("Decline this and the following")}
          </Button>
        )}
        {m.canEdit && !over && (
          <Button size="large" variant="outlined" startIcon={<EditRoundedIcon />} onClick={onEdit} data-testid="edit-meeting">
            {T("Change time, people or place")}
          </Button>
        )}
        {m.canEdit && !over && (sure ? (
          <>
            <Button size="large" variant="contained" color="error" disabled={busy} onClick={() => void act(`/meetings/${m.id}/cancel`)} data-testid="confirm-cancel-meeting">
              {m.laterInSeries > 0 ? T("Cancel just this one and tell everyone") : T("Yes, cancel it and tell everyone")}
            </Button>
            {m.laterInSeries > 0 && (
              <Button size="large" variant="outlined" color="error" disabled={busy} onClick={() => void act(`/meetings/${m.id}/cancel`, { scope: "following" })} data-testid="confirm-cancel-series">
                {T("Cancel this and the following")}
              </Button>
            )}
          </>
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
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", "& > *": { flex: "1 1 150px", minWidth: 0 } }}>
          <Field label={T("From")} type="date" value={fromDate} onChange={(e) => { setFrom(e.target.value); if (toDate < e.target.value) setTo(e.target.value); }} slotProps={{ htmlInput: { min, "data-testid": "block-from" } }} />
          <Field label={T("To")} type="date" value={toDate} onChange={(e) => setTo(e.target.value)} slotProps={{ htmlInput: { min: fromDate, "data-testid": "block-to" } }} />
        </Stack>
        <ToggleButtonGroup exclusive fullWidth value={whole} onChange={(_, v: "days" | "hours" | null) => v && setWhole(v)} aria-label={T("How much of each day")}>
          <ToggleButton value="hours" data-testid="block-hours">{T("Part of each day")}</ToggleButton>
          <ToggleButton value="days" data-testid="block-days">{T("Whole days")}</ToggleButton>
        </ToggleButtonGroup>
        {whole === "hours" && (
          <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", "& > *": { flex: "1 1 150px", minWidth: 0 } }}>
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
        <Button size="large" variant="contained" startIcon={<EventBusyRoundedIcon />} disabled={busy} onClick={() => (bad ? undefined : void save())} data-testid="save-block">
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

