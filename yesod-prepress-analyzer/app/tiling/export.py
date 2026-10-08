"""Panel PDFs: each panel is a window on the untouched artwork.

The source page is placed once as a form XObject and every panel shows only its
printed rectangle (visible part + overlaps + outer bleed), at final size. Around
the printed area there is a blank margin with the crop marks, the overlap ticks
and the panel label: nothing is drawn over the artwork.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import pikepdf
from shapely.geometry import box

from app.contracts.tiling import Rect, TilingMarks, TilingTile
from app.core.exceptions import AnalyzerError

MM = 72 / 25.4
PDF_MAX_PT = 14_400  # 200 in: the largest page a PDF can describe


class TilingError(AnalyzerError):
    code = "TILING_FAILED"


@dataclass(slots=True)
class ArtFrame:
    """Where the artwork is in the file and how big it is at final size."""

    origin: tuple[float, float]
    """Lower-left corner of the finished format (TrimBox), in file points."""
    scale: float
    available: tuple[float, float, float, float]
    """Printable area of the page in art millimetres (the page can hold bleed)."""

    @property
    def width_mm(self) -> float:
        return self.available[2] - self.available[0]


def _box(page: pikepdf.Page, name: str):
    value = page.obj.get(name)
    if value is None or len(value) != 4:
        return None
    x0, y0, x1, y1 = (float(v) for v in value)
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def art_frame(page: pikepdf.Page, scale: float) -> ArtFrame:
    media = _box(page, "/MediaBox") or (0.0, 0.0, 612.0, 792.0)
    crop = _box(page, "/CropBox") or media
    visible = (
        max(media[0], crop[0]),
        max(media[1], crop[1]),
        min(media[2], crop[2]),
        min(media[3], crop[3]),
    )
    trim = _box(page, "/TrimBox") or visible
    to_mm = scale / MM
    return ArtFrame(
        origin=(trim[0], trim[1]),
        scale=scale,
        available=(
            (visible[0] - trim[0]) * to_mm,
            (visible[1] - trim[1]) * to_mm,
            (visible[2] - trim[0]) * to_mm,
            (visible[3] - trim[1]) * to_mm,
        ),
    )


def printed_area(tile: TilingTile, frame: ArtFrame) -> Rect:
    """The printed rectangle, limited to what the page actually contains."""

    a = frame.available
    x0, y0 = max(tile.printed.x, a[0]), max(tile.printed.y, a[1])
    x1 = min(tile.printed.x + tile.printed.w, a[2])
    y1 = min(tile.printed.y + tile.printed.h, a[3])
    if x1 - x0 <= 0.01 or y1 - y0 <= 0.01:
        raise TilingError(f"o painel {tile.number} fica fora da arte")
    return Rect(x=x0, y=y0, w=x1 - x0, h=y1 - y0)


def neighbours(tiles: list[TilingTile], reach_mm: float = 500.0) -> dict[int, dict[str, int]]:
    """Adjacent panel on each side (nearest one that shares part of the edge)."""

    result: dict[int, dict[str, int]] = {t.number: {} for t in tiles}
    for a in tiles:
        ax0, ay0 = a.visible.x, a.visible.y
        ax1, ay1 = ax0 + a.visible.w, ay0 + a.visible.h
        best: dict[str, tuple[float, int]] = {}
        for b in tiles:
            if b.number == a.number:
                continue
            bx0, by0 = b.visible.x, b.visible.y
            bx1, by1 = bx0 + b.visible.w, by0 + b.visible.h
            shares_y = min(ay1, by1) - max(ay0, by0) > 0.5
            shares_x = min(ax1, bx1) - max(ax0, bx0) > 0.5
            candidates = []
            if shares_y and -0.5 <= bx0 - ax1 <= reach_mm:
                candidates.append(("right", bx0 - ax1))
            if shares_y and -0.5 <= ax0 - bx1 <= reach_mm:
                candidates.append(("left", ax0 - bx1))
            if shares_x and -0.5 <= by0 - ay1 <= reach_mm:
                candidates.append(("top", by0 - ay1))
            if shares_x and -0.5 <= ay0 - by1 <= reach_mm:
                candidates.append(("bottom", ay0 - by1))
            for side, distance in candidates:
                if side not in best or distance < best[side][0]:
                    best[side] = (distance, b.number)
        result[a.number] = {side: number for side, (_, number) in best.items()}
    return result


def safe_file_name(name: str) -> str:
    """The operator's name, made safe for every file system (accents kept readable)."""

    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    plain = re.sub(r"[^A-Za-z0-9.\- ]+", " ", plain)
    return re.sub(r"[\s_]+", "_", plain).strip("._-")[:150] or "painel"


