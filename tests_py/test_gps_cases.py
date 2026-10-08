"""GPS location: check-in, check-out and finding a site, in several hundred cases.

The rules live in the database (migrations 0007, 0013, 0020), so most cases
write check-ins exactly as the app will: on the application's own
connection, as the crew member, inside a transaction that is then rolled
back — nothing is left behind. OneMap (finding a site from its postal code)
is tested against sample replies, plus a handful of real lookups.

Groups:
  distance   the database's distance against points placed at exact distances
  fence      distance x GPS accuracy x direction -> accepted or refused
  radius     a project's own radius
  sites      real places across Singapore
  inputs     crew count, missing coordinates, check-out fields, the clock
  who        who may check in, and when
  checkout   distance and accuracy when leaving, counts, what can't change
  open       one open check-in per person
  postal     a new postal code clears the old location
  onemap     reading OneMap's replies; real lookups
"""

from __future__ import annotations

import math
import time
import urllib.error
import uuid
from itertools import product

import psycopg
import pytest
from psycopg.rows import dict_row

import conftest
from _lib import onemap

R = 6_371_000.0
SITE = (1.3521, 103.8198)  # central Singapore
GPS_MESSAGE = "You're currently not receiving GPS signal, please move to a spot where you can."
MAX_ACCURACY = 50.0


def destination(lat: float, lng: float, metres: float, bearing: float) -> tuple[float, float]:
    """The point `metres` away along `bearing` (degrees from north), on the same sphere as the database."""
    d, b = metres / R, math.radians(bearing)
    p1, l1 = math.radians(lat), math.radians(lng)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), math.degrees(l2)


class RollbackError(Exception):
    pass


class World:
    """Crew, projects and a connection as the application, made once for the module."""

    def __init__(self) -> None:
        self.owner = conftest.owner_conn()
        self.app = psycopg.connect(conftest.TEST_APP_URL, row_factory=dict_row, autocommit=True)
        mk = lambda role, name: self.owner.execute(  # noqa: E731
            "insert into users (email, user_type, full_name) values (%s, %s, %s) returning uid",
            (f"pytest-gps-{role}-{uuid.uuid4().hex[:6]}@example.com", role, name),
        ).fetchone()["uid"]
        self.u = {
            "epc": mk("epc_team", "GPS Crew A"),
            "epc2": mk("epc_team", "GPS Crew B"),
            "admin": mk("contractor", "GPS Admin"),
            "outsider": mk("epc_team", "GPS Outsider"),
            "ho": mk("homeowner", "GPS Homeowner"),
            "pm": mk("project_manager", "GPS PM"),
        }
        self.group = self.owner.execute(
            "insert into contractor_groups (name) values (%s) returning group_id",
            (f"pytest gps {uuid.uuid4().hex[:6]}",),
        ).fetchone()["group_id"]
        for r in ("epc", "epc2", "admin"):
            self.owner.execute(
                "insert into contractor_group_members (group_id, user_id) values (%s, %s)", (self.group, self.u[r])
            )
        self.ids: list[int] = []
        self.main = self.project("main", *SITE)

    def project(
        self, name: str, lat: float | None, lng: float | None, radius: int = 100, status: str = "in_progress"
    ) -> int:
        pid = self.owner.execute(
            "insert into projects (name, address, postal_code, site_lat, site_lng, check_in_radius_m, homeowner_id, "
            "homeowner_contact_no, contractor_group_id, installation_start_date, target_end_date, status, "
            "project_manager_id) values "
            "(%s, 'GPS Road', '569933', %s, %s, %s, %s, '+65 9000 0000', %s, current_date, current_date + 21, %s, %s) "
            "returning project_id",
            (f"pytest gps {name}", lat, lng, radius, self.u["ho"], self.group, status, self.u["pm"]),
        ).fetchone()["project_id"]
        self.ids.append(pid)
        return pid

    def run(self, actor: int | None, fn):
        """Run fn as `actor` in a transaction that is always rolled back. ('ok', value) or ('err', error)."""
        try:
            with self.app.transaction():
                self.app.execute("select set_config('app.actor_uid', %s, true)", ("" if actor is None else str(actor),))
                raise RollbackError(fn(self.app))
        except RollbackError as r:
            return "ok", r.args[0]
        except psycopg.Error as e:
            return "err", e

    def close(self) -> None:
        self.app.close()
        self.owner.execute("delete from projects where project_id = any(%s)", (self.ids,))
        self.owner.execute("delete from contractor_group_members where group_id = %s", (self.group,))
        self.owner.execute("delete from contractor_groups where group_id = %s", (self.group,))
        self.owner.execute("delete from users where uid = any(%s)", (list(self.u.values()),))
        self.owner.close()


