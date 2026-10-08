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
        white = tile.white
        # Physical panel = print window + unprinted glue area; marks go in the margin around it.
        phys_w = (printed.w + white.left + white.right) * MM
        phys_h = (printed.h + white.bottom + white.top) * MM
        width, height = phys_w + 2 * margin, phys_h + 2 * margin
        if max(phys_w, phys_h) > PDF_MAX_PT:
            raise TilingError(
                f"o painel {tile.number} ({phys_w / MM:.0f} × {phys_h / MM:.0f} mm) "
                "passa do limite de 5080 mm do PDF"
            )
        out.add_blank_page(page_size=(width, height))
        page = out.pages[-1]
        name = page.add_resource(art, pikepdf.Name.XObject, prefix="Art")
        px, py = margin + white.left * MM, margin + white.bottom * MM
        pw, ph = printed.w * MM, printed.h * MM
        e = px - printed.x * MM - frame.origin[0] * s
        f = py - printed.y * MM - frame.origin[1] * s
        content = [
            f"q {_num(px)} {_num(py)} {_num(pw)} {_num(ph)} re W n "
            f"{_num(s)} 0 0 {_num(s)} {_num(e)} {_num(f)} cm {name} Do Q"
        ]
        # TrimBox = the logical tile, BleedBox = the print window (logical + overlaps + bleed):
        # later steps (RIP, crop, marks) can tell the overlap from the tile itself.
        v = tile.visible
        logical = (
            px + (v.x - printed.x) * MM,
            py + (v.y - printed.y) * MM,
            px + (v.x - printed.x + v.w) * MM,
            py + (v.y - printed.y + v.h) * MM,
        )
        page.obj.TrimBox = pikepdf.Array([round(c, 4) for c in logical])
        page.obj.BleedBox = pikepdf.Array([round(c, 4) for c in (px, py, px + pw, py + ph)])
        # The page goes out turned the way it sits on the media (lying, flip-flop); the
        # content and the boxes are untouched, only /Rotate tells the RIP how to place it.
        if tile.rotation:
            page.obj.Rotate = tile.rotation
        geometry = _PageGeometry(
            physical=(margin, margin, margin + phys_w, margin + phys_h),
            printed=(px, py, px + pw, py + ph),
            logical=logical,
        )
        if margin >= 2 * MM:
            drawn, blocked = _panel_marks(geometry, marks, sides.get(tile.number, {}))
            content.append(drawn)
            if marks.label:
                font_name = page.add_resource(font, pikepdf.Name.Font, prefix="F")
                content.append(
                    _panel_label(
                        tile, printed, geometry, margin, font_name, title, total, sides, blocked
                    )
                )
        page.contents_add("\n".join(c for c in content if c).encode("cp1252", "replace"))
    return out


@dataclass(slots=True)
class _PageGeometry:
    """Rectangles on the panel page (points): x0, y0, x1, y1."""

    physical: tuple[float, float, float, float]
    printed: tuple[float, float, float, float]
    logical: tuple[float, float, float, float]


def _panel_marks(
    geometry: _PageGeometry, marks: TilingMarks, side_of: dict[str, int]
) -> tuple[str, list[float]]:
    """Crop marks at the physical corners, dashed ticks where each overlap starts and ends and
    ticks at the middle of each edge. Also returns the x of every tick in the top and bottom
    margins, which the label has to stay clear of."""

    x0, y0, x1, y1 = geometry.physical
    margin = x0
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

    # Overlap: from the logical edge (start) to the printed edge (end), on sides with a neighbour.
    lx0, ly0, lx1, ly1 = geometry.logical
    px0, py0, px1, py1 = geometry.printed

    def vertical_ticks(x: float) -> list[tuple[float, float, float, float]]:
        return [(x, y0 - gap, x, y0 - gap - reach), (x, y1 + gap, x, y1 + gap + reach)]

    def horizontal_ticks(y: float) -> list[tuple[float, float, float, float]]:
        return [(x0 - gap, y, x0 - gap - reach, y), (x1 + gap, y, x1 + gap + reach, y)]

    ticks: list[tuple[float, float, float, float]] = []
    for side, start, end, make in (
        ("left", lx0, px0, vertical_ticks),
        ("right", lx1, px1, vertical_ticks),
        ("bottom", ly0, py0, horizontal_ticks),
        ("top", ly1, py1, horizontal_ticks),
    ):
        if not marks.draw_overlap_marks or side not in side_of or abs(start - end) <= 0.5:
            continue
        ticks += make(start)
        # The end of the overlap only needs its own tick when it is not the cut edge.
        edge = {"left": x0, "right": x1, "bottom": y0, "top": y1}[side]
        if abs(end - edge) > 0.5:
            ticks += make(end)

    # Middle of each edge of the logical tile: neighbours line up mark to mark.
    centers: list[tuple[float, float, float, float]] = []
    if marks.center_marks:
        centers = vertical_ticks((lx0 + lx1) / 2) + horizontal_ticks((ly0 + ly1) / 2)

    def stroke(style: str, segments: list[tuple[float, float, float, float]]) -> str:
        return (
            f"q 0 0 0 1 K {style} "
            + " ".join(f"{_num(a)} {_num(b)} m {_num(c)} {_num(d)} l" for a, b, c, d in segments)
            + " S Q"
        )

    ops = []
    if lines:
        ops.append(stroke("0.3 w", lines))
    if ticks:
        # Overlap ticks dashed, so they are not mistaken for the cut.
        ops.append(stroke("0.3 w [2 1.5] 0 d", ticks))
    if centers:
        ops.append(stroke("0.6 w", centers))
    # Vertical segments in the top/bottom margins (x0 == x1 and outside the panel height).
    blocked = sorted(
        {a for a, b, c, d in lines + ticks + centers if abs(a - c) < 0.01 and (b > y1 or b < y0)}
    )
    return "\n".join(ops), blocked


