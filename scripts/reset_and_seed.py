"""Wipes a database back to empty and fills it with demo people and a project at every stage.

    node scripts/py.mjs scripts/reset_and_seed.py --target dev          (the demo site's data)
    node scripts/py.mjs scripts/reset_and_seed.py --target test --no-seed
    node scripts/py.mjs scripts/reset_and_seed.py --target prod --no-seed --confirm-wipe-production

Sample people and projects only ever go on dev, the demo site's database:
they're marked as sample people (users.is_demo) and the database is marked
as the demo one, so visitors to the demo site can try the app as them.
Production can only be emptied, never seeded.

What it does, in one go:
  1. Deletes every project (with its files, visits, check-ins, milestones,
     and the maintenance records handed-over projects became), group, request,
     alert and phone subscription, and every account except the real
     project-manager logins (people who've signed in, not demo or test
     accounts). Systems imported from the project listing
     (scripts/import_maintenance.py) are kept: they're 9 Solar Home's
     customers, not sample data. Then empties the audit log, with its
     protection switched off for that one statement and back on straight after.
  2. Empties that environment's R2 bucket of project files.
  3. Adds the demo people (example.com addresses, so nobody real is ever
     messaged; two project managers, each running their own projects), two
     contractor groups, a project at each stage of the flow (through signed
     and closed, with signed certificates) with
     sample photos and PDFs in R2, site visits and check-ins, a pending account
     request and role request, and alerts. Changes are recorded in the audit log
     as the person who'd have made them.

Production needs --confirm-wipe-production, and its R2 keys in .env.local as
PROD_R2_ACCESS_KEY_ID and PROD_R2_SECRET_ACCESS_KEY (the laptop's R2_* keys are
for the dev bucket only). Without them it stops before changing anything.
"""

# ruff: noqa: E501  (sample data reads better one record per line)
from __future__ import annotations

import argparse
import json
import math
import os
import re
import struct
import sys
import zlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import httpx
import psycopg
from psycopg import sql as psql
from psycopg.rows import dict_row

from _lib import certificate, storage
from _lib.db import _from_env_file

SG = timezone(timedelta(hours=8))
NOW = datetime.now(SG)
TODAY = NOW.date()
D = lambda n: TODAY + timedelta(days=n)  # noqa: E731

URLS = {"dev": "MIGRATION_DATABASE_URL", "test": "TEST_MIGRATION_DATABASE_URL", "prod": "PROD_MIGRATION_DATABASE_URL"}

# Everything a project or a person owns. TRUNCATE skips row triggers (no audit
# entry per row) and CASCADE takes anything else that points at these.
WIPE = [
    "notification_deliveries",
    "notifications",
    "push_subscriptions",
    "verification_codes",
    "visit_reminders",
    "site_check_ins",
    "site_visits",
    "project_signatures",
    "upload_intents",
    "project_milestones",
    "project_files",
    "project_assignments",
    "maintenance_systems",
    "projects",
    "role_change_requests",
    "account_requests",
    "contractor_group_members",
    "contractor_groups",
]

PEOPLE = [
    # key, name, role, mobile, groups
    # The superadmin: only ever put in by the database owner, which this script is.
    ("sam", "Sam Tan", "superadmin", "+65 9001 2200", []),
    ("charlotte", "Charlotte Sim", "project_manager", "+65 9001 2201", []),
    # A second project manager, running two projects of their own: each PM sees only theirs.
    ("marcus", "Marcus Lim", "project_manager", "+65 9001 2205", []),
    ("priya", "Priya Nair", "contractor", "+65 9001 2202", ["apex", "kim"]),
    ("ravi", "Ravi Kumar", "epc_team", "+65 9001 2203", ["apex"]),
    ("hafiz", "Hafiz Rahman", "epc_team", "+65 9001 2204", ["kim"]),
    ("jasmine", "Jasmine Lee", "homeowner", "+65 9123 4477", []),
    ("daniel", "Daniel Ong", "homeowner", "+65 8877 2210", []),
    ("farah", "Farah Ismail", "homeowner", "+65 9004 1188", []),
    ("aisha", "Aisha Rahman", "homeowner", "+65 9123 4567", []),
    ("kumar", "Kumar Raj", "homeowner", "+65 8765 4321", []),
    ("grace", "Grace Tan", "homeowner", "+65 9668 2031", []),
    ("benjamin", "Benjamin Koh", "homeowner", "+65 9772 1150", []),
    ("lina", "Lina Wong", "homeowner", "+65 9345 6612", []),
    ("ethan", "Ethan Chua", "homeowner", "+65 9456 2290", []),
]
GROUPS = {"apex": "Apex Solar Contractors", "kim": "Kim Seng M&E Services"}
NAMES = {p[0]: p[1] for p in PEOPLE}

