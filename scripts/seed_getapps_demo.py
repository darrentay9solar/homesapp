# ruff: noqa: E501  (sample data reads better one record per line)
"""Wipes GetApps' demo database and fills it with sample people, groups and projects at every stage.

    node scripts/py.mjs scripts/seed_getapps_demo.py

GetApps (9 Solar Fintech, docs/getapps-workflow.md) has its own demo site, like 9 Solar Home's: visitors
pick a sample person and try the app, no password, and nothing leaves it (api/_lib/demo.py). This fills
its database, GETAPPS_DEMO_MIGRATION_DATABASE_URL in .env.local, and its bucket (getapps-demo, keys
GETAPPS_DEMO_R2_*). It refuses any other database: GetApps' and 9 Solar Home's live ones above all.

What it adds: the office (a superadmin, two HQ Staff, Admin), two contractor groups with their EPC
Project Managers, three groups (contracts) with phases, the Mechanical and Electrical Works checklists,
and ten projects for business clients, from just started to complete, with drawings in the bucket. One
is past its 10 months; one has an overdue Connection Agreement. Each change is in the audit log as the
person who'd have made it. Then the database is marked as a demo one.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
sys.path.insert(0, os.path.dirname(__file__))

import psycopg
from psycopg.rows import dict_row
from reset_and_seed import COLOURS, NOW, SG, TODAY, Bucket, mark_demo_database, pdf, png, wipe

from _lib import storage
from _lib import workflow as wf
from _lib.db import _from_env_file
from _lib.privacy import VERSION

KEY = "GETAPPS_DEMO_MIGRATION_DATABASE_URL"
LIVE = ("PROD_GETAPPS_MIGRATION_DATABASE_URL", "PROD_MIGRATION_DATABASE_URL", "MIGRATION_DATABASE_URL")
GETAPPS_TABLES = ["project_steps", "workflow_checklist_items", "project_phases", "project_groups"]

PEOPLE = [
    # key, name, role, mobile, contractor groups
    ("sam", "Sam Tan", "superadmin", "+65 9101 2200", []),
    ("charlotte", "Charlotte Sim", "project_manager", "+65 9101 2201", []),
    ("marcus", "Marcus Lim", "project_manager", "+65 9101 2205", []),
    ("wendy", "Wendy Loh", "finance", "+65 9101 2206", []),
    ("priya", "Priya Nair", "contractor", "+65 9101 2202", ["apex"]),
    ("ahmad", "Ahmad Hassan", "contractor", "+65 9101 2207", ["kimseng"]),
    ("ravi", "Ravi Kumar", "epc_team", "+65 9101 2203", ["apex"]),
    ("kelvin", "Kelvin Lim", "epc_team", "+65 9101 2208", ["apex"]),
    ("siti", "Siti Nurhaliza", "epc_team", "+65 9101 2204", ["kimseng"]),
]
CONTRACTORS = {"apex": "Apex Solar Contractors", "kimseng": "Kim Seng M&E Services"}
GROUPS = [
    # key, name, contract ref, client, notes, phases
    (
        "tampines",
        "Tampines Industrial Rooftops",
        "9SF-C-2026-014",
        "JTC Corporation",
        "Twelve factory roofs across two phases.",
        ["Phase 1", "Phase 2"],
    ),
    ("jurong", "Jurong West Schools", "9SF-C-2026-021", "MOE Facilities", None, ["Phase 1", "Phase 2"]),
    ("changi", "Changi Logistics Park", None, "Changi Warehousing Pte Ltd", None, []),
]
CHECKLISTS = {
    "mechanical": [
        "Mounting structure fixed to the engineer's drawing",
        "Rail spacing and clamps checked",
        "Roof penetrations sealed and waterproofed",
        "Module earthing bonded",
        "Cable trays and conduits secured",
        "Walkways and safety lines in place",
    ],
    "electrical": [
        "DC string polarity tested",
        "Insulation resistance tested",
        "Isolators labelled",
        "Inverter earthing verified",
        "MSB breaker rating checked",
        "AC cabling terminated and torqued",
        "Surge protection fitted",
    ],
}
# name, address, postal, client, group, phase (index), contractor, run by, started (days ago), items done, extras
PROJECTS = [
    (
        "Tampines Ave 5 · Block A",
        "15 Tampines Avenue 5",
        "529653",
        "JTC Corporation",
        "tampines",
        0,
        "apex",
        "charlotte",
        190,
        "elec_half",
        {},
    ),
    (
        "Tampines Ave 5 · Block B",
        "17 Tampines Avenue 5",
        "529655",
        "JTC Corporation",
        "tampines",
        0,
        "apex",
        "charlotte",
        230,
        "comm_done",
        {"ca_overdue": True},
    ),
    (
        "Tampines Loop Factory",
        "3 Tampines Loop",
        "528884",
        "JTC Corporation",
        "tampines",
        1,
        "apex",
        "charlotte",
        120,
        "mech_half",
        {},
    ),
    (
        "Tampines St 92 Warehouse",
        "9 Tampines Street 92",
        "528871",
        "JTC Corporation",
        "tampines",
        1,
        "kimseng",
        "marcus",
        25,
        "pre_half",
        {},
    ),
    (
        "Jurong West Primary",
        "61 Jurong West Street 91",
        "649040",
        "MOE Facilities",
        "jurong",
        0,
        "kimseng",
        "marcus",
        280,
        "complete",
        {},
    ),
    (
        "Westwood Secondary",
        "11 Jurong West Street 25",
        "648350",
        "MOE Facilities",
        "jurong",
        0,
        "kimseng",
        "marcus",
        250,
        "sp_open",
        {},
    ),
    (
        "Jurong West Sports Hall",
        "20 Jurong West Street 93",
        "648965",
        "MOE Facilities",
        "jurong",
        1,
        "apex",
        "charlotte",
        330,
        "elec_done",
        {},
    ),
    (
        "Changi South Lane DC",
        "21 Changi South Lane",
        "486123",
        "Changi Warehousing Pte Ltd",
        "changi",
        None,
        "apex",
        "charlotte",
        60,
        "pre_done",
        {},
    ),
    (
        "Changi North Rise Hub",
        "8 Changi North Rise",
        "498788",
        "Changi Warehousing Pte Ltd",
        "changi",
        None,
        "kimseng",
        "marcus",
        3,
        "fresh",
        {},
    ),
    (
        "Loyang Way Food Factory",
        "52 Loyang Way",
        "508742",
        "Sunrise Foods Pte Ltd",
        None,
        None,
        "apex",
        "charlotte",
        45,
        "pre_done",
        {"no_group": True},
    ),
]


def order(checks: dict[str, list[str]]) -> list[str]:
    """The order work gets done in: each stage in turn, the SP approvals as they open, then SP Turn-On."""
    stage = lambda key: [i.key for s in wf.STAGES if s.key == key for i in s.items] + checks.get(key, [])  # noqa: E731
    return [*stage("pre_install"), "cs1_application", "pv1_letter", *stage("mechanical"), *stage("electrical"),
            "pq_submission", "pv2_letter", *stage("commissioning"), "connection_agreement", "sp_turn_on", "qa_qc_checklist"]  # fmt: skip


def done_at_point(point: str, seq: list[str], checks: dict[str, list[str]]) -> list[str]:
    """What's done at each named point of a project."""
    upto = lambda last: seq[: seq.index(last) + 1]  # noqa: E731
    pre, mech, elec = (
        [i.key for s in wf.STAGES if s.key == k for i in s.items] for k in ("pre_install", "mechanical", "electrical")
    )
    return {
        "fresh": [],
        "pre_half": pre[:2],
        "pre_done": [*upto(pre[-1]), "cs1_application"],
        "mech_half": upto("pv1_letter") + mech[:2] + checks["mechanical"][:3],
        "elec_half": upto(checks["mechanical"][-1]) + elec[:3] + checks["electrical"][:2],
        "elec_done": [*upto(checks["electrical"][-1]), "pq_submission"],
        "comm_done": upto("scdf_final_acceptance"),
        "sp_open": upto("connection_agreement"),
        "complete": seq,
    }[point]


