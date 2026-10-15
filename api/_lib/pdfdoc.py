"""A small PDF writer for one-page documents (invoices, receipts): text, lines,
filled boxes and JPEG pictures, on A4.

Like the handover certificate (_lib/certificate.py) it writes the PDF itself,
with the standard Helvetica fonts, rather than adding a PDF library to the
serverless bundle. Those fonts cover Western European letters only; anything
else shows as "?". Text can be set left, right or centred: Helvetica's
published letter widths give its length.
"""

# ruff: noqa: E501, RUF001  (the width tables read better whole; the dashes are meant)
from __future__ import annotations

import zlib
from dataclasses import dataclass, field

from _lib.certificate import jpeg_size

A4 = (595.0, 842.0)

# Adobe's widths (thousandths of the size) for the printable ASCII letters, space to "~".
_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]


def clean(s: str) -> str:
    """What Helvetica can show: Western European letters; anything else is "?"."""
    raw = str(s).replace("—", "-").replace("–", "-").replace("×", "x").replace("→", "->").replace(" ", " ")
    return raw.encode("cp1252", "replace").decode("cp1252")


def width(s: str, size: float, bold: bool = False) -> float:
    table = _BOLD if bold else _REG
    return sum(table[ord(c) - 32] if 32 <= ord(c) <= 126 else 556 for c in clean(s)) * size / 1000


def wrap(s: str, size: float, room: float, bold: bool = False) -> list[str]:
    """Lines of at most ``room`` points, broken between words (a word longer than that is cut)."""
    out: list[str] = []
    for para in str(s).splitlines() or [""]:
        line = ""
        for word in para.split(" "):
            test = f"{line} {word}" if line else word
            if width(test, size, bold) <= room:
                line = test
                continue
            if line:
                out.append(line)
            while width(word, size, bold) > room and len(word) > 1:
                cut = len(word)
                while cut > 1 and width(word[:cut], size, bold) > room:
                    cut -= 1
                out.append(word[:cut])
                word = word[cut:]
            line = word
        out.append(line)
    return out


def _esc(s: str) -> str:
    return clean(s).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def hex_rgb(h: str, default: tuple[float, float, float] = (0.03, 0.55, 0.35)) -> tuple[float, float, float]:
    h = (h or "").lstrip("#")
    if len(h) != 6:
        return default
    try:
        return int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255
    except ValueError:
        return default


@dataclass
class Page:
    ops: list[str] = field(default_factory=list)
    images: list[bytes] = field(default_factory=list)

    def text(self, x: float, y: float, s: str, size: float = 10, *, bold: bool = False,
             rgb: tuple[float, float, float] = (0.1, 0.1, 0.1), align: str = "left") -> None:  # fmt: skip
        if align != "left":
            w = width(s, size, bold)
            x -= w if align == "right" else w / 2
        r, g, b = rgb
        self.ops.append(f"BT /{'F2' if bold else 'F1'} {size} Tf {r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} Td ({_esc(s)}) Tj ET")

    def line(self, x1: float, y1: float, x2: float, y2: float, *, rgb: tuple[float, float, float] = (0.85, 0.85, 0.85), w: float = 0.6) -> None:
        r, g, b = rgb
        self.ops.append(f"{r:.3f} {g:.3f} {b:.3f} RG {w} w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def box(self, x: float, y: float, w: float, h: float, rgb: tuple[float, float, float]) -> None:
        r, g, b = rgb
        self.ops.append(f"{r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f")

    def picture(self, jpeg: bytes, x: float, y: float, most_w: float, most_h: float) -> tuple[float, float] | None:
        """A JPEG fitted inside a box with its bottom-left at (x, y); its drawn size, or None if it isn't a JPEG."""
        size = jpeg_size(jpeg)
        if not size:
            return None
        w, h, _ = size
        scale = min(most_w / w, most_h / h)
        dw, dh = w * scale, h * scale
        self.images.append(jpeg)
        self.ops.append(f"q {dw:.1f} 0 0 {dh:.1f} {x:.1f} {y:.1f} cm /Im{len(self.images)} Do Q")
        return dw, dh


def render(page: Page, *, title: str) -> bytes:
    content = zlib.compress("\n".join(page.ops).encode("latin-1"))
    first_image = 7
    xobjects = " ".join(f"/Im{i + 1} {first_image + i} 0 R" for i in range(len(page.images)))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R "
        b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << " + xobjects.encode() + b" >> >> >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(content) + content + b"\nendstream",
    ]
    for img in page.images:
        w, h, comps = jpeg_size(img) or (1, 1, 3)
        space = b"/DeviceGray" if comps == 1 else b"/DeviceRGB"
        objects.append(
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 "
            b"/Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, space, len(img)) + img + b"\nendstream"
        )
    objects.append(b"<< /Title (" + _esc(title).encode("latin-1") + b") /Producer (GetHomeApps) >>")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, len(objects), xref)
    return bytes(out)
