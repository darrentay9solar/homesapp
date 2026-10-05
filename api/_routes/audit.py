"""The audit log: what everyone changed, and putting a change back. Project managers only.

Reading needs app.actor_uid set to an active PM — the table's row level
security returns nothing otherwise — so every read here passes the PM's uid.

A revert never touches the log. It writes the old values back to the data,
through the same triggers as any other change, so it gets its own entry,
pointing at what it undid through reverts_audit_id. Both changes stay true.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dc_field
from typing import Any, Literal
from uuid import uuid4

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import sql
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from _lib import audit_rules, notify
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
# Deleted records that can be brought back as they were. Not projects or
# accounts: a project takes its check-ins and signatures with it, which are
# evidence and can't be re-created; accounts are disabled, never deleted.
RESTORABLE = (*LINK_TABLES, "contractor_groups", "site_visits", "project_files", "electricity_retailers")
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
               n.restores_audit_id as next_restores,
               n.actor_name as next_actor, n.occurred_at as next_at
          from audit_log a
          cross join lateral jsonb_object_keys(coalesce(a.changes, '{}'::jsonb)) as k(field)
          left join lateral (
                select b.audit_id, b.reverts_audit_id, b.restores_audit_id, b.actor_name, b.occurred_at from audit_log b
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
    if a["action"] == "delete" and t not in RESTORABLE:
        return {
            "projects": "Projects are closed, never deleted. One deleted outside the app needs a database recovery.",
            "users": "Accounts are disabled, never deleted. One deleted outside the app needs a database recovery.",
        }.get(t, "Deleted records of this kind can't be restored.")
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
        elif nxt and nxt["next_restores"] is not None:
            state, why = "superseded", f"Restored to an earlier value by {nxt['next_actor'] or 'someone'} since"
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
    # Undoing a whole row: removing an added link, putting back a removed one,
    # or restoring a deleted record.
    row_undo = None
    t = a["entity_table"]
    if not rule and a["action"] != "update" and (t in LINK_TABLES or (a["action"] == "delete" and t in RESTORABLE)):
        nxt = later.get((a["audit_id"], next(iter(a["changes"] or {}), "")))
        undone = nxt and a["audit_id"] in (nxt["next_reverts"], nxt["next_restores"])
        verb = "Remove again" if a["action"] == "insert" else "Put back" if t in LINK_TABLES else "Restore"
        row_undo = {
            "verb": verb,
            "kind": "revert" if t in LINK_TABLES else "restore_record",
            "state": "reverted" if undone else "superseded" if nxt else "current",
        }

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
        "restoresId": a["restores_audit_id"],
        "reason": a["reason"],
        "operationId": str(a["operation_id"]) if a["operation_id"] else None,
        "revertedBy": reverted_by.get(a["audit_id"], []),
        "lockedReason": rule,
        "rowUndo": row_undo,
    }


def _enrich(rows: list[dict[str, Any]], reader: int) -> tuple[list[dict[str, Any]], dict[str, dict[int, str]]]:
    rows = [r for r in rows if r["entity_table"] in TABLES]
    ids = [r["audit_id"] for r in rows]
    later = _later_changes(ids, reader)
    reverted_by: dict[int, list[int]] = {}
    if ids:
        for r in fetch_all(
            "select audit_id, coalesce(reverts_audit_id, restores_audit_id) as reverts_audit_id from audit_log "
            "where reverts_audit_id = any(%(ids)s) or restores_audit_id = any(%(ids)s)",
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
               count(*) filter (where a.reverts_audit_id is not null or a.restores_audit_id is not null)::int as reverts
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


# ------------------------------------------------------- revert and restore
#
# How a change is undone here, and why it is done this way:
#
#   * The log is never touched. A revert or restore is a compensating change
#     written through the same tables, triggers and guards as any other edit,
#     so it gets entries of its own, pointing back at what it undid
#     (reverts_audit_id) or brought back (restores_audit_id).
#   * Every one needs a written reason, kept on each entry it produces. The
#     database refuses one without it.
#   * Selective means selective: one value, or one record. Never a whole
#     project rewound. A value that something else depends on (a completed
#     milestone, a frozen project, someone's group memberships) is refused
#     with the reason, not silently "fixed up" — see _lib/audit_rules.py.
#   * Preview first. The preview performs the change for real inside a
#     transaction and rolls it back, so what it shows is exactly what would be
#     written, including anything the database itself would refuse.
#   * Nothing changes between preview and apply unnoticed: apply carries the
#     newest log entry the preview saw for the affected rows, and stops if
#     there is a newer one.
#   * The people whose work is undone are told, with the reason.


class ActionIn(BaseModel):
    kind: Literal["revert", "restore_value", "restore_record"]
    auditId: int
    # revert: which fields to put back (empty = every one that still can be)
    fields: list[str] = []
    # restore_value: the field to set back to the value auditId left it at
    field: str | None = None
    # restore_record: also bring back what was deleted in the same act
    withRelated: bool = True
    reason: str = ""
    expect: int | None = None


@dataclass
class Step:
    table: str
    key: dict[str, Any]
    op: Literal["update", "insert", "delete"]
    values: dict[str, Any] = dc_field(default_factory=dict)


@dataclass
class Plan:
    entry: dict[str, Any]
    steps: list[Step] = dc_field(default_factory=list)
    blockers: list[str] = dc_field(default_factory=list)
    warnings: list[str] = dc_field(default_factory=list)
    notify_uids: set[int] = dc_field(default_factory=set)
    reverts: int | None = None
    restores: int | None = None
    summary: str = ""


class _RollbackError(Exception):
    pass


def _where(key: dict[str, Any]) -> tuple[sql.Composable, list[Any]]:
    parts = [sql.SQL("{} = %s").format(sql.Identifier(c)) for c in key]
    return sql.SQL(" and ").join(parts), list(key.values())


def _current(cur: Any, table: str, key: dict[str, Any]) -> dict[str, Any] | None:
    where, args = _where(key)
    row = cur.execute(
        sql.SQL("select to_jsonb(r) as row from {} r where {} for update").format(sql.Identifier(table), where), args
    ).fetchone()
    return row["row"] if row else None


def _fixed(table: str) -> set[str]:
    return FIXED | NOISE | set(TABLES[table][0])


def _plan(cur: Any, body: ActionIn, acct: Account) -> Plan:
    a = cur.execute("select * from audit_log where audit_id = %s", (body.auditId,)).fetchone()
    if not a or a["entity_table"] not in TABLES:
        raise HTTPException(404, "No such audit entry.")
    t, changes = a["entity_table"], a["changes"] or {}
    key = _key(a)
    plan = Plan(entry=a)
    if t in NO_REVERT:
        plan.blockers.append(NO_REVERT[t])
        return plan
    if key is None:
        plan.blockers.append("Recorded before row keys were kept, so the exact record can't be found.")
        return plan

    if body.kind == "revert":
        plan.reverts = a["audit_id"]
        if a["actor_uid"] and a["actor_uid"] != acct.uid:
            plan.notify_uids.add(a["actor_uid"])
        if a["action"] == "insert":
            if t not in LINK_TABLES:
                plan.blockers.append(_revert_rule(a) or "Something created can't be un-created from here.")
                return plan
            if _current(cur, t, key) is None:
                plan.blockers.append("That has already been removed.")
            plan.steps.append(Step(t, key, "delete"))
            plan.summary = "Remove again"
            return plan
        if a["action"] == "delete":
            if t not in LINK_TABLES:
                plan.blockers.append("Use Restore to bring back a deleted record.")
                return plan
            return _plan_record(cur, plan, a, key, with_related=False)
        allowed = [f for f in changes if f not in _fixed(t) and changes[f].get("from") != "<redacted>"]
        fields = body.fields or allowed
        bad = [f for f in fields if f not in allowed]
        if bad:
            plan.blockers.append(f"{', '.join(_label(f) for f in bad)} can't be reverted.")
            return plan
        if not fields:
            plan.blockers.append("Nothing in this change can be reverted.")
            return plan
        row = _current(cur, t, key)
        if row is None:
            plan.blockers.append("That record no longer exists.")
            return plan
        stale = [f for f in fields if row.get(f) != changes[f].get("to")]
        if stale:
            plan.blockers.append(
                f"{', '.join(_label(f) for f in stale)} changed again since. "
                "Revert or restore the later change instead."
            )
        values = {f: changes[f].get("from") for f in fields}
        plan.blockers += audit_rules.blockers(cur, t, key, values, acct.uid, _label)
        plan.steps.append(Step(t, key, "update", values))
        plan.summary = f"Revert {len(fields)} field{'s' if len(fields) != 1 else ''}"
        return plan

    if body.kind == "restore_value":
        f = body.field or ""
        plan.restores = a["audit_id"]
        if a["action"] == "delete" or f not in changes:
            plan.blockers.append("That entry didn't set this field.")
            return plan
        if f in _fixed(t) or changes[f].get("to") == "<redacted>":
            plan.blockers.append("This field can't be restored.")
            return plan
        row = _current(cur, t, key)
        if row is None:
            plan.blockers.append("That record no longer exists. Restore the record itself first.")
            return plan
        value = changes[f].get("to")
        if row.get(f) == value:
            plan.blockers.append("It already has this value.")
            return plan
        values = {f: value}
        plan.blockers += audit_rules.blockers(cur, t, key, values, acct.uid, _label)
        plan.steps.append(Step(t, key, "update", values))
        plan.summary = f"Restore {_label(f).lower()}"
        # Everyone who changed this field since then has their change undone.
        for r in cur.execute(
            "select distinct actor_uid from audit_log where entity_table = %s and entity_key = %s "
            "and audit_id > %s and changes ? %s and actor_uid is not null",
            (t, Jsonb(key), a["audit_id"], f),
        ):
            if r["actor_uid"] != acct.uid:
                plan.notify_uids.add(r["actor_uid"])
        return plan

    # restore_record
    if a["action"] != "delete":
        plan.blockers.append("Only a deleted record can be restored.")
        return plan
    plan.restores = a["audit_id"]
    if a["actor_uid"] and a["actor_uid"] != acct.uid:
        plan.notify_uids.add(a["actor_uid"])
    return _plan_record(cur, plan, a, key, with_related=body.withRelated)


def _plan_record(cur: Any, plan: Plan, a: dict[str, Any], key: dict[str, Any], *, with_related: bool) -> Plan:
    """Bring back a deleted record exactly as it was — same id — and, optionally, what went with it."""
    t = a["entity_table"]
    if t not in RESTORABLE:
        plan.blockers.append(_revert_rule(a) or "Deleted records of this kind can't be restored.")
        return plan
    group = [a]
    if with_related:
        # Deleted in the same act: one operation, or the same transaction time and actor.
        group += cur.execute(
            "select * from audit_log where action = 'delete' and audit_id <> %s and entity_table = any(%s) "
            "and ((operation_id is not null and operation_id = %s) "
            "or (occurred_at = %s and actor_uid is not distinct from %s))",
            (a["audit_id"], list(RESTORABLE), a["operation_id"], a["occurred_at"], a["actor_uid"]),
        ).fetchall()
    # The parent was deleted last, so it goes back first.
    for r in sorted(group, key=lambda r: r["audit_id"], reverse=True):
        k = _key(r)
        if k is None:
            continue
        if _current(cur, r["entity_table"], k) is not None:
            if r is a:
                plan.blockers.append("That record already exists again.")
            continue
        values = {f: v.get("from") for f, v in (r["changes"] or {}).items()}
        if "<redacted>" in values.values():
            values = {f: (None if v == "<redacted>" else v) for f, v in values.items()}
            plan.warnings.append("Personal details the log never stores (NRIC) come back empty.")
        plan.steps.append(Step(r["entity_table"], k, "insert", values))
    if t == "project_files":
        plan.warnings.append("This restores the file's record. The file itself must still be in storage.")
    n = len(plan.steps)
    plan.summary = "Put back" if plan.reverts else f"Restore {n} record{'s' if n != 1 else ''}"
    return plan


def _execute(cur: Any, plan: Plan) -> None:
    for s in plan.steps:
        tbl = sql.Identifier(s.table)
        where, args = _where(s.key)
        if s.op == "delete":
            cur.execute(sql.SQL("delete from {} where {}").format(tbl, where), args)
        elif s.op == "insert":
            cur.execute(
                sql.SQL("insert into {t} select * from jsonb_populate_record(null::{t}, %s)").format(t=tbl),
                (Jsonb(s.values),),
            )
        else:
            cols = sql.SQL(", ").join(sql.Identifier(f) for f in s.values)
            q = "update {t} set ({cols}) = (select {cols} from jsonb_populate_record(null::{t}, %s)) where {w}"
            cur.execute(sql.SQL(q).format(t=tbl, cols=cols, w=where), [Jsonb(s.values), *args])


def _newest(cur: Any, plan: Plan) -> int:
    """The newest log entry for any row this action touches — what the preview saw."""
    newest = 0
    for s in plan.steps:
        r = cur.execute(
            "select coalesce(max(audit_id), 0) as n from audit_log where entity_table = %s and entity_key = %s",
            (s.table, Jsonb(s.key)),
        ).fetchone()
        newest = max(newest, r["n"])
    return newest


DB_MESSAGES = {
    "23503": "It belongs to something that no longer exists. Restore that first.",
    "23505": "Something with the same name or key exists now, so this can't come back as it was.",
}


def _effects(rows: list[dict[str, Any]], reader: int) -> list[dict[str, Any]]:
    names = _names(rows, reader)
    return [
        {
            "table": r["entity_table"],
            "action": r["action"],
            "summary": _summary(r, names),
            "location": _location(r, names)["label"],
            "changes": [
                {"field": f, "from": r["changes"][f].get("from"), "to": r["changes"][f].get("to")}
                for f in _shown_fields(r)
            ],
        }
        for r in rows
    ]


def _run(body: ActionIn, acct: Account, *, apply: bool) -> dict[str, Any]:
    reason = body.reason.strip()
    if apply and len(reason) < 10:
        raise HTTPException(400, "Write a reason of at least 10 characters. It's kept with the change.")
    operation = str(uuid4())
    result: dict[str, Any] = {}
    plan: Plan | None = None
    try:
        with transaction(acct.uid) as cur:
            plan = _plan(cur, body, acct)
            newest = _newest(cur, plan)
            if apply and not plan.blockers and body.expect is not None and newest != body.expect:
                raise HTTPException(409, "Something here changed after your preview. Review it again.")
            rows: list[dict[str, Any]] = []
            if not plan.blockers and plan.steps:
                for k, v in (
                    ("app.audit_operation", operation),
                    ("app.audit_reason", reason if apply else "(preview of a revert or restore)"),
                    ("app.reverts_audit_id", str(plan.reverts or "")),
                    ("app.restores_audit_id", str(plan.restores or "")),
                ):
                    cur.execute("select set_config(%s, %s, true)", (k, v))
                cur.execute("savepoint act")
                try:
                    _execute(cur, plan)
                    cur.execute("release savepoint act")
                except psycopg.Error as exc:
                    cur.execute("rollback to savepoint act")
                    state = getattr(exc, "sqlstate", "") or ""
                    msg = (exc.diag.message_primary if exc.diag else None) or "The database refused this."
                    plan.blockers.append(DB_MESSAGES.get(state, msg))
                if not plan.blockers:
                    rows = cur.execute(
                        "select * from audit_log where operation_id = %s order by audit_id", (operation,)
                    ).fetchall()
            who = []
            if plan.notify_uids:
                who = [
                    r["name"]
                    for r in cur.execute(
                        "select coalesce(full_name, email) as name from users where uid = any(%s) order by 1",
                        (list(plan.notify_uids),),
                    )
                ]
            warnings = list(dict.fromkeys(plan.warnings))
            if who:
                warnings.append(f"{', '.join(who)} will be told their change was undone, with your reason.")
            warnings.append("Emails, WhatsApps and alerts already sent about the original change stay sent.")
            result = {
                "summary": plan.summary,
                "blockers": plan.blockers,
                "warnings": warnings,
                "effects": _effects(rows, acct.uid) if rows else [],
                "expect": newest,
            }
            if not apply or plan.blockers:
                raise _RollbackError
            result["operationId"] = operation
    except _RollbackError:
        if apply:
            raise HTTPException(409, result["blockers"][0]) from None
        return result

    # Committed. Tell the people whose work was undone, and why.
    assert plan is not None
    location = result["effects"][0]["location"] if result["effects"] else "a record"
    for uid in plan.notify_uids:
        notify.notify(
            uid,
            "audit_restore",
            "A change of yours was undone",
            f"{(acct.user or {}).get('full_name') or 'A project manager'} undid your change to {location}. "
            f"Reason: {reason}",
            project_id=_project_of(plan.entry),
        )
    n = len(result["effects"])
    result["message"] = f"Done. {n} change{'s' if n != 1 else ''} written to the audit log with your reason."
    return result


@router.post("/audit/actions/preview")
def preview(body: ActionIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Exactly what an action would write, and anything that stops it. Nothing is saved."""
    return _run(body, acct, apply=False)


