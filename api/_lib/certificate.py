"""The handover (Installation) certificate: what the homeowner signs, and its PDF.

build() turns a project into the certificate as plain data, in a fixed order.
Its fingerprint (SHA-256 of that data, canonically encoded) is what the
homeowner's phone sends back when they sign: if anything on the certificate
changed while they were reading it, the fingerprints differ and the signature
is refused, so a signature always belongs to exactly what was on screen.

pdf() lays the signed certificate out on one A4 page with the signature
image. It writes the PDF itself (Helvetica, a JPEG drawn as-is) rather than
adding a PDF library to the serverless bundle; it needs nothing more. The
standard PDF fonts cover Western European letters only, so anything else
(a name in Chinese characters, say) shows as "?" in the PDF; the certificate
data kept with the signature in the database has it exactly.
"""

# ruff: noqa: RUF001  (the multiplication sign is meant)
from __future__ import annotations

import hashlib
import json
import textwrap
import zlib
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

SG = ZoneInfo("Asia/Singapore")
TITLE = "Installation Certificate"
ISSUER = "9 Solar Home"
STATEMENT = (
    "I confirm that the solar PV system described above has been installed at my property, "
    "that I have received the handover documents, and that I accept the installation as complete."
)
MAX_SIGNATURE_BYTES = 400 * 1024


def _d(x: date | None) -> str:
    return x.strftime("%d %b %Y") if x else "—"


def number(pid: int) -> str:
    return f"GHA-{pid:06d}"


def build(p: dict[str, Any], *, contractor: str, manager: str | None) -> dict[str, Any]:
    """The certificate for a project row (projects.* plus h_name, retailer_name)."""
    panels = p.get("panel_quantity_actual") or p.get("panel_quantity_estimate")
    watts = p.get("panel_capacity")
    kwp = f"{panels * watts / 1000:.2f} kWp" if panels and watts else "—"
    if p.get("inverter_commission_grid_connection"):
        grid = "Connected"
    elif p.get("commission_date"):
        grid = f"Scheduled for {_d(p['commission_date'])}"
    else:
        grid = "—"
    site = p.get("address") or "—"
    if p.get("postal_code"):
        site = f"{site}, Singapore {p['postal_code']}"
    rows = [
        ["Project", p.get("name") or "—"],
        ["Site", site],
        ["Homeowner", p.get("h_name") or p.get("homeowner_name") or "—"],
        ["Solar panels", f"{panels} × {watts} W" if panels and watts else (str(panels) if panels else "—")],
        ["System size", kwp],
        ["Inverter", p.get("inverter_to_order") or "—"],
        ["Inverter serial number", p.get("inverter_serial_number") or "—"],
        ["Installation completed", _d(p.get("installation_end_date"))],
        ["Grid connection", grid],
        ["SP turn-on inspection", _d(p.get("sp_turn_on_inspection_date"))],
        ["Electricity retailer", p.get("retailer_name") or "—"],
        ["Installed by", contractor or "—"],
        ["Project manager", manager or "—"],
    ]
    return {
        "title": TITLE,
        "issuer": ISSUER,
        "number": number(int(p["project_id"])),
        "rows": rows,
        "statement": STATEMENT,
    }