# name, address, postal, site, retailer, salesperson, closed (months ago), days created→closed, days over target, PM, crew, (panels, W)
PAST = [
    ("Serangoon Gardens Home", "18 Kensington Park Road, Singapore 557000", "557000", (1.3640, 103.8670), "SP Group", "K. Chandra", 11, 48, 0, "charlotte", "apex", (18, 610)),
    ("Bukit Timah Hillside", "7 Binjai Park, Singapore 589000", "589000", (1.3370, 103.7900), "Geneco", "Mei Ling Goh", 11, 55, 6, "charlotte", "kim", (24, 610)),
    ("Clementi Park House", "25 Clementi Park, Singapore 129000", "129000", (1.3150, 103.7650), "SP Group", "Jason Lim", 10, 44, 0, "marcus", "apex", (16, 580)),
    ("Yishun Riverside", "3 Lorong Bistari, Singapore 768000", "768000", (1.4290, 103.8350), "Keppel Electric", "K. Chandra", 9, 51, 0, "charlotte", "kim", (20, 610)),
    ("Sembawang Hills", "41 Jalan Leban, Singapore 577000", "577000", (1.3740, 103.8320), "SP Group", "Mei Ling Goh", 9, 60, 9, "marcus", "apex", (22, 610)),
    ("Holland Grove Villa", "12 Holland Grove Road, Singapore 278000", "278000", (1.3120, 103.7930), "Senoko Energy", "Jason Lim", 8, 46, 0, "charlotte", "apex", (26, 610)),
    ("Katong Shophouse", "88 Joo Chiat Place, Singapore 427000", "427000", (1.3110, 103.9030), "SP Group", "K. Chandra", 7, 42, 0, "charlotte", "kim", (14, 580)),
    ("Woodlands Crescent", "6 Woodlands Crescent, Singapore 738000", "738000", (1.4410, 103.7910), "Geneco", "Mei Ling Goh", 7, 53, 4, "marcus", "apex", (20, 610)),
    ("Kovan Terrace", "15 Kovan Road, Singapore 548000", "548000", (1.3600, 103.8850), "SP Group", "Jason Lim", 6, 47, 0, "charlotte", "apex", (18, 610)),
    ("Changi Heights", "9 Changi Heights, Singapore 498000", "498000", (1.3610, 103.9690), "Tuas Power Supply", "K. Chandra", 5, 50, 0, "charlotte", "kim", (24, 610)),
    ("Jurong Lakeside", "21 Jalan Pinang, Singapore 618000", "618000", (1.3420, 103.7210), "SP Group", "Mei Ling Goh", 5, 58, 11, "marcus", "apex", (20, 580)),
    ("Marine Parade House", "33 Wilkinson Road, Singapore 436000", "436000", (1.3040, 103.9070), "Keppel Electric", "Jason Lim", 4, 45, 0, "charlotte", "apex", (16, 610)),
    ("Novena Mews", "5 Jalan Kemaman, Singapore 307000", "307000", (1.3200, 103.8390), "SP Group", "K. Chandra", 3, 49, 0, "charlotte", "kim", (22, 610)),
    ("Hougang Avenue Home", "62 Hougang Avenue 2, Singapore 538000", "538000", (1.3610, 103.8890), "Geneco", "Mei Ling Goh", 3, 52, 3, "marcus", "apex", (20, 610)),
    ("Lorong Chuan Villa", "10 Lorong Chuan, Singapore 556000", "556000", (1.3510, 103.8640), "SP Group", "K. Chandra", 2, 44, 0, "charlotte", "apex", (18, 610)),
    ("Teachers' Estate House", "14 Jalan Leban, Singapore 577600", "577600", (1.3755, 103.8335), "Senoko Energy", "Jason Lim", 2, 47, 0, "charlotte", "kim", (20, 580)),
    ("Opera Estate House", "27 Jalan Tari Piring, Singapore 456500", "456500", (1.3175, 103.9265), "SP Group", "Mei Ling Goh", 1, 43, 0, "marcus", "apex", (24, 610)),
    ("Bishan Loft", "8 Jalan Pemimpin, Singapore 577200", "577200", (1.3560, 103.8370), "Keppel Electric", "K. Chandra", 1, 50, 2, "charlotte", "apex", (16, 610)),
]
# name, role asked for, decision, days ago
PAST_REQUESTS = [
    ("Wei Jie Tan", "homeowner", "approved", 300), ("Nur Aisyah", "homeowner", "approved", 240), ("Daniel Koh", "epc_team", "approved", 200),
    ("Siti Rahmah", "homeowner", "rejected", 170), ("Arjun Pillai", "contractor", "approved", 120), ("Grace Ong", "homeowner", "approved", 75),
    ("Benedict Lee", "homeowner", "approved", 40), ("Faizal Ismail", "epc_team", "approved", 20), ("Cheryl Tan", "homeowner", "pending", 6),
]
# The sample homeowners' signature on the signed and closed projects' certificates.
SIGNATURE = (Path(__file__).resolve().parents[1] / "tests_py" / "fixtures" / "signature.jpg").read_bytes()

M1_DETAILS = {
    "sp_application_status": 2,
    "sales": "K. Chandra · Q3-2026-118",
    "waterproofing": True,
    "create_group_chat": True,
    "panel_quantity_estimate": 20,
    "panel_capacity": 610,
    "inverter_to_order": "Huawei SUN2000-10KTL-M1",
    "inverter_collected": True,
    "inverter_serial_number": "HW2K-10KTL-8843921",
    "current_stage": 2,
}
M1_DONE = {
    "installation_end_date": -18,
    "scaffolding_removal": True,
    "scaffolding_removal_date": -17,
    "sp_submission_date": -16,
}
M2 = {
    "inverter_commission_grid_connection": True,
    "commission_date": -11,
    "rcb_breaker_replacement": False,
    "pvl_received_date": -9,
}
M3 = {
    "pre_inspection_date": -6,
    "sp_appointment_letter_received_date": -5,
    "meter_replacement_date": -3,
    "sp_turn_on_inspection_date": -2,
    "fusion_solar_app_access": True,
}
FILES_PRE1 = ["utility_bill", "gst_proof", "sp_forms_signed"]
FILES_PRE1B = ["panel_pictures", "inverter_pictures"]
FILES_M1 = ["sp_submission_screenshot"]
FILES_M2 = ["pvl_letter"]
FILES_M3 = [
    "sp_appointment_letter",
    "as_built_pv_layout",
    "final_submission_documents",
    "handover_docs",
    "fusion_solar_access",
    "completion_form_signed",
]
PHOTO = {"panel_pictures", "inverter_pictures", "sp_submission_screenshot", "fusion_solar_access"}
COLOURS = [(14, 127, 83), (37, 99, 235), (180, 83, 9), (124, 58, 237), (190, 24, 93)]


# ------------------------------------------------------------------ sample files


def png(rgb: tuple[int, int, int]) -> bytes:
    w = h = 96
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def pdf(title: str) -> bytes:
    text = f"BT /F1 18 Tf 60 760 Td ({title} - sample document for the GetHomeApps demo) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(text) + text + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)


class Bucket:
    """The R2 bucket for the environment being reset."""

    def __init__(self, cfg: storage.R2) -> None:
        self.cfg = cfg
        self.http = httpx.Client(timeout=30)

    def put(self, key: str, data: bytes, ctype: str) -> None:
        url = storage._sign(self.cfg, "PUT", key, 120, {"content-type": ctype, "content-length": str(len(data))}, {})
        r = self.http.put(url, content=data, headers={"content-type": ctype})
        r.raise_for_status()

    def keys(self, prefix: str) -> list[str]:
        out: list[str] = []
        token = None
        while True:
            q = {"list-type": "2", "prefix": prefix, **({"continuation-token": token} if token else {})}
            r = self.http.get(storage._sign(self.cfg, "GET", "", 60, {}, q))
            r.raise_for_status()
            out += re.findall(r"<Key>([^<]+)</Key>", r.text)
            m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", r.text)
            if not m:
                return out
            token = m.group(1)

    def delete(self, key: str) -> None:
        self.http.delete(storage._sign(self.cfg, "DELETE", key, 60, {}, {}))


