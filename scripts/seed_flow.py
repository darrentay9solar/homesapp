"""Sample projects at every stage of the flow, for walking through it by hand.

    .venv/Scripts/python.exe scripts/seed_demo.py     (people and groups first)
    .venv/Scripts/python.exe scripts/seed_flow.py

DEVELOPMENT database only: refuses production. Idempotent: a project whose
name already exists is left alone, so run it again after deleting one to
put it back. Changes are recorded in the audit log as the people who would
have made them (the PM creates; the crew fills in), so Audit reads the way
it will for real. Sample files go to local storage (web/.uploads/).

    Stage                      Project                     Homeowner
    1  Draft (name only)       Bedok Ria Terrace           "Marcus Teo" (typed)
    2  Awaiting homeowner      Hillcrest Villa             Farah Ismail
    3  PM to approve           Sunbird Circle              Daniel Ong
    4  In progress (M1)        Jalan Kayu Residence        Jasmine Lee
    5  Late + EPC no-show      Seletar Hills Home          Aisha Rahman
    6  Ready for handover      Punggol Waterway Terrace    Kumar Raj
"""

from __future__ import annotations

import os
import struct
import sys
import uuid
import zlib
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import psycopg
from psycopg.rows import dict_row

from _lib.db import _from_env_file
from _lib.storage import LOCAL_DIR

TODAY = date.today()
D = lambda n: TODAY + timedelta(days=n)  # noqa: E731

EXTRA_HOMEOWNERS = [
    ("Aisha Rahman", "aisha.demo@example.com", "+65 9123 4567"),
    ("Kumar Raj", "kumar.demo@example.com", "+65 8765 4321"),
]

