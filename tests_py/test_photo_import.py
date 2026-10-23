# ruff: noqa: E501  (one assertion per line reads best here)
"""Projects → Import photos (api/_lib/photo_import.py): each installed-photos folder to its project."""

from __future__ import annotations

import uuid

import pytest

from _lib import photo_import as pi
from conftest import bearer


@pytest.mark.parametrize(
    ("name", "want"),
    [
        ("9SH0001-23 Lorong Biawak", ("9SH0001", "23 Lorong Biawak")),
        ("9SH0016-110 Tagore Avenue - Completed", ("9SH0016", "110 Tagore Avenue")),
        ("9SH0035- 51 Nim Green", ("9SH0035", "51 Nim Green")),
        ("9sh0039 - 60 Jalan Ikan Merah", ("9SH0039", "60 Jalan Ikan Merah")),
        ("Installed Pictures", None),
        ("SH0001-23 Lorong Biawak", None),
    ],
)
def test_a_folder_name_gives_its_code_and_address(name, want) -> None:
    assert pi.parse_folder(name) == want


@pytest.mark.parametrize(
    ("folder", "address", "same"),
    [
        ("41 Lor 101 Changi", "41 Lorong 101 Changi, Singapore 417000", True),
        ("2G Swiss Club Rd", "2G Swiss Club Road", True),
        ("4 Jalan Llmu", "4 Jalan Ilmu", True),
        ("46 Pasir Ris Height", "46 Pasir Ris Heights", True),
        ("15 Jalan Chengkek", "115 Jalan Chengkek", False),
        ("15 Jalan Chengkek", "15 Jalan Chempaka", False),
        ("29 Jalan Raya", "29", False),
    ],
)
def test_the_address_must_agree(folder, address, same) -> None:
    assert pi.same_place(folder, address) is same


@pytest.mark.parametrize(
    ("path", "cat"),
    [
        ("2.0 Inverter Photo_58 Li Hwan Drive.jpeg", "inverter_pictures"),
        ("inverter/1.png", "inverter_pictures"),
        ("1 Solar Panel.jpeg", "panel_pictures"),
        ("WhatsApp Image 2026-01-19.jpeg", "panel_pictures"),
    ],
)
def test_inverter_photos_say_so(path, cat) -> None:
    assert pi.category(path) == cat


@pytest.fixture
def coded(fx):
    """A project with a project code, and a file already on it."""
    code = f"9SH{uuid.uuid4().int % 10**6:06d}"
    pid = fx.conn.execute(
        "insert into projects (name, address, postal_code, homeowner_name, homeowner_contact_no, installation_start_date, "
        "target_end_date, project_code, status) values ('23 Lorong Biawak', '23 Lorong Biawak', '419000', 'Mr Ong', "
        "'+65 9000 0000', current_date, current_date, %s, 'in_progress') returning project_id",
        (code,),
    ).fetchone()["project_id"]
    fx.conn.execute(
        "insert into project_files (project_id, category, url, file_name, content_type, size_bytes) "
        "values (%s, 'panel_pictures', 'local:x', '1.jpeg', 'image/jpeg', 100)",
        (pid,),
    )
    yield code, pid
    fx.conn.execute("delete from projects where project_id = %s", (pid,))


def _photo(path: str, size: int = 200, type: str = "image/jpeg") -> dict:
    return {"path": path, "name": path.split("/")[-1], "size": size, "type": type}


def test_the_check_plans_each_photo(client, fx, coded) -> None:
    code, pid = coded
    boss = fx.user("superadmin")
    body = {"folders": [
        {"folder": f"{code}-23 Lor Biawak - Completed", "files": [
            _photo("1.jpeg", 100), _photo("2.jpeg"), _photo("sub/2.jpeg"), _photo("3 Inverter.png", type="image/png"), _photo("clip.mp4", type="video/mp4"),
        ]},
        {"folder": f"{code}-23 Lorong Biawak copy", "files": [_photo("1.jpeg")]},
        {"folder": "9SH9999999-1 Nowhere Road", "files": [_photo("1.jpeg")]},
        {"folder": "Misc", "files": [_photo("1.jpeg")]},
    ]}  # fmt: skip
    r = client.post("/api/py/import/photos/check", headers=bearer(boss["clerk_user_id"]), json=body)
    assert r.status_code == 200, r.text
    got = r.json()
    first = got["folders"][0]
    assert first["project"]["id"] == pid and first["problem"] is None
    assert [(f["category"], f["skip"]) for f in first["files"]] == [
        ("panel_pictures", "Already uploaded"), ("panel_pictures", None), ("panel_pictures", "The same photo twice in the folder"),
        ("inverter_pictures", None), ("panel_pictures", "Not a photo"),
    ]  # fmt: skip
    assert (
        got["folders"][1]["problem"] == "Another folder has the same project code."
        and got["folders"][1]["project"] is None
    )
    assert got["folders"][2]["problem"] == "No project or maintenance system has this project code."
    assert got["folders"][3]["problem"].startswith("The folder's name doesn't start with a project code")
    assert (got["matched"], got["photos"], got["panels"], got["inverters"]) == (1, 2, 1, 1)


def test_another_address_stops_the_folder(client, fx, coded) -> None:
    code, _ = coded
    boss = fx.user("superadmin")
    r = client.post(
        "/api/py/import/photos/check",
        headers=bearer(boss["clerk_user_id"]),
        json={"folders": [{"folder": f"{code}-25 Lorong Biawak", "files": [_photo("1.jpeg")]}]},
    )
    assert r.json()["folders"][0]["problem"] == "The project with this code is at another address."


@pytest.mark.parametrize("role", ["project_manager", "finance", "contractor", "homeowner"])
def test_only_a_superadmin_imports_photos(client, fx, role) -> None:
    u = fx.user(role)
    r = client.post("/api/py/import/photos/check", headers=bearer(u["clerk_user_id"]), json={"folders": []})
    assert r.status_code == 403
