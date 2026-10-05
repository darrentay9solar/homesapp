"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Alert from "@mui/material/Alert";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha, type Theme } from "@mui/material/styles";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { MDialog, PhoneField, ROLE_NAME, RoleAvatar, RoleChip, SectionTitle } from "@/components/m";
import { Header, Page } from "@/components/shell";
import { ago, d2s, initials } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { ROLE_COLOR } from "@/lib/client/mui-theme";
import { type Status, filterPeople, statusOf } from "@/lib/client/people-search";

type Person = {
  uid: number;
  fullName: string | null;
  email: string;
  role: Role;
  roleLabel: string;
  contactNo: string | null;
  active: boolean;
  linked: boolean;
  invitedAt: string | null;
  groups: number[];
};
type Group = { id: number; name: string; members: number[]; projects: number };
type Request = {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  roleLabel: string;
  contactNo: string | null;
  address: string | null;
  postalCode: string | null;
  note: string | null;
  createdAt: string;
};
type Data = { me: number; users: Person[]; groups: Group[]; requests: Request[] };

const ROLES = Object.keys(ROLE_NAME) as Role[];
const CREW: Role[] = ["contractor", "epc_team"];
const TABS: Array<[Role | "all", string]> = [
  ["all", "All"],
  ["homeowner", "Homeowners"],
  ["contractor", "Contractors"],
  ["epc_team", "EPC"],
  ["project_manager", "PMs"],
];
const STATUS_LABEL: Record<Status, string> = { active: "Active", invited: "Invited", disabled: "Disabled" };
const HERO_BG = "linear-gradient(145deg, #0E7F53 0%, #0A5C3E 55%, #073f2b 100%)";

/** Three columns on desktop, two on tablets, one on phones. */
const GRID = {
  display: "grid",
  gap: 2,
  gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" },
} as const;

type DialogState =
  | { kind: "review"; id: number }
  | { kind: "newuser" }
  | { kind: "newgroup" }
  | { kind: "addmember"; id: number }
  | { kind: "person"; uid: number }
  | null;

/** One write: run it, show the server's message, reload. */
function useAction(reload: () => Promise<void>) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  async function run(path: string, init: RequestInit & { json?: unknown }): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetcher<{ message?: string }>(path, init);
      if (res?.message) toast(res.message);
      await reload();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong.", "bad");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy };
}

