"""Huawei FusionSolar's Northbound API: the plants, their output, inverters and alarms.

Settings (never shown, never in the browser):

  FUSIONSOLAR_URL        the address FusionSolar's web page is on, e.g. https://sg5.fusionsolar.huawei.com
  FUSIONSOLAR_USER       a Northbound API account (FusionSolar → System → Company Management →
  FUSIONSOLAR_PASSWORD   Northbound Management), not a person's own login

Every call is a POST with JSON. Logging in gives a token (good for about 30 minutes) that goes
back in the XSRF-TOKEN header; it's kept in solar_sync so each run of the job doesn't log in
again (FusionSolar limits logins). FusionSolar also limits how often each kind of call can be
made: a "too frequent" answer (failCode 407) is a RateLimitedError error, and the sync tries that
kind again on its next run.

The API's own names stay here; the rest of the app gets plain dicts (see solar_sync.py).
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Any

from _lib.auth import env
from _lib.db import fetch_one, transaction

TOKEN_KEY = "token"
TOKEN_LIFE = 25 * 60  # seconds; FusionSolar's lasts about 30 minutes
NOT_LOGGED_IN = {305, 306}  # the session ended: log in again and retry once
TOO_OFTEN = {407, 20004, 20618}


class FusionSolarError(Exception):
    """FusionSolar refused or failed; the message says what it said."""


class NotConfiguredError(FusionSolarError):
    pass


class RateLimitedError(FusionSolarError):
    pass


def configured() -> bool:
    return bool(env("FUSIONSOLAR_URL") and env("FUSIONSOLAR_USER") and env("FUSIONSOLAR_PASSWORD"))


def _base() -> str:
    url = (env("FUSIONSOLAR_URL") or "").strip().rstrip("/")
    if not url.startswith("https://"):
        raise NotConfiguredError("FUSIONSOLAR_URL isn't set (the https:// address of FusionSolar's web page).")
    return url


def _post(
    path: str, body: dict[str, Any], token: str | None, timeout: float = 30
) -> tuple[dict[str, Any], dict[str, str]]:
    req = urllib.request.Request(
        _base() + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **({"XSRF-TOKEN": token} if token else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            headers = {k.lower(): v for k, v in res.headers.items()}
            cookies = res.headers.get_all("Set-Cookie") or []
            for c in cookies:
                name, _, rest = c.partition("=")
                if name.strip().lower() == "xsrf-token":
                    headers["xsrf-token"] = rest.split(";", 1)[0]
            data = json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raise FusionSolarError(f"FusionSolar answered {exc.code} to {path}.") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise FusionSolarError(f"Couldn't reach FusionSolar ({exc}).") from exc
    return data, headers


def _login() -> str:
    user, password = env("FUSIONSOLAR_USER"), env("FUSIONSOLAR_PASSWORD")
    if not (user and password):
        raise NotConfiguredError("FUSIONSOLAR_USER and FUSIONSOLAR_PASSWORD aren't set.")
    data, headers = _post("/thirdData/login", {"userName": user, "systemCode": password}, None)
    token = headers.get("xsrf-token")
    if not data.get("success") or not token:
        code = data.get("failCode")
        if code in TOO_OFTEN:
            raise RateLimitedError("FusionSolar: too many logins just now; trying again on the next run.")
        raise FusionSolarError(f"FusionSolar didn't accept the API account (failCode {code}).")
    with transaction(None) as cur:
        cur.execute(
            "insert into solar_sync (key, value, at) values (%s, %s, now()) "
            "on conflict (key) do update set value = excluded.value, at = now()",
            (TOKEN_KEY, json.dumps({"token": token, "until": time.time() + TOKEN_LIFE})),
        )
    return token


def _token() -> str:
    row = fetch_one("select value from solar_sync where key = %s", (TOKEN_KEY,))
    v = row["value"] if row else None
    if v and v.get("token") and v.get("until", 0) > time.time():
        return str(v["token"])
    return _login()


def call(path: str, body: dict[str, Any], timeout: float = 30) -> Any:
    """One Northbound call; returns its "data". Logs in (again) when needed. ``timeout`` is in seconds."""
    if not configured():
        raise NotConfiguredError("FusionSolar isn't connected yet (docs/solar.md).")
    token = _token()
    for attempt in (1, 2):
        data, _ = _post(path, body, token, timeout)
        if data.get("success"):
            return data.get("data")
        code = data.get("failCode")
        if code in NOT_LOGGED_IN and attempt == 1:
            token = _login()
            continue
        if code in TOO_OFTEN:
            raise RateLimitedError(f"FusionSolar: {path} was called too often; trying again on the next run.")
        raise FusionSolarError(f"FusionSolar refused {path} (failCode {code}: {data.get('message') or ''}).")
    raise FusionSolarError(f"FusionSolar refused {path}.")


# ------------------------------------------------------------------ what the app asks for


def _ms(d: datetime) -> int:
    return int(d.timestamp() * 1000)


def plants() -> list[dict[str, Any]]:
    """Every plant the API account can see."""
    out: list[dict[str, Any]] = []
    page = 1
    while True:
        data = call("/thirdData/stations", {"pageNo": page}) or {}
        rows = data.get("list") or []
        out.extend(rows)
        if page >= int(data.get("pageCount") or 1) or not rows:
            return out
        page += 1


def live(codes: list[str], timeout: float = 30) -> list[dict[str, Any]]:
    """Each plant's figures now: today's, this month's and the total yield, income, health."""
    out: list[dict[str, Any]] = []
    for i in range(0, len(codes), 100):
        out.extend(call("/thirdData/getStationRealKpi", {"stationCodes": ",".join(codes[i : i + 100])}, timeout) or [])
    return out


