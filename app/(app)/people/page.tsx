"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Alert from "@mui/material/Alert";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { alpha } from "@mui/material/styles";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { MDialog, PhoneField, ROLE_NAME, RoleAvatar, RoleChip, SectionTitle } from "@/components/m";
import { Header, Page } from "@/components/shell";
import { ago, d2s, initials } from "@/components/ui";
import { ApiError, useApi, useFetcher } from "@/lib/client/api";
import { type Role, useApp, useMe } from "@/lib/client/app-state";

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
const FILTERS: Array<[Role | "all", string]> = [
  ["all", "All"],
  ["homeowner", "Homeowners"],
  ["contractor", "Contractor admins"],
  ["epc_team", "EPC team"],
  ["project_manager", "Project managers"],
];

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
  const [filter, setFilter] = useState<Role | "all">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (me && me.role !== "project_manager") router.replace("/");
  }, [me, router]);

  const byId = useMemo(() => new Map((data?.users ?? []).map((u) => [u.uid, u])), [data]);
  const groupById = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g])), [data]);

  if (!me || me.role !== "project_manager") return null;

  const needle = q.trim().toLowerCase();
  const people = (data?.users ?? []).filter(
    (u) =>
      (filter === "all" || u.role === filter) &&
      (!needle || `${u.fullName ?? ""} ${u.email}`.toLowerCase().includes(needle))
  );
  const counts = (r: Role | "all") => (data?.users ?? []).filter((u) => r === "all" || u.role === r).length;
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
        {!data && !error && <LoadingCards />}

        {data && (
          <>
            {/* -------------------------------------------- requests */}
            {data.requests.length > 0 && (
              <>
                <SectionTitle title="Waiting for approval" count={data.requests.length} />
                <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", xl: "1fr 1fr 1fr" } }}>
                  {data.requests.map((r) => (
                    <Card
                      key={r.id}
                      sx={(t) => ({
                        p: 2,
                        borderLeft: `4px solid ${t.palette.warning.main}`,
                        bgcolor: alpha(t.palette.warning.main, 0.05),
                      })}
                    >
                      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
                        <RoleAvatar name={r.fullName} role={r.role} size={46} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography noWrap sx={{ fontWeight: 600 }}>
                            {r.fullName}
                          </Typography>
                          <Typography noWrap variant="body2" sx={{ color: "text.secondary" }}>
                            {r.email}
                          </Typography>
                        </Box>
                        <Chip size="small" color="warning" label="New" />
                      </Stack>
                      <Stack direction="row" sx={{ gap: 1, mt: 1.5, alignItems: "center", flexWrap: "wrap" }}>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          Asked for
                        </Typography>
                        <RoleChip role={r.role} />
                        <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
                          {ago(r.createdAt)}
                        </Typography>
                      </Stack>
                      <Button fullWidth variant="contained" sx={{ mt: 2 }} onClick={() => setDialog({ kind: "review", id: r.id })}>
                        Review request
                      </Button>
                    </Card>
                  ))}
                </Box>
              </>
            )}

            <Box
              sx={{
                display: "grid",
                gap: { xs: 0, lg: 4 },
                gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 360px" },
                alignItems: "start",
              }}
            >
              {/* ---------------------------------------- accounts */}
              <Box>
                <SectionTitle title="All accounts" count={data.users.length} />
                <Stack direction={{ xs: "column", md: "row" }} sx={{ gap: 1.5, mb: 2, alignItems: { md: "center" }, minWidth: 0 }}>
                  <TextField
                    size="small"
                    placeholder="Search by name or email"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    sx={{ maxWidth: { md: 300 } }}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchRoundedIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <Stack direction="row" sx={{ gap: 1, overflowX: "auto", pb: 0.5, scrollbarWidth: "none" }}>
                    {FILTERS.map(([k, l]) => (
                      <Chip
                        key={k}
                        label={`${l} · ${counts(k)}`}
                        color={filter === k ? "primary" : "default"}
                        variant={filter === k ? "filled" : "outlined"}
                        onClick={() => setFilter(k)}
                        sx={{ flex: "0 0 auto" }}
                      />
                    ))}
                  </Stack>
                </Stack>

                {people.length === 0 ? (
                  <Card sx={{ p: 5, textAlign: "center", color: "text.secondary" }}>No accounts match.</Card>
                ) : (
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.5,
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr", lg: "1fr 1fr" },
                    }}
                  >
                    {people.map((u) => (
                      <PersonCard
                        key={u.uid}
                        person={u}
                        groupNames={u.groups.map((g) => groupById.get(g)?.name ?? "")}
                        onOpen={() => setDialog({ kind: "person", uid: u.uid })}
                      />
                    ))}
                  </Box>
                )}
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1.5 }}>
                  Moving someone between groups changes which projects they can open. Every change is written to the
                  audit log.
                </Typography>
              </Box>

              {/* ------------------------------------------ groups */}
              <Box>
                <SectionTitle
                  title="Contractor groups"
                  count={data.groups.length}
                  action={
                    <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setDialog({ kind: "newgroup" })}>
                      New group
                    </Button>
                  }
                />
                <Stack sx={{ gap: 1.5 }}>
                  {data.groups.length === 0 && (
                    <Card sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>No groups yet.</Card>
                  )}
                  {data.groups.map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      byId={byId}
                      reload={reload}
                      onAdd={() => setDialog({ kind: "addmember", id: g.id })}
                    />
                  ))}
                </Stack>
              </Box>
            </Box>
          </>
        )}
      </Page>

      {/* Phones: a floating "new account" button instead of the header one. */}
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
          borderRadius: 4,
          boxShadow: 6,
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
        <PersonDialog
          person={byId.get(dialog.uid)!}
          isMe={dialog.uid === data.me}
          groups={data.groups}
          reload={reload}
          onClose={close}
        />
      )}
    </>
  );
}