export default function PeoplePage() {
  const me = useMe();
  const router = useRouter();
  const { data, error, reload } = useApi<Data>(me?.role === "project_manager" ? "/people" : null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [role, setRole] = useState<Role | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (me && me.role !== "project_manager") router.replace("/");
  }, [me, router]);

  const byId = useMemo(() => new Map((data?.users ?? []).map((u) => [u.uid, u])), [data]);
  const groupById = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g])), [data]);
  const searchable = useMemo(
    () => (data?.users ?? []).map((u) => ({ ...u, groupNames: u.groups.map((g) => groupById.get(g)?.name ?? "") })),
    [data, groupById]
  );

  if (!me || me.role !== "project_manager") return null;

  const shown = filterPeople(searchable, { query: q, role, status });
  const count = (r: Role | "all") => searchable.filter((u) => r === "all" || u.role === r).length;
  const filtering = q.trim() !== "" || role !== "all" || status !== "all";
  const close = () => setDialog(null);

  return (
    <>
      <Header
        title="People"
        sub="Accounts & contractor groups"
        right={
          <Button
            variant="contained"
            startIcon={<PersonAddAlt1RoundedIcon />}
            onClick={() => setDialog({ kind: "newuser" })}
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          >
            New account
          </Button>
        }
      />
      <Page>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error.message}
          </Alert>
        )}
        {!data && !error && <Loading />}

        {data && (
          <>
            {/* ------------------------------------------------ hero */}
            <Hero>
              <Typography sx={{ fontWeight: 600, fontSize: { xs: 18, md: 22 } }}>Everyone at 9 Solar Home</Typography>
              <Typography sx={{ opacity: 0.75, fontSize: 13 }}>
                {data.users.filter((u) => u.active).length} active accounts · {data.groups.length} contractor groups
              </Typography>

              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", my: 2.5 }}>
                <Stat n={count("homeowner")} label="Homeowners" />
                <Stat n={count("contractor") + count("epc_team")} label="Contractors & EPC" divider />
                <Stat n={count("project_manager")} label="Project managers" divider />
                <Stat n={data.requests.length} label="Waiting approval" divider highlight={data.requests.length > 0} />
              </Box>

              <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                <SearchBox value={q} onChange={setQ} />
                <StatusMenu value={status} onChange={setStatus} />
              </Stack>
              <SegTabs value={role} onChange={setRole} options={TABS.map(([v, l]) => ({ value: v, label: l, count: count(v) }))} />
            </Hero>

            {/* -------------------------------------------- requests */}
            {data.requests.length > 0 && (
              <>
                <SectionTitle title="Waiting for approval" count={data.requests.length} />
                <Box sx={GRID}>
                  {data.requests.map((r) => (
                    <RequestCard key={r.id} r={r} onReview={() => setDialog({ kind: "review", id: r.id })} />
                  ))}
                </Box>
              </>
            )}

            {/* -------------------------------------------- accounts */}
            <SectionTitle
              title={filtering ? `Showing ${shown.length} of ${data.users.length}` : "All accounts"}
              count={filtering ? undefined : data.users.length}
              action={
                filtering && (
                  <Button
                    size="small"
                    onClick={() => {
                      setQ("");
                      setRole("all");
                      setStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
            {shown.length === 0 ? (
              <Card sx={{ p: 5, textAlign: "center" }} data-testid="people-empty">
                <SearchRoundedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
                <Typography sx={{ fontWeight: 600, mt: 1 }}>Nobody matches</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                  Search by name, email, phone, role, group or status — e.g. &ldquo;apex epc&rdquo; or &ldquo;invited&rdquo;.
                </Typography>
              </Card>
            ) : (
              <Box sx={GRID} data-testid="people-grid">
                {shown.map((u) => (
                  <PersonCard key={u.uid} person={u} groupNames={u.groupNames} onOpen={() => setDialog({ kind: "person", uid: u.uid })} />
                ))}
              </Box>
            )}

            {/* ---------------------------------------------- groups */}
            <SectionTitle
              title="Contractor groups"
              count={data.groups.length}
              action={
                <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setDialog({ kind: "newgroup" })}>
                  New group
                </Button>
              }
            />
            {data.groups.length === 0 ? (
              <Card sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>No groups yet.</Card>
            ) : (
              <Box sx={GRID}>
                {data.groups.map((g) => (
                  <GroupCard key={g.id} group={g} byId={byId} reload={reload} onAdd={() => setDialog({ kind: "addmember", id: g.id })} />
                ))}
              </Box>
            )}
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 2 }}>
              Moving someone between groups changes which projects they can open. Every change is written to the audit log.
            </Typography>
          </>
        )}
      </Page>

      {/* Phones: floating "new account" button. */}
      <Button
        variant="contained"
        aria-label="New account"
        onClick={() => setDialog({ kind: "newuser" })}
        sx={{
          display: { xs: "inline-flex", sm: "none" },
          position: "fixed",
          right: 16,
          bottom: "calc(80px + env(safe-area-inset-bottom))",
          minWidth: 0,
          width: 56,
          height: 56,
          borderRadius: "16px",
          boxShadow: 6,
          zIndex: 5,
        }}
      >
        <PersonAddAlt1RoundedIcon />
      </Button>

      {data && dialog?.kind === "review" && data.requests.find((r) => r.id === dialog.id) && (
        <ReviewDialog request={data.requests.find((r) => r.id === dialog.id)!} reload={reload} onClose={close} />
      )}
      {data && dialog?.kind === "newuser" && <NewUserDialog groups={data.groups} reload={reload} onClose={close} />}
      {data && dialog?.kind === "newgroup" && <NewGroupDialog reload={reload} onClose={close} />}
      {data && dialog?.kind === "addmember" && groupById.get(dialog.id) && (
        <AddMemberDialog group={groupById.get(dialog.id)!} users={data.users} groupById={groupById} reload={reload} onClose={close} />
      )}
      {data && dialog?.kind === "person" && byId.get(dialog.uid) && (
        <PersonDialog person={byId.get(dialog.uid)!} isMe={dialog.uid === data.me} groups={data.groups} reload={reload} onClose={close} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- hero

/** The green header panel, from the reference: stats, search and filter tabs. */
function Hero({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        mt: 2,
        p: { xs: 2.25, md: 3.5 },
        borderRadius: "24px",
        color: "#fff",
        position: "relative",
        overflow: "hidden",
        background: HERO_BG,
        boxShadow: "0 24px 50px -30px rgba(7, 63, 43, 0.9)",
        "&::before": {
          content: '""',
          position: "absolute",
          width: 340,
          height: 340,
          borderRadius: "50%",
          right: -120,
          top: -160,
          background: "rgba(255,255,255,0.06)",
        },
        "& > *": { position: "relative" },
      }}
    >
      {children}
    </Box>
  );
}

function Stat({ n, label, divider, highlight }: { n: number; label: string; divider?: boolean; highlight?: boolean }) {
  return (
    <Box sx={{ pl: divider ? { xs: 1.25, md: 2.5 } : 0, borderLeft: divider ? "1px solid rgba(255,255,255,0.18)" : 0, minWidth: 0 }}>
      <Typography
        sx={{
          fontWeight: 600,
          fontSize: { xs: 28, md: 40 },
          lineHeight: 1.1,
          color: highlight ? "#FFD27A" : "#7EF0B8",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(n).padStart(2, "0")}
      </Typography>
      <Typography sx={{ fontSize: { xs: 11, md: 13 }, opacity: 0.85, mt: 0.5, lineHeight: 1.3 }}>{label}</Typography>
    </Box>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        height: 48,
        borderRadius: "14px",
        bgcolor: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.22)",
        "&:focus-within": { bgcolor: "rgba(255,255,255,0.18)", borderColor: "rgba(255,255,255,0.6)" },
      }}
    >
      <SearchRoundedIcon sx={{ opacity: 0.8 }} />
      <InputBase
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, email, phone, role, group…"
        inputProps={{ "aria-label": "Search people", "data-testid": "people-search" }}
        sx={{ flex: 1, minWidth: 0, color: "#fff", fontSize: 16, "& input::placeholder": { color: "rgba(255,255,255,0.6)", opacity: 1 } }}
      />
      {value && (
        <IconButton size="small" aria-label="Clear search" onClick={() => onChange("")} sx={{ color: "#fff" }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}

/** Status filter. Icon only on phones (it would crowd the search box), labelled on wider screens. */
function StatusMenu({ value, onChange }: { value: Status | "all"; onChange: (v: Status | "all") => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = value === "all" ? "Any status" : STATUS_LABEL[value];
  return (
    <>
      <Button
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={`Status filter: ${label}`}
        sx={{
          height: 48,
          minWidth: 48,
          px: { xs: 0, sm: 2 },
          gap: 1,
          flex: "0 0 auto",
          color: "#fff",
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.22)",
          bgcolor: value === "all" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.26)",
        }}
      >
        <FilterListRoundedIcon />
        <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
          {label}
        </Box>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {(["all", "active", "invited", "disabled"] as const).map((s) => (
          <MenuItem
            key={s}
            selected={value === s}
            onClick={() => {
              onChange(s);
              setAnchor(null);
            }}
          >
            {s === "all" ? "Any status" : STATUS_LABEL[s]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * Pill tabs in a translucent track (the reference's "All / Pending / Ongoing").
 * Scrolls sideways when the tabs don't fit — on a narrow phone — with a fade
 * at the edge as a cue, and keeps the chosen tab in view.
 */
function SegTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count: number }>;
}) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    track.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <Box
      sx={{
        mt: 1.5,
        position: "relative",
        borderRadius: "14px",
        bgcolor: "rgba(0,0,0,0.18)",
        border: "1px solid rgba(255,255,255,0.14)",
        overflow: "hidden",
        "&::after": {
          content: '""',
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 28,
          pointerEvents: "none",
          background: "linear-gradient(90deg, transparent, rgba(7,63,43,0.9))",
          display: { md: "none" },
        },
      }}
    >
      <Box
        ref={track}
        role="tablist"
        aria-label="Filter by role"
        sx={{
          display: "flex",
          gap: 0.5,
          p: 0.5,
          pr: { xs: 3, md: 0.5 },
          overflowX: "auto",
          scrollSnapType: "x proximity",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <ButtonBase
              key={o.value}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(o.value)}
              sx={{
                flex: { xs: "0 0 auto", md: 1 },
                scrollSnapAlign: "start",
                gap: 0.75,
                px: 1.75,
                height: 40,
                borderRadius: "10px",
                fontFamily: "inherit",
                fontSize: 13.5,
                fontWeight: on ? 600 : 500,
                color: on ? "#073f2b" : "rgba(255,255,255,0.85)",
                bgcolor: on ? "#fff" : "transparent",
                transition: "background-color .18s, color .18s",
                "&:hover": { bgcolor: on ? "#fff" : "rgba(255,255,255,0.1)" },
              }}
            >
              {o.label}
              <Box
                component="span"
                sx={{
                  fontSize: 11,
                  fontWeight: 600,
                  px: 0.75,
                  borderRadius: "6px",
                  bgcolor: on ? alpha("#0A9A63", 0.14) : "rgba(255,255,255,0.14)",
                }}
              >
                {o.count}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

function Loading() {
  return (
    <>
      <Skeleton variant="rounded" height={260} sx={{ mt: 2, borderRadius: "24px" }} />
      <Box sx={{ ...GRID, mt: 4 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={190} sx={{ borderRadius: "18px" }} />
        ))}
      </Box>
    </>
  );
}

// --------------------------------------------------------------- cards

/** A card with a coloured edge on the left, like the reference's task cards. */
function EdgeCard({ color, children, dim }: { color: (t: Theme) => string; children: ReactNode; dim?: boolean }) {
  return (
    <Card
      sx={(t) => ({
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        opacity: dim ? 0.6 : 1,
        transition: "box-shadow .2s, transform .2s",
        "&:hover": { boxShadow: "0 18px 40px -26px rgba(0,0,0,0.45)" },
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 16,
          bottom: 16,
          width: 4,
          borderRadius: "0 4px 4px 0",
          bgcolor: color(t),
          zIndex: 1,
        },
      })}
    >
      {children}
    </Card>
  );
}

const roleColor = (role: Role) => (t: Theme) => (t.palette.mode === "dark" ? ROLE_COLOR[role].dark : ROLE_COLOR[role].light);

function StatusBadge({ status }: { status: Status }) {
  const color = status === "active" ? "success" : status === "invited" ? "secondary" : "error";
  return (
    <Chip size="small" variant="outlined" color={color} label={STATUS_LABEL[status].toUpperCase()} sx={{ letterSpacing: "0.08em", fontSize: 10.5, height: 24 }} />
  );
}

function ContactLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: "center", color: "text.secondary", minWidth: 0, mt: 0.6 }}>
      <Box sx={{ display: "grid", flex: "0 0 auto", "& svg": { fontSize: 16 } }}>{icon}</Box>
      <Typography variant="body2" noWrap>
        {text}
      </Typography>
    </Stack>
  );
}

function PersonCard({ person: u, groupNames, onOpen }: { person: Person; groupNames: string[]; onOpen: () => void }) {
  const status = statusOf(u);
  return (
    <EdgeCard color={roleColor(u.role)} dim={!u.active}>
      <CardActionArea onClick={onOpen} data-testid="person-card" sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        <Box sx={{ p: 2.25, pl: 2.75, flex: 1 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "text.secondary" }}>
                <BadgeRoundedIcon sx={{ fontSize: 15 }} />
                <Typography variant="caption">#{String(u.uid).padStart(4, "0")}</Typography>
              </Stack>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 16.5, mt: 0.75 }}>
                {u.fullName ?? u.email}
              </Typography>
              <ContactLine icon={<MailOutlineRoundedIcon />} text={u.email} />
              <ContactLine icon={<PhoneRoundedIcon />} text={u.contactNo ?? "No mobile on file"} />
            </Box>
            <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={50} />
          </Stack>
        </Box>
        <Divider />
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 2.25, pl: 2.75, py: 1.5 }}>
          <RoleChip role={u.role} />
          <Typography variant="caption" noWrap sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
            {groupNames.join(", ")}
          </Typography>
          <StatusBadge status={status} />
        </Stack>
      </CardActionArea>
    </EdgeCard>
  );
}

