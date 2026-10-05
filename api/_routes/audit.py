"""The audit log: what everyone changed, and putting a change back. Project managers only.

Reading needs app.actor_uid set to an active PM — the table's row level
security returns nothing otherwise — so every read here passes the PM's uid.

A revert never touches the log. It writes the old values back to the data,
through the same triggers as any other change, so it gets its own entry,
pointing at what it undid through reverts_audit_id. Both changes stay true.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import sql
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from _lib.account import ROLE_LABEL, Account
from _lib.db import fetch_all, fetch_one, transaction
from _lib.web import role

router = APIRouter()
pm_only = role("project_manager")

# Every audited table: its primary key, and the page of the app it belongs to.
TABLES: dict[str, tuple[tuple[str, ...], str]] = {
    "projects": (("project_id",), "projects"),
    "project_assignments": (("project_id", "user_id"), "projects"),
    "electricity_retailers": (("retailer_id",), "projects"),
    "project_milestones": (("project_id", "milestone_no"), "milestones"),
    "project_files": (("file_id",), "files"),
    "site_visits": (("visit_id",), "sites"),
    "site_check_ins": (("check_in_id",), "sites"),
    "project_signatures": (("signature_id",), "signatures"),
    "users": (("uid",), "people"),
    "account_requests": (("request_id",), "people"),
    "contractor_groups": (("group_id",), "groups"),
    "contractor_group_members": (("group_id", "user_id"), "groups"),
}
PAGES = ("projects", "milestones", "files", "sites", "signatures", "people", "groups")

# Rows whose history is evidence, or whose decisions are final, are never rewritten.
NO_REVERT: dict[str, str] = {
    "account_requests": "Decisions on access requests are final.",
    "site_check_ins": "GPS check-ins are site evidence and can't be edited.",
    "project_signatures": "Signatures are legal records and can't be edited.",
}
# Link rows can be removed again or put back; anything else created or deleted can't.
LINK_TABLES = ("contractor_group_members", "project_assignments")
# Bookkeeping the app maintains itself — shown nowhere, reverted never.
NOISE = {"updated_at", "created_at"}
FIXED = {"clerk_user_id", "clerk_invitation_id", "invited_at", "invited_by", "geocoded_at", "geocode_source"}

# Columns holding another row's id, so the screen can show a name instead.
USER_REFS = {
    "user_id", "homeowner_id", "project_manager_id", "invited_by", "decided_by", "granted_uid",
    "uploaded_by", "added_by", "assigned_by", "created_by", "completed_by", "signed_by",
}  # fmt: skip
GROUP_REFS = {"group_id", "contractor_group_id"}
RETAILER_REFS = {"electricity_retailer_id"}


def _key(a: dict[str, Any]) -> dict[str, Any] | None:
    """The row's primary key. Entries written before 0016 carry only entity_id."""
    if a["entity_key"]:
        return a["entity_key"]
    cols = TABLES[a["entity_table"]][0]
    if len(cols) == 1:
        return {cols[0]: int(a["entity_id"]) if str(a["entity_id"]).isdigit() else a["entity_id"]}
    # A composite key: an insert or delete recorded every column; an update did not.
    side = "to" if a["action"] == "insert" else "from"
    ch = a["changes"] or {}
    if a["action"] != "update" and all(c in ch for c in cols):
        return {c: ch[c][side] for c in cols}
    return None


def _project_of(a: dict[str, Any]) -> int | None:
    if a["project_id"] is not None:
        return a["project_id"]
    if a["entity_table"] == "projects":
        return int(a["entity_id"])
    p = (a["changes"] or {}).get("project_id")
    return (p.get("to") or p.get("from")) if p else None


