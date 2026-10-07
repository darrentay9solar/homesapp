"""Wipes a database back to empty and fills it with demo people and a project at every stage.

    node scripts/py.mjs scripts/reset_and_seed.py --target dev
    node scripts/py.mjs scripts/reset_and_seed.py --target test --no-seed
    node scripts/py.mjs scripts/reset_and_seed.py --target prod --confirm-wipe-production

What it does, in one go:
  1. Deletes every project (with its files, visits, check-ins, milestones),
     group, request, alert and phone subscription, and every account except
     the real project-manager logins (people who've signed in, not demo or test
     accounts). Then empties the audit log, with its protection switched off
     for that one statement and back on straight after.
  2. Empties that environment's R2 bucket of project files.
  3. Adds the demo people (example.com addresses, so nobody real is ever
     messaged), two contractor groups, a project at each stage of the flow with
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
import math
import os
import re
import struct
import sys
import uuid
import zlib
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import httpx
import psycopg
from psycopg.rows import dict_row

from _lib import storage
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
    "project_milestones",
    "project_files",
    "project_assignments",
    "projects",
    "role_change_requests",
    "account_requests",
    "contractor_group_members",
    "contractor_groups",
]

PEOPLE = [
    # key, name, role, mobile, groups
    ("charlotte", "Charlotte Sim", "project_manager", "+65 9001 2201", []),
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
]
GROUPS = {"apex": "Apex Solar Contractors", "kim": "Kim Seng M&E Services"}

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
        c.execute(f"truncate {', '.join(WIPE)} restart identity cascade")
        c.execute("update users set invited_by = null where invited_by is not null")
        c.execute("delete from users where uid <> all(%s)", ([k["uid"] for k in keep],))
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

    gid = {
        k: one("insert into contractor_groups (name) values (%s) returning group_id", name)["group_id"]
        for k, name in GROUPS.items()
    }
    u: dict[str, int] = {}
    for key, name, role, mobile, groups in PEOPLE:
        u[key] = one(
            "insert into users (full_name, user_type, email, contact_no, mobile_verified_at) values (%s, %s, %s, %s, now()) returning uid",
            name,
            role,
            f"{key}.demo@example.com",
            mobile,
        )["uid"]
        for g in groups:
            c.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (gid[g], u[key]))
    for h in ("jasmine", "daniel", "farah", "aisha", "kumar", "grace", "benjamin"):
        c.execute("update users set ic_last4 = %s where uid = %s", (f"{100 + u[h] % 900:03d}D", u[h]))
    pm = keep[0]["uid"] if keep else u["charlotte"]
    sp = one("select retailer_id from electricity_retailers where name = 'SP Group'")["retailer_id"]
    alerts: list[tuple] = []

    def project(name: str, **cols) -> int:
        act(pm)
        cols = {"name": name, "project_manager_id": pm, "created_by": pm, "check_in_radius_m": 100, **cols}
        if cols.get("homeowner_id"):
            cols.setdefault("homeowner_contact_no", next(p[3] for p in PEOPLE if u[p[0]] == cols["homeowner_id"]))
        keys = ", ".join(cols)
        vals = ", ".join(f"%({k})s" for k in cols)
        pid = c.execute(f"insert into projects ({keys}) values ({vals}) returning project_id", cols).fetchone()[
            "project_id"
        ]
        print(f"  + {name}")
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
                key = f"projects/{pid}/{cat}/{uuid.uuid4()}.{ext}"
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
                        "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, uploaded_by) "
                        "values (%s, %s, %s, %s, %s, %s, %s) returning file_id",
                        (pid, cat, key, name, ctype, len(data), who),
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
        act(pm)
        return one(
            "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note, created_by) values (%s, %s, %s, %s, %s) returning visit_id",
            pid,
            day,
            time,
            note,
            pm,
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
        pm,
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
    status(pr, pm, "pm_approved")
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
        pm,
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
    for who in (pm, u["kumar"], u["priya"]):
        alert(
            who,
            "milestone_complete",
            "Ready for handover · Punggol Waterway Terrace",
            "Every milestone is complete. Next: the handover certificate for e-signature.",
            pg,
            f"/projects/{pg}",
            60 * 3,
            who != pm,
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
            gone = bucket.keys("projects/")
            for key in gone:
                bucket.delete(key)
            print(f"  {bucket.cfg.bucket}: removed {len(gone)} stored files")
        elif a.target == "dev":
            import shutil

            shutil.rmtree(storage.LOCAL_DIR / "projects", ignore_errors=True)
        if not a.no_seed:
            seed(c, keep, bucket, a.target)
            n = c.execute(
                "select (select count(*) from projects) p, (select count(*) from users) u, (select count(*) from project_files) f"
            ).fetchone()
            print(f"Seeded: {n['p']} projects, {n['u']} accounts, {n['f']} files.")


if __name__ == "__main__":
    main()
