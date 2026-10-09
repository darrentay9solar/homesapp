# ruff: noqa: RUF001  (the multiplication sign is meant)
"""UAT · the installation certificate the homeowner signs, and the signature itself.

The certificate is filled from the project; its fingerprint changes if
anything on it changes and never otherwise; the PDF is a valid one-page
document carrying the signature, the signer, the time and the fingerprint.
A signature must be a real drawing (a JPEG of sensible size), not a tap.
"""

from __future__ import annotations

import itertools
import re
import zlib
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from _lib import certificate

pytestmark = pytest.mark.uat

FIX = Path(__file__).resolve().parents[1] / "fixtures"
SIG = (FIX / "signature.jpg").read_bytes()
BASE = {
    "project_id": 42,
    "name": "Jalan Kayu Residence",
    "address": "14 Jalan Kayu",
    "postal_code": "799463",
    "h_name": "Jasmine Lee",
    "homeowner_name": None,
    "panel_quantity_actual": 20,
    "panel_quantity_estimate": 18,
    "panel_capacity": 610,
    "inverter_to_order": "Huawei SUN2000-10KTL-M1",
    "inverter_serial_number": "HW2K-10KTL-8843921",
    "installation_end_date": date(2026, 10, 2),
    "inverter_commission_grid_connection": True,
    "commission_date": None,
    "sp_turn_on_inspection_date": date(2026, 10, 6),
    "retailer_name": "SP Group",
}


def build(**over):
    return certificate.build({**BASE, **over}, contractor="Apex Solar Contractors", manager="Charlotte Sim")


def test_the_certificate_reads_like_the_project() -> None:
    rows = dict(build()["rows"])
    assert rows == {
        "Project": "Jalan Kayu Residence",
        "Site": "14 Jalan Kayu, Singapore 799463",
        "Homeowner": "Jasmine Lee",
        "Solar panels": "20 × 610 W",
        "System size": "12.20 kWp",
        "Inverter": "Huawei SUN2000-10KTL-M1",
        "Inverter serial number": "HW2K-10KTL-8843921",
        "Installation completed": "02 Oct 2026",
        "Grid connection": "Connected",
        "SP turn-on inspection": "06 Oct 2026",
        "Electricity retailer": "SP Group",
        "Installed by": "Apex Solar Contractors",
        "Project manager": "Charlotte Sim",
    }
    assert build()["number"] == "GHA-000042"


PANELS = [(20, 18, 610, "20 × 610 W", "12.20 kWp"), (None, 18, 610, "18 × 610 W", "10.98 kWp"),
          (None, None, 610, "—", "—"), (24, None, None, "24", "—"), (1, 1, 1, "1 × 1 W", "0.00 kWp"),
          (36, 30, 455, "36 × 455 W", "16.38 kWp"), (12, 12, 400, "12 × 400 W", "4.80 kWp")]  # fmt: skip


@pytest.mark.parametrize(("actual", "est", "watts", "panels", "size"), PANELS)
def test_panels_and_system_size(actual, est, watts, panels, size) -> None:
    rows = dict(build(panel_quantity_actual=actual, panel_quantity_estimate=est, panel_capacity=watts)["rows"])
    assert (rows["Solar panels"], rows["System size"]) == (panels, size)


@pytest.mark.parametrize(
    ("connected", "when", "want"),
    [
        (True, None, "Connected"),
        (True, date(2026, 11, 1), "Connected"),
        (False, date(2026, 11, 1), "Scheduled for 01 Nov 2026"),
        (False, None, "—"),
        (None, None, "—"),
    ],  # fmt: skip
)
def test_grid_connection(connected, when, want) -> None:
    rows = dict(build(inverter_commission_grid_connection=connected, commission_date=when)["rows"])
    assert rows["Grid connection"] == want


@pytest.mark.parametrize(
    ("over", "row", "want"),
    [
        ({"postal_code": None}, "Site", "14 Jalan Kayu"),
        ({"address": None, "postal_code": None}, "Site", "—"),
        ({"h_name": None, "homeowner_name": "Typed Name"}, "Homeowner", "Typed Name"),
        ({"h_name": None}, "Homeowner", "—"),
        ({"inverter_serial_number": None}, "Inverter serial number", "—"),
        ({"installation_end_date": None}, "Installation completed", "—"),
        ({"retailer_name": None}, "Electricity retailer", "—"),
    ],
)
def test_missing_values_show_a_dash(over, row, want) -> None:
    assert dict(build(**over)["rows"])[row] == want


CHANGES = [(k, v) for k, v in [
    ("name", "Another Name"), ("address", "15 Jalan Kayu"), ("postal_code", "799464"), ("h_name", "Someone Else"),
    ("panel_quantity_actual", 21), ("panel_capacity", 615), ("inverter_to_order", "SMA"),
    ("inverter_serial_number", "X"), ("installation_end_date", date(2026, 10, 3)),
    ("inverter_commission_grid_connection", False), ("sp_turn_on_inspection_date", date(2026, 10, 7)),
    ("retailer_name", "Geneco"), ("project_id", 43),
]]  # fmt: skip


