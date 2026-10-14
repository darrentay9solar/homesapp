"""Matrix: properties that must hold whatever the data.

  assistant     each starter question asked 300 ways finds its own answer; 900 unrelated
                questions find none
  maintenance   3,000 made-up fleets of systems: the dashboard's numbers always add up

Run with: npm run test:matrix
"""

from __future__ import annotations

import random
from datetime import date, timedelta

import pytest

from _lib import analytics as an
from _lib import assistant

FAQ = [
    {"faq_id": i, "question": q, "answer": a, "question_zh": qz, "answer_zh": az, "position": i, "active": True}
    for i, (q, a, qz, az) in enumerate(assistant.STARTER, 1)
]
FILLER = ["Hi,", "Hello", "please", "can you tell me", "I want to know", "thanks", "um", "so"]


def paraphrase(rng: random.Random, q: str) -> str:
    s = q
    if rng.random() < 0.5:
        s = s.lower()
    if rng.random() < 0.3:
        s = s.upper()
    if rng.random() < 0.5:
        s = s.rstrip("?")
    if rng.random() < 0.5:
        s = f"{rng.choice(FILLER)} {s}"
    if rng.random() < 0.3:
        s = f"{s} {rng.choice(['please', 'thanks', '?', '??'])}"
    if rng.random() < 0.3:
        s = "  ".join(s.split(" "))
    return s


RNG = random.Random(7)
ASKED = [(i, paraphrase(RNG, q if RNG.random() < 0.8 or not qz else qz)) for i, (q, _a, qz, _az) in enumerate(assistant.STARTER, 1) for _ in range(300)]
UNRELATED_WORDS = ["weather", "football", "pizza", "holiday", "music", "traffic", "stocks", "recipe", "movie", "birthday", "taxi", "durian"]
UNRELATED = [" ".join(RNG.sample(UNRELATED_WORDS, 3)) + "?" for _ in range(900)]


@pytest.mark.parametrize(("faq_id", "question"), ASKED, ids=[f"asked:{i}" for i in range(len(ASKED))])
def test_asked_another_way(faq_id, question) -> None:
    row, score = assistant.closest(question, FAQ)
    assert row and row["faq_id"] == faq_id and score >= assistant.MATCH, (question, score)


@pytest.mark.parametrize("question", UNRELATED, ids=[f"unrelated:{i}" for i in range(len(UNRELATED))])
def test_unrelated_finds_nothing(question) -> None:
    _row, score = assistant.closest(question, FAQ)
    assert score < assistant.MATCH


# ------------------------------------------------------------------ the dashboard's maintenance numbers

TODAY = date(2026, 10, 14)
MODELS = ["SUN2000-5KTL-L1", "SUN2000-10K-LC0", "SUN2000-12K-MB0", "SUN2000-17KTL-MB0", "Mystery box"]


def fleet(seed: int) -> list[dict]:
    rng = random.Random(seed)
    rows = []
    for i in range(rng.randrange(0, 30)):
        on = TODAY - timedelta(days=rng.randrange(-30, 900))
        six, year = on + timedelta(days=182), on + timedelta(days=365)
        rows.append({
            "system_id": i + 1, "address": f"{i} Lane", "postal_code": rng.choice(["560123", "018989", "730001", None]),
            "run_by": rng.choice([None, 1, 2]), "pm_name": None, "urgent": rng.random() < 0.1,
            "kwp": rng.choice([None, round(rng.uniform(4, 80), 3)]), "phase": rng.choice([1, 3, None]),
            "inverters": rng.sample(MODELS, rng.randrange(0, 3)),
            "ppa_kind": rng.choice(["ppa", "value_buy", None]), "ppa_years": rng.choice([5, 7, 8, 9]),
            "plan_years": rng.choice([None, 3, 5, 7]), "plan_excludes_first_year": rng.random() < 0.5,
            "turned_on_on": on, "six_month_due": six, "one_year_due": year,
            "six_month_done_on": six if rng.random() < 0.3 else None, "one_year_done_on": year if rng.random() < 0.2 else None,
        })  # fmt: skip
    return rows


@pytest.mark.parametrize("seed", range(3000), ids=[f"fleet:{i}" for i in range(3000)])
def test_maintenance_numbers_add_up(seed) -> None:
    rows = fleet(seed)
    u = an.maintenance(rows, TODAY)
    ids = {r["system_id"] for r in rows}
    t = u["tiles"]
    assert t["systems"]["count"] == len(rows)
    for k in ("dueSoon", "overdue", "urgent", "unassigned"):
        assert set(t[k]["ids"]) <= ids and t[k]["count"] == len(t[k]["ids"])
    assert sum(g["count"] for g in u["bySize"]) == len(rows)
    assert sum(g["count"] for g in u["byRegion"]) == len(rows) == sum(g["count"] for g in u["byPhase"])
    assert sum(g["count"] for g in u["inverterPower"]) == sum(len(r["inverters"]) for r in rows) == sum(g["count"] for g in u["inverters"])
    pending = [(r[f"{k}_due"]) for r in rows for k in ("six_month", "one_year") if not r[f"{k}_done_on"]]
    assert u["overdueChecks"]["six"] + u["overdueChecks"]["year"] == sum(1 for d in pending if d < TODAY)
    ahead = sum(m["six"] + m["year"] for m in u["upcoming"])
    assert ahead == sum(1 for d in pending if TODAY <= d and (d.year, d.month) <= ((TODAY.year * 12 + TODAY.month + 10) // 12, (TODAY.month + 10) % 12 + 1))
    assert sum(g["count"] for g in u["ppaEnds"]) == sum(1 for r in rows if r["ppa_kind"] == "ppa" and r["ppa_years"] and r["turned_on_on"])
    sizes = sorted(float(r["kwp"]) for r in rows if r["kwp"] is not None)
    if sizes:
        assert sizes[0] <= u["medianKwp"] <= sizes[-1]
    else:
        assert u["medianKwp"] is None
