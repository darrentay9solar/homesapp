# ruff: noqa: E501, RUF001  (one rule per line reads best here; addresses use en dashes)
"""UAT · addresses, as people read them (api/_lib/address.py): "124 Westwood Crescent, Singapore 648815", once.

FusionSolar  its plant address runs the country and region into the street and repeats the postal code
             or the street: every shape seen in production comes out as one clean line
linked       a plant linked to a system shows the system's own address, to everyone who sees the plant
typed        a street typed or imported with "Singapore" or its postal code keeps only the street (the
             postal code is its own field, so no screen shows it twice): projects, systems, the client list
screens      no address any screen sends starts with "Singapore" or carries a postal code twice
"""

from __future__ import annotations

import re
import uuid
from datetime import date, timedelta

import pytest

from _lib import address
from uat import spec

pytestmark = pytest.mark.uat

# Every shape of FusionSolar address in production (23 Oct 2026), with made-up streets.
FUSIONSOLAR = [
    ("SingaporeSingapore124 WESTWOOD CRESCENT, Singapore 648815648815", "124 WESTWOOD CRESCENT, Singapore 648815"),
    ("SingaporeSingapore12 Sample Road, Singapore 79946312 Sample Road", "12 Sample Road, Singapore 799463"),
    ("SingaporeSingapore3 Trial Lane, Singapore 809001", "3 Trial Lane, Singapore 809001"),
    ("SingaporeSingapore14A Example Walk, Singapore 45600014A Example Walk", "14A Example Walk, Singapore 456000"),
    ("SingaporeSingapore350B Demo Road, Singapore 437000", "350B Demo Road, Singapore 437000"),
    (
        "SingaporeSingapore7 Lorong Contoh Satu Dua Tiga Singapore 558001558001",
        "7 Lorong Contoh Satu Dua Tiga, Singapore 558001",
    ),
    ("Singapore41 Preview Walk, Singapore 486001", "41 Preview Walk, Singapore 486001"),
    ("SingaporeSingaporeBedokJalan Contoh9–9 Jalan Contoh", "9–9 Jalan Contoh"),
    ("SingaporeSingaporeSingaporeJalan Ujian9 Jalan Ujian, Sample Hills Estate", "9 Jalan Ujian, Sample Hills Estate"),
    ("SingaporeSingapore5 Showcase Road", "5 Showcase Road"),
    ("21 Kew Sample, Singapore 466001", "21 Kew Sample, Singapore 466001"),
    ("Blk 123 Sample North Ave 1 #05-12, Singapore 460123", "Blk 123 Sample North Ave 1 #05-12, Singapore 460123"),
    ("12 Sample Road12 Sample Road", "12 Sample Road"),
    ("", ""),
    (None, ""),
]


@pytest.mark.parametrize(("raw", "want"), FUSIONSOLAR)
def test_a_fusionsolar_address_reads_as_one_clean_line(raw, want) -> None:
    assert address.tidy(raw) == want


TYPED = [
    ("124 Westwood Crescent", "124 Westwood Crescent"),
    ("124 Westwood Crescent, Singapore 648815", "124 Westwood Crescent"),
    ("Singapore 124 Westwood Crescent, Singapore 648815", "124 Westwood Crescent"),
    ("124 Westwood Cres 648815", "124 Westwood Cres"),
    ("12 Jalan Kayu S(799463)", "12 Jalan Kayu"),
    ("12 Jalan Kayu (S) 799463", "12 Jalan Kayu"),
    ("23 Lorong Biawak, Singapore", "23 Lorong Biawak"),
    ("Blk 123 Bedok North Ave 1 #05-12, Singapore 460123", "Blk 123 Bedok North Ave 1 #05-12"),
    ("41 Lor 101 Changi", "41 Lor 101 Changi"),
    ("  9   Trial   Lane ,  ", "9 Trial Lane"),
]


@pytest.mark.parametrize(("raw", "want"), TYPED)
def test_a_typed_street_keeps_only_the_street(raw, want) -> None:
    assert address.street(raw) == want


@pytest.mark.parametrize(
    ("street", "postal", "want"),
    [
        ("124 Westwood Crescent", "648815", "124 Westwood Crescent, Singapore 648815"),
        ("124 Westwood Crescent", None, "124 Westwood Crescent"),
        (None, "648815", "Singapore 648815"),
        (None, None, ""),
    ],
)
def test_one_line(street, postal, want) -> None:
    assert address.one_line(street, postal) == want


def clean(a: str | None) -> bool:
    """Read once: no country in front, the postal code at most once (and only after "Singapore")."""
    a = a or ""
    postals = re.findall(r"\d{6}", a)
    return (
        not a.lower().startswith("singapore")
        and a.lower().count("singapore") <= 1
        and len(postals) <= 1
        and not re.search(r"\d{7,}", a)
        and (not postals or a.endswith(f"Singapore {postals[0]}"))
    )


# ------------------------------------------------------------------ Solar, by person