function LoadingCards() {
  return (
    <Box sx={{ display: "grid", gap: 1.5, mt: 4, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" } }}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={124} sx={{ borderRadius: 4.5 }} />
      ))}
    </Box>
  );
}

// ------------------------------------------------------------- cards

function PersonCard({ person: u, groupNames, onOpen }: { person: Person; groupNames: string[]; onOpen: () => void }) {
  return (
    <Card sx={{ opacity: u.active ? 1 : 0.55 }}>
      <CardActionArea onClick={onOpen} sx={{ p: 2, height: "100%", display: "flex", alignItems: "flex-start", flexDirection: "column" }}>
        <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", width: "100%" }}>
          <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={46} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600 }}>
              {u.fullName ?? u.email}
            </Typography>
            <Typography noWrap variant="body2" sx={{ color: "text.secondary" }}>
              {u.email}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" sx={{ gap: 0.75, mt: 1.5, flexWrap: "wrap" }}>
          <RoleChip role={u.role} />
          {!u.active && <Chip size="small" color="error" variant="outlined" label="Disabled" />}
          {u.active && !u.linked && u.invitedAt && (
            <Chip size="small" variant="outlined" icon={<MailOutlineRoundedIcon />} label="Invited" />
          )}
          {groupNames.map((g) => (
            <Chip key={g} size="small" variant="outlined" label={g} />
          ))}
        </Stack>
      </CardActionArea>
    </Card>
  );
}

