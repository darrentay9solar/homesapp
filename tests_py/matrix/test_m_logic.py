# ruff: noqa: E501  (case tables read better whole)
"""Matrix: the rules that decide what people are told and when, case by case.

  check states     every check due from 400 days ago to 400 days ahead, done or not, on 25 days
  check reminders  14 days before, on the day, and overdue (up to 90 days), on 20 days
  meeting reminders a day before and 30 minutes before, across 26 hours and six lead times
  quiet and mute   every alert kind at every hour, quiet hours, pause and urgent on and off
  call links       5,000 links: only Google Meet, Teams and Zoom pass
  the list import  dates written as text, inverter spellings, months later, PPA and phase

Each case is checked against the rule as written in the docs, not against the code.
Run with: npm run test:matrix
"""

from __future__ import annotations

import random
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from _lib import maintenance_reminders, meeting_reminders, prefs
from _routes import maintenance, support

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import import_client_list as icl

SG = ZoneInfo("Asia/Singapore")

# ------------------------------------------------------------------ a check's state


TODAYS = [date(2026, 1, 1) + timedelta(days=i * 15) for i in range(25)]
CHECK_CASES = [(t, off, done) for t in TODAYS for off in range(-400, 401) for done in (False, True)]


@pytest.mark.parametrize(("today", "off", "done"), CHECK_CASES, ids=[f"check:{i}" for i in range(len(CHECK_CASES))])
def test_check_state(today, off, done) -> None:
    due = today + timedelta(days=off)
    want = "done" if done else "overdue" if off < 0 else "due_soon" if off <= 30 else "scheduled"
    assert maintenance.check_state(due, today - timedelta(days=3) if done else None, today) == want


# ------------------------------------------------------------------ check reminders

STAGE_CASES = [(t, off) for t in TODAYS[:20] for off in range(-150, 151)]


@pytest.mark.parametrize(("today", "off"), STAGE_CASES, ids=[f"remind:{i}" for i in range(len(STAGE_CASES))])
def test_check_reminder_stage(today, off) -> None:
    want = "soon" if 0 < off <= 14 else "due" if off == 0 else "overdue" if -90 <= off < 0 else None
    assert maintenance_reminders.stage_for(today + timedelta(days=off), today) == want


# ------------------------------------------------------------------ meeting reminders

NOW = datetime(2026, 10, 14, 9, 0, tzinfo=SG)
LEADS = [timedelta(minutes=30), timedelta(hours=2), timedelta(hours=6), timedelta(hours=23), timedelta(hours=30), timedelta(days=3)]
MEETING_CASES = [(m, lead) for m in range(-30, 26 * 60 + 1, 5) for lead in LEADS]


@pytest.mark.parametrize(("mins", "lead"), MEETING_CASES, ids=[f"meeting:{i}" for i in range(len(MEETING_CASES))])
def test_meeting_reminder_stage(mins, lead) -> None:
    start = NOW + timedelta(minutes=mins)
    made = start - lead
    if 0 < mins <= 30:
        want = "soon"
    elif 30 < mins <= 24 * 60 and lead >= timedelta(hours=30):
        want = "day"
    else:
        want = None
    assert meeting_reminders.stage_for(start, made, NOW) == want


# ------------------------------------------------------------------ quiet hours, pause, mute

KINDS = [*sorted(prefs.CATEGORY_OF), "unknown_kind"]
PREF_CASES = [
    (kind, hour, quiet, paused, urgent, muted)
    for kind in KINDS
    for hour in range(24)
    for quiet in (False, True)
    for paused in (False, True)
    for urgent in (False, True)
    for muted in (False, True)
]


@pytest.mark.parametrize(("kind", "hour", "quiet", "paused", "urgent", "muted"), PREF_CASES, ids=[f"prefs:{i}" for i in range(len(PREF_CASES))])
def test_silenced(kind, hour, quiet, paused, urgent, muted) -> None:
    now = datetime(2026, 10, 14, hour, 15, tzinfo=SG)
    cat = prefs.CATEGORY_OF.get(kind)
    p = prefs.normalise({
        "quiet": {"on": quiet, "from": "22:00", "to": "07:00"},
        "pausedUntil": (now + timedelta(hours=2)).isoformat() if paused else None,
        "urgent": urgent,
        "mute": [cat] if muted and cat else [],
    })  # fmt: skip
    gets_through = cat == "late" and urgent
    in_quiet = quiet and (hour >= 22 or hour < 7)
    if muted and cat:
        want = "muted in their settings"
    elif paused and not gets_through:
        want = "paused in their settings"
    elif in_quiet and not gets_through:
        want = "during their quiet hours"
    else:
        want = None
    assert prefs.silenced(p, kind, now) == want


# ------------------------------------------------------------------ call links