function RequestCard({ r, onReview }: { r: Request; onReview: () => void }) {
  return (
    <EdgeCard color={(t) => t.palette.warning.main}>
      <Box sx={{ p: 2.25, pl: 2.75, flex: 1 }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 600 }}>
              Requested {ago(r.createdAt)}
            </Typography>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: 16.5, mt: 0.5 }}>
              {r.fullName}
            </Typography>
            <ContactLine icon={<MailOutlineRoundedIcon />} text={r.email} />
            <ContactLine icon={<PhoneRoundedIcon />} text={r.contactNo ?? "No mobile given"} />
          </Box>
          <RoleAvatar name={r.fullName} role={r.role} size={50} />
        </Stack>
      </Box>
      <Divider />
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 2.25, pl: 2.75, py: 1.25 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Asked for
        </Typography>
        <RoleChip role={r.role} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" onClick={onReview}>
          Review
        </Button>
      </Stack>
    </EdgeCard>
  );
}

function GroupCard({ group, byId, reload, onAdd }: { group: Group; byId: Map<number, Person>; reload: () => Promise<void>; onAdd: () => void }) {
  const { run, busy } = useAction(reload);
  const members = group.members.map((id) => byId.get(id)).filter((u): u is Person => Boolean(u));
  return (
    <EdgeCard color={(t) => t.palette.primary.main}>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", p: 2.25, pl: 2.75 }}>
        <Box sx={{ width: 50, height: 50, flex: "0 0 auto", borderRadius: "14px", display: "grid", placeItems: "center", fontWeight: 700, color: "#fff", background: HERO_BG }}>
          {initials(group.name)}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: 16 }}>
            {group.name}
          </Typography>
          <Stack direction="row" sx={{ gap: 1.5, color: "text.secondary", mt: 0.25 }}>
            <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
              <GroupsRoundedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{members.length}</Typography>
            </Stack>
            <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
              <SolarPowerRoundedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">
                {group.projects} project{group.projects === 1 ? "" : "s"}
              </Typography>
            </Stack>
          </Stack>
        </Box>
        <AvatarGroup max={3} sx={{ "& .MuiAvatar-root": { width: 30, height: 30, fontSize: 11 } }}>
          {members.map((u) => (
            <RoleAvatar key={u.uid} name={u.fullName ?? u.email} role={u.role} size={30} />
          ))}
        </AvatarGroup>
      </Stack>
      <Divider />
      <Box sx={{ flex: 1 }}>
        {members.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary", px: 2.75, py: 1.5 }}>
            No members yet.
          </Typography>
        ) : (
          <List dense disablePadding sx={{ pl: 0.75 }}>
            {members.map((u) => (
              <ListItem
                key={u.uid}
                secondaryAction={
                  <Tooltip title="Remove from group">
                    <IconButton edge="end" size="small" disabled={busy} aria-label={`Remove ${u.fullName ?? u.email}`} onClick={() => void run(`/groups/${group.id}/members/${u.uid}`, { method: "DELETE" })}>
                      <PersonRemoveRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemAvatar sx={{ minWidth: 42 }}>
                  <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={30} />
                </ListItemAvatar>
                <ListItemText primary={u.fullName ?? u.email} secondary={ROLE_NAME[u.role]} slotProps={{ primary: { noWrap: true } }} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
      <Divider />
      <Stack direction="row" sx={{ px: 1.5, py: 0.75, alignItems: "center" }}>
        <Button size="small" startIcon={<GroupAddRoundedIcon />} onClick={onAdd}>
          Add member
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={group.projects ? "Assigned to projects — can't delete" : "Delete group"}>
          <span>
            <IconButton
              size="small"
              color="error"
              disabled={busy || group.projects > 0}
              aria-label={`Delete ${group.name}`}
              onClick={() => {
                if (confirm(`Delete ${group.name}?`)) void run(`/groups/${group.id}`, { method: "DELETE" });
              }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </EdgeCard>
  );
}

// ------------------------------------------------------------- dialogs

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2, py: 1.25 }}>
      <Typography variant="body2" sx={{ color: "text.secondary", flex: "0 0 auto" }}>
        {k}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: "right", overflowWrap: "anywhere" }}>
        {v}
      </Typography>
    </Stack>
  );
}

