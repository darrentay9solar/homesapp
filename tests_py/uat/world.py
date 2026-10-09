"""The UAT world: one person for every actor in uat/spec.py and one project at every state.

Built straight into the test database through its owner connection (fast,
and bypassing the rules on purpose: setting a scene, not testing it). The
tests then use the real API, as each person, against these projects.
Files are written to laptop storage so they open like real uploads.
"""

from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import psycopg

from _lib import certificate, storage
from conftest import bearer, owner_conn
from uat import spec

SITE = (1.3691, 103.8486)
NEAR = {"lat": SITE[0] + 0.0002, "lng": SITE[1], "accuracy": 12.0}  # about 22 m from the house
SIGNATURE = (Path(__file__).resolve().parents[1] / "fixtures" / "signature.jpg").read_bytes()
PDF = b"%PDF-1.4\n% uat sample\n" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64

VALUES: dict[str, dict[str, Any]] = {
    "pre1": {"sp_application_status": 1},
    "pre1b": {
        "sales": "K. Chandra",
        "waterproofing": False,
        "create_group_chat": True,
        "panel_quantity_estimate": 20,
        "panel_capacity": 610,
        "inverter_to_order": "Huawei SUN2000-10KTL-M1",
        "inverter_collected": True,
        "inverter_serial_number": "HW-UAT-0001",
        "current_stage": 2,
    },
    "m1": {
        "installation_end_date": date(2026, 10, 1),
        "scaffolding_removal": True,
        "scaffolding_removal_date": date(2026, 10, 2),
        "sp_submission_date": date(2026, 10, 3),
    },
    "m2": {
        "inverter_commission_grid_connection": True,
        "rcb_breaker_replacement": False,
        "pvl_received_date": date(2026, 10, 6),
    },
    "m3": {
        "pre_inspection_date": date(2026, 10, 8),
        "sp_appointment_letter_received_date": date(2026, 10, 9),
        "sp_turn_on_inspection_date": date(2026, 10, 10),
    },
    "post": {"fusion_solar_app_access": True},
}
FILES = {
    "pre1": ["utility_bill", "gst_proof", "sp_forms_signed"],
    "pre1b": ["panel_pictures", "inverter_pictures"],
    "m1": ["sp_submission_screenshot"],
    "m2": ["pvl_letter"],
    "m3": ["sp_appointment_letter"],
    "post": [
        "as_built_pv_layout",
        "final_submission_documents",
        "handover_docs",
        "fusion_solar_access",
        "completion_form_signed",
    ],
}
PHOTOS = {"panel_pictures", "inverter_pictures", "sp_submission_screenshot"}