M1 = {
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
M2 = {"inverter_commission_grid_connection": True, "rcb_breaker_replacement": False, "pvl_received_date": -9}
M3 = {
    "pre_inspection_date": -6,
    "sp_appointment_letter_received_date": -5,
    "meter_replacement_date": -3,
    "sp_turn_on_inspection_date": -2,
    "fusion_solar_app_access": True,
}
FILES_PRE1 = ["utility_bill", "gst_proof", "sp_forms_signed"]
FILES_M1 = ["panel_pictures", "inverter_pictures", "sp_submission_screenshot"]
FILES_M2 = ["pvl_letter"]
FILES_M3 = [
    "sp_appointment_letter",
    "as_built_pv_layout",
    "final_submission_documents",
    "handover_docs",
    "fusion_solar_access",
    "completion_form_signed",
]
PHOTO = {"panel_pictures", "inverter_pictures", "sp_submission_screenshot"}


def png(rgb: tuple[int, int, int]) -> bytes:
    """A small solid-colour PNG, so a sample photo shows as a picture."""
    w = h = 64
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
    text = f"BT /F1 18 Tf 60 760 Td ({title} - sample document) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
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


def main() -> None:
    url = _from_env_file("MIGRATION_DATABASE_URL")
    prod = _from_env_file("PROD_MIGRATION_DATABASE_URL")
    host = lambda u: psycopg.conninfo.conninfo_to_dict(u)["host"]  # noqa: E731
    if not url:
        sys.exit("MIGRATION_DATABASE_URL is not set in .env.local")
    if prod and host(url) == host(prod):
        sys.exit("Refusing: MIGRATION_DATABASE_URL points at production.")

    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        one = lambda q, *a: c.execute(q, a).fetchone()  # noqa: E731
        uid = lambda email: (one("select uid from users where lower(email) = %s", email) or {}).get("uid")  # noqa: E731

        for name, email, mobile in EXTRA_HOMEOWNERS:
            if not uid(email):
                c.execute(
                    "insert into users (full_name, user_type, email, contact_no) values (%s, 'homeowner', %s, %s)",
                    (name, email, mobile),
                )
        people = {
            k: uid(e)
            for k, e in {
                "priya": "priya.demo@example.com",
                "ravi": "ravi.demo@example.com",
                "charlotte": "charlotte.demo@example.com",
                "jasmine": "jasmine.demo@example.com",
                "daniel": "daniel.demo@example.com",
                "farah": "farah.demo@example.com",
                "aisha": "aisha.demo@example.com",
                "kumar": "kumar.demo@example.com",
            }.items()
        }
        if not all(people.values()):
            sys.exit("Run scripts/seed_demo.py first — the demo people and groups are missing.")
        # Your own account owns the projects, so they show as yours; otherwise the demo PM.
        me = one(
            "select uid from users where user_type = 'project_manager' and active "
            "and email not like %s order by uid limit 1",
            "%.demo@example.com",
        )
        pm = me["uid"] if me else people["charlotte"]
        apex = one("select group_id from contractor_groups where name = 'Apex Solar Contractors'")["group_id"]
        kim = one("select group_id from contractor_groups where name = 'Kim Seng M&E Services'")["group_id"]
        sp = one("select retailer_id from electricity_retailers where name = 'SP Group'")["retailer_id"]
        for h in ("jasmine", "aisha", "kumar", "daniel"):
            c.execute(
                "update users set ic_last4 = %s where uid = %s and ic_last4 is null",
                (f"{400 + people[h] % 600:03d}F"[-4:], people[h]),
            )

        def act(who: int) -> None:
            c.execute("select set_config('app.actor_uid', %s, false)", (str(who),))

        def project(name: str, **cols) -> int | None:
            if one("select 1 from projects where name = %s", name):
                print(f"  = {name} (already there)")
                return None
            act(pm)
            cols = {"name": name, "project_manager_id": pm, "created_by": pm, **cols}
            keys = ", ".join(cols)
            vals = ", ".join(f"%({k})s" for k in cols)
            pid = c.execute(f"insert into projects ({keys}) values ({vals}) returning project_id", cols).fetchone()[
                "project_id"
            ]
            print(f"  + {name}")
            return pid

        def fill(pid: int, who: int, values: dict) -> None:
            act(who)
            vals = {k: (D(v) if k.endswith("_date") and isinstance(v, int) else v) for k, v in values.items()}
            sets = ", ".join(f"{k} = %({k})s" for k in vals)
            c.execute(f"update projects set {sets} where project_id = %(pid)s", {**vals, "pid": pid})

        def files(pid: int, who: int, cats: list[str]) -> None:
            act(who)
            for cat in cats:
                photo = cat in PHOTO
                ext, ctype = ("png", "image/png") if photo else ("pdf", "application/pdf")
                key = f"projects/{pid}/{cat}/{uuid.uuid4()}.{ext}"
                data = png((14, 127, 83)) if photo else pdf(cat.replace("_", " ").title())
                path = LOCAL_DIR / key
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                path.with_suffix(path.suffix + ".type").write_text(ctype)
                c.execute(
                    "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, "
                    "uploaded_by) values (%s, %s, %s, %s, %s, %s, %s)",
                    (pid, cat, key, f"{cat}.{ext}", ctype, len(data), who),
                )

        def milestones(pid: int, who: int, upto: int) -> None:
            act(who)
            for n in range(1, upto + 1):
                c.execute(
                    "insert into project_milestones (project_id, milestone_no, completed_by) "
                    "values (%s, %s, %s) on conflict do nothing",
                    (pid, n, who),
                )

        def status(pid: int, who: int, value: str) -> None:
            act(who)
            c.execute("update projects set status = %s where project_id = %s", (value, pid))

        common = {"homeowner_contact_no": "+65 9123 4477", "check_in_radius_m": 100}

        # 1. Draft: the homeowner is only a name, so nobody can approve yet.
        project(
            "Bedok Ria Terrace",
            address="3 Bedok Ria, Singapore 469000",
            postal_code="469000",
            site_lat=1.3236,
            site_lng=103.9273,
            homeowner_name="Marcus Teo",
            contractor_text="Northline Roofing Pte Ltd",
            installation_start_date=D(14),
            target_end_date=D(35),
            status="draft",
            **common,
        )

        # 2. Waiting for the homeowner to approve.
        project(
            "Hillcrest Villa",
            address="27 Hillcrest Road, Singapore 289000",
            postal_code="289000",
            site_lat=1.3294,
            site_lng=103.8021,
            homeowner_id=people["farah"],
            contractor_group_id=kim,
            installation_start_date=D(7),
            target_end_date=D(28),
            status="awaiting_homeowner",
            **common,
        )

        # 3. The homeowner approved; a PM approves next.
        pid = project(
            "Sunbird Circle",
            address="8 Sunbird Circle, Singapore 488106",
            postal_code="488106",
            site_lat=1.3521,
            site_lng=103.8198,
            homeowner_id=people["daniel"],
            contractor_group_id=apex,
            installation_start_date=D(3),
            target_end_date=D(24),
            status="awaiting_homeowner",
            **common,
        )
        if pid:
            status(pid, people["daniel"], "homeowner_approved")

        # 4. Under way: before-Milestone-1 done, pre-end of Milestone 1 half done; a visit tomorrow.
        pid = project(
            "Jalan Kayu Residence",
            address="14 Jalan Kayu, Singapore 799463",
            postal_code="799463",
            site_lat=1.3966,
            site_lng=103.8730,
            homeowner_id=people["jasmine"],
            contractor_group_id=apex,
            installation_start_date=D(-5),
            target_end_date=D(16),
            status="awaiting_homeowner",
            **common,
        )
        if pid:
            status(pid, people["jasmine"], "homeowner_approved")
            status(pid, pm, "pm_approved")
            fill(
                pid,
                people["priya"],
                {
                    "electricity_retailer_id": sp,
                    "sp_application_status": 1,
                    "sales": M1["sales"],
                    "waterproofing": True,
                    "create_group_chat": True,
                },
            )
            status(pid, people["priya"], "in_progress")
            files(pid, people["priya"], FILES_PRE1)
            fill(pid, people["ravi"], {"panel_quantity_estimate": 20, "panel_capacity": 610})
            act(pm)
            c.execute(
                "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note, created_by) "
                "values (%s, %s, '09:00', 'Scaffolding and panel mounting', %s)",
                (pid, D(1), pm),
            )

        # 5. Milestone 1 done, Milestone 2 under way — but past its end date, and the crew missed a visit.
        pid = project(
            "Seletar Hills Home",
            address="21 Seletar Hills Drive, Singapore 807021",
            postal_code="807021",
            site_lat=1.3770,
            site_lng=103.8750,
            homeowner_id=people["aisha"],
            contractor_group_id=apex,
            installation_start_date=D(-30),
            target_end_date=D(-9),
            status="awaiting_homeowner",
            **common,
        )
        if pid:
            status(pid, people["aisha"], "homeowner_approved")
            status(pid, pm, "pm_approved")
            fill(pid, people["priya"], {"electricity_retailer_id": sp, **M1})
            status(pid, people["priya"], "in_progress")
            files(pid, people["priya"], FILES_PRE1)
            fill(pid, people["ravi"], M1_DONE)
            files(pid, people["ravi"], FILES_M1)
            milestones(pid, people["ravi"], 1)
            fill(pid, people["ravi"], {"inverter_commission_grid_connection": False, "commission_date": D(4)})
            act(pm)
            c.execute(
                "insert into site_visits (project_id, scheduled_date, scheduled_time, works_note, created_by) "
                "values (%s, %s, '09:00', 'Inverter commissioning', %s)",
                (pid, D(-2), pm),
            )

        # 6. Everything done: ready for the handover certificate.
        pid = project(
            "Punggol Waterway Terrace",
            address="5 Punggol Walk, Singapore 828768",
            postal_code="828768",
            site_lat=1.4096,
            site_lng=103.9047,
            homeowner_id=people["kumar"],
            contractor_group_id=kim,
            installation_start_date=D(-28),
            target_end_date=D(7),
            status="awaiting_homeowner",
            **common,
        )
        if pid:
            status(pid, people["kumar"], "homeowner_approved")
            status(pid, pm, "pm_approved")
            fill(pid, people["priya"], {"electricity_retailer_id": sp, **M1})
            status(pid, people["priya"], "in_progress")
            files(pid, people["priya"], FILES_PRE1)
            fill(pid, people["priya"], M1_DONE)
            files(pid, people["priya"], FILES_M1)
            milestones(pid, people["priya"], 1)
            fill(pid, people["priya"], M2)
            files(pid, people["priya"], FILES_M2)
            milestones(pid, people["priya"], 2)
            fill(pid, people["priya"], M3)
            files(pid, people["priya"], FILES_M3)
            milestones(pid, people["priya"], 3)

        c.execute("select set_config('app.actor_uid', '', false)")
    print("Sample projects are in the development database.")


if __name__ == "__main__":
    main()
