"""Addresses as people read them: "124 Westwood Crescent, Singapore 648815", once.

The app keeps a street address and its postal code apart (projects, maintenance systems, people), so a
screen shows each once. FusionSolar's plant address is one untidy string: the country and region run
into the street ("SingaporeSingapore124 WESTWOOD CRESCENT"), and the postal code or the street often
comes twice at the end (", Singapore 648815648815"). tidy() makes that one line; a plant linked to a
system shows the system's own address instead (one_line).
"""

from __future__ import annotations

import re

# "Singapore", "SingaporeSingapore", "Singapore, Singapore " in front (the country, region and city).
_LEADING = re.compile(r"^(?:(?:Singapore|SINGAPORE|singapore)(?:[\s,]+|(?=[A-Z0-9#])))+")
# The street's name (and district) run into the full address: "Jalan Raya9-9 Jalan Raya" is "9-9 Jalan Raya".
_STREET_FIRST = re.compile(r"^([A-Za-z][A-Za-z .'-]*?)\s*(?=\d)")
# The postal code where FusionSolar writes it: "…, Singapore 648815" (anything after is a repeat).
_POSTAL_SAID = re.compile(r"[\s,]*\bsingapore[\s,]*\(?(\d{6})", re.IGNORECASE)
# Or just at the end, perhaps twice: "… 648815" / "… 648815648815".
_POSTAL_END = re.compile(r"[\s,]*\(?(\d{6})\)?(?:\1)?\s*$")


# A postal code typed at the end of a street: ", Singapore 648815", " S(648815)", " 648815".
_TRAILING_POSTAL = re.compile(r"[\s,]*(?:singapore[\s,]*)?\(?\d{6}\)?\s*$", re.IGNORECASE)
_TRAILING_S = re.compile(r"[\s,]+\(?S\)?\s*\(?\d{6}\)?\s*$", re.IGNORECASE)
_TRAILING_COUNTRY = re.compile(r"[\s,]+singapore\s*$", re.IGNORECASE)


def street(raw: str | None) -> str:
    """The street part only, as the app keeps it beside its postal code: what's typed or imported as
    "Singapore 124 Westwood Crescent, Singapore 648815" is "124 Westwood Crescent"."""
    s = re.sub(r"\s+", " ", (raw or "").strip())
    s = _LEADING.sub("", s) or s
    s = _TRAILING_COUNTRY.sub("", _TRAILING_POSTAL.sub("", _TRAILING_S.sub("", s))) or s
    return s.strip(" ,")


def one_line(street: str | None, postal: str | None) -> str:
    """ "124 Westwood Crescent, Singapore 648815"; just the street without a postal code."""
    s = re.sub(r"\s+", " ", (street or "").strip(" ,"))
    return f"{s}, Singapore {postal}" if s and postal else s or (f"Singapore {postal}" if postal else "")


def tidy(raw: str | None) -> str:
    """FusionSolar's address as one clean line: no country in front, the postal code once, no repeats."""
    s = re.sub(r"\s+", " ", (raw or "").strip())
    if not s:
        return ""
    s = _LEADING.sub("", s) or s
    first = _STREET_FIRST.match(s)
    if first:
        # The district may be run in too ("BedokJalan Raya9-9 Jalan Raya"): the street is the last word run.
        street = re.split(r"(?<=[a-z])(?=[A-Z])", first.group(1).strip())[-1]
        if street.lower() in s[first.end() :].lower():
            s = s[first.end() :]
    m = _POSTAL_SAID.search(s) or _POSTAL_END.search(s)
    if m:
        return one_line(s[: m.start()], m.group(1))
    # No postal code: the street may still come twice ("12 Jalan Kayu12 Jalan Kayu").
    half = len(s) // 2
    if len(s) % 2 == 0 and s[:half] == s[half:]:
        s = s[:half]
    return one_line(s, None)