@dataclass
class World:
    conn: psycopg.Connection
    tag: str
    people: dict[str, dict[str, Any]] = field(default_factory=dict)
    pid: dict[str, int] = field(default_factory=dict)
    group: int = 0
    other_group: int = 0
    retailer: int = 0
    made_pids: list[int] = field(default_factory=list)
    made_uids: list[int] = field(default_factory=list)

    def h(self, actor: str) -> dict[str, str]:
        return bearer(self.people[actor]["clerk_user_id"])

    def uid(self, actor: str) -> int:
        return int(self.people[actor]["uid"])

    def status(self, pid: int) -> str:
        return self.conn.execute("select status from projects where project_id = %s", (pid,)).fetchone()["status"]

    # ---------------------------------------------------------------- people

    def person(self, key: str, role: str, *, active: bool = True, name: str | None = None) -> dict[str, Any]:
        row = self.conn.execute(
            "insert into users (email, user_type, full_name, clerk_user_id, contact_no, active) "
            "values (%s, %s, %s, %s, %s, %s) returning *",
            (
                f"uat-{key}-{uuid.uuid4().hex[:8]}@example.com",
                role,
                name or f"UAT {key.replace('_', ' ').title()}",
                f"user_uat_{key}_{uuid.uuid4().hex[:10]}",
                "+65 9123 4567",
                active,
            ),
        ).fetchone()
        self.made_uids.append(row["uid"])
        return row

    # -------------------------------------------------------------- projects

    def project(self, state: str, *, name: str | None = None, manager: str = "pm") -> int:
        """A new project at ``state`` (see spec.STATES), with the world's team on it."""
        status, recorded = spec.STATUS[state], spec.RECORDED[state]
        c = self.conn
        draft = state == "draft"
        pid = c.execute(
            "insert into projects (name, address, postal_code, site_lat, site_lng, homeowner_id, homeowner_name, "
            "homeowner_contact_no, contractor_group_id, installation_start_date, target_end_date, status, "
            "project_manager_id, created_by, electricity_retailer_id) "
            "values (%s, %s, '569933', %s, %s, %s, %s, '+65 9123 4567', %s, %s, %s, 'draft', %s, %s, %s) "
            "returning project_id",
            (
                name or f"UAT {state} {self.tag}",
                "53 Ang Mo Kio Avenue 3",
                SITE[0],
                SITE[1],
                None if draft else self.uid("ho"),
                "Typed Homeowner" if draft else None,
                self.group,
                date.today() - timedelta(days=10),
                date.today() + timedelta(days=60),
                self.uid(manager),
                self.uid(manager),
                self.retailer if status in ("in_progress", *spec.AT_HANDOVER) else None,
            ),
        ).fetchone()["project_id"]
        self.made_pids.append(pid)
        c.execute(
            "insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s)",
            (pid, self.uid("assigned_epc"), self.uid(manager)),
        )
        sections = [s for s in spec.SECTIONS if spec.SECTION_MILESTONE[s] <= recorded]
        if state == "in_progress_m0":
            sections = []
            self._fill(pid, {"sp_application_status": 1})
            self._files(pid, ["utility_bill"])
        for s in sections:
            self._fill(pid, VALUES[s])
            self._files(pid, FILES[s])
        for n in range(1, recorded + 1):
            c.execute(
                "insert into project_milestones (project_id, milestone_no, completed_by) values (%s, %s, %s)",
                (pid, n, self.uid("crew_epc")),
            )
        c.execute("update projects set status = %s where project_id = %s", (status, pid))
        if status in ("signed", "closed"):
            self._sign(pid)
        return pid

    def _fill(self, pid: int, values: dict[str, Any]) -> None:
        sets = ", ".join(f"{k} = %({k})s" for k in values)
        self.conn.execute(f"update projects set {sets} where project_id = %(pid)s", {**values, "pid": pid})

    def _files(self, pid: int, cats: list[str]) -> None:
        for cat in cats:
            ctype, data = ("image/png", PNG) if cat in PHOTOS else ("application/pdf", PDF)
            key = storage.project_key(pid, cat, ctype)
            self._store(key, data, ctype)
            self.conn.execute(
                "insert into project_files (project_id, category, url, file_name, content_type, size_bytes, "
                "uploaded_by, kind) values (%s, %s, %s, %s, %s, %s, %s, %s)",
                (pid, cat, key, f"{cat}.{storage.ALLOWED_TYPES[ctype]}", ctype, len(data), self.uid("crew_epc"),
                 storage.kind_of(ctype)),
            )  # fmt: skip

    @staticmethod
    def _store(key: str, data: bytes, ctype: str) -> None:
        path = storage.LOCAL_DIR / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.with_suffix(path.suffix + ".type").write_text(ctype)

    def _sign(self, pid: int) -> None:
        p = self.conn.execute(
            "select p.*, h.full_name as h_name, r.name as retailer_name from projects p "
            "left join users h on h.uid = p.homeowner_id "
            "left join electricity_retailers r on r.retailer_id = p.electricity_retailer_id where p.project_id = %s",
            (pid,),
        ).fetchone()
        cert = certificate.build(p, contractor="UAT Contractors", manager="UAT PM")
        fp = certificate.fingerprint(cert)
        pdf_key, sig_key = storage.handover_keys(pid)
        row = self.conn.execute(
            "insert into project_signatures (project_id, signed_by, signature_url, certificate_hash, certificate_url, "
            "signer_name, certificate) values (%s, %s, %s, %s, %s, %s, %s) returning signed_at",
            (pid, self.uid("ho"), sig_key, fp, pdf_key, "UAT Ho", json.dumps(cert)),
        ).fetchone()
        doc = certificate.pdf(
            cert, signature=SIGNATURE, signer="UAT Ho", signed_at=row["signed_at"], fingerprint_hex=fp
        )
        self._store(sig_key, SIGNATURE, "image/jpeg")
        self._store(pdf_key, doc, "application/pdf")

    # ---------------------------------------------------------------- tidy up

    def close(self) -> None:
        c = self.conn
        pids, uids = self.made_pids, self.made_uids
        for pid in pids:
            shutil.rmtree(storage.LOCAL_DIR / "projects" / str(pid), ignore_errors=True)
        c.execute("delete from upload_intents where uid = any(%s)", (uids,))
        # The maintenance records the handed-over projects became, and any made for the tests.
        c.execute(
            "delete from maintenance_systems where project_id = any(%s) or run_by = any(%s) or import_ref like %s",
            (pids, uids, f"uat-{self.tag}%"),
        )
        c.execute("delete from projects where project_id = any(%s)", (pids,))
        c.execute("delete from contractor_group_members where group_id = any(%s)", ([self.group, self.other_group],))
        c.execute("delete from contractor_groups where group_id = any(%s)", ([self.group, self.other_group],))
        c.execute(
            "delete from users u where uid = any(%s) and not exists (select 1 from audit_log a where a.actor_uid = u.uid)",
            (uids,),
        )
        c.execute(
            "update users set active = false, clerk_user_id = null, full_name = 'uat fixture' where uid = any(%s)",
            (uids,),
        )
        c.close()


def build() -> World:
    w = World(owner_conn(), uuid.uuid4().hex[:6])
    c = w.conn
    w.retailer = c.execute("select retailer_id from electricity_retailers where name = 'SP Group'").fetchone()[
        "retailer_id"
    ]
    for actor in spec.ACTORS:
        w.people[actor] = w.person(actor, spec.ROLE[actor], active=actor != "inactive")
    c.execute("update users set ic_last4 = '567D' where uid = %s", (w.uid("ho"),))
    w.group = c.execute(
        "insert into contractor_groups (name) values (%s) returning group_id", (f"UAT crew {w.tag}",)
    ).fetchone()["group_id"]
    w.other_group = c.execute(
        "insert into contractor_groups (name) values (%s) returning group_id", (f"UAT other crew {w.tag}",)
    ).fetchone()["group_id"]
    for actor in ("crew_admin", "crew_epc", "inactive"):
        c.execute("insert into contractor_group_members (group_id, user_id) values (%s, %s)", (w.group, w.uid(actor)))
    for actor in ("out_admin", "out_epc"):
        c.execute(
            "insert into contractor_group_members (group_id, user_id) values (%s, %s)", (w.other_group, w.uid(actor))
        )
    for state in spec.STATE_KEYS:
        w.pid[state] = w.project(state)
    return w