def link_case(rng: random.Random) -> tuple[str, bool]:
    code = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(3)) + "-" + "".join(rng.choice("abcdefghij") for _ in range(4))
    good = [
        f"https://meet.google.com/{code}",
        f"https://teams.microsoft.com/l/meetup-join/19%3ameeting_{code}",
        f"https://teams.live.com/meet/{rng.randrange(10**9)}",
        f"https://zoom.us/j/{rng.randrange(10**10)}",
        f"https://us0{rng.randrange(1, 9)}web.zoom.us/j/{rng.randrange(10**10)}?pwd={code}",
    ]
    bad = [
        f"http://meet.google.com/{code}",
        f"https://meet.google.com.{code}.example/{code}",
        f"https://{code}.example/meet.google.com/{code}",
        f"https://meet.google.com/{code} extra",
        f"https://meet.google.com/{code}\"onmouseover",
        "https://meet.google.com/",
        f"javascript:alert('{code}')",
        f"https://zoom.us.{code}.com/j/1",
        f"meet.google.com/{code}",
        "",
    ]
    if rng.random() < 0.5:
        return rng.choice(good), True
    return rng.choice(bad), False


RNG = random.Random(4110)
LINKS = [link_case(RNG) for _ in range(5000)]


@pytest.mark.parametrize(("link", "ok"), LINKS, ids=[f"link:{i}" for i in range(len(LINKS))])
def test_call_link(link, ok) -> None:
    assert bool(support.CALL_LINK.match(link)) is ok


# ------------------------------------------------------------------ the list import

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def date_case(rng: random.Random) -> tuple[object, date | None]:
    d = date(2020, 1, 1) + timedelta(days=rng.randrange(0, 4000))
    k = rng.randrange(6)
    if k == 0:
        return f"{d.day}-{MONTH_NAMES[d.month - 1]}-{d.year % 100:02d}", d
    if k == 1:
        return f"{d.day:02d} {FULL[d.month - 1]} {d.year}", d
    if k == 2:
        return f"{d.day}/{MONTH_NAMES[d.month - 1][:3]}/{d.year}", d
    if k == 3:
        return datetime.combine(d, time(0)), d
    if k == 4:
        return rng.choice(["first week Dec", "TBC", "end of month", "-", "", None, "N/A"]), None
    return d, d


RNG2 = random.Random(2610)
DATES = [date_case(RNG2) for _ in range(4000)]


@pytest.mark.parametrize(("raw", "want"), DATES, ids=[f"date:{i}" for i in range(len(DATES))])
def test_list_dates(raw, want) -> None:
    assert icl.day(raw, 2026, "a date", [], "9SH0000") == want


def model_case(rng: random.Random) -> tuple[str, str]:
    kw = rng.choice([5, 8, 10, 12, 15, 17, 20, 25, 30, 36, 50])
    suffix = rng.choice(["L1", "LC0", "MAP0", "MB0", "M1", "M3", "M5", "MC0"])
    a = f"SUN2000-{kw}KTL-{suffix}"
    b = rng.choice([f"SUN2000-{kw}K-{suffix}", f"SUN2000 - {kw}KTL-{suffix}", f"sun2000-{kw}ktl-{suffix.lower()}", f" SUN2000-{kw}K-{suffix} "])
    return a, b


RNG3 = random.Random(77)
MODELS = [model_case(RNG3) for _ in range(3000)]


@pytest.mark.parametrize(("a", "b"), MODELS, ids=[f"model:{i}" for i in range(len(MODELS))])
def test_inverter_spellings(a, b) -> None:
    assert icl.model_key(a) == icl.model_key(b.strip().replace(" - ", "-")), (a, b)


RNG4 = random.Random(31)
MONTH_CASES = [(date(2020, 1, 1) + timedelta(days=RNG4.randrange(0, 3650)), RNG4.randrange(0, 61)) for _ in range(5000)]


@pytest.mark.parametrize(("d", "n"), MONTH_CASES, ids=[f"months:{i}" for i in range(len(MONTH_CASES))])
def test_months_later(d, n) -> None:
    got = icl.add_months(d, n)
    assert (got.year * 12 + got.month) - (d.year * 12 + d.month) == n, "exactly n months on"
    nxt = date(got.year + (got.month == 12), got.month % 12 + 1, 1)
    last = (nxt - timedelta(days=1)).day
    assert got.day == min(d.day, last), "same day of the month, or the month's last"


PPA_CASES = [(f"{n} {w}", ("ppa", n)) for n in range(1, 41) for w in ("Years", "years", "Year", "YEARS")] + [
    ("Upfront Purchase", ("value_buy", None)),
    ("upfront purchase", ("value_buy", None)),
    ("Value buy", ("value_buy", None)),
    ("-", (None, None)),
    ("", (None, None)),
    (None, (None, None)),
]


@pytest.mark.parametrize(("raw", "want"), PPA_CASES, ids=[f"ppa:{i}" for i in range(len(PPA_CASES))])
def test_ppa(raw, want) -> None:
    assert icl.ppa(raw) == want


PHASES = [(w, 1) for w in ("Single-phase", "single phase", "SINGLE-PHASE", "1-phase", "1P", "single")] + [
    (w, 3) for w in ("3-phase", "3 phase", "three phase", "Three-Phase", "3P")
] + [(None, None), ("", None), ("-", None)]


@pytest.mark.parametrize(("raw", "want"), PHASES, ids=[f"phase:{i}" for i in range(len(PHASES))])
def test_phase(raw, want) -> None:
    assert icl.phase(raw) == want