def bucket_for(target: str) -> Bucket | None:
    env = _from_env_file
    if target == "prod":
        acct, kid, sec = env("R2_ACCOUNT_ID"), env("PROD_R2_ACCESS_KEY_ID"), env("PROD_R2_SECRET_ACCESS_KEY")
        return Bucket(storage.R2(acct, kid, sec, "gethomeapps-prod")) if acct and kid and sec else None
    if target == "dev":
        acct, kid, sec, b = env("R2_ACCOUNT_ID"), env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY"), env("R2_BUCKET")
        return Bucket(storage.R2(acct, kid, sec, b)) if acct and kid and sec and b else None
    return None


# ---------------------------------------------------------------------- wipe


def wipe(c: psycopg.Connection, target: str) -> list[dict]:
    keep = c.execute(
        "select uid, full_name, email from users where user_type = 'project_manager' and active "
        "and clerk_user_id is not null and email not like %s and email not like 'pytest%%'",
        ("%@example.com",),
    ).fetchall()
    if target == "test":
        keep = []

    def empty_audit_log() -> None:
        # The audit log refuses TRUNCATE by design (migration 0017); switched off for this one statement.
        c.execute("alter table audit_log disable trigger audit_log_no_truncate")
        c.execute("truncate audit_log restart identity")
        c.execute("alter table audit_log enable trigger audit_log_no_truncate")

    with c.transaction():
        c.execute("select set_config('app.actor_uid', '', true)")
        # First, so deleting accounts doesn't try to blank their names in old entries (which the log forbids).
        empty_audit_log()
        # Imported systems outlive the wipe, without links to the projects and people going.
        c.execute("create temp table keep_systems on commit drop as select * from maintenance_systems where import_ref is not null")
        c.execute(f"truncate {', '.join(WIPE)} restart identity cascade")
        c.execute("update users set invited_by = null where invited_by is not null")
        c.execute("delete from users where uid <> all(%s)", ([k["uid"] for k in keep],))
        c.execute(
            "update keep_systems set project_id = null, homeowner_id = null, "
            "run_by = case when run_by = any(%s) then run_by end",
            ([k["uid"] for k in keep],),
        )
        c.execute("insert into maintenance_systems select * from keep_systems")
        c.execute(
            "select setval(pg_get_serial_sequence('maintenance_systems', 'system_id'), "
            "coalesce((select max(system_id) from maintenance_systems), 0) + 1, false)"
        )
        empty_audit_log()  # and the entries those deletions just wrote
    return keep