function GroupCard({
  group,
  byId,
  reload,
  onAdd,
}: {
  group: Group;
  byId: Map<number, Person>;
  reload: () => Promise<void>;
  onAdd: () => void;
}) {
  const { run, busy } = useAction(reload);
  const members = group.members.map((id) => byId.get(id)).filter((u): u is Person => Boolean(u));
  return (
    <Card>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", p: 2 }}>
        <Box
          sx={(t) => ({
            width: 46,
            height: 46,
            borderRadius: 3,
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 14,
            color: "primary.contrastText",
            background: `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.primary.dark})`,
          })}
        >
          {initials(group.name)}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600 }}>
            {group.name}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {members.length} member{members.length === 1 ? "" : "s"} · {group.projects} project
            {group.projects === 1 ? "" : "s"}
          </Typography>
        </Box>
        <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 28, height: 28, fontSize: 11 } }}>
          {members.map((u) => (
            <RoleAvatar key={u.uid} name={u.fullName ?? u.email} role={u.role} size={28} />
          ))}
        </AvatarGroup>
      </Stack>
      <Divider />
      {members.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary", px: 2, py: 1.5 }}>
          No members yet.
        </Typography>
      ) : (
        <List dense disablePadding>
          {members.map((u) => (
            <ListItem
              key={u.uid}
              secondaryAction={
                <Tooltip title="Remove from group">
                  <IconButton
                    edge="end"
                    size="small"
                    disabled={busy}
                    aria-label={`Remove ${u.fullName ?? u.email}`}
                    onClick={() => void run(`/groups/${group.id}/members/${u.uid}`, { method: "DELETE" })}
                  >
                    <PersonRemoveRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemAvatar sx={{ minWidth: 44 }}>
                <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={32} />
              </ListItemAvatar>
              <ListItemText primary={u.fullName ?? u.email} secondary={ROLE_NAME[u.role]} />
            </ListItem>
          ))}
        </List>
      )}
      <Divider />
      <Stack direction="row" sx={{ px: 1, py: 0.75, alignItems: "center" }}>
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
    </Card>
  );
}

