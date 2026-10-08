"""Installation guide: where each panel goes.

An A3 landscape sheet with a picture of the artwork (and, on top, the reference
picture of the vehicle or building at the opacity the operator chose), every panel
outlined and numbered, overlaps and gaps marked, and a table with each panel's
file, region, position, sizes and neighbours. Long tables continue on more pages.
"""

from __future__ import annotations

import io
import zlib
from dataclasses import dataclass
from pathlib import Path

import pikepdf
import pypdfium2
from PIL import Image

from app.contracts.tiling import Rect, TilingBackground, TilingSeam, TilingTile
from app.tiling.export import MM, ArtFrame, overlap_strips, printed_area

PAGE = (420 * MM, 297 * MM)
_EDGE = 12 * MM
_ROWS_FIRST, _ROWS_NEXT = 34, 52
_THUMB_PX = 2400
_BLUE = "0.10 0.35 0.85"
_SIDE = {"left": "E", "right": "D", "top": "C", "bottom": "B"}


def _num(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".") or "0"


def _text(value: str) -> str:
    safe = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return safe.encode("cp1252", "replace").decode("cp1252")


def _image(pdf: pikepdf.Pdf, picture: Image.Image) -> pikepdf.Object:
    """Image XObject (JPEG) with its transparency as a soft mask."""

    rgba = picture.convert("RGBA")
    buffer = io.BytesIO()
    rgba.convert("RGB").save(buffer, format="JPEG", quality=85)
    image = pdf.make_stream(buffer.getvalue())
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height = rgba.size
    image.ColorSpace, image.BitsPerComponent = pikepdf.Name.DeviceRGB, 8
    image.Filter = pikepdf.Name.DCTDecode
    alpha = rgba.getchannel("A")
    if alpha.getextrema()[0] < 255:
        mask = pdf.make_stream(zlib.compress(alpha.tobytes(), 6))
        mask.Type, mask.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
        mask.Width, mask.Height = alpha.size
        mask.ColorSpace, mask.BitsPerComponent = pikepdf.Name.DeviceGray, 8
        mask.Filter = pikepdf.Name.FlateDecode
        image.SMask = mask
    return image


def _render_art(
    path: Path,
    page_index: int,
    frame: ArtFrame,
    area,
    pixels: int = _THUMB_PX,
    document: pypdfium2.PdfDocument | None = None,
) -> Image.Image | None:
    """The artwork inside `area` (art mm), rendered small for the guide."""

    x0, y0, x1, y1 = area
    if x1 <= x0 or y1 <= y0:
        return None
    to_pt = MM / frame.scale
    own = document is None
    document = document or pypdfium2.PdfDocument(str(path))
    try:
        page = document[page_index]
        width_pt, height_pt = page.get_size()
        crop_box = page.get_cropbox()
        # Area in points relative to the rendered (crop) box.
        left = frame.origin[0] + x0 * to_pt - crop_box[0]
        bottom = frame.origin[1] + y0 * to_pt - crop_box[1]
        right = frame.origin[0] + x1 * to_pt - crop_box[0]
        top = frame.origin[1] + y1 * to_pt - crop_box[1]
        scale = pixels / max(right - left, top - bottom)
        bitmap = page.render(
            scale=scale,
            crop=(
                max(0.0, left),
                max(0.0, bottom),
                max(0.0, width_pt - right),
                max(0.0, height_pt - top),
            ),
            draw_annots=False,
        )
        return bitmap.to_pil().convert("RGB")
    finally:
        if own:
            document.close()


