"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { I } from "@/components/icons";
import { PhoneInput } from "@/components/phone-input";
import { Header } from "@/components/shell";
import { Pill, Sec, Sheet, ago, d2s, initials } from "@/components/ui";
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

const ROLE_NAME: Record<Role, string> = {
  homeowner: "Homeowner",
  contractor: "Contractor Admin",
  epc_team: "EPC Team",
  project_manager: "Project Manager",
};
const ROLE_SHORT: Record<Role, string> = {
  homeowner: "Homeowner",
  contractor: "Admin",
  epc_team: "EPC",
  project_manager: "PM",
};
const CREW: Role[] = ["contractor", "epc_team"];

type SheetState =
  | { kind: "review"; request: Request }
  | { kind: "newuser" }
  | { kind: "newgroup" }
  | { kind: "addmember"; group: Group }
  | { kind: "user"; uid: number }
  | null;

/** Hook for one write: runs it, toasts the server's message, reloads. */
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
  const [sheet, setSheet] = useState<SheetState>(null);
  const [filter, setFilter] = useState<Role | "all">("all");

  useEffect(() => {
    if (me && me.role !== "project_manager") router.replace("/");
  }, [me, router]);

  const byId = useMemo(() => new Map((data?.users ?? []).map((u) => [u.uid, u])), [data]);
  const groupName = (id: number) => data?.groups.find((g) => g.id === id)?.name ?? "";

  if (!me || me.role !== "project_manager") return null;
  const list = (data?.users ?? []).filter((u) => filter === "all" || u.role === filter);

  return (
    <>
      <Header
        title="People"
        sub="Accounts & contractor groups"
        right={
          <button className="icobtn brand" aria-label="New account" onClick={() => setSheet({ kind: "newuser" })}>
            <I.plus size={19} />
          </button>
        }
      />
      <div className="scroll">
        {error && <div className="err" style={{ marginTop: 14 }}>{error.message}</div>}
        {!data && !error && <div className="skeleton" style={{ height: 320, marginTop: 18 }} />}

        {data && (
          <div className="cols">
            <div>
              {data.requests.length > 0 && (
                <>
                  <Sec title="Waiting for approval" right={<Pill tone="warn">{data.requests.length}</Pill>} />
                  <div className="plist">
                    {data.requests.map((r) => (
                      <div key={r.id} className="card">
                        <div className="row">
                          <span className="ava">{initials(r.fullName)}</span>
                          <div className="grow">
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.fullName}</div>
                            <div className="tiny">
                              Asked for {r.roleLabel} · {ago(r.createdAt)}
                            </div>
                          </div>
                          <Pill tone="warn">New</Pill>
                        </div>
                        <button
                          className="btn p full"
                          style={{ height: 40, marginTop: 12, fontSize: 13.5 }}
                          onClick={() => setSheet({ kind: "review", request: r })}
                        >
                          Review
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Sec title="All accounts" right={<span className="tiny">{data.users.length}</span>} />
              <div className="filters">
                {(
                  [
                    ["all", "All"],
                    ["homeowner", "Homeowners"],
                    ["contractor", "Contractor admin"],
                    ["epc_team", "EPC team"],
                    ["project_manager", "Project managers"],
                  ] as Array<[Role | "all", string]>
                ).map(([k, l]) => (
                  <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="card" style={{ padding: "1px 15px", marginTop: 10 }}>
                {list.length === 0 && <div className="empty">No accounts match this filter.</div>}
                {list.map((u) => (
                  <button
                    key={u.uid}
                    className={`urow ${u.active ? "" : "off"}`}
                    onClick={() => setSheet({ kind: "user", uid: u.uid })}
                  >
                    <span className={`ava ${u.role === "project_manager" ? "brand" : ""}`}>
                      {initials(u.fullName ?? u.email)}
                    </span>
                    <span className="grow">
                      <span className="un">
                        {u.fullName ?? u.email}
                        {u.active ? "" : " · disabled"}
                      </span>
                      <span className="ue">
                        {u.email}
                        {!u.linked && u.invitedAt ? " · invited, not signed in yet" : ""}
                      </span>
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                      <Pill>{ROLE_SHORT[u.role]}</Pill>
                      {u.groups.length > 0 && (
                        <span className="tiny" style={{ fontSize: 9 }}>
                          {u.groups.map((g) => initials(groupName(g))).join(" · ")}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <div className="tiny" style={{ marginTop: 12 }}>
                Moving someone between groups changes which projects they can open. Every change here is written to
                the audit log.
              </div>
            </div>

            <div>
              <Sec
                title="Contractor groups"
                right={
                  <button className="link" onClick={() => setSheet({ kind: "newgroup" })}>
                    New group
                  </button>
                }
              />
              {data.groups.length === 0 && <div className="empty">No groups yet.</div>}
              {data.groups.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  byId={byId}
                  reload={reload}
                  onAdd={() => setSheet({ kind: "addmember", group: g })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {data && sheet?.kind === "review" && (
        <ReviewSheet request={sheet.request} reload={reload} onClose={() => setSheet(null)} />
      )}
      {data && sheet?.kind === "newuser" && <NewUserSheet groups={data.groups} reload={reload} onClose={() => setSheet(null)} />}
      {data && sheet?.kind === "newgroup" && <NewGroupSheet reload={reload} onClose={() => setSheet(null)} />}
      {data && sheet?.kind === "addmember" && (
        <AddMemberSheet
          group={data.groups.find((g) => g.id === sheet.group.id) ?? sheet.group}
          users={data.users}
          groupName={groupName}
          reload={reload}
          onClose={() => setSheet(null)}
        />
      )}
      {data && sheet?.kind === "user" && byId.get(sheet.uid) && (
        <UserSheet
          user={byId.get(sheet.uid)!}
          isMe={sheet.uid === data.me}
          groups={data.groups}
          reload={reload}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------- groups

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
  return (
    <div className="gcard">
      <div className="gh">
        <span className="ava brand">{initials(group.name)}</span>
        <div className="grow">
          <div className="gn">{group.name}</div>
          <div className="gs">
            {group.members.length} member{group.members.length === 1 ? "" : "s"} · {group.projects} project
            {group.projects === 1 ? "" : "s"}
          </div>
        </div>
        <button
          className="rmx"
          title="Delete group"
          aria-label={`Delete ${group.name}`}
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete ${group.name}?`)) void run(`/groups/${group.id}`, { method: "DELETE" });
          }}
        >
          <I.x size={14} />
        </button>
      </div>
      <div className="gb">
        {group.members.length === 0 && (
          <div className="tiny" style={{ padding: "15px 0" }}>
            No members yet.
          </div>
        )}
        {group.members.map((uid) => {
          const u = byId.get(uid);
          if (!u) return null;
          return (
            <div key={uid} className={`urow ${u.active ? "" : "off"}`}>
              <span className="ava">{initials(u.fullName ?? u.email)}</span>
              <span className="grow">
                <span className="un">{u.fullName ?? u.email}</span>
                <span className="ue">
                  {ROLE_NAME[u.role]} · {u.email}
                </span>
              </span>
              <button
                className="rmx"
                title="Remove from group"
                aria-label={`Remove ${u.fullName ?? u.email}`}
                disabled={busy}
                onClick={() => void run(`/groups/${group.id}/members/${uid}`, { method: "DELETE" })}
              >
                <I.minus size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="gf">
        <button className="link" onClick={onAdd}>
          + Add member
        </button>
      </div>
    </div>
  );
}

function NewGroupSheet({ reload, onClose }: { reload: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const { run, busy } = useAction(reload);
  return (
    <Sheet title="New Contractor Group" sub="Groups can be assigned to projects as one unit" onClose={onClose}>
      <div className="fld">
        <label htmlFor="ng-name">
          Group name<span className="req">*</span>
        </label>
        <input
          id="ng-name"
          className="inp"
          placeholder="e.g. Northline Roofing Pte Ltd"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <button
        className="btn p full"
        disabled={busy || name.trim().length < 3}
        onClick={async () => {
          if (await run("/groups", { method: "POST", json: { name } })) onClose();
        }}
      >
        Create group
      </button>
      <div className="tiny" style={{ textAlign: "center", marginTop: 10 }}>
        Add members after the group is created.
      </div>
    </Sheet>
  );
}

function AddMemberSheet({
  group,
  users,
  groupName,
  reload,
  onClose,
}: {
  group: Group;
  users: Person[];
  groupName: (id: number) => string;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { run, busy } = useAction(reload);
  const avail = users.filter((u) => CREW.includes(u.role) && u.active && !group.members.includes(u.uid));
  return (
    <Sheet title="Add Member" sub={group.name} onClose={onClose}>
      {avail.length === 0 ? (
        <div className="empty">Everyone eligible is already a member. Create a contractor or EPC account first.</div>
      ) : (
        <div className="card" style={{ padding: "1px 15px" }}>
          {avail.map((u) => (
            <button
              key={u.uid}
              className="urow"
              disabled={busy}
              onClick={() => void run(`/groups/${group.id}/members`, { method: "POST", json: { uid: u.uid } })}
            >
              <span className="ava">{initials(u.fullName ?? u.email)}</span>
              <span className="grow">
                <span className="un">{u.fullName ?? u.email}</span>
                <span className="ue">
                  {ROLE_NAME[u.role]}
                  {u.groups.length ? ` · currently in ${u.groups.map(groupName).join(", ")}` : ""}
                </span>
              </span>
              <Pill tone="ok">Add</Pill>
            </button>
          ))}
        </div>
      )}
      <div className="tiny" style={{ marginTop: 12 }}>
        A person can belong to more than one group. Adding them here doesn&apos;t remove them from another.
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------ requests

function ReviewSheet({
  request: r,
  reload,
  onClose,
}: {
  request: Request;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [grant, setGrant] = useState<Role>(r.role);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const { run, busy } = useAction(reload);
  const first = r.fullName.split(" ")[0];

  if (declining) {
    return (
      <Sheet title={`Decline ${first}'s request?`} sub="They'll be told by email and WhatsApp/SMS" onClose={onClose}>
        <div className="fld">
          <label htmlFor="rv-reason">
            Reason<span className="opt">Sent to them</span>
          </label>
          <textarea
            id="rv-reason"
            className="inp"
            placeholder="e.g. We couldn't find a project at this address yet — please call us."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <button
          className="btn full"
          style={{ background: "var(--bad)", color: "#fff" }}
          disabled={busy}
          onClick={async () => {
            if (await run(`/account-requests/${r.id}/reject`, { method: "POST", json: { note: reason } })) onClose();
          }}
        >
          {busy ? "Declining…" : "Decline request"}
        </button>
        <button className="btn g full" style={{ marginTop: 8 }} onClick={() => setDeclining(false)}>
          Cancel
        </button>
        <div className="tiny" style={{ textAlign: "center", marginTop: 10 }}>
          They can send a new request later. Every decision is in the audit log.
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Review Request" sub={`Sent ${ago(r.createdAt)}`} onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <span className="ava brand" style={{ width: 56, height: 56, fontSize: 17, margin: "0 auto" }}>
          {initials(r.fullName)}
        </span>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 10 }}>{r.fullName}</div>
        <div className="tiny">
          Asked for <b style={{ color: "var(--tx)" }}>{r.roleLabel}</b>
        </div>
      </div>
      <div className="card" style={{ padding: "2px 15px", marginBottom: 16 }}>
        <Kv k="Email" v={`${r.email} ✓`} />
        <Kv k="Mobile" v={r.contactNo ?? "—"} />
        <Kv k="Address" v={[r.address, r.postalCode].filter(Boolean).join(", ") || "—"} />
        <Kv k="Note" v={r.note ? `“${r.note}”` : "—"} last />
      </div>
      <div className="fld">
        <label htmlFor="rv-role">Grant role</label>
        <select id="rv-role" className="inp" value={grant} onChange={(e) => setGrant(e.target.value as Role)}>
          {(Object.keys(ROLE_NAME) as Role[]).map((k) => (
            <option key={k} value={k}>
              {ROLE_NAME[k]}
              {k === r.role ? " (requested)" : ""}
            </option>
          ))}
        </select>
        <div className="tiny" style={{ marginTop: 6 }}>
          You can grant a different role from the one they asked for. ✓ = email verified by the sign-in provider.
        </div>
      </div>
      <button
        className="btn p full"
        disabled={busy}
        onClick={async () => {
          if (await run(`/account-requests/${r.id}/approve`, { method: "POST", json: { role: grant } })) onClose();
        }}
      >
        {busy ? "Approving…" : `Approve as ${ROLE_NAME[grant]}`}
      </button>
      <button className="btn d full" style={{ marginTop: 8 }} disabled={busy} onClick={() => setDeclining(true)}>
        Decline
      </button>
    </Sheet>
  );
}

function Kv({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div
      className="row"
      style={{
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: last ? 0 : "1px solid var(--line-soft)",
        fontSize: 12.5,
        alignItems: "flex-start",
      }}
    >
      <span className="tiny" style={{ flex: "0 0 auto" }}>
        {k}
      </span>
      <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

// ------------------------------------------------------------ accounts

function NewUserSheet({
  groups,
  reload,
  onClose,
}: {
  groups: Group[];
  reload: () => Promise<void>;
  onClose: () => void;
}) {
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
    <Sheet title="New Account" sub="Creates a login and sends an invitation" onClose={onClose}>
      <div className="fld">
        <label htmlFor="nu-name">
          Full name<span className="req">*</span>
        </label>
        <input id="nu-name" className="inp" placeholder="e.g. Aisha Rahman" value={f.fullName} onChange={set("fullName")} />
      </div>
      <div className="fld">
        <label htmlFor="nu-email">
          Email<span className="req">*</span>
        </label>
        <input
          id="nu-email"
          className="inp"
          type="email"
          inputMode="email"
          placeholder="name@company.sg"
          value={f.email}
          onChange={set("email")}
        />
      </div>
      <div className="fld">
        <label htmlFor="nu-phone">
          Mobile<span className="opt">For WhatsApp / SMS</span>
        </label>
        <PhoneInput id="nu-phone" value={f.contactNo} onChange={(v) => setF((x) => ({ ...x, contactNo: v }))} />
      </div>
      <div className="fld">
        <label htmlFor="nu-role">
          Role<span className="req">*</span>
        </label>
        <select id="nu-role" className="inp" value={f.role} onChange={set("role")}>
          {(Object.keys(ROLE_NAME) as Role[]).map((k) => (
            <option key={k} value={k}>
              {ROLE_NAME[k]}
            </option>
          ))}
        </select>
      </div>
      {CREW.includes(f.role) && (
        <div className="fld">
          <label htmlFor="nu-group">Add to contractor group</label>
          <select id="nu-group" className="inp" value={f.groupId} onChange={set("groupId")}>
            <option value="">— None for now —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="pair">
        <div className="fld">
          <label htmlFor="nu-postal">
            Postal code<span className="opt">Optional</span>
          </label>
          <input
            id="nu-postal"
            className="inp mono"
            inputMode="numeric"
            maxLength={6}
            value={f.postalCode}
            onChange={set("postalCode")}
          />
        </div>
        {f.role === "homeowner" && (
          <div className="fld">
            <label htmlFor="nu-ic">
              NRIC last 4<span className="opt">Optional</span>
            </label>
            <input id="nu-ic" className="inp mono" maxLength={4} placeholder="567D" value={f.icLast4} onChange={set("icLast4")} />
          </div>
        )}
      </div>
      <div className="fld">
        <label htmlFor="nu-addr">
          Address<span className="opt">Optional</span>
        </label>
        <input
          id="nu-addr"
          className="inp"
          placeholder="Filled in from the postal code"
          value={f.address}
          onChange={set("address")}
        />
      </div>
      <button
        className="btn p full"
        disabled={busy || !ok}
        onClick={async () => {
          const body = { ...f, groupId: f.groupId ? Number(f.groupId) : null };
          if (await run("/people", { method: "POST", json: body })) onClose();
        }}
      >
        {busy ? "Creating…" : "Create account & notify"}
      </button>
      <div className="tiny" style={{ textAlign: "center", marginTop: 10 }}>
        {ok ? "They get an email, plus WhatsApp (or SMS) if a mobile is given." : "Enter a name and a valid email."}
      </div>
    </Sheet>
  );
}

function UserSheet({
  user: u,
  isMe,
  groups,
  reload,
  onClose,
}: {
  user: Person;
  isMe: boolean;
  groups: Group[];
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { run, busy } = useAction(reload);
  const { data: projects } = useApi<Array<{ id: number; name: string; status: string }>>(`/people/${u.uid}/projects`);

  return (
    <Sheet title={u.fullName ?? u.email} sub={u.email} onClose={onClose}>
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="ava brand" style={{ width: 44, height: 44, fontSize: 14 }}>
          {initials(u.fullName ?? u.email)}
        </span>
        <div className="grow">
          <div style={{ fontSize: 14, fontWeight: 600 }}>{u.fullName ?? "—"}</div>
          <div className="tiny">
            {u.roleLabel}
            {u.contactNo ? ` · ${u.contactNo}` : ""}
          </div>
          <div className="tiny">
            {u.linked ? "Signed in" : u.invitedAt ? `Invited ${d2s(u.invitedAt)}, not signed in yet` : "No login yet"}
          </div>
        </div>
        {u.active ? <Pill tone="ok">Active</Pill> : <Pill tone="bad">Disabled</Pill>}
      </div>

      <div className="fld">
        <label htmlFor="us-role">Role</label>
        <select
          id="us-role"
          className="inp"
          value={u.role}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value as Role;
            const leaving = CREW.includes(u.role) && !CREW.includes(next) && u.groups.length > 0;
            if (leaving && !confirm(`${u.fullName ?? "They"} will also be removed from their contractor groups. Continue?`))
              return;
            void run(`/people/${u.uid}`, { method: "PATCH", json: { role: next } });
          }}
        >
          {(Object.keys(ROLE_NAME) as Role[]).map((k) => (
            <option key={k} value={k}>
              {ROLE_NAME[k]}
            </option>
          ))}
        </select>
        <div className="tiny" style={{ marginTop: 6 }}>
          Role controls what this person can see and edit. It takes effect immediately.
        </div>
      </div>

      {CREW.includes(u.role) && (
        <div className="fld">
          <span className="lbl" style={{ display: "flex" }}>
            Contractor groups
          </span>
          <div className="row wrap" style={{ gap: 6 }}>
            {groups.length === 0 && <span className="tiny">No groups exist yet.</span>}
            {groups.map((g) => {
              const inIt = u.groups.includes(g.id);
              return (
                <button
                  key={g.id}
                  className={`pill ${inIt ? "ok" : ""}`}
                  style={{ padding: "8px 12px", cursor: "pointer" }}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      inIt ? `/groups/${g.id}/members/${u.uid}` : `/groups/${g.id}/members`,
                      inIt ? { method: "DELETE" } : { method: "POST", json: { uid: u.uid } }
                    )
                  }
                >
                  {inIt && <i />}
                  {g.name}
                </button>
              );
            })}
          </div>
          <div className="tiny" style={{ marginTop: 7 }}>
            {u.groups.length ? "Tap a group to add or remove." : "Not in any group — this person sees no contractor projects."}
          </div>
        </div>
      )}

      <Sec title="Projects visible to them" />
      {!projects && <div className="skeleton" style={{ height: 50 }} />}
      {projects && projects.length === 0 && (
        <div className="tiny" style={{ padding: "4px 0 8px" }}>
          No projects yet.
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="card" style={{ padding: "1px 15px" }}>
          {projects.map((p) => (
            <div key={p.id} className="urow">
              <span className="grow">
                <span className="un">{p.name}</span>
                <span className="ue">{p.status.replace(/_/g, " ")}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {!isMe && (
        <>
          <button
            className={`btn ${u.active ? "d" : "g"} full`}
            style={{ marginTop: 18 }}
            disabled={busy}
            onClick={() => void run(`/people/${u.uid}`, { method: "PATCH", json: { active: !u.active } })}
          >
            {u.active ? "Disable account" : "Re-enable account"}
          </button>
          <div className="tiny" style={{ textAlign: "center", marginTop: 9 }}>
            Disabling blocks sign-in but keeps their history in the audit log.
          </div>
        </>
      )}
    </Sheet>
  );
}