@pytest.fixture(scope="module")
def w():
    world = World()
    yield world
    world.close()


def check_in(pid: int, user: int, lat, lng, acc, crew=4, **extra):
    cols = {"project_id": pid, "user_id": user, "crew_in": crew, "lat": lat, "lng": lng, "accuracy_m": acc, **extra}
    names = ", ".join(cols)
    vals = ", ".join(f"%({k})s" for k in cols)

    def go(c):
        return c.execute(f"insert into site_check_ins ({names}) values ({vals}) returning *", cols).fetchone()

    return go


def refused_for_gps(result) -> bool:
    kind, err = result
    return kind == "err" and err.sqlstate == "P0002" and err.diag.message_primary == GPS_MESSAGE


# ---------------------------------------------------------------- distance

DISTANCES = [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9, 100, 100.1, 101, 105, 110, 150, 200, 500, 1000, 5000]
BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]


@pytest.mark.parametrize(("metres", "bearing"), list(product(DISTANCES, BEARINGS)))
def test_database_distance_is_exact(w, metres, bearing) -> None:
    lat, lng = destination(*SITE, metres, bearing)
    got = w.app.execute("select geo_distance_m(%s, %s, %s, %s) as d", (*SITE, lat, lng)).fetchone()["d"]
    assert got == pytest.approx(metres, rel=1e-9, abs=1e-6)


# ------------------------------------------------------------------- fence

FENCE_DISTANCES = [0, 10, 50, 90, 99, 99.9, 100.5, 101, 120, 250, 1000, 20000]
ACCURACIES = [None, 0, 5, 20, 49.9, 50, 50.1, 80, 200]
FENCE_BEARINGS = [0, 90, 225]


@pytest.mark.parametrize(("metres", "acc", "bearing"), list(product(FENCE_DISTANCES, ACCURACIES, FENCE_BEARINGS)))
def test_check_in_inside_the_fence_with_a_good_fix_only(w, metres, acc, bearing) -> None:
    lat, lng = destination(*SITE, metres, bearing)
    result = w.run(w.u["epc"], check_in(w.main, w.u["epc"], lat, lng, acc))
    ok = acc is not None and acc <= MAX_ACCURACY and metres <= 100
    if ok:
        assert result[0] == "ok", result
        assert result[1]["distance_m"] == pytest.approx(metres, abs=1e-3)
    else:
        assert refused_for_gps(result), result
        # The crew is never told how far off they are; the detail keeps it for the PM.
        assert str(round(metres)) not in result[1].diag.message_primary


# ------------------------------------------------------------------ radius


@pytest.mark.parametrize(("radius", "fraction"), list(product([25, 50, 150, 300, 1000], [0.5, 0.99, 1.01, 2.0])))
def test_a_projects_own_radius_is_used(w, radius, fraction) -> None:
    pid = w.project(f"r{radius}-{fraction}", *SITE, radius=radius)
    lat, lng = destination(*SITE, radius * fraction, 60)
    result = w.run(w.u["epc"], check_in(pid, w.u["epc"], lat, lng, 10))
    assert (result[0] == "ok") == (fraction < 1), result


# ------------------------------------------------------------------- sites