def _summary(a: dict[str, Any], names: dict[str, dict[int, str]]) -> str:
    t, act, ch = a["entity_table"], a["action"], a["changes"] or {}
    verb = {"insert": "Created", "update": "Updated", "delete": "Deleted"}[act]
    if t == "users":
        return {"insert": "Created account", "delete": "Deleted account"}.get(act, "Updated account")
    if t == "account_requests":
        if act == "insert":
            return "Requested access"
        status = (ch.get("status") or {}).get("to")
        return {"approved": "Approved access request", "rejected": "Declined access request"}.get(
            status, "Updated access request"
        )
    if t in LINK_TABLES:
        uid = (ch.get("user_id") or {}).get("to" if act == "insert" else "from") or (a["entity_key"] or {}).get(
            "user_id"
        )
        who = names["users"].get(uid, "someone") if uid else "someone"
        if t == "contractor_group_members":
            return {"insert": f"Added {who}", "delete": f"Removed {who}"}.get(act, f"Updated {who}")
        return {"insert": f"Assigned {who}", "delete": f"Unassigned {who}"}.get(act, f"Updated {who}")
    if t == "contractor_groups":
        return f"{verb} group"
    if t == "projects":
        return {"insert": "Created project", "delete": "Deleted project"}.get(act, "Updated project details")
    if t == "project_milestones":
        n = (a["entity_key"] or {}).get("milestone_no") or (ch.get("milestone_no") or {}).get("to")
        return f"{'Completed' if act == 'insert' else verb} milestone {n or ''}".strip()
    if t == "project_files":
        return {"insert": "Uploaded a file", "delete": "Removed a file"}.get(act, "Updated a file")
    if t == "site_visits":
        return {"insert": "Scheduled a site visit", "delete": "Cancelled a site visit"}.get(act, "Moved a site visit")
    if t == "site_check_ins":
        if act == "insert":
            return "Checked in on site"
        return "Checked out" if "checked_out_at" in ch else "Updated check-in"
    if t == "project_signatures":
        return "Signed the handover" if act == "insert" else f"{verb} signature"
    return f"{verb} {t.replace('_', ' ')}"


def _shown_fields(a: dict[str, Any]) -> list[str]:
    cols = TABLES[a["entity_table"]][0]
    out = []
    for f, v in (a["changes"] or {}).items():
        if f in NOISE:
            continue
        # A new or removed row: its own id and empty columns say nothing.
        if a["action"] != "update" and (f in cols and a["entity_table"] not in LINK_TABLES):
            continue
        if a["action"] == "insert" and v.get("to") is None:
            continue
        if a["action"] == "delete" and v.get("from") is None:
            continue
        out.append(f)
    return out


def _later_changes(ids: list[int], reader: int) -> dict[tuple[int, str], dict[str, Any]]:
    """For each (entry, field): the next entry that touched the same row and field, if any."""
    if not ids:
        return {}
    rows = fetch_all(
        """
        select a.audit_id, k.field, n.audit_id as next_id, n.reverts_audit_id as next_reverts,
               n.actor_name as next_actor, n.occurred_at as next_at
          from audit_log a
          cross join lateral jsonb_object_keys(coalesce(a.changes, '{}'::jsonb)) as k(field)
          left join lateral (
                select b.audit_id, b.reverts_audit_id, b.actor_name, b.occurred_at from audit_log b
                 where b.entity_table = a.entity_table
                   and b.entity_id is not distinct from a.entity_id
                   and (a.entity_key is null or b.entity_key is null or b.entity_key = a.entity_key)
                   and b.audit_id > a.audit_id
                   and (b.changes ? k.field or b.action <> 'update')
                 order by b.audit_id limit 1) n on true
         where a.audit_id = any(%(ids)s)
        """,
        {"ids": ids},
        actor_uid=reader,
    )
    return {(r["audit_id"], r["field"]): r for r in rows if r["next_id"] is not None}


def _names(entries: list[dict[str, Any]], reader: int) -> dict[str, dict[int, str]]:
    users: set[int] = set()
    groups: set[int] = set()
    retailers: set[int] = set()
    projects: set[int] = set()
    requests: set[int] = set()
    for a in entries:
        pid = _project_of(a)
        if pid:
            projects.add(pid)
        t = a["entity_table"]
        if t == "users" and a["entity_id"]:
            users.add(int(a["entity_id"]))
        if t in ("contractor_groups", "contractor_group_members") and a["entity_id"]:
            groups.add(int(a["entity_id"]))
        if t == "account_requests" and a["entity_id"]:
            requests.add(int(a["entity_id"]))
        for f, v in (a["changes"] or {}).items():
            for side in ("from", "to"):
                x = v.get(side)
                if not isinstance(x, int):
                    continue
                if f in USER_REFS:
                    users.add(x)
                elif f in GROUP_REFS:
                    groups.add(x)
                elif f in RETAILER_REFS:
                    retailers.add(x)
        if a["entity_key"] and isinstance(a["entity_key"].get("user_id"), int):
            users.add(a["entity_key"]["user_id"])

    def lookup(q: str, ids: set[int]) -> dict[int, str]:
        return {r["id"]: r["name"] for r in fetch_all(q, {"ids": list(ids)}, reader)} if ids else {}

    return {
        "users": lookup(
            "select uid as id, coalesce(full_name, email) as name from users where uid = any(%(ids)s)", users
        ),
        "groups": lookup("select group_id as id, name from contractor_groups where group_id = any(%(ids)s)", groups),
        "retailers": lookup(
            "select retailer_id as id, name from electricity_retailers where retailer_id = any(%(ids)s)", retailers
        ),
        "projects": lookup(
            "select project_id as id, coalesce(nullif(name, ''), address) as name from projects "
            "where project_id = any(%(ids)s)",
            projects,
        ),
        "requests": lookup(
            "select request_id as id, full_name as name from account_requests where request_id = any(%(ids)s)",
            requests,
        ),
    }


