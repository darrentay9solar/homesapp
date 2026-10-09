"""Steps the flow tests share: a project created and worked through the real API, as each person would."""

from __future__ import annotations

import base64
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient

from _lib import storage
from uat import world as world_mod

PDF = b"%PDF-1.4\n% uat flow\n" + b"1" * 80
JPEG = b"\xff\xd8\xff\xe0" + b"2" * 80
DAY = date.today()

M1_FIELDS: dict[str, Any] = {
    "electricity_retailer_id": "SP Group",
    "homeowner.ic_last4": "567D",
    "sp_application_status": 1,
    "sales": "K. Chandra",
    "waterproofing": False,
    "create_group_chat": True,
    "panel_quantity_estimate": 20,
    "panel_capacity": 610,
    "inverter_to_order": "Huawei SUN2000-10KTL-M1",
    "inverter_collected": True,
    "inverter_serial_number": "HW-FLOW-0001",
    "current_stage": 2,
    "installation_end_date": (DAY + timedelta(days=9)).isoformat(),
    "scaffolding_removal": True,
    "scaffolding_removal_date": (DAY + timedelta(days=10)).isoformat(),
    "sp_submission_date": (DAY + timedelta(days=11)).isoformat(),
}
M1_FILES = ["utility_bill", "gst_proof", "sp_forms_signed", "panel_pictures", "inverter_pictures"]
M1_LAST = "sp_submission_screenshot"
M2_FIELDS: dict[str, Any] = {
    "inverter_commission_grid_connection": True,
    "rcb_breaker_replacement": False,
    "pvl_received_date": (DAY + timedelta(days=16)).isoformat(),
}
M2_LAST = "pvl_letter"
M3_FIELDS: dict[str, Any] = {
    "pre_inspection_date": (DAY + timedelta(days=18)).isoformat(),
    "sp_appointment_letter_received_date": (DAY + timedelta(days=19)).isoformat(),
    "sp_turn_on_inspection_date": (DAY + timedelta(days=20)).isoformat(),
    "fusion_solar_app_access": True,
}
M3_FILES = ["sp_appointment_letter", "as_built_pv_layout", "final_submission_documents", "handover_docs",
            "fusion_solar_access"]  # fmt: skip
M3_LAST = "completion_form_signed"
PHOTO_SLOTS = {"panel_pictures", "inverter_pictures", "sp_submission_screenshot", "fusion_solar_access"}


class Flow:
    def __init__(self, api: TestClient, world: world_mod.World) -> None:
        self.api, self.w = api, world
        self.pid = 0

    # ------------------------------------------------------------- calls

    def post(self, actor: str, path: str, json: Any = None) -> Any:
        return self.api.post(f"/api/py/projects/{self.pid}{path}", headers=self.w.h(actor), json=json)

    def get(self, actor: str, path: str = "") -> Any:
        return self.api.get(f"/api/py/projects/{self.pid}{path}", headers=self.w.h(actor), follow_redirects=False)

    def status(self) -> str:
        return self.w.status(self.pid)

    def told(self, kind: str) -> set[int]:
        rows = self.w.conn.execute(
            "select recipient_uid from notifications where project_id = %s and kind = %s", (self.pid, kind)
        ).fetchall()
        return {r["recipient_uid"] for r in rows}

    # ------------------------------------------------------------- steps

    def create(
        self, by: str = "pm", *, homeowner: str | None = "ho", manager: str | None = None, name: str = ""
    ) -> Any:
        body: dict[str, Any] = {
            "name": name or f"UAT flow {self.w.tag}",
            "postalCode": "569933",
            "address": "53 Ang Mo Kio Avenue 3",
            "contactNo": "+65 9123 4567",
            "contractor": {"type": "group", "groupId": self.w.group},
            "startDate": (DAY + timedelta(days=2)).isoformat(),
        }
        if homeowner:
            body["homeownerId"] = self.w.uid(homeowner)
        else:
            body["homeownerName"] = "Typed Homeowner"
        if manager:
            body["projectManagerId"] = self.w.uid(manager)
        r = self.api.post("/api/py/projects", headers=self.w.h(by), json=body)
        if r.status_code == 200:
            self.pid = r.json()["id"]
            self.w.made_pids.append(self.pid)
            # The same team as the world's projects: the group, plus one EPC assigned by name.
            self.w.conn.execute(
                "insert into project_assignments (project_id, user_id) values (%s, %s)",
                (self.pid, self.w.uid("assigned_epc")),
            )
        return r

    def approve_both(self, pm: str = "pm") -> None:
        assert self.post("ho", "/approve").status_code == 200
        assert self.post(pm, "/approve").status_code == 200

    def save(self, actor: str, key: str, value: Any) -> Any:
        return self.api.patch(
            f"/api/py/projects/{self.pid}/fields", headers=self.w.h(actor), json={"key": key, "value": value}
        )

    def save_all(self, actor: str, values: dict[str, Any]) -> None:
        for k, v in values.items():
            r = self.save(actor, k, v)
            assert r.status_code == 200, (k, r.text)

    def upload(self, actor: str, slot: str) -> Any:
        data, ctype = (JPEG, "image/jpeg") if slot in PHOTO_SLOTS else (PDF, "application/pdf")
        link = self.api.post(
            f"/api/py/projects/{self.pid}/files/upload-link",
            headers=self.w.h(actor),
            json={"category": slot, "fileName": f"{slot}.{storage.ALLOWED_TYPES[ctype]}", "contentType": ctype,
                  "size": len(data)},
        )  # fmt: skip
        if link.status_code != 200:
            return link
        put = self.api.put(link.json()["uploadUrl"], content=data, headers=link.json()["headers"])
        assert put.status_code == 200, put.text
        return self.api.post(
            f"/api/py/projects/{self.pid}/files",
            headers=self.w.h(actor),
            json={"category": slot, "key": link.json()["key"], "fileName": f"{slot}.bin"},
        )

    def milestone_1(self, actor: str = "crew_epc") -> Any:
        self.save_all(actor, M1_FIELDS)
        for slot in M1_FILES:
            assert self.upload(actor, slot).status_code == 200, slot
        return self.upload(actor, M1_LAST)

    def milestone_2(self, actor: str = "crew_admin") -> Any:
        self.save_all(actor, M2_FIELDS)
        return self.upload(actor, M2_LAST)

    def milestone_3(self, actor: str = "crew_epc") -> Any:
        self.save_all(actor, M3_FIELDS)
        for slot in M3_FILES:
            assert self.upload(actor, slot).status_code == 200, slot
        return self.upload(actor, M3_LAST)

    def to_signature(self) -> None:
        assert self.create().status_code == 200
        self.approve_both()
        assert self.milestone_1().status_code == 200
        assert self.milestone_2().status_code == 200
        r = self.milestone_3()
        assert r.status_code == 200 and "Milestone 3 complete" in r.json()["message"], r.text

    def handover(self, actor: str = "ho") -> dict[str, Any]:
        r = self.get(actor, "/handover")
        assert r.status_code == 200, r.text
        return r.json()

    def sign(self, actor: str = "ho", *, fingerprint: str | None = None, **over: Any) -> Any:
        body = {
            "fingerprint": self.handover(actor)["fingerprint"] if fingerprint is None else fingerprint,
            "signerName": "UAT Homeowner",
            "signature": "data:image/jpeg;base64," + base64.b64encode(world_mod.SIGNATURE).decode(),
            "agree": True,
            **over,
        }
        return self.post(actor, "/handover/sign", body)