// ------------------------------------------------------------ dialogs

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
        <TextField
          label="Reason (sent to them)"
          multiline
          minRows={3}
          placeholder="e.g. We couldn't find a project at this address yet — please call us."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          sx={{ mt: 1 }}
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
            {busy ? "Declining…" : "Decline request"}
          </Button>
          <Button size="large" onClick={() => setDeclining(false)}>
            Cancel
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.secondary", mt: 1 }}>
          They can send a new request later. Every decision is in the audit log.
        </Typography>
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
      <TextField
        select
        label="Grant role"
        value={grant}
        onChange={(e) => setGrant(e.target.value as Role)}
        helperText="You can grant a different role from the one they asked for."
      >
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
  const [f, setF] = useState({
    fullName: "",
    email: "",
    role: "homeowner" as Role,
    contactNo: "",
    groupId: "",
    postalCode: "",
    address: "",
    icLast4: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ok = f.fullName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());

  return (
    <MDialog title="New account" subtitle="Creates a login and sends them an invitation" onClose={onClose}>
      <Stack sx={{ gap: 2.25, mt: 1 }}>
        <TextField label="Full name" required value={f.fullName} onChange={set("fullName")} autoComplete="off" />
        <TextField label="Email" required type="email" value={f.email} onChange={set("email")} autoComplete="off" />
        <PhoneField
          value={f.contactNo}
          onChange={(v) => setF((x) => ({ ...x, contactNo: v }))}
          helperText="For WhatsApp, or SMS if WhatsApp can't deliver"
        />
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
          <TextField
            label="Postal code"
            value={f.postalCode}
            onChange={set("postalCode")}
            slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
          />
          {f.role === "homeowner" && (
            <TextField
              label="NRIC last 4"
              placeholder="567D"
              value={f.icLast4}
              onChange={set("icLast4")}
              slotProps={{ htmlInput: { maxLength: 4 } }}
            />
          )}
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

function AddMemberDialog({
  group,
  users,
  groupById,
  reload,
  onClose,
}: {
  group: Group;
  users: Person[];
  groupById: Map<number, Group>;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { run, busy } = useAction(reload);
  const avail = users.filter((u) => CREW.includes(u.role) && u.active && !group.members.includes(u.uid));
  return (
    <MDialog title="Add member" subtitle={group.name} onClose={onClose}>
      {avail.length === 0 ? (
        <Alert severity="info">Everyone eligible is already a member. Create a contractor admin or EPC account first.</Alert>
      ) : (
        <List disablePadding>
          {avail.map((u) => (
            <ListItemButton
              key={u.uid}
              disabled={busy}
              onClick={() => void run(`/groups/${group.id}/members`, { method: "POST", json: { uid: u.uid } })}
            >
              <ListItemAvatar>
                <RoleAvatar name={u.fullName ?? u.email} role={u.role} />
              </ListItemAvatar>
              <ListItemText
                primary={u.fullName ?? u.email}
                secondary={`${ROLE_NAME[u.role]}${
                  u.groups.length ? ` · in ${u.groups.map((g) => groupById.get(g)?.name).join(", ")}` : ""
                }`}
              />
              <Chip size="small" color="primary" label="Add" />
            </ListItemButton>
          ))}
        </List>
      )}
      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 2 }}>
        A person can belong to more than one group. Adding them here doesn&apos;t remove them from another.
      </Typography>
    </MDialog>
  );
}

function PersonDialog({
  person: u,
  isMe,
  groups,
  reload,
  onClose,
}: {
  person: Person;
  isMe: boolean;
  groups: Group[];
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { run, busy } = useAction(reload);
  const { data: projects } = useApi<Array<{ id: number; name: string; status: string }>>(`/people/${u.uid}/projects`);

  return (
    <MDialog title={u.fullName ?? u.email} subtitle={u.email} onClose={onClose}>
      <Stack direction="row" sx={{ gap: 2, alignItems: "center", mb: 3 }}>
        <RoleAvatar name={u.fullName ?? u.email} role={u.role} size={60} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
            <RoleChip role={u.role} />
            <Chip size="small" color={u.active ? "success" : "error"} variant="outlined" label={u.active ? "Active" : "Disabled"} />
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
            {u.contactNo ?? "No mobile on file"}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {u.linked ? "Has signed in" : u.invitedAt ? `Invited ${d2s(u.invitedAt)} — not signed in yet` : "No login yet"}
          </Typography>
        </Box>
      </Stack>

      <TextField
        select
        label="Role"
        value={u.role}
        disabled={busy}
        helperText="Controls what they can see and edit. Takes effect immediately."
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

      {CREW.includes(u.role) && (
        <>
          <SectionTitle title="Contractor groups" />
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
                  onClick={() =>
                    void run(
                      inIt ? `/groups/${g.id}/members/${u.uid}` : `/groups/${g.id}/members`,
                      inIt ? { method: "DELETE" } : { method: "POST", json: { uid: u.uid } }
                    )
                  }
                />
              );
            })}
          </Stack>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1 }}>
            {u.groups.length ? "Tap a group to add or remove." : "Not in any group — they see no contractor projects."}
          </Typography>
        </>
      )}

      <SectionTitle title="Projects they can open" count={projects?.length} />
      {!projects && <Skeleton variant="rounded" height={56} />}
      {projects && projects.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          None yet.
        </Typography>
      )}
      {projects && projects.length > 0 && (
        <Card>
          <List dense disablePadding>
            {projects.map((p, i) => (
              <ListItem key={p.id} divider={i < projects.length - 1}>
                <ListItemText primary={p.name} secondary={p.status.replace(/_/g, " ")} />
              </ListItem>
            ))}
          </List>
        </Card>
      )}

      {!isMe && (
        <Card sx={{ mt: 3, p: 2 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>Account enabled</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Disabling blocks sign-in but keeps their history in the audit log.
              </Typography>
            </Box>
            <Switch
              checked={u.active}
              disabled={busy}
              onChange={() => void run(`/people/${u.uid}`, { method: "PATCH", json: { active: !u.active } })}
              slotProps={{ input: { "aria-label": "Account enabled" } }}
            />
          </Stack>
        </Card>
      )}
    </MDialog>
  );
}