def build_guide(
    path: Path,
    page_index: int,
    frame: ArtFrame,
    tiles: list[TilingTile],
    seams: list[TilingSeam],
    sides: dict[int, dict[str, int]],
    *,
    title: str = "",
    background: TilingBackground | None = None,
    background_image: Image.Image | None = None,
    revision: int = 1,
    tile_pages: bool = True,
) -> pikepdf.Pdf:
    """Overview sheet (with the table) and then one sheet per panel."""
    pdf = pikepdf.Pdf.new()
    font = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.Type1,
            BaseFont=pikepdf.Name.Helvetica,
            Encoding=pikepdf.Name.WinAnsiEncoding,
        )
    )
    bold = pdf.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.Type1,
            BaseFont=pikepdf.Name("/Helvetica-Bold"),
            Encoding=pikepdf.Name.WinAnsiEncoding,
        )
    )
    printed = {t.number: printed_area(t, frame) for t in tiles}

    # What the picture covers: every printed panel and the reference picture.
    xs0 = [p.x for p in printed.values()]
    ys0 = [p.y for p in printed.values()]
    xs1 = [p.x + p.w for p in printed.values()]
    ys1 = [p.y + p.h for p in printed.values()]
    bg_rect = None
    if background is not None and background_image is not None:
        bw = background.width_mm
        bh = bw * background_image.height / max(1, background_image.width)
        bg_rect = (background.x_mm, background.y_mm, background.x_mm + bw, background.y_mm + bh)
        xs0.append(bg_rect[0])
        ys0.append(bg_rect[1])
        xs1.append(bg_rect[2])
        ys1.append(bg_rect[3])
    extent = (min(xs0), min(ys0), max(xs1), max(ys1))
    ext_w, ext_h = extent[2] - extent[0], extent[3] - extent[1]

    # Picture on the left, table on the right.
    box_x, box_y = _EDGE, _EDGE + 14 * MM
    box_w, box_h = PAGE[0] * 0.6 - _EDGE, PAGE[1] - box_y - _EDGE - 14 * MM
    g = min(box_w / ext_w, box_h / ext_h)
    ox = box_x + (box_w - ext_w * g) / 2 - extent[0] * g
    oy = box_y + (box_h - ext_h * g) / 2 - extent[1] * g

    def at(x: float, y: float) -> tuple[float, float]:
        return ox + x * g, oy + y * g

    pdf.add_blank_page(page_size=PAGE)
    page = pdf.pages[0]
    f = page.add_resource(font, pikepdf.Name.Font, prefix="F")
    fb = page.add_resource(bold, pikepdf.Name.Font, prefix="B")
    ops: list[str] = []

    art_area = (
        max(extent[0], frame.available[0]),
        max(extent[1], frame.available[1]),
        min(extent[2], frame.available[2]),
        min(extent[3], frame.available[3]),
    )
    art = _render_art(path, page_index, frame, art_area)
    if art is not None:
        name = page.add_resource(_image(pdf, art), pikepdf.Name.XObject, prefix="Art")
        x, y = at(art_area[0], art_area[1])
        w, h = (art_area[2] - art_area[0]) * g, (art_area[3] - art_area[1]) * g
        ops.append(f"q {_num(w)} 0 0 {_num(h)} {_num(x)} {_num(y)} cm {name} Do Q")
    if bg_rect is not None and background_image is not None and background is not None:
        name = page.add_resource(_image(pdf, background_image), pikepdf.Name.XObject, prefix="Bg")
        gs = page.add_resource(
            pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, ca=background.opacity),
            pikepdf.Name.ExtGState,
            prefix="GS",
        )
        x, y = at(bg_rect[0], bg_rect[1])
        w, h = (bg_rect[2] - bg_rect[0]) * g, (bg_rect[3] - bg_rect[1]) * g
        ops.append(f"q {gs} gs {_num(w)} 0 0 {_num(h)} {_num(x)} {_num(y)} cm {name} Do Q")

    soft = page.add_resource(
        pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, ca=0.45),
        pikepdf.Name.ExtGState,
        prefix="GS",
    )
    # Overlaps (printed twice) in orange, gaps (not printed) in dark grey.
    strips = [
        f"{_num(at(a, b)[0])} {_num(at(a, b)[1])} {_num((c - a) * g)} {_num((d - b) * g)} re"
        for a, b, c, d in overlap_strips(tiles)
    ]
    if strips:
        ops.append(f"q {soft} gs 1 0.55 0 rg " + " ".join(strips) + " f Q")
    gaps = []
    for seam in seams:
        if seam.kind != "gap" or seam.width_mm <= 0:
            continue
        half = seam.width_mm / 2
        if seam.orientation == "vertical":
            rect = (seam.position - half, seam.start, seam.position + half, seam.end)
        else:
            rect = (seam.start, seam.position - half, seam.end, seam.position + half)
        x, y = at(rect[0], rect[1])
        w, h = (rect[2] - rect[0]) * g, (rect[3] - rect[1]) * g
        gaps.append(f"{_num(x)} {_num(y)} {_num(w)} {_num(h)} re")
    if gaps:
        ops.append(f"q {soft} gs 0.2 0.2 0.2 rg " + " ".join(gaps) + " f Q")

    # Panels: outline of the visible part and the number in the middle.
    size = max(6.0, min(18.0, min(min(t.visible.w, t.visible.h) * g * 0.35 for t in tiles)))
    for tile in tiles:
        v = tile.visible
        x, y = at(v.x, v.y)
        ops.append(f"q {_BLUE} RG 1 w {_num(x)} {_num(y)} {_num(v.w * g)} {_num(v.h * g)} re S Q")
        cx, cy = at(v.x + v.w / 2, v.y + v.h / 2)
        label = f"{tile.number:02d}"
        tw = size * 0.556 * len(label)
        ops.append(
            f"q 1 1 1 rg {_BLUE} RG 0.8 w {_num(cx - tw / 2 - 3)} {_num(cy - size * 0.35 - 3)} "
            f"{_num(tw + 6)} {_num(size + 4)} re B Q "
            f"BT {fb} {_num(size)} Tf {_BLUE} rg {_num(cx - tw / 2)} {_num(cy - size * 0.35)} Td "
            f"({label}) Tj ET"
        )

    # Title and legend.
    head = title or "Guia de instalação"
    ops.append(
        f"BT {fb} 16 Tf 0 0 0 rg {_num(_EDGE)} {_num(PAGE[1] - _EDGE - 12)} Td "
        f"({_text(head)}) Tj ET"
    )
    subtitle = (
        f"Guia de instalação · R{revision} · {len(tiles)} painéis · "
        "medidas em mm no tamanho final · uma folha por painel a seguir"
    )
    ops.append(
        f"BT {f} 9 Tf 0.3 0.3 0.3 rg {_num(_EDGE)} {_num(PAGE[1] - _EDGE - 26)} Td "
        f"({_text(subtitle)}) Tj ET"
    )
    legend_y = _EDGE + 3 * MM
    ops.append(
        f"q {_BLUE} RG 1 w {_num(_EDGE)} {_num(legend_y)} 14 8 re S Q "
        f"BT {f} 8 Tf 0 0 0 rg {_num(_EDGE + 18)} {_num(legend_y + 1)} Td (Painel) Tj ET "
        f"q {soft} gs 1 0.55 0 rg {_num(_EDGE + 70)} {_num(legend_y)} 14 8 re f Q "
        f"BT {f} 8 Tf 0 0 0 rg {_num(_EDGE + 88)} {_num(legend_y + 1)} Td "
        f"(Sobreposição \\(impressa nos dois\\)) Tj ET "
        f"q {soft} gs 0.2 0.2 0.2 rg {_num(_EDGE + 230)} {_num(legend_y)} 14 8 re f Q "
        f"BT {f} 8 Tf 0 0 0 rg {_num(_EDGE + 248)} {_num(legend_y + 1)} Td "
        f"(Fresta \\(não impressa\\)) Tj ET"
    )

    rows = [_row(tile, printed[tile.number], sides.get(tile.number, {})) for tile in tiles]
    table_x = PAGE[0] * 0.6 + 6 * MM
    first, rest = rows[:_ROWS_FIRST], rows[_ROWS_FIRST:]
    ops.append(_table(first, table_x, PAGE[1] - _EDGE - 40, f, fb))
    page.contents_add("\n".join(ops).encode("cp1252", "replace"))

    while rest:
        chunk, rest = rest[:_ROWS_NEXT], rest[_ROWS_NEXT:]
        pdf.add_blank_page(page_size=PAGE)
        extra = pdf.pages[-1]
        fe = extra.add_resource(font, pikepdf.Name.Font, prefix="F")
        fbe = extra.add_resource(bold, pikepdf.Name.Font, prefix="B")
        extra.contents_add(
            _table(chunk, _EDGE, PAGE[1] - _EDGE - 10, fe, fbe, wide=True).encode(
                "cp1252", "replace"
            )
        )

    if tile_pages:
        document = pypdfium2.PdfDocument(str(path))
        try:
            for tile in tiles:
                _tile_page(
                    pdf,
                    (font, bold),
                    _TileContext(path, page_index, frame, document, title, revision, tiles, sides),
                    tile,
                    printed,
                )
        finally:
            document.close()
    return pdf


