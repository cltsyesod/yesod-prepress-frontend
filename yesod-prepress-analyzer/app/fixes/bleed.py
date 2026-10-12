"""Bleed generated from the artwork's own edge.

The page content becomes a form XObject drawn once, unchanged, inside the area it
already covered (the old bleed, or the trim when there was none). Around it, in a
3 × 3 grid, the same form is drawn again with a transform that fills the missing
strip outside that area:

- ``stretch``: the last slice of the artwork (0.1 mm at final size) is stretched
  over the strip, so flat colours and gradients simply continue;
- ``mirror``: the artwork is reflected across the edge, so photos continue without
  a visible smear.

Everything stays vector and in its original colour spaces; nothing inside the trim
changes, and nothing is drawn over the artwork: the strips only cover area outside
what the client's file already printed.
"""

from __future__ import annotations

from dataclasses import dataclass

import pikepdf

from app.fixes.geometry import Box

STRETCH = "stretch"
MIRROR = "mirror"
METHODS = (STRETCH, MIRROR)

_SEAM = 0.05  # pt: strips reach slightly under the original so no hairline shows between them


def _num(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


@dataclass(frozen=True)
class Band:
    """One column (or row) of the grid: its range and the 1-D transform x' = a·x + e."""

    lo: float
    hi: float
    a: float
    e: float


def bands(
    base_lo: float, base_hi: float, want_lo: float, want_hi: float, method: str, slice_pt: float
) -> list[Band]:
    """Ranges along one axis: the missing strip before, the original, the strip after."""

    out = [Band(base_lo, base_hi, 1.0, 0.0)]
    width = base_lo - want_lo
    if width > 0.01:
        if method == MIRROR:
            out.insert(0, Band(want_lo, base_lo, -1.0, 2 * base_lo))
        else:
            # [base_lo, base_lo + s] → [want_lo, base_lo]
            a = width / slice_pt
            out.insert(0, Band(want_lo, base_lo, a, want_lo - base_lo * a))
    width = want_hi - base_hi
    if width > 0.01:
        if method == MIRROR:
            out.append(Band(base_hi, want_hi, -1.0, 2 * base_hi))
        else:
            # [base_hi - s, base_hi] → [base_hi, want_hi]
            a = width / slice_pt
            out.append(Band(base_hi, want_hi, a, base_hi - (base_hi - slice_pt) * a))
    return out


def _artwork_form(pdf: pikepdf.Pdf, page: pikepdf.Page, visible: Box) -> pikepdf.Object:
    """The page's current drawing as a form XObject: same bytes, same resources, and a
    BBox covering the whole visible page (not just the trim), so the old bleed is kept."""

    page.contents_coalesce()
    data = page.obj.Contents.read_bytes() if "/Contents" in page.obj else b""
    resources = page.resources
    return pdf.make_stream(
        data,
        Type=pikepdf.Name.XObject,
        Subtype=pikepdf.Name.Form,
        BBox=pikepdf.Array([round(v, 4) for v in visible]),
        Resources=resources,
    )


def extend_page(
    pdf: pikepdf.Pdf,
    page: pikepdf.Page,
    base: Box,
    wanted: Box,
    visible: Box,
    method: str,
    slice_pt: float,
) -> bool:
    """Redraw the page so the artwork in ``base`` also fills ``wanted``. False if nothing to do."""

    xs = bands(base[0], base[2], wanted[0], wanted[2], method, slice_pt)
    ys = bands(base[1], base[3], wanted[1], wanted[3], method, slice_pt)
    if len(xs) == 1 and len(ys) == 1:
        return False
    form = _artwork_form(pdf, page, visible)
    page.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(YesodArt=form))
    ops: list[str] = []
    for bx in xs:
        for by in ys:
            if bx.a == 1.0 and bx.e == 0.0 and by.a == 1.0 and by.e == 0.0:
                continue
            # Reach a hair under the original, which is drawn last and covers the overlap.
            x0 = bx.lo if bx.lo < base[0] else bx.lo - _SEAM
            x1 = bx.hi if bx.hi > base[2] else bx.hi + _SEAM
            y0 = by.lo if by.lo < base[1] else by.lo - _SEAM
            y1 = by.hi if by.hi > base[3] else by.hi + _SEAM
            ops.append(
                f"q {_num(x0)} {_num(y0)} {_num(x1 - x0)} {_num(y1 - y0)} re W n "
                f"{_num(bx.a)} 0 0 {_num(by.a)} {_num(bx.e)} {_num(by.e)} cm /YesodArt Do Q"
            )
    x0, y0, x1, y1 = base
    ops.append(f"q {_num(x0)} {_num(y0)} {_num(x1 - x0)} {_num(y1 - y0)} re W n /YesodArt Do Q")
    page.obj.Contents = pdf.make_stream(("\n".join(ops) + "\n").encode())
    return True
