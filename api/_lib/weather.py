"""Singapore's weather, from NEA on data.gov.sg (public; nothing about customers is sent): the 2-hour
forecast for each of its 47 areas, and the air temperature at each weather station. A plant shows its
nearest area's forecast and nearest station's temperature (docs/solar.md).

The sync (solar_sync.run) keeps the latest in solar_sync under "weather", every 30 minutes; screens read
that, so a visitor never waits on data.gov.sg.
"""

from __future__ import annotations

import json
import math
import urllib.request
from datetime import datetime, timedelta
from typing import Any

from _lib import demo
from _lib.db import fetch_one, transaction

FORECAST = "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast"
TEMPERATURE = "https://api-open.data.gov.sg/v2/real-time/api/air-temperature"
KEY = "weather"
STALE = timedelta(hours=3)


def _get(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "GetHomeApps (9 Solar Home)"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read()).get("data") or {}


def fetch() -> dict[str, Any]:
    """The latest forecast and temperatures, in the shape kept in solar_sync."""
    f = _get(FORECAST)
    item = (f.get("items") or [{}])[0]
    said = {x["area"]: x["forecast"] for x in item.get("forecasts") or []}
    areas = [
        {
            "name": a["name"],
            "lat": a["label_location"]["latitude"],
            "lng": a["label_location"]["longitude"],
            "forecast": said.get(a["name"]),
        }
        for a in f.get("area_metadata") or []
    ]
    t = _get(TEMPERATURE)
    reading = (t.get("readings") or [{}])[0]
    values = {x["stationId"]: x["value"] for x in reading.get("data") or []}
    stations = [
        {
            "name": s["name"],
            "lat": s["location"]["latitude"],
            "lng": s["location"]["longitude"],
            "c": values.get(s["id"]),
        }
        for s in t.get("stations") or []
        if values.get(s["id"]) is not None
    ]
    period = item.get("valid_period") or {}
    return {
        "areas": areas,
        "valid": period.get("text"),
        "updated": item.get("update_timestamp") or item.get("timestamp"),
        "stations": stations,
        "temperatureAt": reading.get("timestamp"),
    }


def save(now: datetime) -> int:
    data = fetch()
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_sync (key, value, at) values (%s, %s, %s) "
            "on conflict (key) do update set value = excluded.value, at = excluded.at",
            (KEY, json.dumps(data), now),
        )
    return len(data["areas"])


def _nearest(items: list[dict[str, Any]], lat: float, lng: float) -> dict[str, Any] | None:
    # Equirectangular distance: Singapore is small enough for it.
    def d(x: dict[str, Any]) -> float:
        return math.hypot((x["lat"] - lat) * 111.0, (x["lng"] - lng) * 111.0 * math.cos(math.radians(lat)))

    return min(items, key=d) if items else None


def for_place(lat: float | None, lng: float | None, now: datetime) -> dict[str, Any] | None:
    """The weather where a plant is: its area's forecast and the nearest temperature. None without a place,
    or when the last fetch is over 3 hours old."""
    if lat is None or lng is None:
        return None
    row = fetch_one("select value, at from solar_sync where key = %s", (KEY,))
    # The demo has no sync to refresh it: its seeded weather stands.
    if not row or not row["value"] or (now - row["at"] > STALE and not demo.enabled()):
        return None
    w = row["value"]
    area = _nearest([a for a in w.get("areas") or [] if a.get("forecast")], float(lat), float(lng))
    station = _nearest(w.get("stations") or [], float(lat), float(lng))
    if not area and not station:
        return None
    return {
        "area": area["name"] if area else None,
        "forecast": area["forecast"] if area else None,
        "valid": w.get("valid"),
        "temperatureC": station["c"] if station else None,
        "station": station["name"] if station else None,
        "at": row["at"].isoformat(),
    }