@pytest.mark.parametrize(("key", "value"), CHANGES)
def test_any_change_on_the_certificate_changes_its_fingerprint(key, value) -> None:
    assert certificate.fingerprint(build(**{key: value})) != certificate.fingerprint(build())


@pytest.mark.parametrize("key", ["commission_date", "panel_quantity_estimate", "something_else"])
def test_what_isnt_on_the_certificate_doesnt_change_it(key) -> None:
    other = {"commission_date": date(2030, 1, 1), "panel_quantity_estimate": 99, "something_else": "x"}[key]
    assert certificate.fingerprint(build(**{key: other})) == certificate.fingerprint(build())


def test_the_fingerprint_is_stable_and_sha256() -> None:
    fp = certificate.fingerprint(build())
    assert re.fullmatch(r"[0-9a-f]{64}", fp) and fp == certificate.fingerprint(build())


# ------------------------------------------------------------------- the PDF

SIGNERS = ["Jasmine Lee", "Tan (Ah Kow)", "O'Brien \\ Back", "陈美玲", "Zoë Müller", "A" * 120]
SIGS = ["signature.jpg", "signature-grey.jpg", "signature-progressive.jpg", "signature-tall.jpg",
        "signature-wide.jpg", "signature-edge.jpg", "signature-short.jpg"]  # fmt: skip


def _objects(pdf: bytes) -> tuple[list[int], int]:
    xref = int(pdf.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
    lines = pdf[xref:].split(b"\n")
    count = int(lines[1].split()[1])
    return [int(x.split()[0]) for x in lines[3 : 2 + count]], xref


@pytest.mark.parametrize(("signer", "sig"), list(itertools.product(SIGNERS, SIGS)))
def test_the_signed_pdf(signer, sig) -> None:
    image = (FIX / sig).read_bytes()
    cert = build()
    fp = certificate.fingerprint(cert)
    pdf = certificate.pdf(cert, signature=image, signer=signer, signed_at=datetime(2026, 10, 8, 2, 5, tzinfo=UTC),
                          fingerprint_hex=fp)  # fmt: skip
    assert pdf.startswith(b"%PDF-1.4") and pdf.endswith(b"%%EOF\n")
    offsets, xref = _objects(pdf)
    for n, off in enumerate(offsets, start=1):
        assert pdf[off:].startswith(b"%d 0 obj" % n), "every object is where the index says"
    assert image in pdf, "the signature is embedded as drawn"
    page = zlib.decompress(pdf.split(b"/FlateDecode >>\nstream\n", 1)[1].split(b"\nendstream", 1)[0]).decode("latin-1")
    assert fp in page and "08 Oct 2026, 10:05 Singapore time" in page
    assert "Certificate no. GHA-000042" in page
    assert b"/Count 1" in pdf, "one page"
    w, h, comps = certificate.jpeg_size(image)
    assert (b"/Width %d /Height %d" % (w, h)) in pdf
    assert (b"/DeviceGray" in pdf) == (comps == 1)


@pytest.mark.parametrize(
    ("name", "ok"),
    [
        ("signature.jpg", True),
        ("signature-grey.jpg", True),
        ("signature-progressive.jpg", True),
        ("signature-tall.jpg", True),
        ("signature-wide.jpg", False),
        ("signature-edge.jpg", True),
        ("signature-short.jpg", False),
        ("signature-tiny.jpg", False),
        ("signature-big.jpg", True),
    ],  # fmt: skip
)
def test_signature_images(name, ok) -> None:
    assert (certificate.check_signature((FIX / name).read_bytes()) is None) == ok


@pytest.mark.parametrize(
    ("data", "words"),
    [
        (b"", "Draw your signature"),
        (SIG + b"\0" * certificate.MAX_SIGNATURE_BYTES, "too large"),
        (b"\x89PNG\r\n\x1a\n" + b"0" * 200, "didn't come through"),
        (b"%PDF-1.4" + b"0" * 200, "didn't come through"),
        (SIG[: len(SIG) // 2], "didn't come through"),
        (b"\xff\xd8" + b"\0" * 100, "didn't come through"),
        (b"\xff\xd8\xff\xd9", "didn't come through"),
        (b"GIF89a" + b"0" * 100, "didn't come through"),
    ],
    ids=["empty", "too-large", "png", "pdf", "cut-short", "no-frame", "nothing-inside", "gif"],
)
def test_broken_signatures_are_refused(data, words) -> None:
    assert words in (certificate.check_signature(data) or "")


@pytest.mark.parametrize("name", [*SIGS, "signature-tiny.jpg", "signature-big.jpg"])
def test_jpeg_sizes_are_read(name) -> None:
    w, h, comps = certificate.jpeg_size((FIX / name).read_bytes())
    assert w > 0 and h > 0 and comps in (1, 3)
