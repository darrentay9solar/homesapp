# ruff: noqa: E501  (one assertion per line reads best here)
"""What FusionSolar shows that the app added on 23 Oct 2026 (docs/solar.md, docs/tariffs.md):

compare    each energy chart beside the same period a year before, slot by slot, and the change
weather    NEA's next 24 hours for the plant's part of Singapore, and the 4-day outlook
reports    a month's summary on the 1st: each homeowner their plant, each manager their plants; once
acknowledge  a manager notes an alarm is in hand; the homeowner sees only that it is
tariffs    SP's tariff each quarter, what SP pays for solar sent to the grid, the history and averages
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from decimal import Decimal

import pytest

from _lib import solar_reports, tariff
from _lib import solar_sync as sync
from conftest import bearer

SG = sync.SG


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


@pytest.fixture
def plant(fx):
    tag = uuid.uuid4().hex[:6]
    pm, ho = fx.user("project_manager"), fx.user("homeowner")
    sid = fx.conn.execute(
        "insert into maintenance_systems (address, run_by, homeowner_id, rate_per_kwh, kwp) values (%s, %s, %s, 0.22, 10) returning system_id",
        (f"9 More Lane {tag}", pm["uid"], ho["uid"]),
    ).fetchone()["system_id"]
    code = f"NE=MORE{tag}"
    fx.conn.execute(
        "insert into solar_plants (station_code, name, system_id, latitude, longitude, capacity_kwp) values (%s, %s, %s, 1.34, 103.95, 10)",
        (code, f"More plant {tag}", sid),
    )
    yield {"code": code, "pm": pm, "ho": ho, "sid": sid}
    fx.conn.execute("delete from solar_plants where station_code = %s", (code,))
    fx.conn.execute("delete from maintenance_systems where system_id = %s", (sid,))


def _month(fx, code: str, y: int, m: int, kwh: float) -> None:
    fx.conn.execute(
        "insert into solar_readings (station_code, period, at, kwh) values (%s, 'month', %s, %s) on conflict do nothing",
        (code, datetime(y, m, 1, tzinfo=SG), kwh),
    )


# ------------------------------------------------------------------ compare


def test_a_year_beside_the_year_before(client, fx, plant) -> None:
    for m, kwh in ((1, 1000), (2, 1100), (3, 1200)):
        _month(fx, plant["code"], 2024, m, kwh)
    for m, kwh in ((1, 900), (2, 1000)):
        _month(fx, plant["code"], 2023, m, kwh)
    got = client.get(f"/api/py/solar/plants/{plant['code']}/energy?period=year&date=2024-05-01", headers=h(plant["pm"])).json()
    prev = got["previous"]
    assert prev["date"] == "2023-05-01" and prev["totalKwh"] == 1900
    assert prev["kwh"][:3] == [900, 1000, None]
    # Up on the months both years have: (1000 + 1100) on (900 + 1000).
    assert prev["change"] == round((2100 - 1900) / 1900 * 100, 1)


def test_lifetime_has_nothing_to_compare(client, plant) -> None:
    got = client.get(f"/api/py/solar/plants/{plant['code']}/energy?period=lifetime", headers=h(plant["pm"])).json()
    assert got["previous"] is None


def test_a_homeowner_compares_their_own(client, fx, plant) -> None:
    _month(fx, plant["code"], 2024, 1, 500)
    got = client.get("/api/py/me/solar/energy?period=year&date=2025-01-15", headers=h(plant["ho"])).json()
    assert got["previous"]["kwh"][0] == 500 and got["previous"]["change"] is None


@pytest.mark.parametrize(("day", "want"), [(date(2024, 2, 29), date(2023, 2, 28)), (date(2025, 3, 31), date(2024, 3, 31))])
def test_the_same_day_a_year_before(day, want) -> None:
    from _routes.solar import _year_before

    assert _year_before(day) == want


# ------------------------------------------------------------------ weather


def test_the_weather_ahead_for_the_plants_part_of_singapore(client, fx, plant) -> None:
    from _lib import weather

    weather.save(datetime.now(SG))
    w = client.get(f"/api/py/solar/plants/{plant['code']}", headers=h(plant["pm"])).json()["weather"]
    assert w["region"] == "east" and w["next"] == [{"start": "2099-01-01T06:00:00+08:00", "end": "2099-01-01T12:00:00+08:00", "forecast": "Fair"}]
    assert w["outlook"][0]["text"] == "Thundery Showers" and w["today"] == {"low": 25, "high": 33}


@pytest.mark.parametrize(("lat", "lng", "part"), [(1.3521, 103.8198, "central"), (1.44, 103.80, "north"), (1.35, 103.95, "east"), (1.34, 103.70, "west"), (1.27, 103.83, "south")])
def test_a_place_is_in_its_part_of_singapore(lat, lng, part) -> None:
    from _lib import weather

    assert weather.region(lat, lng) == part


# ---------------------------------------------------------------- acknowledge


@pytest.fixture
def alarm(fx, plant):
    return fx.conn.execute(
        "insert into solar_alarms (station_code, device, name, level, raised_at, notified_at) values (%s, 'INV-1', 'Grid loss', 'major', now(), now()) returning alarm_id",
        (plant["code"],),
    ).fetchone()["alarm_id"]


def test_a_manager_acknowledges_an_alarm(client, fx, plant, alarm) -> None:
    r = client.post(f"/api/py/solar/plants/{plant['code']}/alarms/{alarm}/acknowledge", headers=h(plant["pm"]), json={"note": "Crew going Friday"})
    assert r.status_code == 200, r.text
    staff = client.get(f"/api/py/solar/plants/{plant['code']}", headers=h(plant["pm"])).json()["alarms"][0]["acknowledged"]
    assert staff["note"] == "Crew going Friday" and staff["by"] and staff["at"]
    mine = client.get("/api/py/me/solar", headers=h(plant["ho"])).json()["plant"]["alarms"][0]["acknowledged"]
    assert mine["at"] and mine["by"] is None and mine["note"] is None, "the homeowner sees only that it's in hand"
    a = fx.conn.execute(
        "select actor_uid from audit_log where entity_table = 'solar_alarms' and entity_id = %s", (str(alarm),)
    ).fetchall()
    assert [x["actor_uid"] for x in a] == [plant["pm"]["uid"]]


@pytest.mark.parametrize("who", ["finance", "homeowner", "contractor"])
def test_only_a_manager_acknowledges(client, fx, plant, alarm, who) -> None:
    u = plant["ho"] if who == "homeowner" else fx.user(who)
    r = client.post(f"/api/py/solar/plants/{plant['code']}/alarms/{alarm}/acknowledge", headers=h(u), json={})
    assert r.status_code == 403


def test_another_managers_plant_isnt_theirs_to_acknowledge(client, fx, plant, alarm) -> None:
    other = fx.user("project_manager")
    assert client.post(f"/api/py/solar/plants/{plant['code']}/alarms/{alarm}/acknowledge", headers=h(other), json={}).status_code == 404


# ------------------------------------------------------------------- reports


def test_a_months_report_goes_once_to_the_homeowner_and_the_manager(fx, plant) -> None:
    key = "report:2099-01"
    fx.conn.execute("delete from solar_sync where key = %s", (key,))
    _month(fx, plant["code"], 2099, 1, 1234)
    _month(fx, plant["code"], 2098, 1, 1000)
    try:
        assert solar_reports.run(datetime(2099, 2, 1, 9, tzinfo=SG))["sent"] >= 2
        got = fx.conn.execute(
            "select recipient_uid, title, body, link from notifications where kind = 'solar_report' and recipient_uid = any(%s)",
            ([plant["ho"]["uid"], plant["pm"]["uid"]],),
        ).fetchall()
        by = {g["recipient_uid"]: g for g in got}
        assert by[plant["ho"]["uid"]]["title"] == "Your solar in January 2099" and "1,234 kWh" in by[plant["ho"]["uid"]]["body"]
        assert "23% more than January 2098" in by[plant["ho"]["uid"]]["body"]
        assert by[plant["pm"]["uid"]]["title"] == "Solar in January 2099" and by[plant["pm"]["uid"]]["link"] == "/solar?tab=report"
        assert solar_reports.run(datetime(2099, 2, 2, 9, tzinfo=SG)) == {"skipped": "already sent"}
    finally:
        fx.conn.execute("delete from solar_sync where key = %s", (key,))
        fx.conn.execute("delete from solar_readings where station_code = %s", (plant["code"],))


# ------------------------------------------------------------------- tariffs

PAGE = """<div><p>31.16 cents/kWh</p><p>28.59 cents/kWh (w/o GST)</p><h3>ELECTRICITY TARIFF</h3><p>(wef 1 Oct - 31 Dec 26)</p>
<p>23.38 cents/kWh</p><p>21.45 cents/kWh (w/o GST)</p><h3>GAS TARIFF</h3></div>
<h4>Q4 2026 Electricity Tariff (before GST)</h4><ul><li>Market Admin &amp; PSO Fee<br/> 0.08c/kWh</li><li>MSS Fee<br/>0.23c/kWh</li>
<li>Network Costs<br/>6.10c/kWh</li><li>Energy Costs<br/> 22.18c/kWh</li></ul>"""


def test_sps_page_is_read_and_checked() -> None:
    got = tariff.read_sp(PAGE)
    assert (got["starts_on"], got["ends_on"]) == (date(2026, 10, 1), date(2026, 12, 31))
    assert (got["cents_with_gst"], got["cents_without_gst"], got["network_cents"]) == (Decimal("31.16"), Decimal("28.59"), Decimal("6.10"))


def test_parts_that_dont_add_up_are_left_out() -> None:
    got = tariff.read_sp(PAGE.replace("6.10c", "7.10c"))
    assert "network_cents" not in got and got["cents_without_gst"] == Decimal("28.59")


def test_a_changed_page_says_so() -> None:
    with pytest.raises(ValueError, match="no longer shows"):
        tariff.read_sp("<p>Our tariffs have moved</p>")


def test_data_gov_sgs_months() -> None:
    body = json.dumps({"result": {"records": [{"DataSeries": "Low Tension Supplies - Domestic", "2026Jun": "27.27", "2026May": "27.27", "2012Jan": "27.59"}, {"DataSeries": "Other", "2026Jun": "1"}]}})
    got = tariff.read_history(body)
    assert [(r["starts_on"], r["cents_without_gst"]) for r in got] == [(date(2012, 1, 1), Decimal("27.59")), (date(2026, 5, 1), Decimal("27.27")), (date(2026, 6, 1), Decimal("27.27"))]


@pytest.fixture
def quarters(fx):
    """Two quarters in 2098-99 (so nothing real gets in the way), and months before them."""
    fx.conn.execute("delete from sp_tariffs where starts_on >= '2098-01-01'")
    for m in range(1, 7):
        fx.conn.execute("insert into sp_tariffs (starts_on, ends_on, cents_without_gst, source) values (%s, %s, 25, 'data_gov_sg')", (date(2098, m, 1), date(2098, m, 28)))
    fx.conn.execute(
        "insert into sp_tariffs (starts_on, ends_on, cents_without_gst, cents_with_gst, energy_cents, network_cents, mss_cents, market_admin_cents, source) values "
        "('2098-07-01', '2098-09-30', 30, 32.70, 23.69, 6, 0.23, 0.08, 'sp_group'), ('2098-10-01', '2098-12-31', 28, 30.52, 21.69, 6, 0.23, 0.08, 'sp_group')"
    )
    yield
    fx.conn.execute("delete from sp_tariffs where starts_on >= '2098-01-01'")


def test_the_quarter_selling_buying_and_the_12_month_average(quarters) -> None:
    o = tariff.overview(date(2098, 11, 15))
    c = o["current"]
    assert (c["startsOn"], c["buying"], c["withoutGst"], c["selling"], c["parts"]["network"]) == ("2098-10-01", 30.52, 28.0, 22.0, 6.0)
    last = o["history"][-1]
    assert last == {"month": "2098-11", "withoutGst": 28.0, "withGst": 30.52, "selling": 22.0, "source": "sp_group"}
    a = o["average12"]
    # Jan-Jun 25 (data.gov.sg; 9% GST), Jul-Sep 30, Oct-Nov 28: 11 months known in the last 12.
    assert a["months"] == 12 or a["months"] == 11
    assert a["withoutGst"] == round((25 * 6 + 30 * 3 + 28 * 2) / 11, 2) and a["sellingMonths"] == 5


@pytest.mark.parametrize("who", ["superadmin", "project_manager", "finance", "contractor", "epc_team", "homeowner"])
def test_everyone_signed_in_sees_the_tariffs(client, fx, who) -> None:
    u = fx.user(who)
    r = client.get("/api/py/tariffs", headers=h(u))
    assert r.status_code == 200 and "current" in r.json() and "history" in r.json()
    assert r.json()["mine"] is None


def test_a_homeowner_sees_what_their_solar_saves(client, fx, plant) -> None:
    month = datetime.now(SG).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    fx.conn.execute("insert into solar_readings (station_code, period, at, kwh) values (%s, 'month', %s, 800)", (plant["code"], month))
    got = client.get("/api/py/tariffs", headers=h(plant["ho"])).json()
    mine = got["mine"]
    assert mine["rateCents"] == 22.0 and mine["monthKwh"] == 800
    if got["current"]:
        assert mine["cheaperCents"] == round(got["current"]["buying"] - 22.0, 2)
        assert mine["savedSgd"] == round(800 * (got["current"]["buying"] - 22.0) / 100, 2)
