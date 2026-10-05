"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HowToRegRoundedIcon from "@mui/icons-material/HowToRegRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha, type Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { MDialog, RoleAvatar, RoleChip, WaveHeader } from "@/components/m";
import { Page } from "@/components/shell";
import { EdgeCard, GRID, Heading, SearchBox, SegTabs, TopBar, roleColor } from "@/components/topbar";
import { ago, dt2s } from "@/components/ui";
import {
  type AuditChange,
  type AuditEntry,
  type AuditLocation,
  type AuditLog,
  type AuditPerson,
  type Page as AuditPage,
  canRevert,
  dayMonth,
  dayName,
  fieldLabel,
  formatValue,
  groupSessions,
  groupTimeline,
  matchesEntry,
  PAGE_LABEL,
  PAGES,
  type PlaceCard,
  type Refs,
  revertVerb,
  timeOf,
} from "@/lib/client/audit";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { ROLE_COLOR } from "@/lib/client/mui-theme";

type View = "timeline" | "people";
type Filter = AuditPage | "all";
type Confirm = { entry: AuditEntry; fields: string[] };

const NO_REFS: Refs = { users: {}, groups: {}, retailers: {} };
const NEUTRAL = "#7A847F";

const tone = (role: Role | null) => (t: Theme) =>
  role ? (t.palette.mode === "dark" ? ROLE_COLOR[role].dark : ROLE_COLOR[role].light) : NEUTRAL;

/** Merges a page of older entries onto what is already shown. */
function mergeRefs(a: Refs, b: Refs): Refs {
  return { users: { ...a.users, ...b.users }, groups: { ...a.groups, ...b.groups }, retailers: { ...a.retailers, ...b.retailers } };
}