def _location(a: dict[str, Any], names: dict[str, dict[int, str]]) -> dict[str, Any]:
    """Where the change happened — the thing a person would say they were working on."""
    t, ch = a["entity_table"], a["changes"] or {}

    def was(field: str) -> Any:
        v = ch.get(field) or {}
        return v.get("to") or v.get("from")

    pid = _project_of(a)
    if pid:
        return {"key": f"project:{pid}", "kind": "project", "id": pid,
                "label": names["projects"].get(pid) or was("name") or f"Project #{pid}"}  # fmt: skip
    eid = int(a["entity_id"]) if a["entity_id"] and str(a["entity_id"]).isdigit() else None
    if t == "users":
        return {"key": f"person:{eid}", "kind": "person", "id": eid,
                "label": names["users"].get(eid) or was("full_name") or was("email") or f"Account #{eid}"}  # fmt: skip
    if t == "account_requests":
        return {"key": f"request:{eid}", "kind": "request", "id": eid,
                "label": f"Access request · {names['requests'].get(eid) or was('full_name') or eid}"}  # fmt: skip
    if t in ("contractor_groups", "contractor_group_members"):
        return {"key": f"group:{eid}", "kind": "group", "id": eid,
                "label": names["groups"].get(eid) or was("name") or f"Group #{eid}"}  # fmt: skip
    if t == "electricity_retailers":
        return {"key": f"retailer:{eid}", "kind": "retailer", "id": eid,
                "label": f"Retailer · {was('name') or eid}"}  # fmt: skip
    return {"key": f"{t}:{a['entity_id']}", "kind": "other", "id": eid, "label": t.replace("_", " ")}


def _revert_rule(a: dict[str, Any]) -> str | None:
    """Why this entry can't be reverted at all, or None if it can (subject to staleness)."""
    t = a["entity_table"]
    if t in NO_REVERT:
        return NO_REVERT[t]
    if a["action"] == "insert" and t not in LINK_TABLES:
        return {
            "users": "To undo a new account, disable it in People.",
            "contractor_groups": "To undo a new group, delete it in People → Groups.",
        }.get(t, "Something created can't be un-created from here.")
    if a["action"] == "delete" and t not in LINK_TABLES:
        return "Deleted records can't be restored — their history is kept here."
    if _key(a) is None:
        return "Recorded before row keys were kept, so the exact row can't be found."
    return None


def _entry(
    a: dict[str, Any],
    names: dict[str, dict[int, str]],
    later: dict[tuple[int, str], dict[str, Any]],
    reverted_by: dict[int, list[int]],
) -> dict[str, Any]:
    rule = _revert_rule(a)
    fields = _shown_fields(a)
    changes = []
    for f in fields:
        v = a["changes"][f]
        nxt = later.get((a["audit_id"], f))
        redacted = v.get("from") == "<redacted>"
        if redacted:
            state, why = "locked", "Never stored, so it can't be put back."
        elif rule:
            state, why = "locked", rule
        elif a["action"] == "update" and f in FIXED | set(TABLES[a["entity_table"]][0]):
            state, why = "locked", "Set by the system."
        elif nxt and nxt["next_reverts"] == a["audit_id"]:
            state, why = "reverted", f"Reverted by {nxt['next_actor'] or 'someone'}"
        elif nxt:
            state, why = "superseded", f"Changed again by {nxt['next_actor'] or 'someone'} since"
        else:
            state, why = "current", None
        changes.append({"field": f, "from": v.get("from"), "to": v.get("to"), "state": state, "note": why})

    actor = None
    if a["actor_uid"] is not None or a["actor_name"] or a["actor_email"]:
        actor = {
            "uid": a["actor_uid"],
            "name": a["actor_name"] or a["actor_email"] or "Unknown",
            "role": a["actor_role"],
            "roleLabel": ROLE_LABEL.get(a["actor_role"] or "", ""),
        }
    # A link row has nothing but its key: removing or restoring it is the whole revert.
    link_state = None
    if a["entity_table"] in LINK_TABLES and a["action"] != "update" and not rule:
        nxt = later.get((a["audit_id"], next(iter(a["changes"] or {}), "")))
        link_state = "reverted" if nxt and nxt["next_reverts"] == a["audit_id"] else "superseded" if nxt else "current"

    return {
        "id": a["audit_id"],
        "at": a["occurred_at"].isoformat(),
        "action": a["action"],
        "table": a["entity_table"],
        "page": TABLES[a["entity_table"]][1],
        "summary": _summary(a, names),
        "actor": actor,
        "location": _location(a, names),
        "changes": changes,
        "revertsId": a["reverts_audit_id"],
        "revertedBy": reverted_by.get(a["audit_id"], []),
        "lockedReason": rule,
        "linkState": link_state,
    }