function ReviewDialog({ request: r, reload, onClose }: { request: Request; reload: () => Promise<void>; onClose: () => void }) {
  const [grant, setGrant] = useState<Role>(r.role);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const { run, busy } = useAction(reload);
  const first = r.fullName.split(" ")[0];

  if (declining) {
    return (
      <MDialog title={`Decline ${first}'s request?`} subtitle="They'll be told by email, and WhatsApp or SMS" onClose={onClose}>
        <TextField label="Reason (sent to them)" multiline minRows={3} placeholder="e.g. We couldn't find a project at this address yet — please call us." value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 1 }} />
        <Stack sx={{ gap: 1, mt: 3 }}>
          <Button
            size="large"
            variant="contained"
            color="error"
            disabled={busy}
            onClick={async () => {
              if (await run(`/account-requests/${r.id}/reject`, { method: "POST", json: { note: reason } })) onClose();
            }}
          >
            {busy ? "Declining…" : "Decline request"}
          </Button>
          <Button size="large" onClick={() => setDeclining(false)}>
            Cancel
          </Button>
        </Stack>
      </MDialog>
    );
  }

  return (
    <MDialog title="Review request" subtitle={`Sent ${ago(r.createdAt)}`} onClose={onClose}>
      <Stack sx={{ alignItems: "center", textAlign: "center", mb: 2 }}>
        <RoleAvatar name={r.fullName} role={r.role} size={68} />
        <Typography variant="h6" sx={{ mt: 1.5 }}>
          {r.fullName}
        </Typography>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center", mt: 0.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Asked for
          </Typography>
          <RoleChip role={r.role} />
        </Stack>
      </Stack>
      <Card sx={{ px: 2, py: 0.5, mb: 2.5 }}>
        <Detail k="Email" v={`${r.email}  ✓ verified`} />
        <Divider />
        <Detail k="Mobile" v={r.contactNo ?? "—"} />
        <Divider />
        <Detail k="Address" v={[r.address, r.postalCode].filter(Boolean).join(", ") || "—"} />
        <Divider />
        <Detail k="Note" v={r.note ? `“${r.note}”` : "—"} />
      </Card>
      <TextField select label="Grant role" value={grant} onChange={(e) => setGrant(e.target.value as Role)} helperText="You can grant a different role from the one they asked for.">
        {ROLES.map((k) => (
          <MenuItem key={k} value={k}>
            {ROLE_NAME[k]}
            {k === r.role ? " (requested)" : ""}
          </MenuItem>
        ))}
      </TextField>
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button
          size="large"
          variant="contained"
          disabled={busy}
          onClick={async () => {
            if (await run(`/account-requests/${r.id}/approve`, { method: "POST", json: { role: grant } })) onClose();
          }}
        >
          {busy ? "Approving…" : `Approve as ${ROLE_NAME[grant]}`}
        </Button>
        <Button size="large" variant="outlined" color="error" disabled={busy} onClick={() => setDeclining(true)}>
          Decline
        </Button>
      </Stack>
    </MDialog>
  );
}

