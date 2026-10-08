"use client";

import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MyLocationRoundedIcon from "@mui/icons-material/MyLocationRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { MapView, type Pin, useMyPosition } from "@/components/map";
import { useProjectHref } from "@/components/projects";
import { Page } from "@/components/shell";
import { CheckDialog } from "@/components/site-visits";
import { SegTabs, TopBar } from "@/components/topbar";
import { useApi } from "@/lib/client/api";
import { useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { T } from "@/lib/client/i18n";
import { awayText, distanceM } from "@/lib/client/location";
import { hhmm, type SiteRow, visitDay } from "@/lib/client/sites";
import { useTab } from "@/lib/client/tabs";

type Tab = "all" | "today" | "onsite";
const TABS: Array<[Tab, string]> = [
  ["all", "All"],
  ["today", "Due today"],
  ["onsite", "On site"],
];

/**
 * The EPC team's day, as a map: every site they can check in at, with the
 * one they're on or due at picked. Tap a pin (or swipe the cards) to choose
 * a site, then Check In; the phone's GPS must put them at the house.
 */
export default function SitesPage() {
  const me = useMe();
  const href = useProjectHref();
  const { data, error, reload } = useApi<{ sites: SiteRow[]; canCheckIn: boolean }>(me ? "/sites" : null);
  const [tab, setTab] = useTab<Tab>(["all", "today", "onsite"], "all");
  const [picked, setPicked] = useState<number | null>(null);
  const [target, setTarget] = useState<SiteRow | null>(null);
  const where = useMyPosition();

  const all = useMemo(() => data?.sites ?? [], [data]);
  const count = (t: Tab) => all.filter((s) => t === "all" || (t === "today" ? !s.open && s.today.length > 0 : Boolean(s.open))).length;
  const shown = useMemo(
    () =>
      all
        .filter((s) => tab === "all" || (tab === "today" ? !s.open && s.today.length > 0 : Boolean(s.open)))
        // Where you are now, then today's, then the rest.
        .sort((a, b) => Number(Boolean(b.open)) - Number(Boolean(a.open)) || b.today.length - a.today.length),
    [all, tab]
  );
  const current = shown.find((s) => s.id === picked) ?? shown[0] ?? null;

  const pins: Pin[] = useMemo(
    () => shown.filter((s) => s.site).map((s) => ({ id: String(s.id), lat: s.site!.lat, lng: s.site!.lng, kind: "site", label: s.name, dim: !s.canCheckIn && !s.open })),
    [shown]
  );

  if (!me) return null;

  return (
    <>
      <TopBar
        title={T("Sites")}
        sub={T("Tap a site on the map, then check in")}
        tabs={<SegTabs label={T("Filter sites")} value={tab} onChange={setTab} options={TABS.map(([v, l]) => ({ value: v, label: l, count: data ? count(v) : undefined }))} />}
      />
      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && <Skeleton variant="rounded" sx={{ mt: 1, height: { xs: "52vh", lg: "60vh" }, borderRadius: `${DESIGN.radius.card}px` }} />}
          {data && all.length === 0 && (
            <Card sx={{ p: 4, mt: 2, textAlign: "center" }} data-testid="sites-empty">
              <PlaceRoundedIcon sx={{ fontSize: 42, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("No sites to check in at yet")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {T("Projects appear here once they're approved and your contractor group is on them.")}
              </Typography>
            </Card>
          )}
          {data && all.length > 0 && (
            <Box sx={{ mt: 1, position: "relative" }}>
              <Box sx={{ position: "relative" }}>
                <MapView pins={pins} picked={current ? String(current.id) : null} onPick={(id) => setPicked(Number(id))} me={where.pos} height={{ xs: "52vh", lg: "60vh" }} testId="sites-map" />
                <Button
                  size="small"
                  variant="contained"
                  color="inherit"
                  startIcon={<MyLocationRoundedIcon />}
                  disabled={where.busy}
                  onClick={() => void where.locate()}
                  data-testid="locate-me"
                  sx={{ position: "absolute", left: 12, top: 12, zIndex: 500, bgcolor: "background.paper", color: "text.primary", boxShadow: 3, "&:hover": { bgcolor: "background.paper" } }}
                >
                  {where.busy ? T("Finding you…") : where.pos ? T("Update my location") : T("Show my location")}
                </Button>
              </Box>
              {where.problem && (
                <Alert severity="warning" sx={{ mt: 1 }} data-testid="locate-problem">
                  {where.problem}
                </Alert>
              )}
              {shown.length === 0 ? (
                <Card sx={{ p: 3, mt: 1.5, textAlign: "center", color: "text.secondary" }}>{T("Nothing here right now.")}</Card>
              ) : (
                <SiteCards
                  sites={shown}
                  current={current}
                  onPick={(s) => setPicked(s.id)}
                  canCheckIn={data.canCheckIn}
                  me={where.pos}
                  href={href}
                  onCheck={setTarget}
                />
              )}
              <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 2 }}>
                {T("Check in on arrival and out when you leave, at the house with a good GPS signal. You can check in any day, not just scheduled ones.")}
              </Typography>
            </Box>
          )}
        </Page>
      </Box>
      {target && (
        <CheckDialog
          target={{ projectId: target.id, name: target.name, address: target.address, open: target.open, site: target.site }}
          onClose={() => setTarget(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

/**
 * The sites as cards, one at a time, floating over the bottom of the map:
 * swipe (or use the arrows) and the map follows; tap a pin and the cards do.
 */
function SiteCards({
  sites,
  current,
  onPick,
  canCheckIn,
  me,
  href,
  onCheck,
}: {
  sites: SiteRow[];
  current: SiteRow | null;
  onPick: (s: SiteRow) => void;
  canCheckIn: boolean;
  me: { lat: number; lng: number } | null;
  href: (id: number) => string;
  onCheck: (s: SiteRow) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const settling = useRef<number | null>(null);
  const index = Math.max(0, sites.findIndex((s) => s.id === current?.id));

  // A pin was tapped: bring its card into view.
  useEffect(() => {
    const el = track.current?.children[index] as HTMLElement | undefined;
    if (!el || !track.current) return;
    const left = el.offsetLeft - (track.current.clientWidth - el.clientWidth) / 2;
    if (Math.abs(track.current.scrollLeft - left) > 4) track.current.scrollTo({ left, behavior: "smooth" });
  }, [index]);

  // A swipe ended: the card in the middle is the picked site.
  const onScroll = () => {
    if (settling.current) window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => {
      const t = track.current;
      if (!t) return;
      const mid = t.scrollLeft + t.clientWidth / 2;
      let best = 0;
      let bestD = Infinity;
      [...t.children].forEach((c, i) => {
        const el = c as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - mid);
        if (d < bestD) [best, bestD] = [i, d];
      });
      if (sites[best] && sites[best].id !== current?.id) onPick(sites[best]);
    }, 120);
  };

  const go = (d: number) => {
    const s = sites[(index + d + sites.length) % sites.length];
    if (s) onPick(s);
  };

  return (
    <Box sx={{ position: "relative", zIndex: 1, mt: { xs: -9, lg: -10 } }}>
      <Box
        ref={track}
        onScroll={onScroll}
        data-testid="site-cards"
        sx={{
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          px: { xs: "7%", sm: "calc(50% - 190px)" },
          pb: 1,
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {sites.map((s) => (
          <SiteCard key={s.id} s={s} on={s.id === current?.id} canCheckIn={canCheckIn} me={me} href={href(s.id)} onCheck={() => onCheck(s)} onTap={() => onPick(s)} />
        ))}
      </Box>
      {sites.length > 1 && (
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "center", gap: 1, mt: 0.5 }}>
          <IconButton size="small" aria-label={T("Previous site")} onClick={() => go(-1)}>
            <ChevronLeftRoundedIcon />
          </IconButton>
          <Stack direction="row" sx={{ gap: 0.75 }} aria-hidden>
            {sites.map((s) => (
              <Box key={s.id} sx={{ width: s.id === current?.id ? 18 : 7, height: 7, borderRadius: 4, bgcolor: s.id === current?.id ? "primary.main" : "divider", transition: "width 150ms" }} />
            ))}
          </Stack>
          <IconButton size="small" aria-label={T("Next site")} onClick={() => go(1)}>
            <ChevronRightRoundedIcon />
          </IconButton>
        </Stack>
      )}
    </Box>
  );
}

function SiteCard({
  s,
  on,
  canCheckIn,
  me,
  href,
  onCheck,
  onTap,
}: {
  s: SiteRow;
  on: boolean;
  canCheckIn: boolean;
  me: { lat: number; lng: number } | null;
  href: string;
  onCheck: () => void;
  onTap: () => void;
}) {
  const away = me && s.site ? awayText(distanceM(me, s.site), s.radius) : null;
  const tag = s.open ? { label: T("On site"), color: "success" as const } : s.today.length ? { label: T("Due today"), color: "warning" as const } : null;
  const chips: string[] = [];
  if (s.open) chips.push(T("Checked in {time} with {n} crew", { time: hhmm(s.open.inAt), n: s.open.crewIn }));
  for (const v of s.today) chips.push(v.time ? T("Starts at {time}", { time: v.time }) : T("Today"));
  if (!s.today.length && !s.open && s.next) chips.push(s.next.time ? T("Next visit {day} at {time}", { day: visitDay(s.next.date), time: s.next.time }) : T("Next visit {day}", { day: visitDay(s.next.date) }));
  const note = s.today.find((v) => v.note)?.note ?? (!s.today.length ? s.next?.note : null);
  return (
    <Card
      data-testid="site-card"
      data-on={on || undefined}
      onClick={onTap}
      sx={{
        flex: { xs: "0 0 86%", sm: "0 0 380px" },
        scrollSnapAlign: "center",
        p: 2,
        cursor: "pointer",
        boxShadow: on ? 8 : 2,
        borderColor: on ? "primary.main" : "divider",
        transform: on ? "none" : "scale(0.97)",
        transition: "transform 150ms, box-shadow 150ms",
      }}
    >
      <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: 17 }}>
            {s.name}
          </Typography>
          <Typography variant="body2" noWrap sx={{ color: "text.secondary", fontSize: 12.5 }}>
            {s.address}
          </Typography>
        </Box>
        {tag && <Chip size="small" color={tag.color} label={tag.label} />}
      </Stack>
      <Divider sx={{ my: 1.25 }} />
      {note && (
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }} noWrap>
          {note}
        </Typography>
      )}
      <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "text.secondary", minHeight: 20 }}>
        <PlaceRoundedIcon sx={{ fontSize: 16 }} />
        <Typography variant="caption" data-testid="site-distance">
          {!s.located ? T("No GPS location for this site yet, so check-in is off.") : (away ?? T("Postal code {code}", { code: s.postalCode ?? "—" }))}
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ gap: 0.75, mt: 1, flexWrap: "wrap", minHeight: 24 }}>
        {chips.map((c) => (
          <Chip key={c} size="small" icon={<EventRoundedIcon />} label={c} color="primary" variant={s.open ? "filled" : "outlined"} />
        ))}
      </Stack>
      <Stack direction="row" sx={{ gap: 1, mt: 1.5 }}>
        {canCheckIn && (
          <Button
            fullWidth
            size="large"
            variant="contained"
            color={s.open ? "warning" : "primary"}
            disabled={!s.canCheckIn && !s.open}
            startIcon={s.open ? <LogoutRoundedIcon /> : <LoginRoundedIcon />}
            onClick={(e) => {
              e.stopPropagation();
              onCheck();
            }}
            sx={{ whiteSpace: "nowrap", minWidth: 0 }}
          >
            {s.open ? T("Check Out") : T("Check In")}
          </Button>
        )}
        <Button
          size="large"
          variant="outlined"
          component={Link}
          href={href}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          aria-label={T("Open project")}
          sx={{ flex: canCheckIn ? "0 0 52px" : 1, minWidth: 52, px: canCheckIn ? 0 : 2 }}
        >
          {canCheckIn ? <OpenInNewRoundedIcon /> : T("Open project")}
        </Button>
      </Stack>
    </Card>
  );
}