# ---- One sheet per panel ------------------------------------------------------------------

TILE_PAGE = (297 * MM, 210 * MM)
_ORANGE = "1 0.55 0"
_ROTATION = {
    0: "em pé",
    90: "deitado (90°)",
    180: "em pé, girado 180°",
    270: "deitado, girado 180°",
}
_SIDE_LONG = {"left": "Esquerda", "right": "Direita", "top": "Acima", "bottom": "Abaixo"}


@dataclass(slots=True)
class _TileContext:
    path: Path
    page_index: int
    frame: ArtFrame
    document: pypdfium2.PdfDocument
    title: str
    revision: int
    tiles: list[TilingTile]
    sides: dict[int, dict[str, int]]


def overlap_edges(tile: TilingTile, printed: Rect, around: dict[str, int]) -> dict[str, float]:
    """How far the panel prints over each neighbour (only on sides that have one)."""

    v = tile.visible
    reach = {
        "left": v.x - printed.x,
        "right": printed.x + printed.w - (v.x + v.w),
        "bottom": v.y - printed.y,
        "top": printed.y + printed.h - (v.y + v.h),
    }
    return {side: max(0.0, value) if side in around else 0.0 for side, value in reach.items()}


_OPPOSITE = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}


def _tile_page(pdf, fonts, ctx: _TileContext, tile: TilingTile, printed: dict[int, Rect]) -> None:
    font, bold = fonts
    width, height = TILE_PAGE
    pdf.add_blank_page(page_size=TILE_PAGE)
    page = pdf.pages[-1]
    f = page.add_resource(font, pikepdf.Name.Font, prefix="F")
    fb = page.add_resource(bold, pikepdf.Name.Font, prefix="B")
    soft = page.add_resource(
        pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, ca=0.45),
        pikepdf.Name.ExtGState,
        prefix="GS",
    )
    ops: list[str] = []
    p = printed[tile.number]
    v = tile.visible
    around = ctx.sides.get(tile.number, {})
    by_number = {t.number: t for t in ctx.tiles}
    mine = overlap_edges(tile, p, around)

    def text(x: float, y: float, value: str, size: float = 8, face: str | None = None, gray=0.0):
        ops.append(
            f"BT {face or f} {_num(size)} Tf {gray} {gray} {gray} rg {_num(x)} {_num(y)} Td "
            f"({_text(value)}) Tj ET"
        )

    # Header.
    head = f"Painel {tile.number:02d} de {len(ctx.tiles)} · {tile.id}"
    text(_EDGE, height - _EDGE - 14, head, 16, fb)
    sub = " · ".join(
        part for part in (f"{tile.name}.pdf", tile.region, ctx.title, f"R{ctx.revision}") if part
    )
    text(_EDGE, height - _EDGE - 28, sub, 9, gray=0.3)

    # The panel's printed area, with what it covers outlined and the overlaps shaded.
    pad = 18.0
    box_x, box_y = _EDGE + pad, _EDGE + pad
    box_w, box_h = width * 0.58 - box_x - pad, height - box_y - _EDGE - 40 - pad
    g = min(box_w / p.w, box_h / p.h)
    ox = box_x + (box_w - p.w * g) / 2 - p.x * g
    oy = box_y + (box_h - p.h * g) / 2 - p.y * g

    def at(x: float, y: float) -> tuple[float, float]:
        return ox + x * g, oy + y * g

    art = _render_art(
        ctx.path, ctx.page_index, ctx.frame, (p.x, p.y, p.x + p.w, p.y + p.h), 1400, ctx.document
    )
    if art is not None:
        name = page.add_resource(_image(pdf, art), pikepdf.Name.XObject, prefix="Art")
        x, y = at(p.x, p.y)
        ops.append(f"q {_num(p.w * g)} 0 0 {_num(p.h * g)} {_num(x)} {_num(y)} cm {name} Do Q")
    strips = []
    if mine["left"]:
        strips.append((p.x, p.y, mine["left"], p.h))
    if mine["right"]:
        strips.append((v.x + v.w, p.y, mine["right"], p.h))
    if mine["bottom"]:
        strips.append((p.x, p.y, p.w, mine["bottom"]))
    if mine["top"]:
        strips.append((p.x, v.y + v.h, p.w, mine["top"]))
    if strips:
        ops.append(
            f"q {soft} gs {_ORANGE} rg "
            + " ".join(
                f"{_num(at(a, b)[0])} {_num(at(a, b)[1])} {_num(w * g)} {_num(h * g)} re"
                for a, b, w, h in strips
            )
            + " f Q"
        )
    x, y = at(p.x, p.y)
    ops.append(
        f"q 0.5 G 0.5 w [3 2] 0 d {_num(x)} {_num(y)} {_num(p.w * g)} {_num(p.h * g)} re S Q"
    )
    x, y = at(v.x, v.y)
    ops.append(f"q {_BLUE} RG 1.2 w {_num(x)} {_num(y)} {_num(v.w * g)} {_num(v.h * g)} re S Q")

    # Neighbour numbers just outside each side.
    left, bottom = at(p.x, p.y)
    right, top = at(p.x + p.w, p.y + p.h)
    middle = ((left + right) / 2, (bottom + top) / 2)
    spots = {
        "left": (left - 10, middle[1]),
        "right": (right + 10, middle[1]),
        "top": (middle[0], top + 9),
        "bottom": (middle[0], bottom - 9),
    }
    for side, number in around.items():
        cx, cy = spots[side]
        label = f"{number:02d}"
        ops.append(
            f"q 1 1 1 rg {_BLUE} RG 0.8 w {_num(cx - 8)} {_num(cy - 5)} 16 11 re B Q "
            f"BT {fb} 8 Tf {_BLUE} rg {_num(cx - 4.5)} {_num(cy - 2.5)} Td ({label}) Tj ET"
        )

    # Where it goes: every panel outlined, this one filled.
    map_x, map_w = width * 0.6, width * 0.4 - _EDGE
    map_top = height - _EDGE - 44
    map_h = height * 0.32
    rects = [(t.visible.x, t.visible.y, t.visible.w, t.visible.h) for t in ctx.tiles]
    ex0 = min(r[0] for r in rects)
    ey0 = min(r[1] for r in rects)
    ex1 = max(r[0] + r[2] for r in rects)
    ey1 = max(r[1] + r[3] for r in rects)
    k = min(map_w / (ex1 - ex0), map_h / (ey1 - ey0))
    mx = map_x + (map_w - (ex1 - ex0) * k) / 2 - ex0 * k
    my = map_top - map_h + (map_h - (ey1 - ey0) * k) / 2 - ey0 * k
    for t, (rx, ry, rw, rh) in zip(ctx.tiles, rects, strict=True):
        fill = f"{_BLUE} rg " if t.number == tile.number else "0.93 0.94 0.96 rg "
        ops.append(
            f"q {fill}0.55 G 0.5 w {_num(mx + rx * k)} {_num(my + ry * k)} "
            f"{_num(rw * k)} {_num(rh * k)} re B Q"
        )

    # Data.
    white = tile.white
    phys = (p.w + white.left + white.right, p.h + white.top + white.bottom)
    rows = [
        ("Arquivo", f"{tile.name}.pdf"),
        ("Posição", f"linha {tile.row}, coluna {tile.column} ({tile.id})"),
        ("Região", tile.region or "—"),
        ("Cobre da arte", f"{v.w:.0f} × {v.h:.0f} mm"),
        ("Impresso", f"{p.w:.0f} × {p.h:.0f} mm"),
        ("Painel físico", f"{phys[0]:.0f} × {phys[1]:.0f} mm"),
        ("Na mídia", _ROTATION.get(tile.rotation, "")),
        (
            "Área branca",
            " · ".join(
                f"{_SIDE_LONG[s][:3].lower()}. {getattr(white, s):.0f}"
                for s in ("left", "right", "top", "bottom")
                if getattr(white, s) > 0
            )
            or "—",
        ),
    ]
    under: list[int] = []
    for side in ("left", "right", "top", "bottom"):
        if side not in around:
            continue
        number = around[side]
        other = by_number.get(number)
        theirs = (
            overlap_edges(other, printed[number], ctx.sides.get(number, {}))[_OPPOSITE[side]]
            if other
            else 0.0
        )
        if mine[side] > 0.5:
            note = f"painel {number:02d} · este fica por cima ({mine[side]:.0f} mm)"
        elif theirs > 0.5:
            note = f"painel {number:02d} · este fica por baixo ({theirs:.0f} mm)"
            under.append(number)
        else:
            note = f"painel {number:02d} · topo a topo"
        rows.append((_SIDE_LONG[side], note))
    if under:
        rows.append(("Instalar antes de", ", ".join(f"{n:02d}" for n in sorted(under))))
    covered = [around[s] for s in around if mine[s] > 0.5]
    if covered:
        rows.append(("Instalar depois de", ", ".join(f"{n:02d}" for n in sorted(covered))))

    y = map_top - map_h - 22
    for label, value in rows:
        text(map_x, y, label, 8, gray=0.35)
        limit = int((map_w - 78) / 4.1)
        text(map_x + 78, y, value if len(value) <= limit else value[: limit - 1] + "…", 8)
        y -= 13

    # Legend.
    ly = _EDGE
    ops.append(
        f"q {_BLUE} RG 1.2 w {_num(_EDGE)} {_num(ly)} 14 8 re S Q "
        f"BT {f} 7.5 Tf 0 0 0 rg {_num(_EDGE + 18)} {_num(ly + 1.5)} Td (Cobre da arte) Tj ET "
        f"q 0.5 G 0.5 w [3 2] 0 d {_num(_EDGE + 90)} {_num(ly)} 14 8 re S Q "
        f"BT {f} 7.5 Tf 0 0 0 rg {_num(_EDGE + 108)} {_num(ly + 1.5)} Td (Impresso) Tj ET "
        f"q {soft} gs {_ORANGE} rg {_num(_EDGE + 160)} {_num(ly)} 14 8 re f Q "
        f"BT {f} 7.5 Tf 0 0 0 rg {_num(_EDGE + 178)} {_num(ly + 1.5)} Td "
        f"({_text('Sobreposição (impressa também no vizinho)')}) Tj ET"
    )
    page.contents_add("\n".join(ops).encode("cp1252", "replace"))