function NewUserDialog({ groups, reload, onClose }: { groups: Group[]; reload: () => Promise<void>; onClose: () => void }) {
  const { run, busy } = useAction(reload);
  const [f, setF] = useState({ fullName: "", email: "", role: "homeowner" as Role, contactNo: "", groupId: "", postalCode: "", address: "", icLast4: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ok = f.fullName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());

  return (
    <MDialog title="New account" subtitle="Creates a login and sends them an invitation" onClose={onClose}>
      <Stack sx={{ gap: 2.25, mt: 1 }}>
        <TextField label="Full name" required value={f.fullName} onChange={set("fullName")} autoComplete="off" />
        <TextField label="Email" required type="email" value={f.email} onChange={set("email")} autoComplete="off" />
        <PhoneField value={f.contactNo} onChange={(v) => setF((x) => ({ ...x, contactNo: v }))} helperText="For WhatsApp, or SMS if WhatsApp can't deliver" />
        <TextField select label="Role" required value={f.role} onChange={set("role")}>
          {ROLES.map((k) => (
            <MenuItem key={k} value={k}>
              {ROLE_NAME[k]}
            </MenuItem>
          ))}
        </TextField>
        {CREW.includes(f.role) && (
          <TextField select label="Contractor group" value={f.groupId} onChange={set("groupId")}>
            <MenuItem value="">None for now</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Stack direction="row" sx={{ gap: 1.5 }}>
          <TextField label="Postal code" value={f.postalCode} onChange={set("postalCode")} slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }} />
          {f.role === "homeowner" && <TextField label="NRIC last 4" placeholder="567D" value={f.icLast4} onChange={set("icLast4")} slotProps={{ htmlInput: { maxLength: 4 } }} />}
        </Stack>
        <TextField label="Address" placeholder="Filled in from the postal code" value={f.address} onChange={set("address")} />
      </Stack>
      <Button
        fullWidth
        size="large"
        variant="contained"
        disabled={busy || !ok}
        sx={{ mt: 3 }}
        onClick={async () => {
          if (await run("/people", { method: "POST", json: { ...f, groupId: f.groupId ? Number(f.groupId) : null } })) onClose();
        }}
      >
        {busy ? "Creating…" : "Create account & notify"}
      </Button>
      <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.secondary", mt: 1 }}>
        {ok ? "They get an email, plus WhatsApp (or SMS) if a mobile is given." : "Enter a name and a valid email."}
      </Typography>
    </MDialog>
  );
}

function NewGroupDialog({ reload, onClose }: { reload: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const { run, busy } = useAction(reload);
  return (
    <MDialog title="New contractor group" subtitle="Groups can be assigned to projects as one unit" onClose={onClose} maxWidth="xs">
      <TextField label="Group name" placeholder="e.g. Northline Roofing Pte Ltd" value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
      <Button
        fullWidth
        size="large"
        variant="contained"
        disabled={busy || name.trim().length < 3}
        sx={{ mt: 3 }}
        onClick={async () => {
          if (await run("/groups", { method: "POST", json: { name } })) onClose();
        }}
      >
        Create group
      </Button>
    </MDialog>
  );
}

function AddMemberDialog({ group, users, groupById, reload, onClose }: { group: Group; users: Person[]; groupById: Map<number, Group>; reload: () => Promise<void>; onClose: () => void }) {
  const { run, busy } = useAction(reload);
  const avail = users.filter((u) => CREW.includes(u.role) && u.active && !group.members.includes(u.uid));
  return (
    <MDialog title="Add member" subtitle={group.name} onClose={onClose}>
      {avail.length === 0 ? (
        <Alert severity="info">Everyone eligible is already a member. Create a contractor admin or EPC account first.</Alert>
      ) : (
        <List disablePadding>
          {avail.map((u) => (
            <ListItemButton key={u.uid} disabled={busy} onClick={() => void run(`/groups/${group.id}/members`, { method: "POST", json: { uid: u.uid } })}>
              <ListItemAvatar>
                <RoleAvatar name={u.fullName ?? u.email} role={u.role} />
              </ListItemAvatar>
              <ListItemText primary={u.fullName ?? u.email} secondary={`${ROLE_NAME[u.role]}${u.groups.length ? ` · in ${u.groups.map((g) => groupById.get(g)?.name).join(", ")}` : ""}`} />
              <Chip size="small" color="primary" label="Add" />
            </ListItemButton>
          ))}
        </List>
      )}
    </MDialog>
  );
}

/** A settings-style row with a tinted icon tile, as on the reference's Profile screen. */
function SettingRow({ icon, tint, label, sub, right, children }: { icon: ReactNode; tint: string; label: string; sub?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <Card sx={{ px: 2, py: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.75 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: "11px", display: "grid", placeItems: "center", flex: "0 0 auto", color: tint, bgcolor: alpha(tint, 0.14) }}>{icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500 }}>{label}</Typography>
          {sub && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {sub}
            </Typography>
          )}
        </Box>
        {right}
      </Stack>
      {children && <Box sx={{ mt: 1.5 }}>{children}</Box>}
    </Card>
  );
}