# ---------------------------------------------------------------------- seed


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6_371_000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def seed(c: psycopg.Connection, keep: list[dict], bucket: Bucket | None, target: str) -> None:
    one = lambda q, *a: c.execute(q, a).fetchone()  # noqa: E731
    colour = iter(COLOURS * 50)

    def act(uid: int | None) -> None:
        c.execute("select set_config('app.actor_uid', %s, false)", (str(uid) if uid else "",))

    # Through Neon's pooler a session can outlive a failed run, keeping its actor: start clean.
    act(None)
    gid = {
        k: one("insert into contractor_groups (name) values (%s) returning group_id", name)["group_id"]
        for k, name in GROUPS.items()
    }
    u: dict[str, int] = {}
    for key, name, role, mobile, groups in PEOPLE:
        u[key] = one(
            # is_demo: a sample person visitors can try the demo site as (only the owner can set it).
            "insert into users (full_name, user_type, email, contact_no, mobile_verified_at, is_demo) values (%s, %s, %s, %s, now(), true) returning uid",
            name,
            role,
            f"{key}.demo@example.com",
            mobile,
        )["uid"]
        for g in groups:
            c.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (gid[g], u[key]))
    for h in ("jasmine", "daniel", "farah", "aisha", "kumar", "grace", "benjamin", "lina", "ethan"):
        c.execute("update users set ic_last4 = %s where uid = %s", (f"{100 + u[h] % 900:03d}D", u[h]))
    # On dev (the demo site) the sample PM runs the projects, so a visitor trying
    # the app as Charlotte sees their alerts and approvals.
    pm = u["charlotte"] if target == "dev" or not keep else keep[0]["uid"]
    sp = one("select retailer_id from electricity_retailers where name = 'SP Group'")["retailer_id"]
    alerts: list[tuple] = []

    # On the demo, Marcus runs two projects; on a laptop's own database the one real PM runs all.
    marcus = u["marcus"] if target == "dev" or not keep else pm
    manager: dict[int, int] = {}

    def project(name: str, run_by: int | None = None, **cols) -> int:
        who = run_by or pm
        act(who)
        cols = {"name": name, "project_manager_id": who, "created_by": who, "check_in_radius_m": 100, **cols}
        if "created_at" not in cols:
            # Set up about ten days before its start (never in the future), as a PM would.
            start = cols.get("installation_start_date") or TODAY
            cols["created_at"] = datetime.combine(min(start - timedelta(days=10), TODAY - timedelta(days=1)), datetime.min.time(), SG) + timedelta(hours=10)
        if cols.get("homeowner_id"):
            known = next((p[3] for p in PEOPLE if u[p[0]] == cols["homeowner_id"]), None)
            cols.setdefault("homeowner_contact_no", known or one("select contact_no from users where uid = %s", cols["homeowner_id"])["contact_no"])
        keys = ", ".join(cols)
        vals = ", ".join(f"%({k})s" for k in cols)
        pid = c.execute(f"insert into projects ({keys}) values ({vals}) returning project_id", cols).fetchone()[
            "project_id"
        ]
        print(f"  + {name}")
        manager[pid] = who
        return pid

    def status(pid: int, who: int, value: str) -> None:
        act(who)
        c.execute("update projects set status = %s where project_id = %s", (value, pid))

    def fill(pid: int, who: int, values: dict) -> None:
        act(who)
        vals = {k: (D(v) if k.endswith("_date") and isinstance(v, int) else v) for k, v in values.items()}
        sets = ", ".join(f"{k} = %({k})s" for k in vals)
        c.execute(f"update projects set {sets} where project_id = %(pid)s", {**vals, "pid": pid})

    def files(pid: int, who: int, cats: list[str], *, extra_photo: bool = False) -> list[int]:
        act(who)
        made = []
        for cat in cats:
            for n in range(2 if extra_photo and cat == "panel_pictures" else 1):
                photo = cat in PHOTO
                ext, ctype = ("png", "image/png") if photo else ("pdf", "application/pdf")
                key = storage.project_key(pid, cat, ctype)
                label = cat.replace("_", " ").capitalize()
                data = png(next(colour)) if photo else pdf(label)
                if bucket:
                    bucket.put(key, data, ctype)
                else:
                    path = storage.LOCAL_DIR / key
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                    path.with_suffix(path.suffix + ".type").write_text(ctype)
                name = f"{label}{f' {n + 1}' if n else ''}.{ext}"
                made.append(
                    c.execute(
                        "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by, kind) "
                        "values (%s, %s, %s, %s, %s, %s, %s, %s) returning file_id",
                        (pid, cat, key, name, ctype, len(data), who, storage.kind_of(ctype)),
                    ).fetchone()["file_id"]
                )
        return made

    def milestones(pid: int, who: int, upto: int) -> None:
        act(who)
        for n in range(1, upto + 1):
            c.execute(
                "insert into project_milestones (project_id, milestone_no, completed_by) values (%s, %s, %s) on conflict do nothing",
                (pid, n, who),
            )

    def visit(pid: int, day: date, time: str | None, note: str) -> int:
        act(manager[pid])
        return one(
            "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note, created_by) values (%s, %s, %s, %s, %s) returning visit_id",
            pid,
            day,
            time,
            note,
            manager[pid],
        )["visit_id"]

    def attended(
        pid: int, vid: int, who: int, site: tuple[float, float], day: date, t_in: str, t_out: str, crew: int
    ) -> None:
        """A past check-in. The database stamps check-ins with its own clock, so the
        rule that does it is paused for this one insert (owner connection only)."""
        act(who)
        at = lambda t: datetime.combine(day, datetime.strptime(t, "%H:%M").time(), SG)  # noqa: E731
        spot = (site[0] + 0.00012, site[1] + 0.00008)
        with c.transaction():
            c.execute("alter table site_check_ins disable trigger enforce_check_in_radius_insert")
            c.execute(
                "insert into site_check_ins (project_id, visit_id, user_id, checked_in_at, crew_in, lat, lng, distance_m, "
                "accuracy_m, checked_out_at, crew_out) values (%s, %s, %s, %s, %s, %s, %s, %s, 9, %s, 0)",
                (pid, vid, who, at(t_in), crew, spot[0], spot[1], round(haversine(site, spot), 1), at(t_out)),
            )
            c.execute("alter table site_check_ins enable trigger enforce_check_in_radius_insert")

    def alert(
        uid: int, kind: str, title: str, body: str, pid: int | None, link: str, minutes_ago: int, read: bool = False
    ) -> None:
        alerts.append((uid, kind, title, body, pid, link, minutes_ago, read))

    # 1. Draft: the homeowner is only a typed name and the crew a typed company.
    project(
        "Bedok Ria Terrace",
        address="3 Bedok Ria, Singapore 469000",
        postal_code="469000",
        site_lat=1.3236,
        site_lng=103.9273,
        homeowner_name="Marcus Teo",
        homeowner_contact_no="+65 9330 5521",
        contractor_text="Northline Roofing Pte Ltd",
        installation_start_date=D(14),
        target_end_date=D(35),
        status="draft",
    )

    # 2. Waiting for the homeowner.
    hill = project(
        "Hillcrest Villa",
        address="27 Hillcrest Road, Singapore 289000",
        postal_code="289000",
        site_lat=1.3294,
        site_lng=103.8021,
        homeowner_id=u["farah"],
        contractor_group_id=gid["kim"],
        installation_start_date=D(7),
        target_end_date=D(28),
        status="awaiting_homeowner",
    )
    alert(
        u["farah"],
        "approval_request",
        "Approve Hillcrest Villa",
        "9 Solar Home has set up your solar project. Please review and approve it.",
        hill,
        f"/projects/{hill}",
        60 * 20,
    )

    # 3. The homeowner declined, with a reason; the PM can ask again.
    tam = project(
        "Tampines Grove",
        run_by=marcus,
        address="12 Tampines Grove, Singapore 528600",
        postal_code="528600",
        site_lat=1.3550,
        site_lng=103.9430,
        homeowner_id=u["benjamin"],
        contractor_group_id=gid["apex"],
        installation_start_date=D(10),
        target_end_date=D(31),
        status="awaiting_homeowner",
    )
    status(tam, u["benjamin"], "homeowner_declined")
    alert(
        marcus,
        "approval_declined",
        "Benjamin Koh declined Tampines Grove",
        "Reason: “The start date clashes with our renovation. Can we start in December?”",
        tam,
        f"/projects/{tam}",
        60 * 5,
    )

    # 4. The homeowner approved; a PM approves next.
    sun = project(
        "Sunbird Circle",
        address="8 Sunbird Circle, Singapore 488106",
        postal_code="488106",
        site_lat=1.3521,
        site_lng=103.8198,
        homeowner_id=u["daniel"],
        contractor_group_id=gid["apex"],
        installation_start_date=D(3),
        target_end_date=D(24),
        status="awaiting_homeowner",
    )
    status(sun, u["daniel"], "homeowner_approved")
    alert(
        pm,
        "approval_request",
        "Approve Sunbird Circle",
        "Daniel Ong approved the project. Approve it to start the work.",
        sun,
        f"/projects/{sun}",
        90,
    )

    # 5. Under way: before Milestone 1 done, survey half done. Visited yesterday; due again today.
    jk_site = (1.3966, 103.8730)
    jk = project(
        "Jalan Kayu Residence",
        address="14 Jalan Kayu, Singapore 799463",
        postal_code="799463",
        site_lat=jk_site[0],
        site_lng=jk_site[1],
        homeowner_id=u["jasmine"],
        contractor_group_id=gid["apex"],
        installation_start_date=D(-5),
        target_end_date=D(16),
        status="awaiting_homeowner",
    )
    status(jk, u["jasmine"], "homeowner_approved")
    status(jk, pm, "pm_approved")
    fill(
        jk,
        u["priya"],
        {
            "electricity_retailer_id": sp,
            "sp_application_status": 1,
            "sales": M1_DETAILS["sales"],
            "waterproofing": True,
            "create_group_chat": True,
        },
    )
    status(jk, u["priya"], "in_progress")
    files(jk, u["priya"], FILES_PRE1)
    fill(
        jk,
        u["ravi"],
        {"panel_quantity_estimate": 20, "panel_capacity": 610, "inverter_to_order": M1_DETAILS["inverter_to_order"]},
    )
    blurry = files(jk, u["ravi"], ["panel_pictures"], extra_photo=True)
    act(
        pm
    )  # A blurry photo, removed by the PM: it shows under Ravi's My Files → Removed, and can be restored in Audit.
    c.execute("update project_files set file_name = 'Panels (blurry).png' where file_id = %s", (blurry[-1],))
    c.execute("delete from project_files where file_id = %s", (blurry[-1],))
    v_yday = visit(jk, D(-1), "09:00", "Scaffolding erected")
    attended(jk, v_yday, u["ravi"], jk_site, D(-1), "08:52", "17:30", 4)
    visit(jk, TODAY, "14:00", "Panel mounting")
    visit(jk, D(3), "09:00", "Inverter installation")
    alert(
        u["ravi"],
        "visit_assigned",
        "Site visit today · Jalan Kayu Residence",
        "Today at 14:00 — Panel mounting.",
        jk,
        f"/projects/{jk}#site-visits",
        60 * 18,
        True,
    )

    # 6. Milestone 1 done, Milestone 2 under way — past its end date, and the crew is running late this morning.
    sel_site = (1.3770, 103.8750)
    sel = project(
        "Seletar Hills Home",
        address="21 Seletar Hills Drive, Singapore 807021",
        postal_code="807021",
        site_lat=sel_site[0],
        site_lng=sel_site[1],
        homeowner_id=u["aisha"],
        contractor_group_id=gid["apex"],
        installation_start_date=D(-30),
        target_end_date=D(-9),
        status="awaiting_homeowner",
    )
    status(sel, u["aisha"], "homeowner_approved")
    status(sel, pm, "pm_approved")
    fill(sel, u["priya"], {"electricity_retailer_id": sp, **M1_DETAILS})
    status(sel, u["priya"], "in_progress")
    files(sel, u["priya"], FILES_PRE1)
    fill(sel, u["ravi"], M1_DONE)
    files(sel, u["ravi"], FILES_PRE1B + FILES_M1)
    milestones(sel, u["ravi"], 1)
    fill(sel, u["ravi"], {"inverter_commission_grid_connection": False, "commission_date": D(4)})
    late = visit(sel, TODAY, "08:00", "Inverter commissioning")
    c.execute("insert into visit_reminders (visit_id, kind) values (%s, 'missed')", (late,))
    for who in (pm, u["ravi"]):
        alert(
            who,
            "visit_missed",
            "Running late · Seletar Hills Home",
            "The EPC crew was due today at 08:00 and hasn't checked in an hour later.",
            sel,
            f"/projects/{sel}#site-visits",
            35,
        )

    # 7. Milestones 1 and 2 done; Milestone 3 under way, with a visit tomorrow.
    pr_site = (1.3720, 103.9500)
    pr = project(
        "Pasir Ris Garden",
        run_by=marcus,
        address="40 Pasir Ris Drive 3, Singapore 518180",
        postal_code="518180",
        site_lat=pr_site[0],
        site_lng=pr_site[1],
        homeowner_id=u["grace"],
        contractor_group_id=gid["kim"],
        installation_start_date=D(-24),
        target_end_date=D(5),
        status="awaiting_homeowner",
    )
    status(pr, u["grace"], "homeowner_approved")
    status(pr, marcus, "pm_approved")
    fill(pr, u["priya"], {"electricity_retailer_id": sp, **M1_DETAILS})
    status(pr, u["priya"], "in_progress")
    files(pr, u["priya"], FILES_PRE1)
    fill(pr, u["hafiz"], M1_DONE)
    files(pr, u["hafiz"], FILES_PRE1B + FILES_M1)
    milestones(pr, u["hafiz"], 1)
    fill(pr, u["hafiz"], M2)
    files(pr, u["hafiz"], FILES_M2)
    milestones(pr, u["hafiz"], 2)
    fill(pr, u["hafiz"], {"pre_inspection_date": D(-1)})
    v = visit(pr, D(-12), "10:00", "Inverter commissioning")
    attended(pr, v, u["hafiz"], pr_site, D(-12), "10:40", "15:10", 3)
    visit(pr, D(1), "10:00", "SP turn-on inspection")
    alert(
        marcus,
        "milestone_complete",
        "Milestone 2 complete · Pasir Ris Garden",
        "The inverter is commissioned and the grid connection is in hand.",
        pr,
        f"/projects/{pr}",
        60 * 30,
        True,
    )

    # 8. Everything done: ready for the handover certificate.
    pg = project(
        "Punggol Waterway Terrace",
        address="5 Punggol Walk, Singapore 828768",
        postal_code="828768",
        site_lat=1.4096,
        site_lng=103.9047,
        homeowner_id=u["kumar"],
        contractor_group_id=gid["kim"],
        installation_start_date=D(-28),
        target_end_date=D(7),
        status="awaiting_homeowner",
    )
    status(pg, u["kumar"], "homeowner_approved")
    status(pg, pm, "pm_approved")
    fill(pg, u["priya"], {"electricity_retailer_id": sp, **M1_DETAILS})
    status(pg, u["priya"], "in_progress")
    files(pg, u["priya"], FILES_PRE1)
    fill(pg, u["priya"], M1_DONE)
    files(pg, u["priya"], FILES_PRE1B + FILES_M1)
    milestones(pg, u["priya"], 1)
    fill(pg, u["priya"], M2)
    files(pg, u["priya"], FILES_M2)
    milestones(pg, u["priya"], 2)
    fill(pg, u["priya"], M3)
    files(pg, u["priya"], FILES_M3)
    milestones(pg, u["priya"], 3)
    status(pg, u["priya"], "awaiting_signature")
    for who in (pm, u["priya"]):
        alert(
            who,
            "milestone_complete",
            "Ready for handover · Punggol Waterway Terrace",
            "Every milestone is complete. The homeowner has been asked to sign the handover certificate.",
            pg,
            f"/projects/{pg}",
            60 * 3,
            who != pm,
        )
    alert(
        u["kumar"],
        "signature_request",
        "Sign your handover certificate · Punggol Waterway Terrace",
        "Your solar installation at 5 Punggol Walk, Singapore 828768 is complete. Check the installation certificate and sign it on your phone.",
        pg,
        f"/projects/{pg}",
        60 * 3,
    )

    def finished(
        name: str,
        homeowner: str,
        address: str,
        postal: str,
        site: tuple[float, float],
        start: int,
        *,
        run_by: int | None = None,
        group: str = "apex",
        retailer: int | None = None,
        sales: str | None = None,
        panels: tuple[int, int] | None = None,
        homeowner_uid: int | None = None,
        signer_name: str | None = None,
        created: datetime | None = None,
    ) -> int:
        """A project with every milestone done and the homeowner's signature on its certificate."""
        ho = homeowner_uid or u[homeowner]
        boss = run_by or pm
        extra = {"created_at": created} if created else {}
        pid = project(
            name,
            run_by=boss,
            **extra,
            address=address,
            postal_code=postal,
            site_lat=site[0],
            site_lng=site[1],
            homeowner_id=ho,
            contractor_group_id=gid[group],
            installation_start_date=D(start),
            target_end_date=D(start + 21),
            status="awaiting_homeowner",
        )
        status(pid, ho, "homeowner_approved")
        status(pid, boss, "pm_approved")
        details = {**M1_DETAILS, "electricity_retailer_id": retailer or sp}
        if sales:
            details["sales"] = sales
        if panels:
            details["panel_quantity_estimate"], details["panel_capacity"] = panels
        fill(pid, u["priya"], details)
        status(pid, u["priya"], "in_progress")
        files(pid, u["priya"], FILES_PRE1)
        fill(pid, u["ravi"], {**M1_DONE, **M2, **M3})
        files(pid, u["ravi"], FILES_PRE1B + FILES_M1 + FILES_M2 + FILES_M3)
        milestones(pid, u["ravi"], 3)
        status(pid, u["ravi"], "awaiting_signature")
        row = one(
            "select p.*, h.full_name as h_name, r.name as retailer_name from projects p join users h on h.uid = p.homeowner_id "
            "left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id where p.project_id = %s",
            pid,
        )
        pm_name = one("select full_name from users where uid = %s", boss)["full_name"]
        cert = certificate.build(row, contractor=GROUPS[group], manager=pm_name)
        fp = certificate.fingerprint(cert)
        pdf_key, sig_key = storage.handover_keys(pid)
        signer = signer_name or NAMES[homeowner]
        act(ho)
        signed_at = one(
            "insert into project_signatures (project_id, signed_by, signature_url, certificate_hash, certificate_url, signer_name, certificate) "
            "values (%s, %s, %s, %s, %s, %s, %s) returning signed_at",
            pid,
            ho,
            sig_key,
            fp,
            pdf_key,
            signer,
            json.dumps(cert, ensure_ascii=False),
        )["signed_at"]
        document = certificate.pdf(cert, signature=SIGNATURE, signer=signer, signed_at=signed_at, fingerprint_hex=fp)
        for key, data, ctype in ((sig_key, SIGNATURE, "image/jpeg"), (pdf_key, document, "application/pdf")):
            if bucket:
                bucket.put(key, data, ctype)
            else:
                path = storage.LOCAL_DIR / key
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                path.with_suffix(path.suffix + ".type").write_text(ctype)
        status(pid, ho, "signed")
        return pid

    # 9. Signed by the homeowner: the PM checks the certificate and closes the project.
    ut = finished("Upper Thomson Corner", "lina", "5 Thomson Hills Road, Singapore 574000", "574000", (1.3540, 103.8330), -35)
    alert(pm, "signed", "Handover signed · Upper Thomson Corner", "Lina Wong signed the installation certificate. Check it and close the project.", ut, f"/projects/{ut}", 40)

    # 10. Closed: signed, checked and closed, and everyone told.
    sg = finished("Siglap Garden House", "ethan", "40 Siglap Hill, Singapore 456000", "456000", (1.3130, 103.9260), -50)
    status(sg, pm, "closed")
    for who in (u["ethan"], u["priya"], u["ravi"]):
        text = (
            "Siglap Garden House is complete and closed. Thank you for choosing 9 Solar Home."
            if who == u["ethan"]
            else "The homeowner signed the handover certificate and the project is closed."
        )
        alert(who, "project_closed", "Project closed · Siglap Garden House", text, sg, f"/projects/{sg}", 60 * 26, True)

    # 11. A year of finished projects, so the dashboard has trends to show: when each
    # was created, approved, worked through, signed and closed, some on time and some
    # late, across Singapore's regions, retailers, salespeople and both PMs. Their
    # homeowners aren't sample people visitors can pick.
    retailer_ids = {
        name: one(
            "insert into electricity_retailers (name) values (%s) on conflict (name) do update set name = excluded.name "
            "returning retailer_id",
            name,
        )["retailer_id"]
        for name in ("SP Group", "Geneco", "Keppel Electric", "Senoko Energy", "Tuas Power Supply")
    }
    history: list[tuple[int, dict[str, datetime]]] = []
    for n, (name, street, postal, site, retailer, seller, months_ago, took, late_by, pm_key, group, kit) in enumerate(PAST):
        closed_on = NOW - timedelta(days=30 * months_ago + (n % 4) * 3)
        created_on = closed_on - timedelta(days=took)
        ho = one(
            "insert into users (full_name, user_type, email, contact_no) values (%s, 'homeowner', %s, %s) returning uid",
            f"{name.split()[0]} Homeowner",
            f"past{n}.demo@example.com",
            f"+65 9{n:03d} 7{n:03d}",
        )["uid"]
        start = (created_on.date() - TODAY).days + 4
        pid = finished(
            name,
            "",
            street,
            postal,
            site,
            start,
            run_by=u[pm_key],
            group=group,
            retailer=retailer_ids[retailer],
            sales=f"{seller} · {created_on:%y%m}-{n:02d}",
            panels=kit,
            homeowner_uid=ho,
            signer_name=f"{name.split()[0]} Homeowner",
            created=created_on,
        )
        # The target: three weeks after the start, plus the job's usual length; some finish after it.
        target = created_on.date() + timedelta(days=took - late_by)
        c.execute("update projects set target_end_date = %s where project_id = %s", (target, pid))
        status(pid, u[pm_key], "closed")
        approved = created_on + timedelta(days=2 + n % 3, hours=3)
        pm_ok = approved + timedelta(days=1, hours=2)
        m1 = created_on + timedelta(days=round(took * 0.35))
        m2 = created_on + timedelta(days=round(took * 0.55))
        m3 = created_on + timedelta(days=round(took * 0.8))
        signed = m3 + timedelta(days=1 + n % 3, hours=5)
        when = {
            "awaiting_homeowner": created_on,
            "homeowner_approved": approved,
            "pm_approved": pm_ok,
            "in_progress": pm_ok + timedelta(days=1),
            "awaiting_signature": m3,
            "signed": signed,
            "closed": closed_on,
            "m1": m1,
            "m2": m2,
            "m3": m3,
        }
        history.append((pid, when))
        # Two or three site visits each, attended at varied hours (some an hour or more late).
        for k in range(2 + n % 2):
            day = (pm_ok + timedelta(days=4 + k * 6)).date()
            planned = ["08:00", "09:00", "13:30"][(n + k) % 3]
            arrive = (datetime.strptime(planned, "%H:%M") + timedelta(minutes=[-10, 5, 25, 75][(n + k) % 4])).strftime("%H:%M")
            v = visit(pid, day, planned, ["Scaffolding erected", "Panel mounting", "Inverter commissioning"][k % 3])
            attended(pid, v, u["ravi" if group == "apex" else "hafiz"], site, day, arrive, "16:45", 3 + (n + k) % 3)

    # Account requests over the year, for the sign-up figures.
    act(None)
    for n, (who, role_key, state, days_ago) in enumerate(PAST_REQUESTS):
        c.execute(
            "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no, status, created_at, decided_at) "
            "values (%s, %s, %s, %s, '+65 8000 0000', %s, now() - make_interval(days => %s), "
            "case when %s <> 'pending' then now() - make_interval(days => %s) end)",
            (f"user_past_{n}", f"request{n}.demo@example.com", who, role_key, state, days_ago, state, max(days_ago - 1, 0)),
        )

    # People waiting for a PM: a new account, and a role change.
    act(None)
    c.execute(
        "insert into account_requests (clerk_user_id, email, full_name, requested_type, contact_no, note) "
        "values ('user_demo_kelvin', 'kelvin.demo@example.com', 'Kelvin Lim', 'epc_team', '+65 8222 1100', 'I''m joining Apex Solar''s crew next week.')"
    )
    act(u["ravi"])
    c.execute(
        "insert into role_change_requests (uid, from_type, requested_type, reason) values (%s, 'epc_team', 'contractor', %s)",
        (u["ravi"], "I'm moving to Apex's office to coordinate crews from November."),
    )
    alert(pm, "account_request", "New account request", "Kelvin Lim asked to join as EPC Team.", None, "/people", 50)
    alert(
        pm,
        "role_request",
        "Role change request",
        "Ravi Kumar asked to change from EPC Team to Contractor Admin.",
        None,
        "/people",
        25,
    )

    act(None)
    for uid, kind, title, body, pid, link, mins, read in alerts:
        c.execute(
            "insert into notifications (recipient_uid, project_id, kind, title, body, link, created_at, read_at) "
            "values (%s, %s, %s, %s, %s, %s, now() - make_interval(mins => %s), case when %s then now() end)",
            (uid, pid, kind, title, body, link, mins, read),
        )
    c.execute("select set_config('app.actor_uid', '', false)")
    # The projects still under way: approvals a few days after they were set up, not today.
    done = {pid for pid, _ in history}
    for r in c.execute("select project_id, created_at from projects").fetchall():
        if r["project_id"] not in done:
            t0 = r["created_at"]
            # Never later than now: a project set up yesterday was approved since, not next week.
            at = lambda d, h=0, t0=t0: min(t0 + timedelta(days=d, hours=h), NOW - timedelta(minutes=30))  # noqa: E731
            history.append((r["project_id"], {"homeowner_approved": at(2, 4), "homeowner_declined": at(3), "pm_approved": at(3, 1), "in_progress": at(4)}))
    backdate(c, history)
    maintenance(c, u)


