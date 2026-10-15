"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BlockDetails, BlockDialog, daysWith, useNow, type DayMark, Legend, MeetingDetails, MeetingDialog, type MeetingDraft, MeetingRow, MiniMonth, TimeGrid, WeekStrip } from "@/components/calendar";
import { Page } from "@/components/shell";
import { Heading, SegTabs, TopBar } from "@/components/topbar";
import { useApi, useFetcher } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { addDays, type Block, type CalendarData, dayLoad, dayText, type Meeting, monthGrid, sgDay, sortUpcoming, today, weekDays } from "@/lib/client/calendar";
import { T, useLang } from "@/lib/client/i18n";

type View = "day" | "week" | "list";
type Open = { kind: "new"; draft: MeetingDraft } | { kind: "edit"; m: Meeting } | { kind: "meeting"; m: Meeting } | { kind: "block"; day: string } | { kind: "blocked"; b: Block } | null;

/**
 * Everyone's own calendar: the meetings they've arranged or been asked to,
 * and time they've blocked out, in 30-minute rows. A week on a laptop, a day
 * with the week above it on a phone, or a list of what's coming. Invitations
 * waiting for an answer are dashed and listed first; a meeting holds the time
 * once accepted.
 */
export default function CalendarPage() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const fetcher = useFetcher();
  const { lang } = useLang();
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up("lg"), { noSsr: true });
  // Until someone picks a view: a week on a laptop, a day on a phone (or the list, when linked to it).
  const [chosen, setView] = useState<View | null>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "list" ? "list" : null));
  const view: View = chosen ?? (wide ? "week" : "day");
  const now = useNow();
  const [anchor, setAnchor] = useState(today());
  const [month, setMonth] = useState(today());
  const [open, setOpen] = useState<Open>(null);


  const week = weekDays(anchor);
  const grid = monthGrid(month);
  // One request covers the week on show and the month beside it (for its dots), within the 62 days a request may span.
  const from = [week[0], grid[0]].sort()[0];
  const to = [week[6], grid[41]].sort()[1];
  const range = Date.parse(to) - Date.parse(from) <= 60 * 86_400_000 ? [from, to] : [week[0], week[6]];
  const { data, error, reload } = useApi<CalendarData>(me ? `/calendar?from=${range[0]}&to=${range[1]}` : null);
  const upcoming = useApi<{ meetings: Meeting[] }>(me && view === "list" ? "/calendar/upcoming" : null);

  // Opened from a notification: /calendar?meeting=12.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("meeting"));
    if (!id) return;
    void fetcher<Meeting>(`/meetings/${id}`).then(
      (m) => {
        setAnchor(sgDay(m.startsAt));
        setMonth(sgDay(m.startsAt));
        setOpen({ kind: "meeting", m });
      },
      () => undefined
    );
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, from the link
  }, []);

  const meetings = data?.meetings ?? [];
  const blocks = data?.blocks ?? [];
  const marks = useMemo(() => {
    const out: Record<string, DayMark> = {};
    const spans = [...meetings.filter((m) => m.myResponse === "accepted"), ...blocks];
    for (const d of grid) {
      const load = dayLoad(spans, d);
      if (load !== "free") out[d] = load;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- grid follows month
  }, [data, month]);
  const toAnswer = sortUpcoming(meetings).filter((m) => m.canRespond && m.myResponse === "pending" && Date.parse(m.endsAt) > now);

  if (!me) return null;
  const refresh = async () => {
    await Promise.all([reload(), view === "list" ? upcoming.reload() : undefined]);
  };
  const pick = (d: string) => {
    setAnchor(d);
    setMonth(d);
  };
  const step = (n: number) => pick(addDays(anchor, view === "week" ? 7 * n : n));
  const days = view === "week" ? week : [anchor];
  const label = view === "week" ? `${dayText(week[0], lang, { day: "numeric", month: "short" })} – ${dayText(week[6], lang, { day: "numeric", month: "short", year: "numeric" })}` : dayText(anchor, lang, { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <TopBar
        title={T("Calendar")}
        action={
          <Button onClick={() => setOpen({ kind: "new", draft: {} })} startIcon={<AddRoundedIcon />} data-testid="new-meeting" sx={{ color: "#073f2b", bgcolor: "#fff", px: { xs: 1.5, sm: 2 }, height: 36, "&:hover": { bgcolor: "#eafff4" } }}>
            {T("Meeting")}
          </Button>
        }
        tabs={
          <SegTabs
            label={T("Calendar view")}
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: T("Day") },
              { value: "week", label: T("Week") },
              { value: "list", label: T("Upcoming"), count: data ? toAnswer.length || undefined : undefined },
            ]}
          />
        }
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "300px minmax(0, 1fr)" }, mt: 1.5, alignItems: "start" }}>
            {/* Beside the calendar on a laptop: the month, invitations to answer, blocking out time. */}
            <Stack sx={{ gap: 2, display: { xs: view === "list" ? "flex" : "none", lg: "flex" }, order: { xs: 2, lg: 0 } }}>
              <Card sx={{ p: 2 }}>
                <MiniMonth month={month} onMonth={setMonth} selected={anchor} onSelect={pick} marks={marks} testId="calendar-month" />
              </Card>
              <Button variant="outlined" size="large" startIcon={<EventBusyRoundedIcon />} onClick={() => setOpen({ kind: "block", day: anchor })} data-testid="block-time">
                {T("Block out time")}
              </Button>
              {toAnswer.length > 0 && view !== "list" && (
                <Box>
                  <Heading title={T("Waiting for your answer")} count={toAnswer.length} />
                  <Stack sx={{ gap: 1 }}>
                    {toAnswer.slice(0, 4).map((m) => (
                      <MeetingRow key={m.id} m={m} onClick={() => setOpen({ kind: "meeting", m })} />
                    ))}
                  </Stack>
                </Box>
              )}
              <Card sx={{ p: 2 }}>
                <Legend />
              </Card>
            </Stack>

            <Box sx={{ minWidth: 0 }}>
              {view === "list" ? (
                <UpcomingList meetings={upcoming.data?.meetings ?? null} onOpen={(m) => setOpen({ kind: "meeting", m })} />
              ) : (
                <>
                  <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
                    <Button variant="outlined" size="small" onClick={() => pick(today())} startIcon={<EventAvailableRoundedIcon />}>
                      {T("Today")}
                    </Button>
                    <IconButton size="small" aria-label={view === "week" ? T("Previous week") : T("Previous day")} onClick={() => step(-1)}>
                      <ChevronLeftRoundedIcon />
                    </IconButton>
                    <IconButton size="small" aria-label={view === "week" ? T("Next week") : T("Next day")} onClick={() => step(1)}>
                      <ChevronRightRoundedIcon />
                    </IconButton>
                    <Typography noWrap sx={{ fontWeight: 600, fontSize: { xs: 15, lg: 17 }, flex: "1 1 110px", minWidth: 0 }} data-testid="calendar-range">
                      {label}
                    </Typography>
                    <Button size="small" sx={{ display: { xs: "inline-flex", lg: "none" } }} startIcon={<EventBusyRoundedIcon />} onClick={() => setOpen({ kind: "block", day: anchor })}>
                      {T("Block")}
                    </Button>
                  </Stack>
                  {view === "day" && (
                    <Box sx={{ mb: 1.5 }}>
                      <WeekStrip days={week} selected={anchor} onSelect={pick} busyDays={daysWith(meetings)} />
                    </Box>
                  )}
                  {view === "day" && toAnswer.length > 0 && (
                    <Box sx={{ display: { lg: "none" }, mb: 1.5 }}>
                      <MeetingRow m={toAnswer[0]} onClick={() => setOpen({ kind: "meeting", m: toAnswer[0] })} />
                    </Box>
                  )}
                  {data ? (
                    <TimeGrid
                      days={days}
                      meetings={meetings}
                      blocks={blocks}
                      onMeeting={(m) => setOpen({ kind: "meeting", m })}
                      onBlock={(b) => setOpen({ kind: "blocked", b })}
                      onSlot={(day, minutes) => setOpen({ kind: "new", draft: { day, minutes } })}
                    />
                  ) : (
                    !error && <Skeleton variant="rounded" height={480} />
                  )}
                </>
              )}
            </Box>
          </Box>
        </Page>
      </Box>

      {open?.kind === "new" && (
        <MeetingDialog
          draft={open.draft}
          onClose={() => setOpen(null)}
          onSaved={(m) => {
            setOpen(null);
            pick(sgDay(m.startsAt));
            void refresh();
          }}
        />
      )}
      {open?.kind === "edit" && (
        <MeetingDialog
          edit={open.m}
          onClose={() => setOpen({ kind: "meeting", m: open.m })}
          onSaved={(m) => {
            setOpen({ kind: "meeting", m });
            void refresh();
          }}
        />
      )}
      {open?.kind === "meeting" && (
        <MeetingDetails
          m={open.m}
          onClose={() => setOpen(null)}
          onEdit={() => setOpen({ kind: "edit", m: open.m })}
          onChanged={async () => {
            const fresh = await fetcher<Meeting>(`/meetings/${open.m.id}`).catch(() => null);
            setOpen(fresh && fresh.status !== "cancelled" ? { kind: "meeting", m: fresh } : null);
            await refresh();
          }}
        />
      )}
      {open?.kind === "block" && (
        <BlockDialog
          day={open.day}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            void refresh();
          }}
        />
      )}
      {open?.kind === "blocked" && (
        <BlockDetails
          b={open.b}
          onClose={() => setOpen(null)}
          onFreed={() => {
            setOpen(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

/** What's coming, a day at a time; invitations to answer first. */
function UpcomingList({ meetings, onOpen }: { meetings: Meeting[] | null; onOpen: (m: Meeting) => void }) {
  const { lang } = useLang();
  if (!meetings)
    return (
      <Stack sx={{ gap: 1 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={96} />
        ))}
      </Stack>
    );
  const ask = meetings.filter((m) => m.canRespond && m.myResponse === "pending");
  const rest = meetings.filter((m) => !ask.includes(m));
  const byDay = new Map<string, Meeting[]>();
  for (const m of rest) byDay.set(sgDay(m.startsAt), [...(byDay.get(sgDay(m.startsAt)) ?? []), m]);
  if (!meetings.length)
    return (
      <Card sx={{ p: 4, textAlign: "center" }} data-testid="calendar-empty">
        <EventAvailableRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
        <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nothing coming up")}</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
          {T("Meetings you arrange or are asked to show here.")}
        </Typography>
      </Card>
    );
  return (
    <Box data-testid="upcoming-list">
      {ask.length > 0 && (
        <>
          <Typography variant="body2" sx={{ color: "warning.main", fontWeight: 600, mt: 2, mb: 1 }}>
            {T("Waiting for your answer")} · {ask.length}
          </Typography>
          <Stack sx={{ gap: 1 }}>
            {ask.map((m) => (
              <MeetingRow key={m.id} m={m} onClick={() => onOpen(m)} />
            ))}
          </Stack>
        </>
      )}
      {byDay.size > 0 && <Heading title={T("Coming up")} count={rest.length} />}
      {/* An agenda, as in Google Calendar: the date on the left, that day's meetings beside it. */}
      <Stack sx={{ gap: 2 }}>
        {[...byDay.entries()].map(([d, ms]) => {
          const isToday = d === today();
          return (
            <Box key={d} sx={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr)", gap: 1.5, alignItems: "start" }} data-testid="agenda-day">
              <Stack sx={{ alignItems: "center", pt: 0.5 }} aria-label={dayText(d, lang, { weekday: "long", day: "numeric", month: "long" })}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", color: isToday ? "primary.main" : "text.secondary" }}>
                  {isToday ? T("Today") : dayText(d, lang, { weekday: "short" })}
                </Typography>
                <Box sx={(t) => ({ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 18, bgcolor: isToday ? (t.vars ?? t).palette.primary.main : "transparent", color: isToday ? (t.vars ?? t).palette.primary.contrastText : (t.vars ?? t).palette.text.primary })}>
                  {Number(d.slice(8))}
                </Box>
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 11 }}>
                  {dayText(d, lang, { month: "short" })}
                </Typography>
              </Stack>
              <Stack sx={{ gap: 1 }}>
                {ms.map((m) => (
                  <MeetingRow key={m.id} m={m} onClick={() => onOpen(m)} />
                ))}
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