def _row(tile: TilingTile, printed, around: dict[str, int]) -> list[str]:
    v = tile.visible
    near = " ".join(
        f"{_SIDE[s]}{around[s]:02d}" for s in ("left", "right", "top", "bottom") if s in around
    )
    return [
        f"{tile.number:02d}",
        tile.name,
        tile.region,
        f"{tile.column}/{tile.row}",
        f"{v.w:.0f}×{v.h:.0f}",
        f"{printed.w:.0f}×{printed.h:.0f}",
        near,
    ]


_HEADERS = ["Nº", "Arquivo", "Região", "Col/Lin", "Visível", "Impresso", "Vizinhos"]


def _table(rows: list[list[str]], x: float, top: float, font: str, bold: str, wide=False) -> str:
    widths = [22, 150, 90, 38, 58, 58, 70] if wide else [18, 92, 62, 30, 44, 44, 52]
    if wide:
        widths = [w * 1.8 for w in widths]
    size, step = 7.0, 11.0
    max_chars = [max(2, int(w / (size * 0.5))) for w in widths]
    ops = []

    def line(cells: list[str], y: float, font_name: str) -> None:
        cx = x
        for cell, w, limit in zip(cells, widths, max_chars, strict=True):
            text = cell if len(cell) <= limit else cell[: limit - 1] + "…"
            at = f"{_num(cx)} {_num(y)}"
            ops.append(f"BT {font_name} {_num(size)} Tf 0 0 0 rg {at} Td ({_text(text)}) Tj ET")
            cx += w

    line(_HEADERS, top, bold)
    ops.append(
        f"q 0.6 G 0.5 w {_num(x)} {_num(top - 3)} m {_num(x + sum(widths))} {_num(top - 3)} l S Q"
    )
    y = top - step - 2
    for row in rows:
        line(row, y, font)
        y -= step
    ops.append(
        f"BT {font} 6.5 Tf 0.35 0.35 0.35 rg {_num(x)} {_num(y - 4)} Td "
        f"({_text('Vizinhos: E esquerda, D direita, C acima, B abaixo.')}) Tj ET"
    )
    return "\n".join(ops)