def _num(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def _text(value: str) -> str:
    safe = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return safe.encode("cp1252", "replace").decode("cp1252")


def _font(out: pikepdf.Pdf) -> pikepdf.Object:
    return out.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.Type1,
            BaseFont=pikepdf.Name.Helvetica,
            Encoding=pikepdf.Name.WinAnsiEncoding,
        )
    )


def build_panels(
    source: pikepdf.Pdf,
    page_index: int,
    frame: ArtFrame,
    tiles: list[TilingTile],
    marks: TilingMarks,
    title: str = "",
    total: int | None = None,
    sides: dict[int, dict[str, int]] | None = None,
) -> pikepdf.Pdf:
    """A PDF with one page per panel of `tiles` (in the order given)."""

    out = pikepdf.Pdf.new()
    src_page = source.pages[page_index]
    form = src_page.as_form_xobject(handle_transformations=False)
    # qpdf clips the form at the TrimBox; the bleed and the overlaps must stay printable.
    form.BBox = pikepdf.Array([float(v) for v in src_page.obj.MediaBox])
    art = out.copy_foreign(form)
    font = _font(out)
    total = total or len(tiles)
    sides = sides if sides is not None else neighbours(tiles)
    margin = marks.margin_mm * MM
    s = frame.scale

    for tile in tiles:
        printed = printed_area(tile, frame)
        width, height = printed.w * MM + 2 * margin, printed.h * MM + 2 * margin
        if max(width, height) > PDF_MAX_PT:
            raise TilingError(
                f"o painel {tile.number} ({printed.w:.0f} × {printed.h:.0f} mm) passa do limite "
                "de 5080 mm do PDF"
            )
        out.add_blank_page(page_size=(width, height))
        page = out.pages[-1]
        name = page.add_resource(art, pikepdf.Name.XObject, prefix="Art")
        pw, ph = printed.w * MM, printed.h * MM
        e = margin - printed.x * MM - frame.origin[0] * s
        f = margin - printed.y * MM - frame.origin[1] * s
        content = [
            f"q {_num(margin)} {_num(margin)} {_num(pw)} {_num(ph)} re W n "
            f"{_num(s)} 0 0 {_num(s)} {_num(e)} {_num(f)} cm {name} Do Q"
        ]
        trim = [margin, margin, margin + pw, margin + ph]
        page.obj.TrimBox = pikepdf.Array([round(v, 4) for v in trim])
        page.obj.BleedBox = pikepdf.Array([round(v, 4) for v in trim])
        if margin >= 2 * MM:
            content.append(_panel_marks(tile, printed, margin, marks, sides.get(tile.number, {})))
            if marks.label:
                font_name = page.add_resource(font, pikepdf.Name.Font, prefix="F")
                content.append(_panel_label(tile, printed, margin, font_name, title, total, sides))
        page.contents_add("\n".join(c for c in content if c).encode("cp1252", "replace"))
    return out