PLACES = {
    "Changi": (1.3644, 103.9915),
    "Jurong East": (1.3329, 103.7436),
    "Woodlands": (1.4382, 103.7890),
    "Sentosa": (1.2494, 103.8303),
    "Tuas": (1.2950, 103.6368),
    "Punggol": (1.4043, 103.9021),
    "Pasir Ris": (1.3721, 103.9474),
    "Bukit Timah": (1.3294, 103.8021),
    "Marina Bay": (1.2834, 103.8607),
    "Pulau Ubin": (1.4044, 103.9625),
}


@pytest.mark.parametrize(("place", "metres"), list(product(PLACES, [60, 160])))
def test_sites_across_singapore(w, place, metres) -> None:
    pid = w.project(f"{place}-{metres}", *PLACES[place])
    lat, lng = destination(*PLACES[place], metres, 30)
    result = w.run(w.u["epc"], check_in(pid, w.u["epc"], lat, lng, 15))
    assert (result[0] == "ok") == (metres <= 100), result


# ------------------------------------------------------------------- inputs


@pytest.mark.parametrize("crew", [0, -1, None])
def test_crew_count_must_be_at_least_one(w, crew) -> None:
    kind, err = w.run(w.u["epc"], check_in(w.main, w.u["epc"], *SITE, 5, crew=crew))
    assert kind == "err" and ("crew" in err.diag.message_primary or err.sqlstate == "23502")


@pytest.mark.parametrize(("lat", "lng"), [(None, SITE[1]), (SITE[0], None), (None, None)])
def test_missing_coordinates_are_refused(w, lat, lng) -> None:
    assert refused_for_gps(w.run(w.u["epc"], check_in(w.main, w.u["epc"], lat, lng, 5)))


@pytest.mark.parametrize(
    "extra",
    [
        {"checked_out_at": "now()"},
        {"crew_out": 3},
        {"checkout_lat": SITE[0]},
        {"checkout_lng": SITE[1]},
        {"checkout_accuracy_m": 5},
        {"checkout_distance_m": 0},
    ],
)
def test_a_check_in_cant_arrive_already_checked_out(w, extra) -> None:
    if "checked_out_at" in extra:
        extra = {"checked_out_at": "2026-01-01T00:00:00Z"}
    kind, err = w.run(w.u["epc"], check_in(w.main, w.u["epc"], *SITE, 5, **extra))
    assert kind == "err" and "separate step" in err.diag.message_primary


def test_a_site_without_a_location_refuses_check_in(w) -> None:
    pid = w.project("no-location", None, None)
    kind, err = w.run(w.u["epc"], check_in(pid, w.u["epc"], *SITE, 5))
    assert kind == "err" and "no verified location" in err.diag.message_primary


def test_the_time_comes_from_the_server_not_the_phone(w) -> None:
    def go(c):
        row = check_in(w.main, w.u["epc"], *SITE, 5, checked_in_at="2020-01-01T08:00:00Z")(c)
        return row["checked_in_at"], c.execute("select now() as n").fetchone()["n"]

    kind, (stored, now) = w.run(w.u["epc"], go)
    assert kind == "ok" and stored == now


def test_the_distance_recorded_is_the_servers(w) -> None:
    lat, lng = destination(*SITE, 40, 0)
    kind, row = w.run(w.u["epc"], check_in(w.main, w.u["epc"], lat, lng, 5, distance_m=0))
    assert kind == "ok" and row["distance_m"] == pytest.approx(40, abs=1e-3)


# ---------------------------------------------------------------------- who


@pytest.mark.parametrize(
    ("actor", "as_user", "ok"),
    [
        ("epc", "epc", True),
        ("epc", "epc2", False),
        ("admin", "admin", False),
        ("outsider", "outsider", False),
        ("ho", "ho", False),
        ("pm", "pm", False),
        (None, "epc", False),
    ],
)
def test_only_the_epc_crew_checks_in_and_only_as_themselves(w, actor, as_user, ok) -> None:
    kind, err = w.run(w.u.get(actor), check_in(w.main, w.u[as_user], *SITE, 5))
    assert (kind == "ok") == ok, err
    if not ok:
        assert err.sqlstate == "42501"