KPI_PATH = {
    "hour": "/thirdData/getKpiStationHour",
    "day": "/thirdData/getKpiStationDay",
    "month": "/thirdData/getKpiStationMonth",
    "year": "/thirdData/getKpiStationYear",
}


def history(period: str, codes: list[str], when: datetime) -> list[dict[str, Any]]:
    """Yield and income by hour (for a day), by day (for a month), by month (for a year) or by year."""
    out: list[dict[str, Any]] = []
    for i in range(0, len(codes), 100):
        body = {"stationCodes": ",".join(codes[i : i + 100]), "collectTime": _ms(when)}
        out.extend(call(KPI_PATH[period], body) or [])
    return out


def devices(codes: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i in range(0, len(codes), 100):
        out.extend(call("/thirdData/getDevList", {"stationCodes": ",".join(codes[i : i + 100])}) or [])
    return out


def device_live(dev_ids: list[int], type_id: int, timeout: float = 30) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i in range(0, len(dev_ids), 100):
        body = {"devIds": ",".join(str(d) for d in dev_ids[i : i + 100]), "devTypeId": type_id}
        out.extend(call("/thirdData/getDevRealKpi", body, timeout) or [])
    return out


def five_minutes(dev_ids: list[int], type_id: int, day: datetime) -> list[dict[str, Any]]:
    """Each inverter's readings every 5 minutes through ``day`` (FusionSolar takes 10 at a time)."""
    out: list[dict[str, Any]] = []
    for i in range(0, len(dev_ids), 10):
        body = {"devIds": ",".join(str(d) for d in dev_ids[i : i + 10]), "devTypeId": type_id, "collectTime": _ms(day)}
        out.extend(call("/thirdData/getDevFiveMinutes", body) or [])
    return out


DEVICE_KPI_PATH = {
    "day": "/thirdData/getDevKpiDay",
    "month": "/thirdData/getDevKpiMonth",
    "year": "/thirdData/getDevKpiYear",
}


def device_history(period: str, dev_ids: list[int], type_id: int, when: datetime) -> list[dict[str, Any]]:
    """Each inverter's kWh by day (of ``when``'s month), month (of its year) or year: FusionSolar's device report."""
    out: list[dict[str, Any]] = []
    for i in range(0, len(dev_ids), 50):
        body = {"devIds": ",".join(str(d) for d in dev_ids[i : i + 50]), "devTypeId": type_id, "collectTime": _ms(when)}
        out.extend(call(DEVICE_KPI_PATH[period], body) or [])
    return out


def alarms(codes: list[str], since: datetime, until: datetime | None = None) -> list[dict[str, Any]]:
    until = until or datetime.now(UTC)
    out: list[dict[str, Any]] = []
    for i in range(0, len(codes), 100):
        body = {
            "stationCodes": ",".join(codes[i : i + 100]),
            "beginTime": _ms(since),
            "endTime": _ms(until),
            "language": "en_US",
        }
        out.extend(call("/thirdData/getAlarmList", body) or [])
    return out