# Sample systems from before the app, as the project listing import brings them in:
# address, postal, PPA years (None: value buy), plan years, plan excludes the 1st year,
# panels [(count, Wp)], phase, inverters, months since turn-on, urgent note, manager.
LISTING = [
    ("12 Sample Rise", "579001", 5, 5, False, [(22, 620)], 1, ["SUN2000-5KTL-L1", "SUN2000-5KTL-L1"], 4, None, "charlotte"),
    ("7 Example Avenue", "466001", 7, 7, True, [(23, 635), (3, 620)], 1, ["SUN2000-10K-LC0"], 7, "Poor generation: need to check", "charlotte"),
    ("30 Demo Crescent", "558001", None, 3, False, [(38, 620)], 3, ["SUN2000-25KTL-M5"], 5, None, None),
    ("88 Showcase Road", "288001", 8, 8, True, [(62, 620)], 3, ["SUN2000-17KTL-MB0", "SUN2000-17KTL-MB0"], 12, None, "marcus"),
    ("3 Trial Lane", "809001", 5, 5, True, [(18, 640)], 1, ["SUN2000-12K-MB0"], 2, None, None),
    ("41 Preview Walk", "486001", 5, 5, False, [(20, 620)], 1, ["SUN2000-10KTL-MAP0"], 9, None, "charlotte"),
]