@router.post("/audit/actions/apply")
def apply(body: ActionIn, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    return _run(body, acct, apply=True)


@router.get("/audit/{audit_id}/history")
def history(audit_id: int, field: str, acct: Account = Depends(pm_only)) -> dict[str, Any]:
    """Every value one field of one record has had — its version history, newest first."""
    a = fetch_one("select * from audit_log where audit_id = %s", (audit_id,), actor_uid=acct.uid)
    if not a or a["entity_table"] not in TABLES:
        raise HTTPException(404, "No such audit entry.")
    t, key = a["entity_table"], _key(a)
    if key is None:
        raise HTTPException(400, "Recorded before row keys were kept, so this record's history can't be followed.")
    rows = fetch_all(
        "select * from audit_log where entity_table = %(t)s and (entity_key = %(k)s "
        "or (entity_key is null and entity_id = %(id)s)) and (changes ? %(f)s or action = 'delete') "
        "order by audit_id desc",
        {"t": t, "k": Jsonb(key), "id": a["entity_id"], "f": field},
        actor_uid=acct.uid,
    )
    where, args = _where(key)
    with transaction(acct.uid) as cur:
        now = cur.execute(
            sql.SQL("select to_jsonb(r) as row from {} r where {}").format(sql.Identifier(t), where), args
        ).fetchone()
    lock = NO_REVERT.get(t) or ("Set by the system." if field in _fixed(t) else None)
    lock = lock or audit_rules.field_lock(t, field)
    if field == "ic_last4":
        lock = "Never stored in the log, so earlier values can't be brought back."
    names = _names(rows or [a], acct.uid)
    versions = []
    for r in rows:
        v = {
            "id": r["audit_id"],
            "at": r["occurred_at"].isoformat(),
            "actor": {
                "uid": r["actor_uid"],
                "name": r["actor_name"] or r["actor_email"] or "Outside the app",
                "role": r["actor_role"],
            },
            "deleted": r["action"] == "delete",
            "value": None if r["action"] == "delete" else r["changes"][field].get("to"),
            "reason": r["reason"],
            "revertsId": r["reverts_audit_id"],
            "restoresId": r["restores_audit_id"],
        }
        versions.append(v)
    return {
        "field": field,
        "table": t,
        "location": _location(a, names)["label"],
        "exists": now is not None,
        "current": now["row"].get(field) if now else None,
        "lockedReason": lock,
        "versions": versions,
        "refs": {k: names[k] for k in ("users", "groups", "retailers")},
    }


def _label(field: str) -> str:
    return field.replace("_", " ").capitalize()