def _enrich(rows: list[dict[str, Any]], reader: int) -> tuple[list[dict[str, Any]], dict[str, dict[int, str]]]:
    rows = [r for r in rows if r["entity_table"] in TABLES]
    ids = [r["audit_id"] for r in rows]
    later = _later_changes(ids, reader)
    reverted_by: dict[int, list[int]] = {}
    if ids:
        for r in fetch_all(
            "select audit_id, reverts_audit_id from audit_log where reverts_audit_id = any(%(ids)s)",
            {"ids": ids},
            actor_uid=reader,
        ):
            reverted_by.setdefault(r["reverts_audit_id"], []).append(r["audit_id"])
    names = _names(rows, reader)
    return [_entry(r, names, later, reverted_by) for r in rows], names


# ------------------------------------------------------------------ read


@router.get("/audit")
def log(
    acct: Account = Depends(pm_only),
    page: str | None = None,
    uid: int | None = None,
    system: bool = False,
    location: str | None = None,
    before: int | None = None,
    limit: int = Query(200, ge=1, le=500),
) -> dict[str, Any]:
    """Newest first. Filter by page of the app, by who did it, or by where it happened."""
    where = ["entity_table = any(%(tables)s)"]
    params: dict[str, Any] = {"limit": limit + 1}
    if page:
        if page not in PAGES:
            raise HTTPException(400, "Unknown page.")
        params["tables"] = [t for t, (_, p) in TABLES.items() if p == page]
    else:
        params["tables"] = list(TABLES)
    if uid is not None:
        where.append("actor_uid = %(uid)s")
        params["uid"] = uid
    elif system:
        where.append("actor_uid is null")
    if location:
        kind, _, ident = location.partition(":")
        if not ident.isdigit():
            raise HTTPException(400, "Unknown location.")
        params["lid"] = int(ident)
        params["lids"] = ident
        where.append(
            {
                "project": "(project_id = %(lid)s or (entity_table = 'projects' and entity_id = %(lids)s))",
                "person": "(entity_table = 'users' and entity_id = %(lids)s)",
                "request": "(entity_table = 'account_requests' and entity_id = %(lids)s)",
                "group": "(entity_table in ('contractor_groups', 'contractor_group_members') "
                "and entity_id = %(lids)s)",
            }.get(kind, "false")
        )
    if before is not None:
        where.append("audit_id < %(before)s")
        params["before"] = before

    rows = fetch_all(
        f"select * from audit_log where {' and '.join(where)} order by audit_id desc limit %(limit)s",
        params,
        actor_uid=acct.uid,
    )
    more = len(rows) > limit
    entries, names = _enrich(rows[:limit], acct.uid)

    # How many entries each page has, under the same person filter — for the tabs.
    scope = "actor_uid = %(uid)s" if uid is not None else "actor_uid is null" if system else "true"
    counts = {p: 0 for p in PAGES}
    for r in fetch_all(
        f"select entity_table, count(*)::int as n from audit_log where {scope} group by entity_table",
        {"uid": uid},
        actor_uid=acct.uid,
    ):
        if r["entity_table"] in TABLES:
            counts[TABLES[r["entity_table"]][1]] += r["n"]

    return {
        "entries": entries,
        "nextBefore": entries[-1]["id"] if more and entries else None,
        "counts": counts,
        # Names for ids that appear in changes — "Priya Nair", not "user 12".
        "refs": {k: names[k] for k in ("users", "groups", "retailers")},
    }