def maintenance(c: psycopg.Connection, u: dict[str, int]) -> None:
    """Maintenance as it would look: the handed-over projects' contracts filled in, and sample imported systems."""
    c.execute("select set_config('app.actor_uid', '', false)")
    # The handed-over projects became maintenance records as they closed (today, before the
    # history was backdated): count their checks from when they really closed.
    for i, m in enumerate(c.execute(
        "select m.system_id, p.closed_at, p.panel_capacity from maintenance_systems m join projects p using (project_id) order by m.system_id"
    ).fetchall()):  # fmt: skip
        on = m["closed_at"].astimezone(SG).date()
        six, year = add_months(on, 6), add_months(on, 12)
        c.execute(
            "update maintenance_systems set turned_on_on = %s, six_month_due = %s, one_year_due = %s, "
            "six_month_done_on = %s, one_year_done_on = %s, ppa_kind = %s, ppa_years = %s, plan_years = %s, "
            "plan_excludes_first_year = %s, phase = %s, roof_access = false where system_id = %s",
            (
                on, six, year,
                # Most checks that fell due were done a few days after; one in five is still waiting.
                six + timedelta(days=3) if six + timedelta(days=3) < TODAY and i % 5 else None,
                year + timedelta(days=5) if year + timedelta(days=5) < TODAY and i % 5 else None,
                "value_buy" if i % 4 == 3 else "ppa", None if i % 4 == 3 else (5, 7, 8)[i % 3],
                (5, 7, 8)[i % 3], i % 2 == 1, 3 if i % 3 == 0 else 1, m["system_id"],
            ),
        )  # fmt: skip
    for n, (addr, postal, ppa, plan, excl, panels, phase, inverters, months, urgent, pm) in enumerate(LISTING, 1):
        on = add_months(TODAY, -months)
        c.execute(
            "insert into maintenance_systems (import_ref, address, postal_code, run_by, ppa_kind, ppa_years, plan_years, "
            "plan_excludes_first_year, panels, kwp, phase, inverters, turned_on_on, six_month_due, one_year_due, "
            "six_month_done_on, roof_access, urgent, urgent_note) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, %s, %s)",
            (
                f"demo-listing#{n}", addr, postal, u[pm] if pm else None, "ppa" if ppa else "value_buy", ppa, plan, excl,
                json.dumps([{"count": k, "wp": w} for k, w in panels]), sum(k * w for k, w in panels) / 1000, phase,
                inverters, on, add_months(on, 6), add_months(on, 12),
                # The 6-month check done where it fell due over a month ago; 7 Example Avenue's is overdue.
                add_months(on, 6) + timedelta(days=4) if months >= 8 and n != 2 else None,
                urgent is not None, urgent,
            ),
        )  # fmt: skip


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    last = (date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)).day
    return date(year, month, min(d.day, last))