@pytest.mark.parametrize(
    ("status", "ok"),
    [
        ("draft", False),
        ("awaiting_homeowner", False),
        ("homeowner_approved", False),
        ("pm_approved", True),
        ("in_progress", True),
        ("awaiting_signature", False),
        ("closed", False),
    ],
)
def test_check_in_is_open_only_while_the_work_is(w, status, ok) -> None:
    pid = w.project(f"status-{status}", *SITE, status=status)
    kind, _ = w.run(w.u["epc"], check_in(pid, w.u["epc"], *SITE, 5))
    assert (kind == "ok") == ok


def _in_then(fn, user_key="epc"):
    """Check in at the site, then run fn(cursor, row) in the same transaction."""

    def go(c, w):
        row = check_in(w.main, w.u[user_key], *SITE, 5)(c)
        return fn(c, row)

    return go


def test_nobody_can_delete_a_check_in(w) -> None:
    def go(c):
        row = check_in(w.main, w.u["epc"], *SITE, 5)(c)
        c.execute("delete from site_check_ins where check_in_id = %s", (row["check_in_id"],))

    kind, err = w.run(w.u["epc"], go)
    assert kind == "err" and "evidence" in err.diag.message_primary


def test_a_pm_can_correct_the_crew_count_but_not_check_out_for_them(w) -> None:
    def go(c):
        row = check_in(w.main, w.u["epc"], *SITE, 5)(c)
        c.execute("select set_config('app.actor_uid', %s, true)", (str(w.u["pm"]),))
        c.execute("update site_check_ins set crew_in = 6 where check_in_id = %s", (row["check_in_id"],))
        try:
            with c.transaction():
                c.execute(
                    "update site_check_ins set checked_out_at = now(), crew_out = 6, checkout_lat = %s, "
                    "checkout_lng = %s, checkout_accuracy_m = 5 where check_in_id = %s",
                    (*SITE, row["check_in_id"]),
                )
        except psycopg.Error as e:
            return c.execute(
                "select crew_in from site_check_ins where check_in_id = %s", (row["check_in_id"],)
            ).fetchone()["crew_in"], e.diag.message_primary
        return None

    kind, value = w.run(w.u["epc"], go)
    assert kind == "ok" and value[0] == 6 and "checked in can check out" in value[1]


def test_another_crew_member_cant_check_someone_out(w) -> None:
    def go(c):
        row = check_in(w.main, w.u["epc"], *SITE, 5)(c)
        c.execute("select set_config('app.actor_uid', %s, true)", (str(w.u["epc2"]),))
        c.execute(
            "update site_check_ins set checked_out_at = now(), crew_out = 4, checkout_lat = %s, "
            "checkout_lng = %s, checkout_accuracy_m = 5 where check_in_id = %s",
            (*SITE, row["check_in_id"]),
        )

    kind, err = w.run(w.u["epc"], go)
    assert kind == "err" and err.sqlstate == "42501"


# ----------------------------------------------------------------- checkout


def checkout(lat, lng, acc, crew_out=4):
    def go(c, row):
        return c.execute(
            "update site_check_ins set checked_out_at = now(), crew_out = %s, checkout_lat = %s, checkout_lng = %s, "
            "checkout_accuracy_m = %s where check_in_id = %s returning *",
            (crew_out, lat, lng, acc, row["check_in_id"]),
        ).fetchone()

    return go


@pytest.mark.parametrize(("metres", "acc"), list(product([0, 50, 99, 101, 500], [10, 50, 51, None])))
def test_check_out_is_fenced_too(w, metres, acc) -> None:
    lat, lng = destination(*SITE, metres, 180)
    result = w.run(w.u["epc"], lambda c: _in_then(checkout(lat, lng, acc))(c, w))
    ok = acc is not None and acc <= MAX_ACCURACY and metres <= 100
    if ok:
        assert result[0] == "ok" and result[1]["checkout_distance_m"] == pytest.approx(metres, abs=1e-3)
    else:
        assert refused_for_gps(result), result