def fingerprint(cert: dict[str, Any]) -> str:
    raw = json.dumps(cert, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf8")).hexdigest()


# ------------------------------------------------------------------ JPEG


def jpeg_size(data: bytes) -> tuple[int, int, int] | None:
    """(width, height, colour components) of a baseline or progressive JPEG, or None if it isn't one."""
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if marker in (0xC0, 0xC1, 0xC2):
            h = int.from_bytes(data[i + 5 : i + 7], "big")
            w = int.from_bytes(data[i + 7 : i + 9], "big")
            comps = data[i + 9] if i + 9 < len(data) else 0
            return (w, h, comps) if w and h and comps in (1, 3) else None
        if length < 2:
            return None
        i += 2 + length
    return None


def check_signature(data: bytes) -> str | None:
    """Why this isn't a usable signature image, or None."""
    if not data:
        return "Draw your signature first."
    if len(data) > MAX_SIGNATURE_BYTES:
        return "The signature image is too large. Clear it and sign again."
    size = jpeg_size(data)
    if not size or b"\xff\xd9" not in data[-64:]:
        return "The signature didn't come through. Clear it and sign again."
    w, h, _ = size
    if not (100 <= w <= 4000 and 40 <= h <= 4000):
        return "The signature didn't come through. Clear it and sign again."
    return None


# ------------------------------------------------------------------- PDF


def _pdf_text(s: str) -> str:
    raw = s.replace("—", "-").replace("×", "x").replace("→", "->")
    raw = raw.encode("cp1252", "replace").decode("cp1252")
    return raw.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class _Page:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def text(self, x: float, y: float, s: str, size: float = 10, bold: bool = False, grey: float = 0) -> None:
        self.ops.append(
            f"BT /{'F2' if bold else 'F1'} {size} Tf {grey} {grey} {grey} rg {x:.1f} {y:.1f} Td ({_pdf_text(s)}) Tj ET"
        )

    def colour_text(self, x: float, y: float, s: str, size: float, rgb: tuple[float, float, float]) -> None:
        r, g, b = rgb
        self.ops.append(f"BT /F2 {size} Tf {r} {g} {b} rg {x:.1f} {y:.1f} Td ({_pdf_text(s)}) Tj ET")

    def line(self, x1: float, y1: float, x2: float, y2: float, grey: float = 0.8) -> None:
        self.ops.append(f"{grey} {grey} {grey} RG 0.6 w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def image(self, x: float, y: float, w: float, h: float) -> None:
        self.ops.append(f"q {w:.1f} 0 0 {h:.1f} {x:.1f} {y:.1f} cm /Im1 Do Q")


def pdf(cert: dict[str, Any], *, signature: bytes, signer: str, signed_at: datetime, fingerprint_hex: str) -> bytes:
    """One A4 page: the certificate, the statement, and the signature."""
    w_img, h_img, comps = jpeg_size(signature) or (1, 1, 3)
    pg = _Page()
    left, right, y = 56, 539, 780
    pg.colour_text(left, y, ISSUER.upper(), 10, (0.03, 0.55, 0.35))
    y -= 30
    pg.text(left, y, cert["title"], 22, bold=True)
    y -= 20
    pg.text(left, y, f"Certificate no. {cert['number']}", 10, grey=0.35)
    y -= 18
    pg.line(left, y, right, y)
    y -= 22
    for label, value in cert["rows"]:
        lines = textwrap.wrap(str(value), 58) or ["-"]
        pg.text(left, y, label, 10, grey=0.4)
        for i, ln in enumerate(lines[:3]):
            pg.text(210, y - i * 14, ln, 10.5, bold=True)
        y -= 14 * min(len(lines), 3) + 8
    y -= 6
    pg.line(left, y, right, y)
    y -= 22
    for ln in textwrap.wrap(cert["statement"], 92):
        pg.text(left, y, ln, 10.5)
        y -= 15
    y -= 14
    box_w = 220.0
    box_h = min(110.0, box_w * h_img / w_img)
    pg.image(left, y - box_h, box_w * min(1.0, (box_h * w_img / h_img) / box_w), box_h)
    y -= box_h + 6
    pg.line(left, y, left + 260, y, grey=0.3)
    y -= 14
    pg.text(left, y, f"{signer} (homeowner)", 10.5, bold=True)
    y -= 14
    when = signed_at.astimezone(SG).strftime("%d %b %Y, %H:%M") + " Singapore time"
    pg.text(left, y, f"Signed electronically in GetHomeApps on {when}", 9.5, grey=0.35)
    pg.text(left, 64, "Certificate fingerprint (SHA-256)", 7.5, grey=0.45)
    pg.text(left, 54, fingerprint_hex, 7.5, grey=0.2)
    pg.text(left, 40, "The fingerprint identifies exactly what was signed; any change to the certificate changes it.",
            7.5, grey=0.45)  # fmt: skip

    content = zlib.compress("\n".join(pg.ops).encode("latin-1"))
    space = "/DeviceGray" if comps == 1 else "/DeviceRGB"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R "
        b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 7 0 R >> >> >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(content) + content + b"\nendstream",
        (
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 "
            b"/Filter /DCTDecode /Length %d >>\nstream\n" % (w_img, h_img, space.encode(), len(signature))
        )
        + signature
        + b"\nendstream",
    ]
    title = _pdf_text(f"{cert['title']} {cert['number']}").encode("latin-1")
    objects.append(b"<< /Title (" + title + b") /Producer (GetHomeApps) >>")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        len(objects),
        xref,
    )
    return bytes(out)