def backdate(c: psycopg.Connection, history: list[tuple[int, dict[str, datetime]]]) -> None:
    """Sample history only: the audit log, milestones, signature and closing moved to when they happened.

    The audit log refuses edits by design; this one statement, on the demo
    database, by its owner, is the exception, and its protection is back on
    straight after (as for the empty log in wipe()).
    """
    with c.transaction():
        c.execute("alter table audit_log disable trigger audit_log_no_update")
        for pid, when in history:
            for state in when.keys() & {"awaiting_homeowner", "homeowner_approved", "homeowner_declined", "pm_approved", "in_progress", "awaiting_signature", "signed", "closed"}:
                c.execute(
                    "update audit_log set occurred_at = %s where entity_table = 'projects' and project_id = %s "
                    "and changes->'status'->>'to' = %s",
                    (when[state], pid, state),
                )
            if "closed" in when:
                c.execute(
                    "update audit_log set occurred_at = %s where project_id = %s and occurred_at > %s and not (changes ? 'status')",
                    (when["m1"], pid, when["closed"]),
                )
        c.execute("alter table audit_log enable trigger audit_log_no_update")
        for pid, when in history:
            if "closed" not in when:
                continue
            for n in (1, 2, 3):
                c.execute(
                    "update project_milestones set completed_at = %s where project_id = %s and milestone_no = %s",
                    (when[f"m{n}"], pid, n),
                )
            c.execute("update project_signatures set signed_at = %s where project_id = %s", (when["signed"], pid))
            c.execute("update projects set closed_at = %s where project_id = %s", (when["closed"], pid))