@pytest.mark.parametrize(("crew_out", "ok"), [(-1, False), (None, False), (0, True), (5, True)])
def test_check_out_needs_a_crew_count(w, crew_out, ok) -> None:
    result = w.run(w.u["epc"], lambda c: _in_then(checkout(*SITE, 5, crew_out))(c, w))
    assert (result[0] == "ok") == ok, result


@pytest.mark.parametrize(
    "change",
    [
        "lat = lat + 0.0001",
        "lng = lng + 0.0001",
        "accuracy_m = 1",
        "distance_m = 999",
        "checked_in_at = checked_in_at - interval '2 hours'",
    ],
)
def test_where_and_when_they_arrived_cant_be_changed(w, change) -> None:
    def fn(c, row):
        c.execute(f"update site_check_ins set {change} where check_in_id = %s", (row["check_in_id"],))

    kind, err = w.run(w.u["epc"], lambda c: _in_then(fn)(c, w))
    assert kind == "err" and "cannot be changed" in err.diag.message_primary


@pytest.mark.parametrize(
    "change",
    [
        "checked_out_at = checked_out_at - interval '1 hour'",
        "checkout_lat = checkout_lat + 0.0001",
        "checkout_distance_m = 999",
    ],
)
def test_where_and_when_they_left_cant_be_changed(w, change) -> None:
    def fn(c, row):
        out = checkout(*SITE, 5)(c, row)
        c.execute(f"update site_check_ins set {change} where check_in_id = %s", (out["check_in_id"],))

    kind, err = w.run(w.u["epc"], lambda c: _in_then(fn)(c, w))
    assert kind == "err" and "cannot be changed" in err.diag.message_primary


@pytest.mark.parametrize("change", ["crew_in = 7", "crew_out = 2"])
def test_crew_counts_can_still_be_corrected_after_leaving(w, change) -> None:
    def fn(c, row):
        out = checkout(*SITE, 5)(c, row)
        return c.execute(
            f"update site_check_ins set {change} where check_in_id = %s returning *", (out["check_in_id"],)
        ).fetchone()

    assert w.run(w.u["epc"], lambda c: _in_then(fn)(c, w))[0] == "ok"


@pytest.mark.parametrize("change", ["checkout_lat = 1.35", "checkout_accuracy_m = 5"])
def test_leaving_details_only_arrive_with_the_check_out(w, change) -> None:
    def fn(c, row):
        c.execute(f"update site_check_ins set {change} where check_in_id = %s", (row["check_in_id"],))

    kind, err = w.run(w.u["epc"], lambda c: _in_then(fn)(c, w))
    assert kind == "err" and "only when checking out" in err.diag.message_primary


# --------------------------------------------------------------------- open


def test_one_open_check_in_per_person(w) -> None:
    def go(c):
        check_in(w.main, w.u["epc"], *SITE, 5)(c)
        check_in(w.main, w.u["epc"], *SITE, 5)(c)

    kind, err = w.run(w.u["epc"], go)
    assert kind == "err" and err.sqlstate == "23505"


def test_after_checking_out_they_can_check_in_again(w) -> None:
    def go(c):
        row = check_in(w.main, w.u["epc"], *SITE, 5)(c)
        checkout(*SITE, 5)(c, row)
        return check_in(w.main, w.u["epc"], *SITE, 5)(c)

    assert w.run(w.u["epc"], go)[0] == "ok"


def test_two_crew_members_can_be_on_site_together(w) -> None:
    def go(c):
        check_in(w.main, w.u["epc"], *SITE, 5)(c)
        c.execute("select set_config('app.actor_uid', %s, true)", (str(w.u["epc2"]),))
        return check_in(w.main, w.u["epc2"], *SITE, 5)(c)

    assert w.run(w.u["epc"], go)[0] == "ok"