def main() -> None:
    url = _from_env_file(KEY)
    if not url:
        sys.exit(f"{KEY} isn't in .env.local: GetApps' demo database (a Neon branch of the getapps project).")
    host = lambda x: psycopg.conninfo.conninfo_to_dict(x)["host"]  # noqa: E731
    for live in LIVE:
        other = _from_env_file(live)
        if other and host(other) == host(url):
            sys.exit(f"Refusing: {KEY} points at the same database as {live}.")
    acct = _from_env_file("GETAPPS_R2_ACCOUNT_ID") or _from_env_file("R2_ACCOUNT_ID")
    kid, sec = _from_env_file("GETAPPS_DEMO_R2_ACCESS_KEY_ID"), _from_env_file("GETAPPS_DEMO_R2_SECRET_ACCESS_KEY")
    if not (acct and kid and sec):
        sys.exit(
            "GETAPPS_DEMO_R2_ACCESS_KEY_ID and GETAPPS_DEMO_R2_SECRET_ACCESS_KEY aren't in .env.local (the getapps-demo bucket's token)."
        )
    bucket = Bucket(storage.R2(acct, kid, sec, "getapps-demo"))

    with psycopg.connect(url, row_factory=dict_row, autocommit=True, prepare_threshold=None) as c:
        print(f"Resetting GetApps' demo ({host(url).split('.')[0]})")
        with c.transaction():
            c.execute(f"truncate {', '.join(GETAPPS_TABLES)} restart identity cascade")
        wipe(c, "test")  # everything else, every account and the audit log
        gone = bucket.keys("projects/") + bucket.keys("profiles/")
        for key in gone:
            bucket.delete(key)
        print(f"  getapps-demo: removed {len(gone)} stored files")
        seed(c, bucket)
        mark_demo_database(c)
        print("  marked as a demo database")
        n = c.execute(
            "select (select count(*) from projects) p, (select count(*) from users) u, (select count(*) from project_files) f, (select count(*) from project_steps) s"
        ).fetchone()
        print(f"Seeded: {n['p']} projects, {n['u']} sample people, {n['s']} workflow steps, {n['f']} drawings.")