def _fit(text: str, size: float, low: float, high: float, blocked: list[float]):
    """Where a line of text fits between the ticks of a margin: the first free stretch wide
    enough, or the widest one with the text cut short. None if nothing fits."""

    pad = 1.5 * MM
    char = size * 0.52  # average Helvetica width
    edges = [low] + [b for b in blocked if low < b < high] + [high]
    stretches = [
        (a + pad, b - pad) for a, b in zip(edges, edges[1:], strict=False) if b - a > 2 * pad
    ]
    if not stretches or not text:
        return None
    need = len(text) * char
    for a, b in stretches:
        if b - a >= need:
            return a, text
    a, b = max(stretches, key=lambda s: s[1] - s[0])
    room = int((b - a) / char)
    if room < 4:
        return None
    return a, text[: room - 1] + "…"


_SIDE_NAMES = {"left": "esq.", "right": "dir.", "top": "acima", "bottom": "abaixo"}


def _panel_label(
    tile: TilingTile,
    printed: Rect,
    geometry: _PageGeometry,
    margin: float,
    font: str,
    title: str,
    total: int,
    sides: dict[int, dict[str, int]],
    blocked: list[float] | None = None,
) -> str:
    """Top line in the top margin, bottom line in the bottom one, both clear of the marks."""

    size = max(4.0, min(10.0, margin * 0.4))
    top = tile.label_top
    if top is None:
        top = _default_head(tile, printed, title, total)
    if tile.label_bottom is not None:
        bottom = tile.label_bottom
    else:
        around = sides.get(tile.number, {})
        near = " · ".join(
            f"{_SIDE_NAMES[side]}: painel {around[side]}"
            for side in ("left", "right", "top", "bottom")
            if side in around
        )
        bottom = f"Vizinhos: {near}" if near else ""

    x0, _, x1, y1 = geometry.physical
    ops = []
    for text, y in ((top, y1 + (margin - size) / 2), (bottom, (margin - size) / 2)):
        placed = _fit(text.strip(), size, x0, x1, blocked or [])
        if placed is None:
            continue
        x, line = placed
        ops.append(
            f"BT {font} {_num(size)} Tf 0 0 0 1 k {_num(x)} {_num(y)} Td ({_text(line)}) Tj ET"
        )
    return "\n".join(ops)


def _default_head(tile: TilingTile, printed: Rect, title: str, total: int) -> str:
    v = tile.visible
    w = tile.white
    physical = (
        f" · painel {printed.w + w.left + w.right:.0f} × {printed.h + w.top + w.bottom:.0f} mm "
        "com área branca"
        if w.left + w.right + w.top + w.bottom > 0
        else ""
    )
    return " · ".join(
        part
        for part in (
            title,
            tile.name,
            f"painel {tile.number}/{total}",
            tile.id or f"coluna {tile.column}, linha {tile.row}",
            tile.region,
            f"impresso {printed.w:.0f} × {printed.h:.0f} mm "
            f"(lógico {v.w:.0f} × {v.h:.0f}){physical}",
        )
        if part
    )


def check_constraint(tiles: list[TilingTile], frame: ArtFrame, constraint) -> None:
    """Refuses to produce panels that do not fit the printable area of the material."""

    if constraint.printable_width_mm <= 0:
        return
    problems = []
    for tile in tiles:
        p = printed_area(tile, frame)
        w = p.w + tile.white.left + tile.white.right
        h = p.h + tile.white.top + tile.white.bottom
        lying = tile.rotation % 180 != 0 if tile.rotation else constraint.direction == "lying"
        across, along = (h, w) if lying else (w, h)
        label = tile.id or f"{tile.number}"
        if across > constraint.printable_width_mm + 0.01:
            problems.append(
                f"{label}: {across:.0f} mm > largura imprimível {constraint.printable_width_mm:.0f}"
            )
        if constraint.printable_length_mm > 0 and along > constraint.printable_length_mm + 0.01:
            problems.append(
                f"{label}: {along:.0f} mm > comprimento {constraint.printable_length_mm:.0f}"
            )
    if problems:
        raise TilingError("painéis não cabem no material: " + "; ".join(problems))


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