export default function AuditPage() {
  const me = useMe();
  const router = useRouter();
  const pm = me?.role === "project_manager";
  const [view, setView] = useState<View>("timeline");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  // Bumped after a revert so every open list reloads.
  const [version, setVersion] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [person, setPerson] = useState<AuditPerson | null>(null);

  useEffect(() => {
    if (me && !pm) router.replace("/");
  }, [me, pm, router]);

  const logPath = pm && view === "timeline" ? `/audit?v=${version}${filter !== "all" ? `&page=${filter}` : ""}` : null;
  const { data: log, error: logError } = useApi<AuditLog>(logPath);
  const { data: people, error: peopleError } = useApi<AuditPerson[]>(pm ? `/audit/people?v=${version}` : null);

  // "Load older" pages, kept only for the filter they were loaded under.
  const [older, setOlder] = useState<{ key: string; log: AuditLog } | null>(null);
  const olderLog = older && older.key === logPath ? older.log : null;

  if (!me || !pm) return null;

  const counts = log?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const timelineTabs = [
    { value: "all" as Filter, label: "All", count: total },
    ...PAGES.map(([v, l]) => ({ value: v as Filter, label: l, count: counts?.[v] })),
  ];
  const peopleTabs = [
    { value: "all" as Filter, label: "All", count: people?.length },
    ...PAGES.map(([v, l]) => ({ value: v as Filter, label: l, count: people?.filter((p) => p.pages.includes(v)).length })),
  ];

  return (
    <>
      <TopBar
        title="Audit Log"
        action={<ViewSwitch value={view} onChange={setView} />}
        search={
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder={view === "timeline" ? "Search changes, people, places" : "Search people"}
            testId="audit-search"
          />
        }
        tabs={<SegTabs label="Filter by page" value={filter} onChange={setFilter} options={view === "timeline" ? timelineTabs : peopleTabs} />}
      />

      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {view === "timeline" ? (
            <Timeline
              log={log}
              older={olderLog}
              error={logError}
              q={q}
              filter={filter}
              onOlder={(more) => setOlder({ key: logPath ?? "", log: olderLog ? { ...more, entries: [...olderLog.entries, ...more.entries], refs: mergeRefs(olderLog.refs, more.refs) } : more })}
              onRevert={(entry, fields) => setConfirm({ entry, fields })}
            />
          ) : (
            <PeopleView people={people} error={peopleError} q={q} filter={filter} onOpen={setPerson} />
          )}
          <Typography variant="caption" component="p" sx={{ textAlign: "center", color: "text.secondary", mt: 3 }}>
            Entries can never be edited or deleted. A revert is a new change that points back at the one it undoes.
          </Typography>
        </Page>
      </Box>

      {person && (
        <PersonDialog person={person} version={version} onClose={() => setPerson(null)} onRevert={(entry, fields) => setConfirm({ entry, fields })} />
      )}
      {confirm && (
        <RevertDialog
          {...confirm}
          refs={mergeRefs(log?.refs ?? NO_REFS, olderLog?.refs ?? NO_REFS)}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            setOlder(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------ header

function ViewSwitch({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: Array<[View, string, ReactNode]> = [
    ["timeline", "Timeline", <TimelineRoundedIcon key="t" sx={{ fontSize: 18 }} />],
    ["people", "By person", <GroupsRoundedIcon key="p" sx={{ fontSize: 18 }} />],
  ];
  return (
    <Stack direction="row" role="tablist" aria-label="View" sx={{ p: "3px", gap: "3px", borderRadius: "11px", bgcolor: "rgba(0,0,0,0.2)" }}>
      {opts.map(([v, label, icon]) => {
        const on = v === value;
        return (
          <ButtonBase
            key={v}
            role="tab"
            aria-selected={on}
            aria-label={label}
            onClick={() => onChange(v)}
            sx={{
              height: 30,
              px: { xs: 1, sm: 1.25 },
              gap: 0.75,
              borderRadius: "8px",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              color: on ? "#073f2b" : "rgba(255,255,255,0.85)",
              bgcolor: on ? "#fff" : "transparent",
            }}
          >
            {icon}
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {label}
            </Box>
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

// ------------------------------------------------------------ timeline

/** Rail widths: the date column, then the line with its dots. */
const RAIL = { xs: 46, lg: 92 } as const;
const DOTCOL = { xs: 18, lg: 28 } as const;

function Timeline({
  log,
  older,
  error,
  q,
  filter,
  onOlder,
  onRevert,
}: {
  log: AuditLog | null;
  older: AuditLog | null;
  error: ApiError | null;
  q: string;
  filter: Filter;
  onOlder: (more: AuditLog) => void;
  onRevert: (entry: AuditEntry, fields: string[]) => void;
}) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [loadingMore, setLoadingMore] = useState(false);

  const refs = useMemo(() => mergeRefs(log?.refs ?? NO_REFS, older?.refs ?? NO_REFS), [log, older]);
  const all = useMemo(() => [...(log?.entries ?? []), ...(older?.entries ?? [])], [log, older]);
  const shown = useMemo(() => all.filter((e) => matchesEntry(e, q, refs)), [all, q, refs]);
  const days = useMemo(() => groupTimeline(shown), [shown]);
  const nextBefore = older ? older.nextBefore : log?.nextBefore;

  if (error) return <Alert severity="error" sx={{ mt: 2 }}>{error.message}</Alert>;
  if (!log) return <TimelineSkeleton />;

  return (
    <Box sx={{ position: "relative", mt: 2 }} data-testid="audit-timeline">
      {/* The line every day hangs from. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: 10,
          bottom: 0,
          left: { xs: RAIL.xs + DOTCOL.xs / 2, lg: RAIL.lg + DOTCOL.lg / 2 },
          width: "1px",
          bgcolor: "divider",
        }}
      />
      <RailRow
        rail={
          <Typography sx={{ color: "primary.main", fontWeight: 600, fontSize: { xs: 13, lg: 15 } }}>Now</Typography>
        }
        dot={<Dot live />}
      >
        <Typography sx={{ color: "text.secondary", fontSize: 14, pt: { lg: 0.25 } }}>
          {shown.length === all.length
            ? `${all.length} change${all.length === 1 ? "" : "s"}${filter !== "all" ? ` on ${PAGE_LABEL[filter]}` : ""}, newest first`
            : `${shown.length} of ${all.length} changes match`}
        </Typography>
      </RailRow>

      {days.length === 0 && (
        <RailRow rail={null} dot={null}>
          <Card sx={{ p: 4, textAlign: "center" }}>
            <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
            <Typography sx={{ fontWeight: 600, mt: 1 }}>{all.length ? "Nothing matches" : "No changes yet"}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
              {all.length ? "Try a name, a place, a page or a field — e.g. “priya panel”." : "Everything anyone changes will appear here."}
            </Typography>
          </Card>
        </RailRow>
      )}

      {days.map((d) => {
        const { day, month } = dayMonth(d.key);
        const name = dayName(d.key);
        return (
          <RailRow
            key={d.key}
            rail={
              <>
                <Typography sx={{ fontWeight: 600, fontSize: { xs: 22, lg: 32 }, lineHeight: 1 }}>{day}</Typography>
                <Typography sx={{ fontSize: { xs: 11, lg: 14 }, mt: 0.5, fontWeight: name === "Today" ? 600 : 500, color: name === "Today" ? "primary.main" : "text.secondary" }}>
                  {name === "Today" || name === "Yesterday" ? name : `${name}, ${month}`}
                </Typography>
              </>
            }
            dot={<Dot />}
          >
            <Stack sx={{ gap: { xs: 1.5, lg: 2 } }}>
              {d.cards.map((c) => (
                <PlaceCardView key={c.location.key} card={c} refs={refs} onRevert={onRevert} />
              ))}
            </Stack>
          </RailRow>
        );
      })}

      {nextBefore && (
        <RailRow rail={null} dot={<Dot />}>
          <Button
            variant="outlined"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              try {
                const sep = filter !== "all" ? `&page=${filter}` : "";
                onOlder(await fetcher<AuditLog>(`/audit?before=${nextBefore}${sep}`));
              } catch (err) {
                toast(err instanceof ApiError ? err.message : "Couldn't load older changes.", "bad");
              } finally {
                setLoadingMore(false);
              }
            }}
          >
            {loadingMore ? "Loading…" : "Load older changes"}
          </Button>
        </RailRow>
      )}
    </Box>
  );
}

function RailRow({ rail, dot, children }: { rail: ReactNode; dot: ReactNode; children: ReactNode }) {
  return (
    <Box
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: { xs: `${RAIL.xs}px ${DOTCOL.xs}px minmax(0, 1fr)`, lg: `${RAIL.lg}px ${DOTCOL.lg}px minmax(0, 1fr)` },
        pb: { xs: 3, lg: 4 },
      }}
    >
      <Box sx={{ textAlign: "right", pr: { xs: 0.75, lg: 1.5 }, pt: 0.25 }}>{rail}</Box>
      <Box sx={{ display: "flex", justifyContent: "center", pt: { xs: 0.9, lg: 1.25 } }}>{dot}</Box>
      <Box sx={{ minWidth: 0, pl: { xs: 0.5, lg: 1 } }}>{children}</Box>
    </Box>
  );
}

function Dot({ live }: { live?: boolean }) {
  return (
    <Box
      sx={(t) => ({
        width: 9,
        height: 9,
        borderRadius: "50%",
        position: "relative",
        zIndex: 1,
        bgcolor: live ? "primary.main" : "background.default",
        border: `2px solid ${live ? t.palette.primary.main : t.palette.divider}`,
        boxShadow: live ? `0 0 0 4px ${alpha(t.palette.primary.main, 0.18)}` : `0 0 0 3px ${t.palette.background.default}`,
        ...(!live && { borderColor: "text.disabled" }),
      })}
    />
  );
}

function TimelineSkeleton() {
  return (
    <Stack sx={{ gap: 2, mt: 3, pl: { xs: `${RAIL.xs + DOTCOL.xs}px`, lg: `${RAIL.lg + DOTCOL.lg}px` } }}>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={190} sx={{ borderRadius: "20px" }} />
      ))}
    </Stack>
  );
}

const KIND_ICON: Record<AuditLocation["kind"], ReactNode> = {
  project: <SolarPowerRoundedIcon />,
  person: <PersonRoundedIcon />,
  request: <HowToRegRoundedIcon />,
  group: <GroupsRoundedIcon />,
  retailer: <BoltRoundedIcon />,
  other: <DescriptionOutlinedIcon />,
};

/**
 * Everything that happened in one place on one day. A tinted shell with the
 * place and who changed it; inside, a white card listing each change in the
 * style of a version history. Open it to see every change line by line.
 */
function PlaceCardView({ card, refs, onRevert }: { card: PlaceCard; refs: Refs; onRevert: (e: AuditEntry, fields: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const shared = card.people.length > 1;
  const FIRST = 3;
  const rows = open ? card.entries : card.entries.slice(0, FIRST);

  return (
    <Box
      data-testid="audit-card"
      data-shared={shared || undefined}
      sx={(t) => ({
        borderRadius: "20px",
        p: { xs: 0.75, lg: 1 },
        bgcolor: alpha(t.palette.text.primary, 0.045),
        border: 1,
        borderColor: shared ? alpha(t.palette.warning.main, 0.55) : "transparent",
      })}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, px: { xs: 1, lg: 1.25 }, pt: 0.75, pb: 1.25 }}>
        <Box
          sx={(t) => ({
            width: 38,
            height: 38,
            flex: "0 0 auto",
            borderRadius: "11px",
            display: "grid",
            placeItems: "center",
            bgcolor: alpha(t.palette.primary.main, 0.12),
            color: "primary.main",
            "& svg": { fontSize: 20 },
          })}
        >
          {KIND_ICON[card.location.kind]}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: { xs: 15, lg: 16 } }}>
            {card.location.label}
          </Typography>
          <Typography noWrap variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {card.pages.map((p) => PAGE_LABEL[p]).join(" · ")} · {card.entries.length} change{card.entries.length === 1 ? "" : "s"}
          </Typography>
        </Box>
        <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 32, height: 32, fontSize: 11.5, borderColor: "background.paper" } }}>
          {card.people.map((p) => (
            <PersonAvatar key={p.key} name={p.name} role={p.role} size={32} />
          ))}
        </AvatarGroup>
      </Stack>

      {/* More than one person changed this place: say so, and let the PM pick one out. */}
      {shared && (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, px: { xs: 1, lg: 1.25 }, pb: 1.25, alignItems: "center" }}>
          <Chip
            size="small"
            icon={<GroupsRoundedIcon />}
            label={`${card.people.length} people changed this`}
            sx={(t) => ({ bgcolor: alpha(t.palette.warning.main, 0.16), color: "warning.main", "& .MuiChip-icon": { color: "inherit" } })}
          />
          {card.people.map((p) => {
            const on = focus === p.key;
            return (
              <Chip
                key={p.key}
                size="small"
                variant={on ? "filled" : "outlined"}
                avatar={<PersonAvatar name={p.name} role={p.role} size={20} />}
                label={`${p.name.split(" ")[0]} · ${p.count}`}
                onClick={() => setFocus(on ? null : p.key)}
                aria-pressed={on}
                sx={(t) => ({ borderColor: tone(p.role)(t), ...(on && { bgcolor: alpha(tone(p.role)(t), 0.16), color: tone(p.role)(t) }) })}
              />
            );
          })}
        </Stack>
      )}

      <Card sx={{ borderRadius: "16px", border: 0, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}>
        {rows.map((e, i) => (
          <Box key={e.id}>
            {i > 0 && <Divider />}
            <EntryRow
              entry={e}
              refs={refs}
              expanded={open}
              dim={focus !== null && contributorKeyOf(e) !== focus}
              latest={i === 0}
              onToggle={() => setOpen((o) => !o)}
              onRevert={onRevert}
            />
          </Box>
        ))}
        <Divider />
        <ButtonBase
          onClick={() => setOpen((o) => !o)}
          sx={{ width: "100%", py: 1.1, gap: 0.5, fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "primary.main" }}
        >
          {open ? "Close" : card.entries.length > FIRST ? `Open all ${card.entries.length} changes` : "Open to see every change"}
          <ExpandMoreRoundedIcon sx={{ fontSize: 18, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </ButtonBase>
      </Card>
    </Box>
  );
}

function contributorKeyOf(e: AuditEntry): string {
  return e.actor ? (e.actor.uid !== null ? `u${e.actor.uid}` : `n${e.actor.name}`) : "system";
}

/** One change, as a version-history row; opened, it lists every field before and after. */
function EntryRow({
  entry: e,
  refs,
  expanded,
  dim,
  latest,
  onToggle,
  onRevert,
}: {
  entry: AuditEntry;
  refs: Refs;
  expanded: boolean;
  dim: boolean;
  latest: boolean;
  onToggle: () => void;
  onRevert: (e: AuditEntry, fields: string[]) => void;
}) {
  const role = e.actor?.role ?? null;
  const current = e.changes.filter((c) => c.state === "current");
  return (
    <Box sx={{ opacity: dim ? 0.35 : 1, transition: "opacity .2s" }} data-testid="audit-entry">
      <ButtonBase onClick={onToggle} sx={{ width: "100%", textAlign: "left", fontFamily: "inherit", alignItems: "flex-start", gap: 1.25, px: { xs: 1.5, lg: 2 }, py: 1.4 }}>
        <Box sx={(t) => ({ width: 8, height: 8, mt: 0.85, flex: "0 0 auto", borderRadius: "50%", bgcolor: tone(role)(t) })} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{e.summary}</Typography>
            {e.revertsId && <Chip size="small" icon={<UndoRoundedIcon />} label={`Undoes #${e.revertsId}`} color="warning" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
            {latest && !expanded && <Typography variant="caption" sx={{ color: "text.secondary" }}>latest</Typography>}
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13, mt: 0.15 }}>
            <Box component="span" sx={(t) => ({ color: tone(role)(t), fontWeight: 600 })}>
              {e.actor?.name ?? "Outside the app"}
            </Box>
            {" · "}
            {timeOf(e.at)}
            {e.changes.length > 0 && ` · ${e.changes.length} field${e.changes.length === 1 ? "" : "s"}`}
          </Typography>
          {!expanded && e.changes.length > 0 && (
            <Typography variant="caption" noWrap component="div" sx={{ color: "text.secondary", mt: 0.25 }}>
              {e.changes.slice(0, 3).map((c) => fieldLabel(c.field)).join(", ")}
              {e.changes.length > 3 ? "…" : ""}
            </Typography>
          )}
        </Box>
        <Typography variant="caption" sx={{ color: "text.disabled", flex: "0 0 auto", mt: 0.25 }}>
          #{e.id}
        </Typography>
      </ButtonBase>

      <Collapse in={expanded} unmountOnExit>
        <Stack sx={{ gap: 0.75, px: { xs: 1.5, lg: 2 }, pb: 1.75, pl: { xs: 3.25, lg: 4 } }}>
          {e.changes.map((c) => (
            <ChangeLine key={c.field} change={c} action={e.action} refs={refs} onRevert={e.linkState ? undefined : () => onRevert(e, [c.field])} />
          ))}
          <EntryFooter entry={e} current={current} onRevert={onRevert} />
        </Stack>
      </Collapse>
    </Box>
  );
}

function EntryFooter({ entry: e, current, onRevert }: { entry: AuditEntry; current: AuditChange[]; onRevert: (e: AuditEntry, fields: string[]) => void }) {
  if (e.lockedReason) {
    return (
      <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "text.secondary", mt: 0.5 }}>
        <LockOutlinedIcon sx={{ fontSize: 15 }} />
        <Typography variant="caption">{e.lockedReason}</Typography>
      </Stack>
    );
  }
  if (e.linkState) {
    return e.linkState === "current" ? (
      <Box sx={{ mt: 0.5 }}>
        <Button size="small" variant="outlined" color="warning" startIcon={<UndoRoundedIcon />} onClick={() => onRevert(e, [])}>
          {revertVerb(e)}
        </Button>
      </Box>
    ) : (
      <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5 }}>
        {e.linkState === "reverted" ? "Already undone." : "Changed again since — undo the later change instead."}
      </Typography>
    );
  }
  if (current.length > 1) {
    return (
      <Box sx={{ mt: 0.5 }}>
        <Button size="small" variant="outlined" color="warning" startIcon={<UndoRoundedIcon />} onClick={() => onRevert(e, current.map((c) => c.field))}>
          Revert all {current.length}
        </Button>
      </Box>
    );
  }
  return null;
}

const STATE_COLOR = (state: AuditChange["state"]) => (t: Theme) =>
  state === "current" ? t.palette.primary.main : state === "reverted" ? t.palette.warning.main : t.palette.text.disabled;

/** One field, before and after, with its own revert. */
function ChangeLine({
  change: c,
  action,
  refs,
  onRevert,
  dense,
}: {
  change: AuditChange;
  action: AuditEntry["action"];
  refs: Refs;
  onRevert?: () => void;
  dense?: boolean;
}) {
  const from = formatValue(c.field, c.from, refs);
  const to = formatValue(c.field, c.to, refs);
  return (
    <Box
      data-testid="audit-line"
      data-state={c.state}
      sx={(t) => ({
        display: "flex",
        alignItems: "center",
        gap: 1,
        py: dense ? 0.6 : 0.85,
        pl: 1.25,
        pr: 0.75,
        borderLeft: `3px solid ${STATE_COLOR(c.state)(t)}`,
        borderRadius: "0 10px 10px 0",
        bgcolor: alpha(t.palette.text.primary, 0.035),
      })}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500, display: "block", lineHeight: 1.4 }}>
          {fieldLabel(c.field)}
        </Typography>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap", fontSize: dense ? 13 : 14, lineHeight: 1.45 }}>
          {action !== "insert" && (
            <Box component="span" sx={{ color: action === "delete" ? "error.main" : "text.secondary", textDecoration: action === "update" ? "line-through" : "none", overflowWrap: "anywhere" }}>
              {from}
            </Box>
          )}
          {action === "update" && <ArrowForwardRoundedIcon sx={{ fontSize: 14, color: "text.disabled" }} />}
          {action !== "delete" && (
            <Box component="span" sx={{ color: c.state === "current" ? "primary.main" : "text.primary", fontWeight: 600, overflowWrap: "anywhere" }}>
              {to}
            </Box>
          )}
        </Stack>
        {c.note && c.state !== "locked" && (
          <Typography variant="caption" sx={{ color: c.state === "reverted" ? "warning.main" : "text.secondary", display: "block" }}>
            {c.note}
          </Typography>
        )}
      </Box>
      {c.state === "current" && action === "update" && onRevert && (
        // Icon only on phones, so the values keep the width.
        <Button
          size="small"
          color="warning"
          aria-label={`Revert ${fieldLabel(c.field)}`}
          onClick={onRevert}
          sx={{ flex: "0 0 auto", minWidth: 36, px: { xs: 0.75, sm: 1 }, gap: 0.5 }}
        >
          <UndoRoundedIcon sx={{ fontSize: 17 }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            Revert
          </Box>
        </Button>
      )}
      {c.state === "reverted" && <Chip size="small" label="Reverted" variant="outlined" color="warning" sx={{ height: 22, fontSize: 10.5 }} />}
      {c.state === "locked" && action === "update" && (
        <Box title={c.note ?? undefined} sx={{ display: "grid", color: "text.disabled", pr: 0.5 }}>
          <LockOutlinedIcon sx={{ fontSize: 16 }} />
        </Box>
      )}
    </Box>
  );
}

function PersonAvatar({ name, role, size }: { name: string; role: Role | null; size: number }) {
  if (role) return <RoleAvatar name={name} role={role} size={size} />;
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: alpha(NEUTRAL, 0.16), color: NEUTRAL }}>
      <TerminalRoundedIcon sx={{ fontSize: size * 0.55 }} />
    </Avatar>
  );
}

// ------------------------------------------------------------ by person

function PeopleView({
  people,
  error,
  q,
  filter,
  onOpen,
}: {
  people: AuditPerson[] | null;
  error: ApiError | null;
  q: string;
  filter: Filter;
  onOpen: (p: AuditPerson) => void;
}) {
  if (error) return <Alert severity="error" sx={{ mt: 2 }}>{error.message}</Alert>;
  if (!people)
    return (
      <Box sx={{ ...GRID, mt: 3 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={128} sx={{ borderRadius: "18px" }} />
        ))}
      </Box>
    );
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = people.filter(
    (p) =>
      (filter === "all" || p.pages.includes(filter)) &&
      words.every((w) => [p.name, p.email ?? "", p.roleLabel].join(" ").toLowerCase().includes(w))
  );
  return (
    <>
      <Heading title={filter === "all" ? "Everyone who changed something" : `Changed ${PAGE_LABEL[filter]}`} count={shown.length} />
      {shown.length === 0 ? (
        <Card sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>Nobody matches.</Card>
      ) : (
        <Box sx={GRID} data-testid="audit-people">
          {shown.map((p) => (
            <PersonAuditCard key={p.uid ?? "system"} p={p} onOpen={() => onOpen(p)} />
          ))}
        </Box>
      )}
    </>
  );
}

