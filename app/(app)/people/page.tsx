"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import FingerprintRoundedIcon from "@mui/icons-material/FingerprintRounded";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import EventBusyRoundedIcon from "@mui/icons-material/EventBusyRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SolarPowerRoundedIcon from "@mui/icons-material/SolarPowerRounded";
import Alert from "@mui/material/Alert";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AvatarEditor } from "@/components/avatar";
import { Field, MDialog, PhoneField, ROLE_NAME, RoleAvatar, RoleChip, SettingRow, WaveHeader } from "@/components/m";
import { splitPhone } from "@/components/phone-input";
import { Page } from "@/components/shell";
import { EdgeCard, GRID, HERO_BG, Heading, SearchBox, SegTabs, TopBar, roleColor } from "@/components/topbar";
import { ago, d2s, initials } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { T, TR } from "@/lib/client/i18n";
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
  avatar: string | null;
  disableOn: string | null;
  enableOn: string | null;
  disabledReason: "manual" | "scheduled" | null;
};
type Group = { id: number; name: string; members: number[]; projects: number };

/** Tomorrow's date in Singapore, the earliest an expiry or enable date can be. */
function tomorrowSg(): string {
  return new Date(Date.now() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
}

/** "19 Oct 2026" from "2026-10-19". */
function day(iso: string): string {
  return d2s(`${iso}T12:00:00+08:00`);
}

/** Expiry chosen when an account is made: a date, or "No expiry" ticked. One is required. */
function ExpiryFields({ value, onChange }: { value: { expiresOn: string; noExpiry: boolean }; onChange: (v: { expiresOn: string; noExpiry: boolean }) => void }) {
  const tomorrow = tomorrowSg();
  return (
    <Box>
      <Field
        label={T("Account expires on")}
        type="date"
        icon={<EventBusyRoundedIcon />}
        value={value.expiresOn}
        disabled={value.noExpiry}
        onChange={(e) => onChange({ ...value, expiresOn: e.target.value })}
        helperText={T("It disables itself that day. You can change the date later.")}
        slotProps={{ htmlInput: { min: tomorrow, "data-testid": "expires-on" } }}
      />
      <FormControlLabel
        sx={{ mt: 0.5 }}
        control={<Checkbox checked={value.noExpiry} onChange={(e) => onChange({ expiresOn: e.target.checked ? "" : value.expiresOn, noExpiry: e.target.checked })} slotProps={{ input: { "data-testid": "no-expiry" } as object }} />}
        label={T("No expiry")}
      />
    </Box>
  );
}
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
type RoleRequest = {
  id: number;
  uid: number;
  fullName: string;
  email: string;
  contactNo: string | null;
  from: Role;
  fromLabel: string;
  role: Role;
  roleLabel: string;
  reason: string | null;
  createdAt: string;
};
type Data = { me: number; users: Person[]; groups: Group[]; requests: Request[]; roleRequests: RoleRequest[] };

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

type DialogState =
  | { kind: "review"; id: number }
  | { kind: "role"; id: number }
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
  const tabLabel = TABS.find(([v]) => v === role)?.[1] ?? "All";
  const close = () => setDialog(null);

  return (
    <>
      {/* Green header, after the reference's "My Task" screen. */}
      <TopBar
        title={T("People")}
        action={
          <Button
            onClick={() => setDialog({ kind: "newuser" })}
            startIcon={<PersonAddAlt1RoundedIcon />}
            sx={{ color: "#073f2b", bgcolor: "#fff", px: { xs: 1.5, sm: 2 }, height: 36, "&:hover": { bgcolor: "#eafff4" } }}
          >
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {T("New account")}
            </Box>
            <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
              {T("New")}
            </Box>
          </Button>
        }
        search={
          <Stack direction="row" sx={{ gap: 1 }}>
            <SearchBox value={q} onChange={setQ} placeholder={T("Search people")} testId="people-search" />
            <StatusMenu value={status} onChange={setStatus} />
          </Stack>
        }
        tabs={<SegTabs label={T("Filter by role")} value={role} onChange={setRole} options={TABS.map(([v, l]) => ({ value: v, label: l, count: count(v) }))} />}
      />

      <Box sx={{ position: "relative", bgcolor: "background.default", flex: 1 }}>
        <Page>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error.message}
            </Alert>
          )}
          {!data && !error && <Loading />}

          {data && (
            <>
              {data.requests.length + data.roleRequests.length > 0 && !filtering && (
                <>
                  <Heading title={T("Waiting for approval")} count={data.requests.length + data.roleRequests.length} />
                  <Box sx={GRID}>
                    {data.requests.map((r) => (
                      <RequestCard key={r.id} r={r} onReview={() => setDialog({ kind: "review", id: r.id })} />
                    ))}
                    {data.roleRequests.map((r) => (
                      <RoleRequestCard key={`role-${r.id}`} r={r} onReview={() => setDialog({ kind: "role", id: r.id })} />
                    ))}
                  </Box>
                </>
              )}

              <Heading
                title={role === "all" ? T("All people") : tabLabel}
                count={shown.length}
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
                      {T("Clear filters")}
                    </Button>
                  )
                }
              />
              {shown.length === 0 ? (
                <Card sx={{ p: 4, textAlign: "center" }} data-testid="people-empty">
                  <SearchRoundedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
                  <Typography sx={{ fontWeight: 600, mt: 1 }}>{T("Nobody matches")}</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                    {T("Try a name, email, phone, role, group or status — e.g. “apex epc”.")}
                  </Typography>
                </Card>
              ) : (
                <Box sx={GRID} data-testid="people-grid">
                  {shown.map((u) => (
                    <PersonCard key={u.uid} person={u} groupNames={u.groupNames} onOpen={() => setDialog({ kind: "person", uid: u.uid })} />
                  ))}
                </Box>
              )}

              {!filtering && (
                <>
                  <Heading
                    title={T("Contractor groups")}
                    count={data.groups.length}
                    action={
                      <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setDialog({ kind: "newgroup" })}>
                        {T("New group")}
                      </Button>
                    }
                  />
                  {data.groups.length === 0 ? (
                    <Card sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>{T("No groups yet.")}</Card>
                  ) : (
                    <Box sx={GRID}>
                      {data.groups.map((g) => (
                        <GroupCard key={g.id} group={g} byId={byId} reload={reload} onAdd={() => setDialog({ kind: "addmember", id: g.id })} />
                      ))}
                    </Box>
                  )}
                </>
              )}
            </>
          )}
        </Page>
      </Box>

      {data && dialog?.kind === "review" && data.requests.find((r) => r.id === dialog.id) && (
        <ReviewDialog request={data.requests.find((r) => r.id === dialog.id)!} groups={data.groups} reload={reload} onClose={close} />
      )}
      {data && dialog?.kind === "role" && data.roleRequests.find((r) => r.id === dialog.id) && (
        <RoleReviewDialog request={data.roleRequests.find((r) => r.id === dialog.id)!} groups={data.groups} reload={reload} onClose={close} />
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

// ---------------------------------------------------------- top bar

/** Status filter: a 40px icon button, labelled on desktop. */
function StatusMenu({ value, onChange }: { value: Status | "all"; onChange: (v: Status | "all") => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = T(value === "all" ? "Any status" : STATUS_LABEL[value]);
  return (
    <>
      <Button
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={T("Status filter: {label}", { label: T(label) })}
        sx={{
          height: 40,
          minWidth: 40,
          px: { xs: 0, lg: 1.5 },
          gap: 0.75,
          flex: "0 0 auto",
          color: "#fff",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.2)",
          bgcolor: value === "all" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.28)",
        }}
      >
        <FilterListRoundedIcon sx={{ fontSize: 20 }} />
        <Box component="span" sx={{ display: { xs: "none", lg: "inline" }, fontSize: 13 }}>
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
            {s === "all" ? T("Any status") : STATUS_LABEL[s]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function Loading() {
  return (
    <>
      <Box sx={{ ...GRID, mt: 3 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={128} />
        ))}
      </Box>
    </>
  );
}

// --------------------------------------------------------------- cards

/** "Expires 19 Oct", "Expired", or "Enables 1 Nov" — only when a date is set. */
function ScheduleChip({ person: u }: { person: Person }) {
  if (!u.active && u.disabledReason === "scheduled") return <Chip size="small" color="error" variant="outlined" label={T("Expired")} data-testid="expired-chip" />;
  if (!u.active && u.enableOn) return <Chip size="small" color="info" variant="outlined" label={T("Enables {date}", { date: day(u.enableOn) })} />;
  if (u.active && u.disableOn) return <Chip size="small" color="warning" variant="outlined" label={T("Expires {date}", { date: day(u.disableOn) })} data-testid="expires-chip" />;
  return null;
}

function StatusBadge({ status }: { status: Status }) {
  const color = status === "active" ? "success" : status === "invited" ? "secondary" : "error";
  return (
    <Chip size="small" variant="outlined" color={color} label={T(STATUS_LABEL[status]).toUpperCase()} sx={{ letterSpacing: "0.08em", fontSize: 10.5, height: 24 }} />
  );
}

function ContactLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "text.secondary", minWidth: 0, mt: 0.25 }}>
      <Box sx={{ display: "grid", flex: "0 0 auto", "& svg": { fontSize: 15 } }}>{icon}</Box>
      <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
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
        <Box sx={{ p: 1.5, pl: 2.25, flex: 1 }}>
          <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", color: "text.secondary" }}>
                <BadgeRoundedIcon sx={{ fontSize: 15 }} />
                <Typography variant="caption">#{String(u.uid).padStart(4, "0")}</Typography>
              </Stack>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5, mt: 0.25 }}>
                {u.fullName ?? u.email}
              </Typography>
              <ContactLine icon={<MailOutlineRoundedIcon />} text={u.email} />
              <ContactLine icon={<PhoneRoundedIcon />} text={u.contactNo ?? T("No mobile on file")} />
            </Box>
            <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={42} src={u.avatar} />
          </Stack>
        </Box>
        <Divider />
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 1.5, pl: 2.25, py: 1 }}>
          <RoleChip role={u.role} />
          <ScheduleChip person={u} />
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
      <Box sx={{ p: 1.5, pl: 2.25, flex: 1 }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 600 }}>
              {T("Requested {when}", { when: ago(r.createdAt) })}
            </Typography>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5, mt: 0.25 }}>
              {r.fullName}
            </Typography>
            <ContactLine icon={<MailOutlineRoundedIcon />} text={r.email} />
            <ContactLine icon={<PhoneRoundedIcon />} text={r.contactNo ?? T("No mobile given")} />
          </Box>
          <RoleAvatar name={r.fullName} role={r.role} size={42} />
        </Stack>
      </Box>
      <Divider />
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 1.5, pl: 2.25, py: 0.75 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {T("Asked for")}
        </Typography>
        <RoleChip role={r.role} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" onClick={onReview} data-testid="request-review">
          {T("Review")}
        </Button>
      </Stack>
    </EdgeCard>
  );
}

