# ruff: noqa: E501  (one assertion per line reads best here)
"""The meeting form's options (migration 0042): place, reminders, repeating, video links.

place      online, physical (with a postal code) or a phone call; older "site"/"office" are physical
reminders  an hour before unless chosen; up to five, up to four weeks before; none at all
repeat     one meeting per time, sharing a series; busy at any of them is refused; changing,
           answering and cancelling this one or this and the ones after it
video      a link for the meeting's time when a service is connected, else a clear refusal
contacts   only managers see the addresses of the people they invite
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from itertools import pairwise
from zoneinfo import ZoneInfo

import pytest

from _lib import video
from conftest import bearer

SG = ZoneInfo("Asia/Singapore")


def h(u) -> dict[str, str]:
    return bearer(u["clerk_user_id"])


def slot(days: int, hour: int, minute: int = 0) -> str:
    d = datetime.now(SG).date() + timedelta(days=days)
    return datetime.combine(d, time(hour, minute)).isoformat(timespec="minutes")


@pytest.fixture
def pm(fx):
    return fx.user("project_manager", full_name="Options PM")


@pytest.fixture
def pm2(fx):
    return fx.user("project_manager", full_name="Options Other")


@pytest.fixture
def tidy(fx):
    yield
    if fx.uids:
        fx.conn.execute("delete from meetings where organiser_id = any(%s)", (fx.uids,))
        fx.conn.execute("delete from calendar_blocks where user_id = any(%s)", (fx.uids,))


def arrange(client, who, people, start, end, **kw):
    return client.post("/api/py/meetings", headers=h(who),
                       json={"title": "Weekly sync", "people": [p["uid"] for p in people], "startsAt": start, "endsAt": end, **kw})  # fmt: skip


def series(fx, sid: int) -> list[dict]:
    return fx.conn.execute(
        "select meeting_id, starts_at, ends_at, cancelled_at, repeat, title from meetings where series_id = %s order by starts_at", (sid,)
    ).fetchall()


# ------------------------------------------------------------------ place


def test_physical_with_a_postal_code(client, pm, pm2, tidy) -> None:
    r = arrange(client, pm, [pm2], slot(3, 10), slot(3, 11), place="physical", location="10 Ubi Crescent", postalCode="408564")
    assert r.status_code == 200, r.text
    m = r.json()["meeting"]
    assert (m["place"], m["location"], m["postalCode"]) == ("physical", "10 Ubi Crescent", "408564")
    assert arrange(client, pm, [pm2], slot(3, 12), slot(3, 13), place="physical", postalCode="4085").status_code == 400


@pytest.mark.parametrize("old", ["site", "office"])
def test_the_older_place_names_are_physical(client, pm, pm2, tidy, old) -> None:
    r = arrange(client, pm, [pm2], slot(4, 10), slot(4, 11), place=old, location="40 Siglap Hill")
    assert r.status_code == 200, r.text
    assert r.json()["meeting"]["place"] == "physical"


def test_online_keeps_no_address(client, pm, pm2, tidy) -> None:
    m = arrange(client, pm, [pm2], slot(3, 14), slot(3, 15), place="physical", location="10 Ubi Crescent", postalCode="408564").json()["meeting"]
    r = client.patch(f"/api/py/meetings/{m['id']}", headers=h(pm), json={"place": "online"})
    assert r.status_code == 200, r.text
    assert (r.json()["meeting"]["location"], r.json()["meeting"]["postalCode"]) == (None, None)


def test_the_postal_code_finds_the_address(client, pm, monkeypatch) -> None:
    from _lib import onemap

    loc = type("L", (), {"address": "10 UBI CRESCENT SINGAPORE 408564", "postal_code": "408564", "lat": 1.3, "lng": 103.9})()
    monkeypatch.setattr(onemap, "resolve", lambda _a, _p: loc)
    r = client.get("/api/py/calendar/geocode", headers=h(pm), params={"postal": "408564"})
    assert r.status_code == 200 and r.json()["address"].startswith("10 UBI")
    assert client.get("/api/py/calendar/geocode", headers=h(pm), params={"postal": "40856"}).status_code == 400


# ------------------------------------------------------------------ reminders


def test_an_hour_before_unless_chosen(client, pm, pm2, tidy) -> None:
    assert arrange(client, pm, [pm2], slot(3, 10), slot(3, 11)).json()["meeting"]["reminders"] == [60]
    m = arrange(client, pm, [pm2], slot(3, 12), slot(3, 13), reminders=[30, 1440, 30]).json()["meeting"]
    assert m["reminders"] == [1440, 30], "each once, earliest first"
    assert arrange(client, pm, [pm2], slot(3, 14), slot(3, 15), reminders=[]).json()["meeting"]["reminders"] == []
    r = client.patch(f"/api/py/meetings/{m['id']}", headers=h(pm), json={"reminders": [10]})
    assert r.status_code == 200 and r.json()["meeting"]["reminders"] == [10]


@pytest.mark.parametrize("bad", [[1, 2, 3, 4, 5, 6], [-5], [40321]])
def test_reminders_have_limits(client, pm, pm2, tidy, bad) -> None:
    assert arrange(client, pm, [pm2], slot(3, 16), slot(3, 17), reminders=bad).status_code == 400


# ------------------------------------------------------------------ repeating


def test_a_weekly_meeting_is_one_meeting_a_week(client, fx, pm, pm2, tidy) -> None:
    r = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=4)
    assert r.status_code == 200, r.text
    assert "4 meetings" in r.json()["message"]
    m = r.json()["meeting"]
    assert m["repeat"] == "weekly" and m["seriesId"] == m["id"] and m["laterInSeries"] == 3
    rows = series(fx, m["seriesId"])
    assert len(rows) == 4 and {(b["starts_at"] - a["starts_at"]).days for a, b in pairwise(rows)} == {7}
    asked = fx.conn.execute("select body from notifications where recipient_uid = %s and kind = 'meeting_request'", (pm2["uid"],)).fetchall()
    assert len(asked) == 1 and "Repeats: Weekly on" in asked[0]["body"] and "(4 meetings)" in asked[0]["body"], "asked once for the series"


def test_until_a_date(client, fx, pm, pm2, tidy) -> None:
    first = datetime.now(SG).date() + timedelta(days=2)
    r = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="daily", repeatUntil=(first + timedelta(days=4)).isoformat())
    assert r.status_code == 200, r.text
    assert len(series(fx, r.json()["meeting"]["seriesId"])) == 5


def test_busy_at_any_of_them_is_refused(client, fx, pm, pm2, tidy) -> None:
    third = (datetime.now(SG).date() + timedelta(days=16)).isoformat()
    assert client.post("/api/py/calendar/blocks", headers=h(pm2), json={"fromDate": third}).status_code == 200
    r = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=4)
    assert r.status_code == 409 and "Options Other" in r.json()["error"] and "Busy on" in r.json()["error"]


def test_a_repeat_of_one_and_a_repeating_check_are_refused(client, pm, pm2, tidy) -> None:
    first = datetime.now(SG).date() + timedelta(days=2)
    assert arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatUntil=(first + timedelta(days=3)).isoformat()).status_code == 400
    assert arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=1).status_code == 400


def test_accepting_the_series_skips_the_busy_ones(client, fx, pm, pm2, tidy) -> None:
    m = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=4).json()["meeting"]
    third = (datetime.now(SG).date() + timedelta(days=16)).isoformat()
    assert client.post("/api/py/calendar/blocks", headers=h(pm2), json={"fromDate": third}).status_code == 200
    r = client.post(f"/api/py/meetings/{m['id']}/respond", headers=h(pm2), json={"response": "accepted", "series": True})
    assert r.status_code == 200, r.text
    assert "Accepted 3 meetings" in r.json()["message"] and "still to answer" in r.json()["message"]
    answers = [x["response"] for x in fx.conn.execute(
        "select mp.response from meeting_people mp join meetings m on m.meeting_id = mp.meeting_id "
        "where m.series_id = %s and mp.user_id = %s order by m.starts_at", (m["seriesId"], pm2["uid"])).fetchall()]  # fmt: skip
    assert answers == ["accepted", "accepted", "pending", "accepted"]


def test_declining_just_one(client, fx, pm, pm2, tidy) -> None:
    m = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=3).json()["meeting"]
    r = client.post(f"/api/py/meetings/{m['id']}/respond", headers=h(pm2), json={"response": "declined"})
    assert r.status_code == 200 and r.json()["message"] == "Declined. The organiser has been told."
    left = fx.conn.execute("select count(*) as n from meeting_people mp join meetings m on m.meeting_id = mp.meeting_id "
                           "where m.series_id = %s and mp.user_id = %s and mp.response = 'pending'", (m["seriesId"], pm2["uid"])).fetchone()  # fmt: skip
    assert left["n"] == 2


def test_moving_this_and_the_ones_after_it(client, fx, pm, pm2, tidy) -> None:
    m = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=4).json()["meeting"]
    rows = series(fx, m["seriesId"])
    second = rows[1]["meeting_id"]
    start = rows[1]["starts_at"].astimezone(SG) + timedelta(hours=2)
    r = client.patch(f"/api/py/meetings/{second}", headers=h(pm), json={
        "startsAt": start.strftime("%Y-%m-%dT%H:%M"), "endsAt": (start + timedelta(hours=1, minutes=30)).strftime("%Y-%m-%dT%H:%M"),
        "title": "Weekly sync (later)", "scope": "following"})  # fmt: skip
    assert r.status_code == 200, r.text
    assert "Saved for 3 meetings" in r.json()["message"]
    after = series(fx, m["seriesId"])
    assert after[0]["starts_at"] == rows[0]["starts_at"] and after[0]["title"] == "Weekly sync", "the first stays"
    for old, new in zip(rows[1:], after[1:], strict=True):
        assert new["starts_at"] - old["starts_at"] == timedelta(hours=2)
        assert new["ends_at"] - new["starts_at"] == timedelta(hours=1, minutes=30)
        assert new["title"] == "Weekly sync (later)"


def test_changing_just_one(client, fx, pm, pm2, tidy) -> None:
    m = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=3).json()["meeting"]
    r = client.patch(f"/api/py/meetings/{m['id']}", headers=h(pm), json={"title": "Just this one"})
    assert r.status_code == 200 and r.json()["message"] == "Saved."
    assert [x["title"] for x in series(fx, m["seriesId"])] == ["Just this one", "Weekly sync", "Weekly sync"]


def test_cancelling_this_and_the_ones_after_it(client, fx, pm, pm2, tidy) -> None:
    m = arrange(client, pm, [pm2], slot(2, 9), slot(2, 10), repeat="weekly", repeatCount=4).json()["meeting"]
    third = series(fx, m["seriesId"])[2]["meeting_id"]
    r = client.post(f"/api/py/meetings/{third}/cancel", headers=h(pm), json={"scope": "following"})
    assert r.status_code == 200 and "Cancelled 2 meetings" in r.json()["message"]
    assert [x["cancelled_at"] is not None for x in series(fx, m["seriesId"])] == [False, False, True, True]
    assert client.get(f"/api/py/meetings/{m['id']}", headers=h(pm)).json()["laterInSeries"] == 1


# ------------------------------------------------------------------ video links


def test_a_video_service_not_connected_says_so(client, pm, monkeypatch) -> None:
    for k in video.NEEDS["zoom"]:
        monkeypatch.delenv(k, raising=False)
    r = client.post("/api/py/calendar/video-link", headers=h(pm), json={"provider": "zoom", "title": "Sync", "startsAt": slot(2, 9), "endsAt": slot(2, 10)})
    assert r.status_code == 503 and "isn't connected" in r.json()["error"]


def test_a_connected_service_makes_a_link_for_that_time(client, pm, monkeypatch) -> None:
    for k in video.NEEDS["zoom"]:
        monkeypatch.setenv(k, "x")
    asked = {}

    def fake(title, start, end):
        asked.update(title=title, start=start, end=end)
        return "https://us02web.zoom.us/j/123456789"

    monkeypatch.setattr(video, "zoom", fake)
    r = client.post("/api/py/calendar/video-link", headers=h(pm), json={"provider": "zoom", "title": "Sync", "startsAt": slot(2, 9), "endsAt": slot(2, 10)})
    assert r.status_code == 200 and r.json()["link"].startswith("https://us02web.zoom.us/")
    assert asked["start"].hour == 9 and asked["end"] - asked["start"] == timedelta(hours=1), "for the meeting's own time"
    assert "zoom" in client.get("/api/py/calendar/contacts", headers=h(pm)).json()["video"]


def test_a_video_link_for_a_past_time_is_refused(client, pm) -> None:
    r = client.post("/api/py/calendar/video-link", headers=h(pm), json={"provider": "teams", "startsAt": slot(-2, 9), "endsAt": slot(-2, 10)})
    assert r.status_code == 400


# ------------------------------------------------------------------ contacts


def test_only_managers_see_addresses(client, fx, pm) -> None:
    ho = fx.user("homeowner", full_name="Address Owner")
    fx.conn.execute("update users set address = '7 Example Avenue', postal_code = '466001' where uid = %s", (ho["uid"],))
    people = {p["uid"]: p for p in client.get("/api/py/calendar/contacts", headers=h(pm)).json()["people"]}
    assert people[ho["uid"]]["postalCode"] == "466001"
    crew = fx.user("contractor")
    pid = fx.conn.execute(
        "insert into projects (name, address, postal_code, homeowner_id, homeowner_contact_no, project_manager_id, created_by, installation_start_date, target_end_date, status) "
        "values ('Contacts', '7 Example Avenue', '466001', %s, '+65 9000 0000', %s, %s, current_date, current_date + 7, 'in_progress') returning project_id",
        (ho["uid"], pm["uid"], pm["uid"]),
    ).fetchone()["project_id"]
    try:
        fx.conn.execute("insert into project_assignments (project_id, user_id, assigned_by) values (%s, %s, %s)", (pid, crew["uid"], pm["uid"]))
        theirs = {p["uid"]: p for p in client.get("/api/py/calendar/contacts", headers=h(crew)).json()["people"]}
        assert ho["uid"] in theirs and theirs[ho["uid"]]["address"] is None and theirs[ho["uid"]]["postalCode"] is None
    finally:
        fx.conn.execute("delete from projects where project_id = %s", (pid,))