def test_one_person_can_be_open_on_two_different_sites(w) -> None:
    other = w.project("second-site", *SITE)

    def go(c):
        check_in(w.main, w.u["epc"], *SITE, 5)(c)
        return check_in(other, w.u["epc"], *SITE, 5)(c)

    assert w.run(w.u["epc"], go)[0] == "ok"


# ------------------------------------------------------------------- postal


def _owner_tx(w: World, fn):
    try:
        with w.owner.transaction():
            raise RollbackError(fn(w.owner))
    except RollbackError as r:
        return r.args[0]


def test_a_new_postal_code_clears_the_old_location(w) -> None:
    pid = w.project("postal-1", *SITE)
    row = _owner_tx(
        w,
        lambda c: c.execute(
            "update projects set postal_code = '799463' where project_id = %s " "returning site_lat, site_lng", (pid,)
        ).fetchone(),
    )
    assert row == {"site_lat": None, "site_lng": None}


def test_a_new_postal_code_with_new_coordinates_keeps_them(w) -> None:
    pid = w.project("postal-2", *SITE)
    row = _owner_tx(
        w,
        lambda c: c.execute(
            "update projects set postal_code = '799463', site_lat = 1.3966, "
            "site_lng = 103.8730 where project_id = %s returning site_lat",
            (pid,),
        ).fetchone(),
    )
    assert row["site_lat"] == 1.3966


def test_check_in_is_refused_until_the_new_site_is_located(w) -> None:
    pid = w.project("postal-3", *SITE)
    w.owner.execute("update projects set postal_code = '799463' where project_id = %s", (pid,))
    kind, err = w.run(w.u["epc"], check_in(pid, w.u["epc"], *SITE, 5))
    assert kind == "err" and "no verified location" in err.diag.message_primary


# ------------------------------------------------------------------- onemap


def r(postal: str, lat: float, lng: float, address: str = "SOMEWHERE") -> dict:
    return {"POSTAL": postal, "LATITUDE": str(lat), "LONGITUDE": str(lng), "ADDRESS": address, "SEARCHVAL": address}


@pytest.fixture
def replies(monkeypatch):
    box: dict = {"results": [], "calls": []}

    def fake(query, attempt=0):
        box["calls"].append(query)
        res = box["results"]
        if isinstance(res, Exception):
            raise res
        return res

    monkeypatch.setattr(onemap, "_search", fake)
    return box


@pytest.mark.parametrize("n_neighbours", [0, 1, 3])
def test_a_postal_code_picks_its_own_building_among_neighbours(replies, n_neighbours) -> None:
    replies["results"] = [r("569931", 1.30, 103.80)] * n_neighbours + [r("569933", 1.3691, 103.8486, "AMK HUB")]
    loc = onemap.geocode("569933")
    assert (loc.postal_code, loc.lat, loc.lng, loc.address) == ("569933", 1.3691, 103.8486, "AMK HUB")


@pytest.mark.parametrize("others", [[], [r("569931", 1.3, 103.8)]])
def test_a_postal_code_with_no_exact_match_is_not_found(replies, others) -> None:
    replies["results"] = others
    with pytest.raises(onemap.GeocodeError) as e:
        onemap.geocode("569933")
    assert e.value.reason == "not_found" and "postal code" in e.value.for_people()


@pytest.mark.parametrize("spread", [0.0, 0.0003])
def test_an_address_with_close_matches_resolves(replies, spread) -> None:
    replies["results"] = [r("238801", 1.3048, 103.8318), r("238802", 1.3048 + spread, 103.8318)]
    assert onemap.geocode("Orchard Road 1").lat == 1.3048


@pytest.mark.parametrize("spread", [0.001, 0.05])
def test_an_address_matching_far_apart_places_is_ambiguous(replies, spread) -> None:
    replies["results"] = [r("238801", 1.3048, 103.8318), r("530001", 1.3048 + spread, 103.8318)]
    with pytest.raises(onemap.GeocodeError) as e:
        onemap.geocode("Jalan Kayu")
    assert e.value.reason == "ambiguous" and "postal code" in e.value.for_people()