function PersonAuditCard({ p, onOpen }: { p: AuditPerson; onOpen: () => void }) {
  return (
    <EdgeCard color={p.role ? roleColor(p.role) : () => NEUTRAL} dim={p.active === false}>
      <CardActionArea onClick={onOpen} data-testid="audit-person" sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        <Box sx={{ p: 1.5, pl: 2.25, flex: 1 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Last change {ago(p.lastAt)}
              </Typography>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5, mt: 0.25 }}>
                {p.name}
              </Typography>
              <Stack direction="row" sx={{ gap: 2, mt: 0.5, color: "text.secondary" }}>
                <Stat icon={<EditRoundedIcon />} text={`${p.changes} change${p.changes === 1 ? "" : "s"}`} />
                <Stat icon={<PlaceRoundedIcon />} text={`${p.places} place${p.places === 1 ? "" : "s"}`} />
                {p.reverts > 0 && <Stat icon={<UndoRoundedIcon />} text={`${p.reverts} revert${p.reverts === 1 ? "" : "s"}`} />}
              </Stack>
            </Box>
            <PersonAvatar name={p.name} role={p.role} size={42} />
          </Stack>
        </Box>
        <Divider />
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, px: 1.5, pl: 2.25, py: 1, overflow: "hidden" }}>
          {p.role ? <RoleChip role={p.role} /> : <Chip size="small" label={p.roleLabel} />}
          <Typography variant="caption" noWrap sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
            {p.pages.map((x) => PAGE_LABEL[x]).join(" · ")}
          </Typography>
        </Stack>
      </CardActionArea>
    </EdgeCard>
  );
}