/** One person, laid out like the reference's Profile screen. */
function PersonDialog({ person: u, isMe, groups, reload, onClose }: { person: Person; isMe: boolean; groups: Group[]; reload: () => Promise<void>; onClose: () => void }) {
  const { run, busy } = useAction(reload);
  const phone = useMediaQuery((t: Theme) => t.breakpoints.down("sm"));
  const { data: projects } = useApi<Array<{ id: number; name: string; status: string }>>(`/people/${u.uid}/projects`);
  const status = statusOf(u);

  return (
    <Dialog open onClose={onClose} fullScreen={phone} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { bgcolor: "background.default", overflowX: "hidden" } } }}>
      <Box sx={{ position: "relative", pb: 3 }}>
        <Box sx={{ height: 150, background: HERO_BG, color: "#fff", px: 1, pt: "env(safe-area-inset-top)" }}>
          <Stack direction="row" sx={{ alignItems: "center", height: 64 }}>
            <IconButton onClick={onClose} aria-label="Back" sx={{ color: "#fff" }}>
              <ArrowBackRoundedIcon />
            </IconButton>
            <Typography sx={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: 17, mr: 5 }}>Profile</Typography>
          </Stack>
        </Box>

        <Card sx={{ mx: 2.5, mt: -6, pt: 6.5, pb: 2.5, px: 2, textAlign: "center", overflow: "visible", position: "relative" }}>
          <Box sx={{ position: "absolute", left: "50%", top: -40, transform: "translateX(-50%)", borderRadius: "50%", p: 0.5, bgcolor: "background.paper" }}>
            <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={76} />
          </Box>
          <Typography variant="h6">{u.fullName ?? u.email}</Typography>
          <Typography sx={{ color: "text.secondary", mt: 0.25 }}>{u.contactNo ?? "No mobile on file"}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {u.email}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, justifyContent: "center", mt: 1.5, flexWrap: "wrap" }}>
            <RoleChip role={u.role} />
            <StatusBadge status={status} />
          </Stack>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1 }}>
            {u.linked ? "Has signed in" : u.invitedAt ? `Invited ${d2s(u.invitedAt)} — not signed in yet` : "No login yet"}
          </Typography>
        </Card>

        <Box sx={{ px: 2.5 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 17, mt: 3, mb: 1.5 }}>General</Typography>
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<BadgeRoundedIcon />} tint="#2563EB" label="Role" sub="Controls what they can see and edit">
              <TextField
                select
                size="small"
                value={u.role}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as Role;
                  const leaving = CREW.includes(u.role) && !CREW.includes(next) && u.groups.length > 0;
                  if (leaving && !confirm(`${u.fullName ?? "They"} will also leave their contractor groups. Continue?`)) return;
                  void run(`/people/${u.uid}`, { method: "PATCH", json: { role: next } });
                }}
              >
                {ROLES.map((k) => (
                  <MenuItem key={k} value={k}>
                    {ROLE_NAME[k]}
                  </MenuItem>
                ))}
              </TextField>
            </SettingRow>

            {CREW.includes(u.role) && (
              <SettingRow icon={<GroupsRoundedIcon />} tint="#B45309" label="Contractor groups" sub={u.groups.length ? "Tap to add or remove" : "Not in a group — sees no contractor projects"}>
                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                  {groups.length === 0 && (
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      No groups exist yet.
                    </Typography>
                  )}
                  {groups.map((g) => {
                    const inIt = u.groups.includes(g.id);
                    return (
                      <Chip
                        key={g.id}
                        label={g.name}
                        color={inIt ? "primary" : "default"}
                        variant={inIt ? "filled" : "outlined"}
                        disabled={busy}
                        onClick={() => void run(inIt ? `/groups/${g.id}/members/${u.uid}` : `/groups/${g.id}/members`, inIt ? { method: "DELETE" } : { method: "POST", json: { uid: u.uid } })}
                      />
                    );
                  })}
                </Stack>
              </SettingRow>
            )}

            <SettingRow icon={<SolarPowerRoundedIcon />} tint="#0A9A63" label="Projects they can open" right={<Chip size="small" label={projects?.length ?? "…"} />}>
              {!projects && <Skeleton variant="rounded" height={40} />}
              {projects && projects.length === 0 && (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  None yet.
                </Typography>
              )}
              {projects && projects.length > 0 && (
                <List dense disablePadding>
                  {projects.map((p, i) => (
                    <ListItem key={p.id} divider={i < projects.length - 1} disableGutters>
                      <ListItemText primary={p.name} secondary={p.status.replace(/_/g, " ")} />
                    </ListItem>
                  ))}
                </List>
              )}
            </SettingRow>

            {!isMe && (
              <SettingRow
                icon={<PowerSettingsNewRoundedIcon />}
                tint="#CE2E33"
                label="Account enabled"
                sub="Disabling blocks sign-in; history stays in the audit log"
                right={<Switch checked={u.active} disabled={busy} onChange={() => void run(`/people/${u.uid}`, { method: "PATCH", json: { active: !u.active } })} slotProps={{ input: { "aria-label": "Account enabled" } }} />}
              />
            )}
          </Stack>
        </Box>
      </Box>
    </Dialog>
  );
}
