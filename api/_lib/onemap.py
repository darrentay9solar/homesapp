"""Geocoding against OneMap, Singapore's official map service (run by SLA).

Used when an address or postal code is saved — never during a check-in:
OneMap rate-limits hard, and a crew on a roof should not depend on it.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
SG_POSTAL = re.compile(r"^\d{6}$")


class GeocodeError(Exception):
    def __init__(self, message: str, reason: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason  # not_found | ambiguous | rate_limited | unreachable | invalid_query
        self.hint = hint

    def for_people(self) -> str:
        return f"{self}{' ' + self.hint if self.hint else ''}"


@dataclass
class Location:
    address: str
    postal_code: str | None
    lat: float
    lng: float


def _search(query: str, attempt: int = 0) -> list[dict]:
    url = f"{SEARCH_URL}?" + urllib.parse.urlencode(
        {"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1}
    )
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "gethomeapps"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read()).get("results") or []
    except urllib.error.HTTPError as exc:
        if exc.code == 429 and attempt < 3:
            time.sleep(2**attempt)
            return _search(query, attempt + 1)
        if exc.code == 429:
            raise GeocodeError("OneMap is busy. Try again in a minute.", "rate_limited") from exc
        raise GeocodeError(f"OneMap returned {exc.code}.", "unreachable") from exc
    except OSError as exc:
        raise GeocodeError(f"Could not reach OneMap: {exc}", "unreachable") from exc


def geocode(query: str) -> Location:
    q = query.strip()
    if len(q) < 3:
        raise GeocodeError("Enter a postal code or address.", "invalid_query")
    results = [r for r in _search(q) if r.get("LATITUDE") and r.get("LONGITUDE")]
    if SG_POSTAL.match(q):
        # Postal codes identify one building; ignore any fuzzy neighbours.
        results = [r for r in results if r.get("POSTAL") == q] or []
    if not results:
        raise GeocodeError(
            f'OneMap found nothing for "{q}".',
            "not_found",
            "Check the postal code is correct." if SG_POSTAL.match(q) else "Try the 6-digit postal code instead.",
        )
    first = results[0]
    spread = any(
        abs(float(r["LATITUDE"]) - float(first["LATITUDE"])) > 0.0005
        or abs(float(r["LONGITUDE"]) - float(first["LONGITUDE"])) > 0.0005
        for r in results
    )
    if spread and not SG_POSTAL.match(q):
        raise GeocodeError(
            f'"{q}" matched {len(results)} different places.',
            "ambiguous",
            "Use the 6-digit postal code — it identifies one building.",
        )
    postal = first.get("POSTAL")
    return Location(
        address=first.get("ADDRESS") or first.get("SEARCHVAL") or q,
        postal_code=postal if postal and postal != "NIL" else None,
        lat=float(first["LATITUDE"]),
        lng=float(first["LONGITUDE"]),
    )


def resolve(address: str | None, postal_code: str | None) -> Location:
    """Fills in whichever of address / postal code is missing. Postal code wins."""
    address = (address or "").strip() or None
    postal_code = (postal_code or "").strip() or None
    if not address and not postal_code:
        raise GeocodeError("Enter either an address or a postal code.", "invalid_query")
    if postal_code and not SG_POSTAL.match(postal_code):
        raise GeocodeError(f'"{postal_code}" is not a 6-digit Singapore postal code.', "invalid_query")
    loc = geocode(postal_code or address or "")
    if not loc.postal_code:
        loc.postal_code = postal_code
    return loc