@pytest.mark.parametrize("missing", ["LATITUDE", "LONGITUDE"])
def test_results_without_coordinates_are_skipped(replies, missing) -> None:
    bad = r("569933", 1.0, 103.0)
    bad[missing] = ""
    replies["results"] = [bad, r("569933", 1.3691, 103.8486)]
    assert onemap.geocode("569933").lat == 1.3691


def test_nil_postal_code_is_recorded_as_none(replies) -> None:
    replies["results"] = [r("NIL", 1.3, 103.8, "A PARK")]
    assert onemap.geocode("Some Park").postal_code is None


@pytest.mark.parametrize("query", ["", "  ", "ab"])
def test_too_short_a_query_is_refused(replies, query) -> None:
    with pytest.raises(onemap.GeocodeError) as e:
        onemap.geocode(query)
    assert e.value.reason == "invalid_query" and not replies["calls"]


@pytest.mark.parametrize("postal", ["12345", "1234567", "abcdef", "56993a"])
def test_postal_codes_must_be_six_digits(replies, postal) -> None:
    with pytest.raises(onemap.GeocodeError):
        onemap.resolve(None, postal)


def test_postal_code_wins_over_the_address(replies) -> None:
    replies["results"] = [r("569933", 1.3691, 103.8486)]
    onemap.resolve("Somewhere else entirely", "569933")
    assert replies["calls"] == ["569933"]


def test_the_postal_code_is_filled_in_from_the_address(replies) -> None:
    replies["results"] = [r("799463", 1.3966, 103.8730)]
    assert onemap.resolve("14 Jalan Kayu", None).postal_code == "799463"


class _Http:
    def __init__(self, codes: list[int], body: bytes = b'{"results": []}'):
        self.codes, self.body, self.calls = codes, body, 0

    def __call__(self, req, timeout=10):
        code = self.codes[min(self.calls, len(self.codes) - 1)]
        self.calls += 1
        if code != 200:
            raise urllib.error.HTTPError(req.full_url, code, "x", {}, None)
        body = self.body

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return body

        return Resp()


@pytest.mark.parametrize(
    ("codes", "outcome"),
    [
        ([429, 200], "ok"),
        ([429, 429, 200], "ok"),
        ([429] * 5, "rate_limited"),
        ([500], "unreachable"),
        ([403], "unreachable"),
    ],
)
def test_onemap_being_busy_or_down(monkeypatch, codes, outcome) -> None:
    http = _Http(codes)
    monkeypatch.setattr(onemap.urllib.request, "urlopen", http)
    monkeypatch.setattr(onemap.time, "sleep", lambda s: None)
    if outcome == "ok":
        assert onemap._search("569933") == []
    else:
        with pytest.raises(onemap.GeocodeError) as e:
            onemap._search("569933")
        assert e.value.reason == outcome


def test_onemap_unreachable(monkeypatch) -> None:
    def boom(req, timeout=10):
        raise OSError("network is unreachable")

    monkeypatch.setattr(onemap.urllib.request, "urlopen", boom)
    with pytest.raises(onemap.GeocodeError) as e:
        onemap._search("569933")
    assert e.value.reason == "unreachable"


# Real lookups against OneMap: a few, spaced out, because OneMap rate-limits hard.
REAL = {"569933": "ANG MO KIO", "238801": "ORCHARD", "018956": "MARINA", "609731": "JURONG", "819663": "CHANGI"}


@pytest.mark.parametrize("postal", list(REAL))
def test_real_onemap_lookup_finds_the_building_in_singapore(postal) -> None:
    time.sleep(1.5)
    loc = onemap.geocode(postal)
    assert loc.postal_code == postal
    assert 1.15 < loc.lat < 1.48 and 103.6 < loc.lng < 104.1