function RoleRequestCard({ r, onReview }: { r: RoleRequest; onReview: () => void }) {
  return (
    <EdgeCard color={(t) => t.palette.warning.main}>
      <Box sx={{ p: 1.5, pl: 2.25, flex: 1 }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 600 }}>
              {T("Role change · {when}", { when: ago(r.createdAt) })}
            </Typography>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: 15.5, mt: 0.25 }}>
              {r.fullName}
            </Typography>
            <ContactLine icon={<MailOutlineRoundedIcon />} text={r.email} />
            {r.reason && (
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, overflowWrap: "anywhere" }}>
                &ldquo;{r.reason}&rdquo;
              </Typography>
            )}
          </Box>
          <RoleAvatar name={r.fullName} role={r.from} size={42} />
        </Stack>
      </Box>
      <Divider />
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, px: 1.5, pl: 2.25, py: 0.75, flexWrap: "wrap" }}>
        <RoleChip role={r.from} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {T("to")}
        </Typography>
        <RoleChip role={r.role} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" onClick={onReview} data-testid="role-review">
          {T("Review")}
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
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", p: 1.5, pl: 2.25 }}>
        <Box sx={{ width: 42, height: 42, flex: "0 0 auto", borderRadius: `${DESIGN.radius.iconTile}px`, display: "grid", placeItems: "center", fontWeight: 700, color: "#fff", background: HERO_BG }}>
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
                {T(group.projects === 1 ? "{n} project" : "{n} projects", { n: group.projects })}
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
            {T("No members yet.")}
          </Typography>
        ) : (
          <List dense disablePadding sx={{ pl: 0.75 }}>
            {members.map((u) => (
              <ListItem
                key={u.uid}
                secondaryAction={
                  <Tooltip title={T("Remove from group")}>
                    <IconButton edge="end" size="small" disabled={busy} aria-label={`Remove ${u.fullName ?? u.email}`} onClick={() => void run(`/groups/${group.id}/members/${u.uid}`, { method: "DELETE" })}>
                      <PersonRemoveRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemAvatar sx={{ minWidth: 42 }}>
                  <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={30} />
                </ListItemAvatar>
                <ListItemText primary={u.fullName ?? u.email} secondary={TR(ROLE_NAME[u.role])} slotProps={{ primary: { noWrap: true } }} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
      <Divider />
      <Stack direction="row" sx={{ px: 1.5, py: 0.75, alignItems: "center" }}>
        <Button size="small" startIcon={<GroupAddRoundedIcon />} onClick={onAdd}>
          {T("Add member")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={group.projects ? T("Assigned to projects — can't delete") : T("Delete group")}>
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

function ReviewDialog({ request: r, groups, reload, onClose }: { request: Request; groups: Group[]; reload: () => Promise<void>; onClose: () => void }) {
  const [grant, setGrant] = useState<Role>(r.role);
  const [expiry, setExpiry] = useState({ expiresOn: "", noExpiry: false });
  const [groupId, setGroupId] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const { run, busy } = useAction(reload);
  const first = r.fullName.split(" ")[0];

  if (declining) {
    return (
      <MDialog title={T("Decline Request")} heading={T("Decline {name}'s request?", { name: first })} subtitle={T("They'll be told by email, and by WhatsApp or SMS. They can ask again later.")} onClose={onClose}>
        <Field
          label={T("Reason (sent to them)")}
          icon={<ChatBubbleOutlineRoundedIcon />}
          multiline
          minRows={3}
          placeholder={T("e.g. We couldn't find a project at this address yet — please call us.")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
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
            {busy ? T("Declining…") : T("Decline Request")}
          </Button>
          <Button size="large" onClick={() => setDeclining(false)}>
            {T("Cancel")}
          </Button>
        </Stack>
      </MDialog>
    );
  }

  return (
    <MDialog title={T("Review Request")} onClose={onClose}>
      <Stack sx={{ alignItems: "center", textAlign: "center", mb: 2.5 }}>
        <RoleAvatar name={r.fullName} role={r.role} size={68} />
        <Typography sx={{ mt: 1.25, color: "primary.main", fontWeight: 600, fontSize: 20 }}>{r.fullName}</Typography>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center", mt: 0.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {T("Asked for")}
          </Typography>
          <RoleChip role={r.role} />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            · {ago(r.createdAt)}
          </Typography>
        </Stack>
      </Stack>
      <Card sx={{ px: 2, py: 0.5, mb: 3 }}>
        <Detail k="Email" v={`${r.email}  ✓ verified`} />
        <Divider />
        <Detail k="Mobile" v={r.contactNo ?? "—"} />
        <Divider />
        <Detail k="Address" v={[r.address, r.postalCode].filter(Boolean).join(", ") || "—"} />
        <Divider />
        <Detail k="Note" v={r.note ? `“${r.note}”` : "—"} />
      </Card>
      <Stack sx={{ gap: 2.5 }}>
        <Field select label={T("Grant role")} icon={<BadgeRoundedIcon />} value={grant} onChange={(e) => setGrant(e.target.value as Role)} helperText={T("You can grant a different role from the one they asked for.")}>
          {ROLES.map((k) => (
            <MenuItem key={k} value={k}>
              {TR(ROLE_NAME[k])}
              {k === r.role ? " (requested)" : ""}
            </MenuItem>
          ))}
        </Field>
        {CREW.includes(grant) && (
          <Field select label={T("Contractor group")} icon={<GroupsRoundedIcon />} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <MenuItem value="">{T("None for now")}</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </Field>
        )}
        <ExpiryFields value={expiry} onChange={setExpiry} />
      </Stack>
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button
          size="large"
          variant="contained"
          disabled={busy || !(expiry.noExpiry || expiry.expiresOn)}
          onClick={async () => {
            const json = { role: grant, groupId: groupId ? Number(groupId) : null, ...expiry };
            if (await run(`/account-requests/${r.id}/approve`, { method: "POST", json })) onClose();
          }}
        >
          {busy ? T("Approving…") : T("Approve as {role}", { role: ROLE_NAME[grant] })}
        </Button>
        <Button size="large" variant="outlined" color="error" disabled={busy} onClick={() => setDeclining(true)}>
          {T("Decline")}
        </Button>
      </Stack>
    </MDialog>
  );
}

function RoleReviewDialog({ request: r, groups, reload, onClose }: { request: RoleRequest; groups: Group[]; reload: () => Promise<void>; onClose: () => void }) {
  const [grant, setGrant] = useState<Role>(r.role);
  const [groupId, setGroupId] = useState("");
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const { run, busy } = useAction(reload);
  const first = r.fullName.split(" ")[0];

  if (declining) {
    return (
      <MDialog title={T("Decline Request")} heading={T("Decline {name}'s request?", { name: first })} subtitle={T("They stay {role}. They'll be told in the app, by email, and by WhatsApp or SMS.", { role: r.fromLabel })} onClose={onClose}>
        <Field label={T("Reason (sent to them)")} icon={<ChatBubbleOutlineRoundedIcon />} multiline minRows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <Stack sx={{ gap: 1, mt: 3 }}>
          <Button
            size="large"
            variant="contained"
            color="error"
            disabled={busy}
            onClick={async () => {
              if (await run(`/role-requests/${r.id}/reject`, { method: "POST", json: { note } })) onClose();
            }}
          >
            {busy ? T("Declining…") : T("Decline Request")}
          </Button>
          <Button size="large" onClick={() => setDeclining(false)}>
            {T("Cancel")}
          </Button>
        </Stack>
      </MDialog>
    );
  }

  return (
    <MDialog title={T("Review Role Change")} onClose={onClose}>
      <Stack sx={{ alignItems: "center", textAlign: "center", mb: 2.5 }}>
        <RoleAvatar name={r.fullName} role={r.from} size={68} />
        <Typography sx={{ mt: 1.25, color: "primary.main", fontWeight: 600, fontSize: 20 }}>{r.fullName}</Typography>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center", mt: 0.5 }}>
          <RoleChip role={r.from} />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {T("to")}
          </Typography>
          <RoleChip role={r.role} />
        </Stack>
      </Stack>
      <Card sx={{ px: 2, py: 0.5, mb: 3 }}>
        <Detail k="Email" v={r.email} />
        <Divider />
        <Detail k="Mobile" v={r.contactNo ?? "—"} />
        <Divider />
        <Detail k="Asked" v={ago(r.createdAt)} />
        <Divider />
        <Detail k="Why" v={r.reason ? `“${r.reason}”` : "—"} />
      </Card>
      <Stack sx={{ gap: 2.5 }}>
        <Field select label={T("Grant role")} icon={<BadgeRoundedIcon />} value={grant} onChange={(e) => setGrant(e.target.value as Role)} helperText={T("You can grant a different role from the one they asked for. The change is in the audit log and can be reverted there.")}>
          {ROLES.filter((k) => k !== r.from).map((k) => (
            <MenuItem key={k} value={k}>
              {TR(ROLE_NAME[k])}
              {k === r.role ? " (requested)" : ""}
            </MenuItem>
          ))}
        </Field>
        {CREW.includes(grant) && !CREW.includes(r.from) && (
          <Field select label={T("Contractor group")} icon={<GroupsRoundedIcon />} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <MenuItem value="">{T("None for now")}</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </Field>
        )}
      </Stack>
      <Stack sx={{ gap: 1, mt: 3 }}>
        <Button
          size="large"
          variant="contained"
          disabled={busy}
          onClick={async () => {
            const json = { role: grant, groupId: groupId ? Number(groupId) : null };
            if (await run(`/role-requests/${r.id}/approve`, { method: "POST", json })) onClose();
          }}
        >
          {busy ? T("Approving…") : T("Make {name} {role}", { name: first, role: ROLE_NAME[grant] })}
        </Button>
        <Button size="large" variant="outlined" color="error" disabled={busy} onClick={() => setDeclining(true)}>
          {T("Decline")}
        </Button>
      </Stack>
    </MDialog>
  );
}

function NewUserDialog({ groups, reload, onClose }: { groups: Group[]; reload: () => Promise<void>; onClose: () => void }) {
  const { run, busy } = useAction(reload);
  const [f, setF] = useState({ fullName: "", email: "", role: "homeowner" as Role, contactNo: "", groupId: "", postalCode: "", address: "", icLast4: "" });
  const [expiry, setExpiry] = useState({ expiresOn: "", noExpiry: false });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const mobileOk = splitPhone(f.contactNo).local.replace(/\D/g, "").length >= 6;
  const expiryOk = expiry.noExpiry || Boolean(expiry.expiresOn);
  const ok = f.fullName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) && mobileOk && expiryOk;

  return (
    <MDialog
      title={T("New Account")}
      heading={T("Create their login")}
      subtitle={T("They'll get an email, and a WhatsApp (or SMS) message, inviting them in with this role.")}
      onClose={onClose}
    >
      <Stack sx={{ gap: 2.5 }}>
        <Field label={T("Full name")} required icon={<PersonOutlineRoundedIcon />} placeholder={T("e.g. Aisha Rahman")} value={f.fullName} onChange={set("fullName")} autoComplete="off" />
        <Field label={T("Email")} required type="email" icon={<MailOutlineRoundedIcon />} placeholder={T("name@example.com")} value={f.email} onChange={set("email")} autoComplete="off" />
        <PhoneField required value={f.contactNo} onChange={(v) => setF((x) => ({ ...x, contactNo: v }))} helperText={T("For WhatsApp, or SMS if WhatsApp can't deliver")} />
        <Field select label={T("Role")} required icon={<BadgeRoundedIcon />} value={f.role} onChange={set("role")}>
          {ROLES.map((k) => (
            <MenuItem key={k} value={k}>
              {TR(ROLE_NAME[k])}
            </MenuItem>
          ))}
        </Field>
        {CREW.includes(f.role) && (
          <Field select label={T("Contractor group")} icon={<GroupsRoundedIcon />} value={f.groupId} onChange={set("groupId")}>
            <MenuItem value="">{T("None for now")}</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={String(g.id)}>
                {g.name}
              </MenuItem>
            ))}
          </Field>
        )}
        <Stack direction="row" sx={{ gap: 1.5 }}>
          <Field label={T("Postal code")} icon={<PlaceOutlinedIcon />} placeholder={T("6 digits")} value={f.postalCode} onChange={set("postalCode")} slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }} />
          {f.role === "homeowner" && (
            <Field label={T("NRIC last 4")} icon={<FingerprintRoundedIcon />} placeholder="567D" value={f.icLast4} onChange={set("icLast4")} slotProps={{ htmlInput: { maxLength: 4 } }} />
          )}
        </Stack>
        <Field label={T("Address")} icon={<HomeOutlinedIcon />} placeholder={T("Filled in from the postal code")} value={f.address} onChange={set("address")} />
        <ExpiryFields value={expiry} onChange={setExpiry} />
      </Stack>
      <Button
        fullWidth
        size="large"
        variant="contained"
        disabled={busy || !ok}
        sx={{ mt: 3 }}
        onClick={async () => {
          if (await run("/people", { method: "POST", json: { ...f, ...expiry, groupId: f.groupId ? Number(f.groupId) : null } })) onClose();
        }}
      >
        {busy ? T("Creating…") : T("Create Account")}
      </Button>
      <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.secondary", mt: 1.25 }}>
        {ok ? T("We never ask for a full NRIC.") : !expiryOk && f.fullName && mobileOk ? T("Set when the account expires, or tick No expiry.") : T("Enter their name, email and mobile.")}
      </Typography>
    </MDialog>
  );
}

function NewGroupDialog({ reload, onClose }: { reload: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const { run, busy } = useAction(reload);
  return (
    <MDialog title={T("New Group")} heading={T("Create a contractor group")} subtitle={T("Groups can be assigned to projects as one unit.")} onClose={onClose} maxWidth="xs">
      <Field label={T("Group name")} required icon={<GroupsRoundedIcon />} placeholder={T("e.g. Northline Roofing Pte Ltd")} value={name} onChange={(e) => setName(e.target.value)} />
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
        {T("Create Group")}
      </Button>
    </MDialog>
  );
}

function AddMemberDialog({ group, users, groupById, reload, onClose }: { group: Group; users: Person[]; groupById: Map<number, Group>; reload: () => Promise<void>; onClose: () => void }) {
  const { run, busy } = useAction(reload);
  const avail = users.filter((u) => CREW.includes(u.role) && u.active && !group.members.includes(u.uid));
  return (
    <MDialog title={T("Add Member")} heading={group.name} subtitle={T("Contractor admins and EPC crew. A person can be in more than one group.")} onClose={onClose}>
      {avail.length === 0 ? (
        <Alert severity="info">{T("Everyone eligible is already a member. Create a contractor admin or EPC account first.")}</Alert>
      ) : (
        <Card>
          <List disablePadding>
            {avail.map((u, i) => (
              <ListItemButton key={u.uid} divider={i < avail.length - 1} disabled={busy} onClick={() => void run(`/groups/${group.id}/members`, { method: "POST", json: { uid: u.uid } })}>
                <ListItemAvatar>
                  <RoleAvatar name={u.fullName ?? u.email} role={u.role} />
                </ListItemAvatar>
                <ListItemText primary={u.fullName ?? u.email} secondary={`${TR(ROLE_NAME[u.role])}${u.groups.length ? ` · in ${u.groups.map((g) => groupById.get(g)?.name).join(", ")}` : ""}`} />
                <Chip size="small" color="primary" label={T("Add")} />
              </ListItemButton>
            ))}
          </List>
        </Card>
      )}
    </MDialog>
  );
}

/**
 * Enabled now, when the account expires (disables itself), and, while it's
 * disabled, when it enables itself. Only project managers see this.
 */
function AccountSchedule({ person: u, busy, run }: { person: Person; busy: boolean; run: (path: string, init: RequestInit & { json?: unknown }) => Promise<boolean> }) {
  const [disableOn, setDisableOn] = useState(u.disableOn ?? "");
  const [enableOn, setEnableOn] = useState(u.enableOn ?? "");
  const tomorrow = tomorrowSg();
  const save = (json: Record<string, unknown>) => void run(`/people/${u.uid}`, { method: "PATCH", json });
  const expired = !u.active && u.disabledReason === "scheduled";
  return (
    <SettingRow
      icon={<PowerSettingsNewRoundedIcon />}
      tint="#CE2E33"
      label={T("Account enabled")}
      sub={expired ? T("Expired on {date}. Move the expiry date later to enable it again.", { date: day(u.disableOn ?? "") }) : "Disabling blocks sign-in; history stays in the audit log"}
      right={<Switch checked={u.active} disabled={busy || expired} onChange={() => save({ active: !u.active })} slotProps={{ input: { "aria-label": T("Account enabled") } }} />}
    >
      <Stack sx={{ gap: 2 }} data-testid="account-schedule">
        <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
          <Field
            label={T("Expires on")}
            type="date"
            icon={<EventBusyRoundedIcon />}
            value={disableOn}
            onChange={(e) => setDisableOn(e.target.value)}
            helperText={u.disableOn ? undefined : "No expiry"}
            slotProps={{ htmlInput: { min: tomorrow, "data-testid": "disable-on" } }}
          />
          <Button variant="outlined" disabled={busy || disableOn === (u.disableOn ?? "") || !disableOn} onClick={() => save({ disableOn })} sx={{ flex: "0 0 auto", height: 52 }}>
            {T("Save")}
          </Button>
        </Stack>
        {u.disableOn && (
          <Button size="small" disabled={busy} onClick={() => save({ disableOn: null })} sx={{ alignSelf: "flex-start", mt: -1.5 }}>
            {T("Remove the expiry")}
          </Button>
        )}
        {!u.active && (
          <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
            <Field
              label={T("Enable again on")}
              type="date"
              icon={<EventAvailableRoundedIcon />}
              value={enableOn}
              onChange={(e) => setEnableOn(e.target.value)}
              helperText={u.enableOn ? undefined : "Stays disabled until a project manager enables it"}
              slotProps={{ htmlInput: { min: tomorrow, "data-testid": "enable-on" } }}
            />
            <Button variant="outlined" disabled={busy || enableOn === (u.enableOn ?? "") || !enableOn} onClick={() => save({ enableOn })} sx={{ flex: "0 0 auto", height: 52 }}>
              {T("Save")}
            </Button>
          </Stack>
        )}
      </Stack>
    </SettingRow>
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
        <WaveHeader title={T("Profile")} onBack={onClose} height={150} />

        <Card sx={{ mx: 2.5, mt: -4, pt: 6.5, pb: 2.5, px: 2, textAlign: "center", overflow: "visible", position: "relative" }}>
          <Box sx={{ position: "absolute", left: "50%", top: -40, transform: "translateX(-50%)", borderRadius: "50%", p: 0.5, bgcolor: "background.paper" }}>
            {/* Project managers can replace or remove anyone's picture. */}
            <AvatarEditor name={u.fullName ?? u.email} role={u.role} src={u.avatar} base={isMe ? "/me" : `/people/${u.uid}`} size={76} onChanged={reload} />
          </Box>
          <Typography variant="h6">{u.fullName ?? u.email}</Typography>
          <Typography sx={{ color: "text.secondary", mt: 0.25 }}>{u.contactNo ?? T("No mobile on file")}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {u.email}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, justifyContent: "center", mt: 1.5, flexWrap: "wrap" }}>
            <RoleChip role={u.role} />
            <StatusBadge status={status} />
          </Stack>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1 }}>
            {u.linked ? T("Has signed in") : u.invitedAt ? T("Invited {date} — not signed in yet", { date: d2s(u.invitedAt) }) : T("No login yet")}
          </Typography>
        </Card>

        <Box sx={{ px: 2.5 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 17, mt: 3, mb: 1.5 }}>{T("General")}</Typography>
          <Stack sx={{ gap: 1.25 }}>
            <SettingRow icon={<BadgeRoundedIcon />} tint="#2563EB" label={T("Role")} sub={T("Controls what they can see and edit")}>
              <TextField
                select
                size="small"
                value={u.role}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as Role;
                  const leaving = CREW.includes(u.role) && !CREW.includes(next) && u.groups.length > 0;
                  if (leaving && !confirm(T("{name} will also leave their contractor groups. Continue?", { name: u.fullName ?? T("They") }))) return;
                  void run(`/people/${u.uid}`, { method: "PATCH", json: { role: next } });
                }}
              >
                {ROLES.map((k) => (
                  <MenuItem key={k} value={k}>
                    {TR(ROLE_NAME[k])}
                  </MenuItem>
                ))}
              </TextField>
            </SettingRow>

            {CREW.includes(u.role) && (
              <SettingRow icon={<GroupsRoundedIcon />} tint="#B45309" label={T("Contractor groups")} sub={u.groups.length ? T("Tap to add or remove") : T("Not in a group — sees no contractor projects")}>
                <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                  {groups.length === 0 && (
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      {T("No groups exist yet.")}
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

            <SettingRow icon={<SolarPowerRoundedIcon />} tint="#0A9A63" label={T("Projects they can open")} right={<Chip size="small" label={projects?.length ?? "…"} />}>
              {!projects && <Skeleton variant="rounded" height={40} />}
              {projects && projects.length === 0 && (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {T("None yet.")}
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

            {!isMe && <AccountSchedule person={u} busy={busy} run={run} />}
          </Stack>
        </Box>
      </Box>
    </Dialog>
  );
}