def seed(c: psycopg.Connection, bucket: Bucket) -> None:
    one = lambda q, *a: c.execute(q, a).fetchone()  # noqa: E731
    colour = iter(COLOURS * 400)

    def act(uid: int | None) -> None:
        c.execute("select set_config('app.actor_uid', %s, false)", (str(uid) if uid else "",))

    act(None)
    cg = {
        k: one("insert into contractor_groups (name) values (%s) returning group_id", n)["group_id"]
        for k, n in CONTRACTORS.items()
    }
    u: dict[str, int] = {}
    for key, name, role, mobile, groups in PEOPLE:
        u[key] = one(
            # is_demo: a sample person visitors can try the demo as (only the database owner can set it).
            "insert into users (full_name, user_type, email, contact_no, mobile_verified_at, is_demo, privacy_accepted_at, privacy_version) "
            "values (%s, %s, %s, %s, now(), true, now(), %s) returning uid",
            name, role, f"{key}.getapps.demo@example.com", mobile, VERSION,
        )["uid"]  # fmt: skip
        for g in groups:
            c.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (cg[g], u[key]))
    sp = one("select retailer_id from electricity_retailers where name = 'SP Group'")
    sp_id = sp["retailer_id"] if sp else None

    # The office sets up the contracts and the Works checklists.
    act(u["sam"])
    gid: dict[str, int] = {}
    phases: dict[str, list[int]] = {}
    for key, name, ref, client, notes, phase_names in GROUPS:
        gid[key] = one(
            "insert into project_groups (name, contract_ref, client, notes, created_by) values (%s, %s, %s, %s, %s) returning group_id",
            name,
            ref,
            client,
            notes,
            u["sam"],
        )["group_id"]
        phases[key] = [
            one(
                "insert into project_phases (group_id, name, sort) values (%s, %s, %s) returning phase_id",
                gid[key],
                p,
                i,
            )["phase_id"]
            for i, p in enumerate(phase_names)
        ]
    checks: dict[str, list[str]] = {}
    for stage, labels in CHECKLISTS.items():
        file = f"{'Mechanical' if stage == 'mechanical' else 'Electrical'} Works checklist (sample).xlsx"
        checks[stage] = [
            f"check:{one('insert into workflow_checklist_items (stage, sort, label, source_file) values (%s, %s, %s, %s) returning item_id', stage, i, label, file)['item_id']}"
            for i, label in enumerate(labels)
        ]
    seq = order(checks)
    crew = {"apex": ["ravi", "kelvin"], "kimseng": ["siti"]}

    def drawing(pid: int, key: str, who: int, at: datetime) -> None:
        item = wf.ITEMS[key]
        picture = key in ("inverters", "solar_panels", "isolators", "pvdb")
        ctype = "image/png" if picture else "application/pdf"
        data = png(next(colour)) if picture else pdf(f"{item.label}")
        path = storage.project_key(pid, "workflow", ctype)
        bucket.put(path, data, ctype)
        name = f"{item.label.replace('/', '-')}.{'png' if picture else 'pdf'}"
        c.execute(
            "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by, kind, step, uploaded_at) "
            "values (%s, 'workflow', %s, %s, %s, %s, %s, %s, %s, %s)",
            (pid, path, name, ctype, len(data), who, storage.kind_of(ctype), key, at),
        )

    for name, address, postal, client, group, phase, contractor, run_by, ago, point, extra in PROJECTS:
        pm = u[run_by]
        act(pm)
        start = TODAY - timedelta(days=ago)
        cols = {
            "name": name, "address": address, "postal_code": postal, "homeowner_name": client,
            "homeowner_contact_no": "+65 6123 4567", "contractor_group_id": cg[contractor],
            "installation_start_date": start, "target_end_date": wf.target_end(start), "status": "draft",
            "project_manager_id": pm, "created_by": pm, "electricity_retailer_id": sp_id,
            "created_at": datetime.combine(start - timedelta(days=7), datetime.min.time(), SG) + timedelta(hours=10),
        }  # fmt: skip
        keys = ", ".join(cols)
        pid = c.execute(
            f"insert into projects ({keys}) values ({', '.join(f'%({k})s' for k in cols)}) returning project_id", cols
        ).fetchone()["project_id"]
        c.execute("update projects set status = 'in_progress' where project_id = %s", (pid,))
        if group and not extra.get("no_group"):
            c.execute("update projects set group_id = %s, phase_id = %s where project_id = %s",
                      (gid[group], phases[group][phase] if phase is not None else None, pid))  # fmt: skip
        for epc in crew[contractor]:
            c.execute(
                "insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s)",
                (pid, u[epc], pm),
            )
        # The crew works through it, a few days apart, never past today.
        done = done_at_point(point, seq, checks)
        span = max(1, min(ago - 2, 300))
        for n, key in enumerate(done):
            at = min(
                NOW - timedelta(hours=2),
                datetime.combine(start, datetime.min.time(), SG)
                + timedelta(days=span * (n + 1) / (len(done) + 1), hours=10),
            )
            if key == "pv2_letter" and extra.get("ca_overdue"):
                at = NOW - timedelta(days=10)  # the Connection Agreement was due a week after it
            worker = u[crew[contractor][n % len(crew[contractor])]]
            act(worker)
            if not key.startswith("check:"):
                drawing(pid, key, worker, at - timedelta(minutes=30))
            data = {"serial": f"HW-SUN2000-{pid:04d}", "size": "100 kW"} if key == "inverters" else {}
            c.execute("insert into project_steps (project_id, step, done_by, done_at, data) values (%s, %s, %s, %s, %s::jsonb)",
                      (pid, key, worker, at, json.dumps(data)))  # fmt: skip
        # Something uploaded and waiting for its tick, on the projects still going.
        nxt = next((k for k in seq if k not in done and not k.startswith("check:") and k in wf.ITEMS), None)
        if nxt and point not in ("fresh", "complete"):
            st = wf.state(
                {"project_id": pid, "installation_start_date": start, "target_end_date": wf.target_end(start)},
                wf_loaded(c, pid),
                TODAY,
            )
            if wf.opens(st, nxt)[0]:
                act(u[crew[contractor][0]])
                drawing(pid, nxt, u[crew[contractor][0]], NOW - timedelta(hours=5))
        print(f"  + {name} ({point.replace('_', ' ')})")
    act(None)


def wf_loaded(c: psycopg.Connection, pid: int) -> wf.Loaded:
    """The workflow's inputs for one project, read on this connection (wf.load reads through the app's)."""
    out = wf.Loaded()
    for r in c.execute(
        "select s.project_id, s.step, s.done_at, s.data, s.note, null as by_name from project_steps s where project_id = %s",
        (pid,),
    ):
        out.steps.setdefault(pid, {})[r["step"]] = r
    for r in c.execute(
        "select item_id, stage, label from workflow_checklist_items where active order by stage, sort, item_id"
    ):
        out.checklists.setdefault(r["stage"], []).append(r)
    return out


if __name__ == "__main__":
    main()
