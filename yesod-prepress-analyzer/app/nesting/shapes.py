"""Piece outlines for nesting.

A piece's real shape comes from its die line: the paths stroked or filled with the
cut separation (CutContour, Corte...). Without one, the piece is the rectangle of
its TrimBox. Shapes are returned in PDF points of the source page.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pikepdf
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

Matrix = tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
_CURVE_STEPS = 12


@dataclass(slots=True)
class PieceShape:
    cut: BaseGeometry
    """Cut line (die line or TrimBox), in source points."""
    bleed: BaseGeometry
    """Printed area: the cut line grown by the bleed, clipped to the page."""
    from_die_line: bool


def _multiply(m: Matrix, n: Matrix) -> Matrix:
    """m then n (PDF row-vector convention: [x y 1] · m · n)."""

    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = n
    return (
        a * a2 + b * c2,
        a * b2 + b * d2,
        c * a2 + d * c2,
        c * b2 + d * d2,
        e * a2 + f * c2 + e2,
        e * b2 + f * d2 + f2,
    )


def _apply(m: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def _bezier(p0, p1, p2, p3) -> list[tuple[float, float]]:
    points = []
    for step in range(1, _CURVE_STEPS + 1):
        t = step / _CURVE_STEPS
        u = 1 - t
        points.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return points


def _separation_names(page: pikepdf.Page) -> dict[str, set[str]]:
    """Colour-space resource name -> colorant names it paints."""

    result: dict[str, set[str]] = {}
    resources = page.obj.get("/Resources") or {}
    spaces = resources.get("/ColorSpace") if hasattr(resources, "get") else None
    for key, value in (spaces or {}).items():
        try:
            if isinstance(value, pikepdf.Array) and str(value[0]) == "/Separation":
                result[str(key)] = {str(value[1]).lstrip("/").casefold()}
            elif isinstance(value, pikepdf.Array) and str(value[0]) == "/DeviceN":
                result[str(key)] = {str(item).lstrip("/").casefold() for item in value[1]}
        except Exception:
            logger.debug("unreadable colour space %s", key, exc_info=True)
    return result


def die_line(page: pikepdf.Page, cut_names: list[str]) -> BaseGeometry | None:
    """Union of the closed paths painted with a cut separation on the page."""

    wanted = {name.casefold() for name in cut_names}
    spaces = _separation_names(page)
    try:
        instructions = pikepdf.parse_content_stream(page)
    except Exception:
        logger.debug("unable to parse page content for die line", exc_info=True)
        return None

    ctm = IDENTITY
    stack: list[tuple[Matrix, str, str]] = []
    stroke_space = fill_space = ""
    subpaths: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    polygons: list[Polygon] = []

    def start(point):
        nonlocal current
        if len(current) > 1:
            subpaths.append(current)
        current = [point]

    for operands, operator in instructions:
        op = str(operator)
        # pikepdf yields int and Decimal operands; names and arrays are skipped.
        values = [float(v) for v in operands if _is_number(v)]
        if op == "q":
            stack.append((ctm, stroke_space, fill_space))
        elif op == "Q" and stack:
            ctm, stroke_space, fill_space = stack.pop()
        elif op == "cm" and len(values) == 6:
            ctm = _multiply(tuple(values), ctm)  # type: ignore[arg-type]
        elif op == "CS" and operands:
            stroke_space = str(operands[0])
        elif op == "cs" and operands:
            fill_space = str(operands[0])
        elif op == "m" and len(values) == 2:
            start(_apply(ctm, *values))
        elif op == "l" and len(values) == 2 and current:
            current.append(_apply(ctm, *values))
        elif op == "c" and len(values) == 6 and current:
            p0 = current[-1]
            p1, p2, p3 = (_apply(ctm, *values[i : i + 2]) for i in (0, 2, 4))
            current.extend(_bezier(p0, p1, p2, p3))
        elif op == "v" and len(values) == 4 and current:
            p0 = current[-1]
            p2, p3 = (_apply(ctm, *values[i : i + 2]) for i in (0, 2))
            current.extend(_bezier(p0, p0, p2, p3))
        elif op == "y" and len(values) == 4 and current:
            p0 = current[-1]
            p1, p3 = (_apply(ctm, *values[i : i + 2]) for i in (0, 2))
            current.extend(_bezier(p0, p1, p3, p3))
        elif op == "re" and len(values) == 4:
            x, y, w, h = values
            start(_apply(ctm, x, y))
            current.extend(
                [_apply(ctm, x + w, y), _apply(ctm, x + w, y + h), _apply(ctm, x, y + h)]
            )
        elif op in {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"}:
            if len(current) > 1:
                subpaths.append(current)
            current = []
            stroking = op in {"S", "s", "B", "B*", "b", "b*"}
            filling = op in {"f", "F", "f*", "B", "B*", "b", "b*"}
            is_cut = (stroking and spaces.get(stroke_space, set()) & wanted) or (
                filling and spaces.get(fill_space, set()) & wanted
            )
            if is_cut:
                for points in subpaths:
                    if len(points) >= 3:
                        polygon = Polygon(points).buffer(0)
                        if not polygon.is_empty and polygon.area > 1:
                            polygons.append(polygon)
            subpaths = []

    if not polygons:
        return None
    union = unary_union(polygons)
    # Holes in a die line are inner cuts; the piece occupies its outer outline.
    parts = union.geoms if isinstance(union, MultiPolygon) else [union]
    return unary_union([Polygon(part.exterior) for part in parts])


def _is_number(value: object) -> bool:
    if isinstance(value, bool | str | bytes):
        return False
    try:
        float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return True


def _page_box(page: pikepdf.Page, name: str) -> tuple[float, float, float, float] | None:
    value = page.obj.get(name)
    if value is None or len(value) != 4:
        return None
    x0, y0, x1, y1 = (float(v) for v in value)
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def piece_shape(
    page: pikepdf.Page, cut_names: list[str], bleed_pt: float, use_die_line: bool = True
) -> PieceShape:
    media = _page_box(page, "/MediaBox") or (0.0, 0.0, 0.0, 0.0)
    visible = box(*(_page_box(page, "/CropBox") or media)).intersection(box(*media))
    trim = _page_box(page, "/TrimBox")
    bleed_box = _page_box(page, "/BleedBox")

    cut = die_line(page, cut_names) if use_die_line else None
    from_die_line = cut is not None
    if cut is None:
        cut = box(*trim) if trim else visible

    if from_die_line:
        printed = cut.buffer(bleed_pt, join_style="mitre", mitre_limit=2.0)
    elif bleed_box:
        printed = box(*bleed_box)
    else:
        printed = cut.buffer(bleed_pt, join_style="mitre")
    printed = printed.intersection(_print_limit(visible, bleed_box))
    if printed.is_empty:
        printed = cut
    return PieceShape(cut=cut, bleed=printed, from_die_line=from_die_line)


def _print_limit(visible: BaseGeometry, bleed_box) -> BaseGeometry:
    """Nothing is printed beyond the BleedBox (1 pt of slack keeps the die-line stroke whole)."""

    if not bleed_box:
        return visible
    return box(*bleed_box).buffer(1.0, join_style="mitre").intersection(visible)


def page_pieces(
    page: pikepdf.Page, cut_names: list[str], bleed_pt: float, use_die_line: bool = True
) -> list[PieceShape]:
    """Every piece on a page: each separate die-line outline is its own piece.

    A sheet of stickers (several shapes on one page) becomes several pieces, each
    one printed with its own bleed around its own cut line. A page without a die
    line, or with a single outline, is one piece.
    """

    whole = piece_shape(page, cut_names, bleed_pt, use_die_line)
    if not whole.from_die_line or not isinstance(whole.cut, MultiPolygon):
        return [whole]
    media = _page_box(page, "/MediaBox") or (0.0, 0.0, 0.0, 0.0)
    visible = box(*(_page_box(page, "/CropBox") or media)).intersection(box(*media))
    limit = _print_limit(visible, _page_box(page, "/BleedBox"))
    pieces = []
    for part in whole.cut.geoms:
        printed = part.buffer(bleed_pt, join_style="mitre", mitre_limit=2.0).intersection(limit)
        pieces.append(
            PieceShape(
                cut=part, bleed=printed if not printed.is_empty else part, from_die_line=True
            )
        )
    # Reading order (top to bottom, left to right) keeps piece numbers predictable.
    pieces.sort(key=lambda p: (-round(p.cut.bounds[3]), p.cut.bounds[0]))
    return pieces


def contour_pieces(
    pdf_path,
    page: pikepdf.Page,
    page_index: int,
    offset_pt: float,
    merge_pt: float,
) -> list[PieceShape]:
    """Pieces of a page without die line: the system creates the die line itself.

    Everything printed is traced; art closer than `merge_pt` belongs to the same
    piece (letters of a word, a logo and its text), separate shapes become separate
    pieces. Each die line runs `offset_pt` outside the artwork, so nothing printed
    is ever cut off.
    """

    from app.fixes.contour import artwork_silhouette  # pdfium only needed here

    media = _page_box(page, "/MediaBox") or (0.0, 0.0, 0.0, 0.0)
    crop = _page_box(page, "/CropBox") or media
    visible = box(*crop).intersection(box(*media))
    bleed_box = _page_box(page, "/BleedBox")
    region = box(*bleed_box).intersection(visible) if bleed_box else visible
    silhouette = artwork_silhouette(pdf_path, page_index, region.bounds, origin=crop[:2])
    if silhouette is None or silhouette.is_empty:
        return []

    reach = max(merge_pt, offset_pt, 0.0)
    grouped = silhouette.buffer(reach, join_style="round", quad_segs=8)
    die = grouped.buffer(offset_pt - reach, join_style="round", quad_segs=8) if reach else grouped
    parts = die.geoms if isinstance(die, MultiPolygon) else [die]
    pieces = [
        PieceShape(cut=Polygon(part.exterior), bleed=Polygon(part.exterior), from_die_line=False)
        for part in parts
        if isinstance(part, Polygon) and not part.is_empty
    ]
    pieces.sort(key=lambda p: (-round(p.cut.bounds[3]), p.cut.bounds[0]))
    return pieces


def scaled(geometry: BaseGeometry, factor: float) -> BaseGeometry:
    return affinity.scale(geometry, xfact=factor, yfact=factor, origin=(0, 0))