@pytest.fixture(scope="module")
def plants(world):
    """A plant on pm's system (ho2 its homeowner) and one not linked, both with FusionSolar's untidy addresses."""
    c = world.conn
    tag = uuid.uuid4().hex[:6]
    sid = c.execute(
        "insert into maintenance_systems (address, postal_code, run_by, homeowner_id, kwp) values (%s, '648815', %s, %s, 10) returning system_id",
        (f"124 UAT Westwood Crescent {tag}", world.uid("pm"), world.uid("ho2")),
    ).fetchone()["system_id"]
    codes = {"linked": f"NE=ADDR{tag}L", "loose": f"NE=ADDR{tag}X"}
    c.execute(
        "insert into solar_plants (station_code, name, address, system_id) values (%s, %s, %s, %s), (%s, %s, %s, null)",
        (
            codes["linked"], f"UAT address linked {tag}", f"SingaporeSingapore124 UAT WESTWOOD CRESCENT {tag}, Singapore 648815648815", sid,
            codes["loose"], f"UAT address loose {tag}", f"SingaporeSingapore9 UAT Trial Lane {tag}, Singapore 8090019 UAT Trial Lane {tag}",
        ),
    )  # fmt: skip
    yield {
        "codes": codes,
        "tag": tag,
        "system": f"124 UAT Westwood Crescent {tag}, Singapore 648815",
        "loose": f"9 UAT Trial Lane {tag}, Singapore 809001",
    }
    c.execute("delete from solar_plants where station_code = any(%s)", (list(codes.values()),))
    c.execute("delete from maintenance_systems where system_id = %s", (sid,))


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_every_plant_address_on_solar_reads_once(api, world, plants, actor) -> None:
    r = api.get("/api/py/solar", headers=world.h(actor))
    assert r.status_code == spec.solar_staff(actor)
    if r.status_code != 200:
        return
    rows = r.json()["plants"]
    assert all(clean(p["address"]) for p in rows), [p["address"] for p in rows if not clean(p["address"])][:3]
    mine = {p["code"]: p["address"] for p in rows if p["code"] in plants["codes"].values()}
    if plants["codes"]["linked"] in mine:
        assert mine[plants["codes"]["linked"]] == plants["system"], "the system's own address"
    assert mine.get(plants["codes"]["loose"]) == plants["loose"]


@pytest.mark.parametrize("actor", spec.ACTORS)
@pytest.mark.parametrize("which", ["linked", "loose"])
def test_a_plants_page_shows_its_address_once(api, world, plants, actor, which) -> None:
    r = api.get(f"/api/py/solar/plants/{plants['codes'][which]}", headers=world.h(actor))
    if r.status_code == 200:
        assert r.json()["address"] == plants["system" if which == "linked" else "loose"]


def test_the_homeowner_sees_their_systems_address(api, world, plants) -> None:
    got = api.get("/api/py/me/solar", headers=world.h("ho2")).json()["plant"]
    assert got and got["address"] == plants["system"]


# --------------------------------------------------------------- typed in


def test_a_new_project_keeps_only_the_street(api, world) -> None:
    body = {
        "name": "UAT Address House", "postalCode": "238801", "address": "Singapore 1 UAT Address Road, Singapore 238801",
        "homeownerId": None, "homeownerName": "Mr Typed", "contactNo": "+65 9123 4567",
        "contractor": {"type": "group", "groupId": world.group}, "startDate": (date.today() + timedelta(days=3)).isoformat(),
    }  # fmt: skip
    r = api.post("/api/py/projects", headers=world.h("pm"), json=body)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    try:
        row = world.conn.execute("select address, postal_code from projects where project_id = %s", (pid,)).fetchone()
        assert (row["address"], row["postal_code"]) == ("1 UAT Address Road", "238801")
    finally:
        world.conn.execute("delete from projects where project_id = %s", (pid,))


def test_a_systems_address_keeps_only_the_street(api, world) -> None:
    sid = world.conn.execute(
        "insert into maintenance_systems (address, postal_code, run_by) values ('2 UAT Address Road', '238802', %s) returning system_id",
        (world.uid("pm"),),
    ).fetchone()["system_id"]
    try:
        r = api.patch(
            f"/api/py/maintenance/{sid}",
            headers=world.h("pm"),
            json={"address": "2 UAT Address Road, Singapore 238802"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["system"]["address"] == "2 UAT Address Road" and r.json()["system"]["postalCode"] == "238802"
    finally:
        world.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def test_the_client_list_keeps_only_the_street() -> None:
    from _lib import client_list

    assert client_list.street("12 Jalan Kayu, Singapore 799463") == "12 Jalan Kayu"


# ------------------------------------------------------------- every screen


@pytest.mark.parametrize("actor", spec.ACTORS)
def test_no_project_or_system_address_carries_its_postal_code(api, world, actor) -> None:
    seen = []
    p = api.get("/api/py/projects?handed=true", headers=world.h(actor))
    if p.status_code == 200:
        seen += [x["address"] for x in p.json()["projects"]]
    m = api.get("/api/py/maintenance", headers=world.h(actor))
    if m.status_code == 200:
        seen += [x["address"] for x in m.json()["systems"]]
    odd = [a for a in seen if a and (re.search(r"\b\d{6}\b", a) or a.lower().startswith("singapore"))]
    assert odd == []