def mark_demo_database(c: psycopg.Connection) -> None:
    """The database's own "this is the demo" marker (api/_lib/demo.py): its comment, which only its owner can set."""
    db = c.execute("select current_database() as d").fetchone()["d"]
    c.execute(psql.SQL("comment on database {} is 'gethomeapps:demo'").format(psql.Identifier(db)))


# ---------------------------------------------------------------------- main


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", choices=URLS, required=True)
    ap.add_argument("--no-seed", action="store_true", help="wipe only")
    ap.add_argument("--confirm-wipe-production", action="store_true")
    a = ap.parse_args()

    url = _from_env_file(URLS[a.target])
    if not url:
        sys.exit(f"{URLS[a.target]} isn't in .env.local")
    host = lambda x: psycopg.conninfo.conninfo_to_dict(x)["host"]  # noqa: E731
    prod_url = _from_env_file("PROD_MIGRATION_DATABASE_URL")
    is_prod = bool(prod_url) and host(url) == host(prod_url)
    if a.target != "prod" and is_prod:
        sys.exit(f"Refusing: {URLS[a.target]} points at production.")
    if a.target == "prod" and not a.no_seed:
        sys.exit("Production never gets sample people or projects. To empty it, add --no-seed.")
    if a.target == "prod" and not a.confirm_wipe_production:
        sys.exit(
            "Production: add --confirm-wipe-production. Everything except real PM logins is deleted, including the audit log."
        )

    bucket = bucket_for(a.target)
    if a.target == "prod" and not bucket:
        sys.exit(
            "Production's R2 keys aren't in .env.local (PROD_R2_ACCESS_KEY_ID, PROD_R2_SECRET_ACCESS_KEY). Nothing was changed."
        )

    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        print(f"Resetting {a.target} ({host(url).split('.')[0]})")
        keep = wipe(c, a.target)
        print("  kept: " + (", ".join(f"{k['full_name']} (PM)" for k in keep) or "no accounts"))
        if bucket:
            # Project files, and the pictures of the people just removed.
            gone = bucket.keys("projects/") + bucket.keys("profiles/")
            for key in gone:
                bucket.delete(key)
            print(f"  {bucket.cfg.bucket}: removed {len(gone)} stored files")
        else:  # laptop storage (dev without R2, and test)
            import shutil

            shutil.rmtree(storage.LOCAL_DIR / "projects", ignore_errors=True)
        if not a.no_seed:
            seed(c, keep, bucket, a.target)
            if a.target == "dev":
                mark_demo_database(c)
                print("  marked as the demo database (its comment: gethomeapps:demo)")
            n = c.execute(
                "select (select count(*) from projects) p, (select count(*) from users) u, (select count(*) from project_files) f"
            ).fetchone()
            print(f"Seeded: {n['p']} projects, {n['u']} accounts, {n['f']} files.")


if __name__ == "__main__":
    main()
