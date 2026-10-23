# ruff: noqa: E501  (the messages read better whole)
"""A month's solar, sent once the month is over (as FusionSolar's report subscription does): in the app,
and by email where it's set up (docs/solar.md).

  homeowner          their plant: what it made, beside the same month a year before, and what that much
                     electricity costs at SP's tariff
  project manager    the plants they run (a superadmin: every plant): what they made together, and the
                     best and lowest for their size

Sent from the 1st of the month for the month before, once (solar_sync "report:YYYY-MM"), only for
months with figures. A person who turned solar alerts off (Account → Notifications) isn't sent it.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from _lib import notify, tariff
from _lib.db import fetch_all, fetch_one, transaction
from _lib.solar_sync import SG


def _claim(month: date) -> bool:
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_sync (key, value, at) values (%s, '{}'::jsonb, now()) on conflict (key) do nothing returning key",
            (f"report:{month.isoformat()[:7]}",),
        )
        return cur.fetchone() is not None


def _kwh(month: date) -> dict[str, float]:
    start = datetime(month.year, month.month, 1, tzinfo=SG)
    return {
        r["station_code"]: float(r["kwh"])
        for r in fetch_all(
            "select station_code, kwh from solar_readings where period = 'month' and at = %s and kwh is not null",
            (start,),
        )
    }


def run(now: datetime) -> dict[str, Any]:
    local = now.astimezone(SG)
    month = (local.date().replace(day=1) - timedelta(days=1)).replace(day=1)
    this = _kwh(month)
    if not this or not _claim(month):
        return {"skipped": "no figures yet" if not this else "already sent"}
    before = _kwh(month.replace(year=month.year - 1))
    label = month.strftime("%B %Y")
    sp = fetch_one(
        "select cents_with_gst, cents_without_gst from sp_tariffs where starts_on <= %s order by starts_on desc limit 1",
        (month,),
    )
    cents = (
        float(sp["cents_with_gst"] or float(sp["cents_without_gst"]) * (1 + float(tariff.gst_rate(month))))
        if sp
        else None
    )
    plants = fetch_all(
        "select p.station_code, p.name, coalesce(p.capacity_kwp, m.kwp) as kwp, m.run_by, m.homeowner_id "
        "from solar_plants p left join maintenance_systems m on m.system_id = p.system_id"
    )
    people = {
        u["uid"]: u
        for u in fetch_all(
            "select uid, full_name, email, language, user_type::text as role, is_demo from users where active"
        )
    }
    url = notify.app_url()
    sent = 0

    def send(uid: int, title: str, lines: list[str], link: str) -> None:
        nonlocal sent
        u = people.get(uid)
        if not u:
            return
        m = notify.msg_solar_report(u["full_name"], title, lines, url + link, u["language"] or "en")
        try:
            notify.notify(uid, "solar_report", m["title"], m["body"], link=link,
                          email=(u["email"], *m["email"]) if u["email"] else None)  # fmt: skip
            sent += 1
        except Exception as exc:  # one person's report mustn't stop the others
            print(f"[solar report] couldn't send to {uid}: {exc}")

    # Each homeowner: their own plant.
    for p in plants:
        kwh = this.get(p["station_code"])
        if not p["homeowner_id"] or kwh is None:
            continue
        lines = [f"Your solar made {kwh:,.0f} kWh in {label}."]
        if (b := before.get(p["station_code"])) and b > 0:
            change = (kwh - b) / b * 100
            lines.append(
                f"That's {abs(change):.0f}% {'more' if change >= 0 else 'less'} than {month.replace(year=month.year - 1).strftime('%B %Y')}."
            )
        if cents:
            lines.append(
                f"At SP's tariff ({cents:.2f} cents per kWh), that much electricity costs S${kwh * cents / 100:,.2f}."
            )
        send(p["homeowner_id"], f"Your solar in {label}", lines, "/my-solar?tab=energy")

    # Each manager: the plants they run; a superadmin: every plant.
    def summary(mine: list[dict[str, Any]]) -> list[str]:
        made = [(p, this[p["station_code"]]) for p in mine if p["station_code"] in this]
        total = sum(k for _, k in made)
        lines = [f"Your {len(made)} plants made {total:,.0f} kWh in {label}."]
        sized = sorted(((k / float(p["kwp"]), p["name"]) for p, k in made if p["kwp"]), reverse=True)
        if len(sized) >= 2:
            lines.append(
                f"Most for its size: {sized[0][1]} ({sized[0][0]:.0f} kWh per kWp). Least: {sized[-1][1]} ({sized[-1][0]:.0f} kWh per kWp)."
            )
        return lines

    for uid, u in people.items():
        if u["is_demo"] or u["role"] not in ("project_manager", "superadmin"):
            continue
        mine = plants if u["role"] == "superadmin" else [p for p in plants if p["run_by"] == uid]
        if any(p["station_code"] in this for p in mine):
            send(uid, f"Solar in {label}", summary(mine), "/solar?tab=report")
    return {"month": label, "sent": sent}