function Stat({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Stack direction="row" sx={{ gap: 0.5, alignItems: "center", "& svg": { fontSize: 15 } }}>
      {icon}
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}

const ACTION_STYLE = (e: AuditEntry) => {
  if (e.revertsId) return { icon: <UndoRoundedIcon />, color: (t: Theme) => t.palette.warning.main };
  if (e.table === "site_check_ins") return { icon: <PlaceRoundedIcon />, color: (t: Theme) => t.palette.info.main };
  if (e.action === "insert") return { icon: <AddRoundedIcon />, color: (t: Theme) => t.palette.primary.main };
  if (e.action === "delete") return { icon: <DeleteOutlineRoundedIcon />, color: (t: Theme) => t.palette.error.main };
  return { icon: <EditRoundedIcon />, color: (t: Theme) => t.palette.info.main };
};

/**
 * One person's activity, as an activity log: each piece of work is a node on
 * the line ("4 changes to Jalan Kayu Residence"), with what they changed
 * branching off it underneath.
 */
function PersonDialog({
  person: p,
  version,
  onClose,
  onRevert,
}: {
  person: AuditPerson;
  version: number;
  onClose: () => void;
  onRevert: (e: AuditEntry, fields: string[]) => void;
}) {
  const phone = useMediaQuery((t: Theme) => t.breakpoints.down("sm"));
  const path = p.uid !== null ? `/audit?uid=${p.uid}&v=${version}` : `/audit?system=true&v=${version}`;
  const { data, error } = useApi<AuditLog>(path);
  const sessions = useMemo(() => groupSessions(data?.entries ?? []), [data]);
  const refs = data?.refs ?? NO_REFS;

  return (
    <Dialog open onClose={onClose} fullScreen={phone} fullWidth maxWidth="md" slotProps={{ paper: { sx: { overflowX: "hidden" } } }}>
      <WaveHeader title="Activity" onBack={onClose} height={150} />
      <Box sx={{ px: { xs: 2, sm: 4 }, mt: -5.5, position: "relative" }}>
        <Card sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.75, boxShadow: "0 18px 40px -28px rgba(0,0,0,0.5)" }}>
          <PersonAvatar name={p.name} role={p.role} size={56} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: 18, color: "primary.main" }}>
              {p.name}
            </Typography>
            <Stack direction="row" sx={{ gap: 1, alignItems: "center", mt: 0.5, flexWrap: "wrap" }}>
              {p.role ? <RoleChip role={p.role} /> : <Chip size="small" label={p.roleLabel} />}
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {p.changes} changes · {p.places} places · last {ago(p.lastAt)}
              </Typography>
            </Stack>
          </Box>
        </Card>
      </Box>

      <Box sx={{ px: { xs: 2, sm: 4 }, pt: 3, pb: { xs: "calc(32px + env(safe-area-inset-bottom))", sm: 4 } }}>
        {error && <Alert severity="error">{error.message}</Alert>}
        {!data && !error && <Skeleton variant="rounded" height={260} sx={{ borderRadius: "18px" }} />}
        {data && sessions.length === 0 && <Typography sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>No changes.</Typography>}
        {sessions.map((s, i) => (
          <SessionBlock key={`${s.location.key}-${s.end}`} session={s} last={i === sessions.length - 1} refs={refs} onRevert={onRevert} />
        ))}
        {data?.nextBefore && (
          <Typography variant="caption" component="p" sx={{ color: "text.secondary", textAlign: "center" }}>
            Showing the latest {data.entries.length}. Older changes are on the timeline.
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}

function SessionBlock({
  session: s,
  last,
  refs,
  onRevert,
}: {
  session: ReturnType<typeof groupSessions>[number];
  last: boolean;
  refs: Refs;
  onRevert: (e: AuditEntry, fields: string[]) => void;
}) {
  const head = s.entries[0];
  const { icon, color } = ACTION_STYLE(s.entries.length === 1 ? head : { ...head, action: "update", revertsId: null, table: "" });
  const title = s.entries.length === 1 ? `${head.summary} · ${s.location.label}` : `${s.entries.length} changes to ${s.location.label}`;
  return (
    <Box
      data-testid="audit-session"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "34px minmax(0, 1fr)", sm: "128px 34px minmax(0, 1fr)" },
        columnGap: 1.5,
        position: "relative",
      }}
    >
      {/* The line down through this block's node. */}
      {!last && <Box aria-hidden sx={{ position: "absolute", top: 34, bottom: 0, left: { xs: 16.5, sm: 128 + 12 + 16.5 }, width: "1px", bgcolor: "divider" }} />}
      <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, color: "text.secondary", textAlign: "right", pt: 0.9 }}>
        {dt2s(s.end)}
      </Typography>
      <Box
        sx={(t) => ({
          width: 34,
          height: 34,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          position: "relative",
          zIndex: 1,
          color: "#fff",
          bgcolor: color(t),
          "& svg": { fontSize: 18 },
        })}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, pb: 3 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, pt: 0.6 }}>{title}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "block", sm: "none" } }}>
          {dt2s(s.end)}
        </Typography>
        <Stack sx={{ mt: 1.25, gap: 1.25 }}>
          {s.entries.map((e) => (
            <SessionChild key={e.id} entry={e} refs={refs} onRevert={onRevert} />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function SessionChild({ entry: e, refs, onRevert }: { entry: AuditEntry; refs: Refs; onRevert: (e: AuditEntry, fields: string[]) => void }) {
  const { color } = ACTION_STYLE(e);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr)", columnGap: 1 }}>
      <Box sx={(t) => ({ width: 9, height: 9, mt: 0.75, borderRadius: "50%", border: `1.5px solid ${color(t)}`, bgcolor: "background.paper" })} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {timeOf(e.at)} · {PAGE_LABEL[e.page]}
          {e.revertsId ? ` · undoes #${e.revertsId}` : ""}
        </Typography>
        <Box
          sx={(t) => ({
            mt: 0.5,
            p: 1.25,
            pl: 1.5,
            borderRadius: "0 12px 12px 0",
            borderLeft: `3px solid ${color(t)}`,
            bgcolor: alpha(t.palette.text.primary, 0.04),
          })}
        >
          <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{e.summary}</Typography>
          {e.changes.length > 0 && (
            <Stack sx={{ gap: 0.5, mt: 0.75 }}>
              {e.changes.map((c) => (
                <ChangeLine key={c.field} dense change={c} action={e.action} refs={refs} onRevert={e.linkState ? undefined : () => onRevert(e, [c.field])} />
              ))}
            </Stack>
          )}
          {(e.linkState === "current" || e.lockedReason) && (
            <EntryFooter entry={e} current={e.changes.filter((c) => c.state === "current")} onRevert={onRevert} />
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------ revert

function RevertDialog({ entry: e, fields, refs, onClose, onDone }: Confirm & { refs: Refs; onClose: () => void; onDone: () => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const lines = e.changes.filter((c) => fields.includes(c.field));
  const link = e.linkState !== null;
  const who = e.actor?.name ?? "someone outside the app";

  return (
    <MDialog
      title="Revert Change"
      heading={link ? `${revertVerb(e)}?` : `Put back ${lines.length === 1 ? fieldLabel(lines[0].field).toLowerCase() : `${lines.length} values`}?`}
      subtitle={`This undoes ${who}'s change from ${dt2s(e.at)} as a new change signed by you. Their entry stays in the log.`}
      onClose={onClose}
      maxWidth="xs"
    >
      <Stack sx={{ gap: 0.75 }}>
        {link ? (
          <Typography sx={{ textAlign: "center", fontWeight: 500 }}>
            {e.summary} · {e.location.label}
          </Typography>
        ) : (
          lines.map((c) => (
            <ChangeLine key={c.field} change={{ ...c, from: c.to, to: c.from, state: "current", note: null }} action="update" refs={refs} />
          ))
        )}
      </Stack>
      {!canRevert(e) && <Alert severity="info" sx={{ mt: 2 }}>Nothing here can still be reverted.</Alert>}
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button
          size="large"
          variant="contained"
          disabled={busy || !canRevert(e)}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetcher<{ message: string }>(`/audit/${e.id}/revert`, { method: "POST", json: { fields } });
              toast(res.message);
              onDone();
            } catch (err) {
              toast(err instanceof ApiError ? err.message : "Couldn't revert.", "bad");
              setBusy(false);
            }
          }}
        >
          {busy ? "Reverting…" : link ? revertVerb(e) : "Revert"}
        </Button>
        <Button size="large" onClick={onClose}>
          Cancel
        </Button>
      </Stack>
    </MDialog>
  );
}