def _panel_marks(
    tile: TilingTile, printed: Rect, margin: float, marks: TilingMarks, side_of: dict[str, int]
) -> str:
    """Crop marks at the printed corners and ticks where the overlap starts, in the margin."""

    x0, y0 = margin, margin
    x1, y1 = margin + printed.w * MM, margin + printed.h * MM
    reach = min(5 * MM, margin * 0.6)
    gap = min(1.5 * MM, margin * 0.2)
    lines = []
    if marks.crop_marks:
        for x in (x0, x1):
            lines.append((x, y0 - gap, x, y0 - gap - reach))
            lines.append((x, y1 + gap, x, y1 + gap + reach))
        for y in (y0, y1):
            lines.append((x0 - gap, y, x0 - gap - reach, y))
            lines.append((x1 + gap, y, x1 + gap + reach, y))
    # Where the visible part ends inside the printed area: the overlap with the neighbour.
    ticks = []
    v = tile.visible
    left = (v.x - printed.x) * MM
    right = (printed.x + printed.w - v.x - v.w) * MM
    bottom = (v.y - printed.y) * MM
    top = (printed.y + printed.h - v.y - v.h) * MM
    if "left" in side_of and left > 0.5:
        ticks += [(x0 + left, y0 - gap, x0 + left, y0 - gap - reach)]
        ticks += [(x0 + left, y1 + gap, x0 + left, y1 + gap + reach)]
    if "right" in side_of and right > 0.5:
        ticks += [(x1 - right, y0 - gap, x1 - right, y0 - gap - reach)]
        ticks += [(x1 - right, y1 + gap, x1 - right, y1 + gap + reach)]
    if "bottom" in side_of and bottom > 0.5:
        ticks += [(x0 - gap, y0 + bottom, x0 - gap - reach, y0 + bottom)]
        ticks += [(x1 + gap, y0 + bottom, x1 + gap + reach, y0 + bottom)]
    if "top" in side_of and top > 0.5:
        ticks += [(x0 - gap, y1 - top, x0 - gap - reach, y1 - top)]
        ticks += [(x1 + gap, y1 - top, x1 + gap + reach, y1 - top)]
    ops = []
    if lines:
        ops.append(
            "q 0 0 0 1 K 0.3 w "
            + " ".join(f"{_num(a)} {_num(b)} m {_num(c)} {_num(d)} l" for a, b, c, d in lines)
            + " S Q"
        )
    if ticks:
        # Overlap ticks dashed, so they are not mistaken for the cut.
        ops.append(
            "q 0 0 0 1 K 0.3 w [2 1.5] 0 d "
            + " ".join(f"{_num(a)} {_num(b)} m {_num(c)} {_num(d)} l" for a, b, c, d in ticks)
            + " S Q"
        )
    return "\n".join(ops)


_SIDE_NAMES = {"left": "esq.", "right": "dir.", "top": "acima", "bottom": "abaixo"}


def _panel_label(
    tile: TilingTile,
    printed: Rect,
    margin: float,
    font: str,
    title: str,
    total: int,
    sides: dict[int, dict[str, int]],
) -> str:
    size = max(4.0, min(10.0, margin * 0.4))
    v = tile.visible
    head = " · ".join(
        part
        for part in (
            title,
            tile.name,
            f"painel {tile.number}/{total}",
            f"coluna {tile.column}, linha {tile.row}",
            tile.region,
            f"impresso {printed.w:.0f} × {printed.h:.0f} mm (visível {v.w:.0f} × {v.h:.0f})",
        )
        if part
    )
    around = sides.get(tile.number, {})
    near = " · ".join(
        f"{_SIDE_NAMES[side]}: painel {around[side]}"
        for side in ("left", "right", "top", "bottom")
        if side in around
    )
    lines = [head] + ([f"Vizinhos: {near}"] if near else [])
    # Top margin, clear of the crop marks at the corners and of the overlap tick.
    x = margin + max(0.0, (v.x - printed.x) * MM) + min(4 * MM, margin)
    y = margin + printed.h * MM + (margin - size) / 2
    ops = [f"BT {font} {_num(size)} Tf 0 0 0 1 k {_num(x)} {_num(y)} Td ({_text(lines[0])}) Tj ET"]
    if len(lines) > 1:
        y2 = (margin - size) / 2
        ops.append(
            f"BT {font} {_num(size)} Tf 0 0 0 1 k {_num(x)} {_num(y2)} Td ({_text(lines[1])}) Tj ET"
        )
    return "\n".join(ops)


def overlap_strips(tiles: list[TilingTile]) -> list[tuple[float, float, float, float]]:
    """Areas printed by two neighbouring panels (the overlaps), in art millimetres."""

    strips = []
    for i, a in enumerate(tiles):
        pa = box(a.printed.x, a.printed.y, a.printed.x + a.printed.w, a.printed.y + a.printed.h)
        for b in tiles[i + 1 :]:
            pb = box(b.printed.x, b.printed.y, b.printed.x + b.printed.w, b.printed.y + b.printed.h)
            shared = pa.intersection(pb)
            if not shared.is_empty and shared.area > 1:
                strips.append(shared.bounds)
    return strips