@router.get("/audit/people")
def people(acct: Account = Depends(pm_only)) -> list[dict[str, Any]]:
    """Everyone who has changed anything: how much, where, and when they last did."""
    rows = fetch_all(
        """
        select a.actor_uid as uid,
               coalesce(u.full_name, max(a.actor_name), max(a.actor_email)) as name,
               coalesce(u.user_type::text, max(a.actor_role::text)) as role,
               u.email, u.active,
               count(*)::int as changes,
               max(a.occurred_at) as last_at,
               count(distinct coalesce(a.project_id::text, a.entity_table || ':' || a.entity_id))::int as places,
               array_agg(distinct a.entity_table) as tables,
               count(*) filter (where a.reverts_audit_id is not null)::int as reverts
          from audit_log a
          left join users u on u.uid = a.actor_uid
         where a.entity_table = any(%(tables)s)
         group by a.actor_uid, u.full_name, u.user_type, u.email, u.active
         order by max(a.occurred_at) desc
        """,
        {"tables": list(TABLES)},
        actor_uid=acct.uid,
    )
    return [
        {
            "uid": r["uid"],
            "name": r["name"] if r["uid"] is not None else "Outside the app",
            "role": r["role"] if r["uid"] is not None else None,
            "roleLabel": ROLE_LABEL.get(r["role"] or "", "") if r["uid"] is not None else "Scripts & console",
            "email": r["email"],
            "active": r["active"],
            "changes": r["changes"],
            "places": r["places"],
            "lastAt": r["last_at"].isoformat(),
            "pages": sorted({TABLES[t][1] for t in r["tables"] if t in TABLES}, key=PAGES.index),
            "reverts": r["reverts"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------- revert


class RevertIn(BaseModel):
    # Which fields to put back. Empty means every field that still can be.
    fields: list[str] = []


def _where(key: dict[str, Any]) -> tuple[sql.Composable, list[Any]]:
    parts = [sql.SQL("{} = %s").format(sql.Identifier(c)) for c in key]
    return sql.SQL(" and ").join(parts), list(key.values())


@router.post("/audit/{audit_id}/revert")
def revert(audit_id: int, body: RevertIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    a = fetch_one("select * from audit_log where audit_id = %s", (audit_id,), actor_uid=acct.uid)
    if not a or a["entity_table"] not in TABLES:
        raise HTTPException(404, "No such audit entry.")
    rule = _revert_rule(a)
    if rule:
        raise HTTPException(400, rule)
    key = _key(a)
    assert key is not None
    t = sql.Identifier(a["entity_table"])
    where, wargs = _where(key)
    changes = a["changes"] or {}

    with transaction(acct.uid) as cur:
        # The new entries this transaction writes point back at this one.
        cur.execute("select set_config('app.reverts_audit_id', %s, true)", (str(audit_id),))

        if a["action"] == "insert":  # a link that was added: remove it again
            cur.execute(sql.SQL("delete from {} where {} returning 1").format(t, where), wargs)
            if not cur.fetchone():
                raise HTTPException(409, "That link has already been removed.")
            return {"message": "Removed again.", "fields": []}

        if a["action"] == "delete":  # a link that was removed: put it back
            row = {f: v.get("from") for f, v in changes.items()}
            cur.execute(sql.SQL("select 1 from {} where {}").format(t, where), wargs)
            if cur.fetchone():
                raise HTTPException(409, "That link already exists again.")
            cur.execute(
                sql.SQL("insert into {t} select * from jsonb_populate_record(null::{t}, %s)").format(t=t),
                (Jsonb(row),),
            )
            return {"message": "Put back.", "fields": []}

        locked = FIXED | set(TABLES[a["entity_table"]][0]) | NOISE
        allowed = [f for f in changes if f not in locked and changes[f].get("from") != "<redacted>"]
        fields = body.fields or allowed
        bad = [f for f in fields if f not in allowed]
        if bad:
            raise HTTPException(400, f"Can't revert {', '.join(bad)}.")
        if not fields:
            raise HTTPException(400, "Nothing in this change can be reverted.")

        cur.execute(sql.SQL("select to_jsonb(r) as row from {} r where {} for update").format(t, where), wargs)
        current = cur.fetchone()
        if not current:
            raise HTTPException(409, "That record no longer exists.")
        # Only put a value back if nobody has changed it since — otherwise the
        # revert would silently throw away their later edit.
        stale = [f for f in fields if current["row"].get(f) != changes[f].get("to")]
        if stale:
            raise HTTPException(
                409,
                f"{', '.join(_label(f) for f in stale)} changed again since. Revert the later change instead.",
            )

        cols = sql.SQL(", ").join(sql.Identifier(f) for f in fields)
        put_back = "update {t} set ({cols}) = (select {cols} from jsonb_populate_record(null::{t}, %s)) where {w}"
        cur.execute(
            sql.SQL(put_back).format(t=t, cols=cols, w=where),
            [Jsonb({f: changes[f].get("from") for f in fields}), *wargs],
        )
        cur.execute("select set_config('app.reverts_audit_id', '', true)")

    n = len(fields)
    return {"message": f"Reverted {n} field{'s' if n != 1 else ''}.", "fields": fields}


def _label(field: str) -> str:
    return field.replace("_", " ").capitalize()
