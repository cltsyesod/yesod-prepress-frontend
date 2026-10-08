"""Cut lines for the panels, on the cut separation (CutContour by default).

The die line around the artwork is measured once on the whole artwork (the same
silhouette used by the contour fix) and each panel gets only the part of it that
falls inside its print window, as open paths: where the line leaves the panel it
just stops, no cut is added along the panel edge. Optionally each physical panel
gets a cut around it, to be cut off the roll. Nothing is drawn over the artwork
other than the cut itself, which the RIP sends to the cutter and does not print.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pikepdf
from shapely import affinity
from shapely.geometry import LineString, MultiLineString, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge

from app.contracts.tiling import Rect, TilingCut
from app.fixes.contour import artwork_silhouette, contour_die_line
from app.tiling.export import MM, ArtFrame

_TOLERANCE_MM = 0.05  # path simplification, at final size


@dataclass(slots=True)
class CutPlan:
    name: str
    width_pt: float
    contour: BaseGeometry | None
    """Die line in art millimetres (polygons; their outlines are cut)."""
    panel_edge: bool
    close_at_edge: bool = False
    """Closed pieces: where the die line leaves the panel, it runs along the panel edge."""


def plan_cut(source: Path, page_index: int, frame: ArtFrame, cut: TilingCut) -> CutPlan | None:
    if not cut.active:
        return None
    contour = None
    if cut.contour:
        to_pt = MM / frame.scale
        a = frame.available
        region = (
            frame.origin[0] + a[0] * to_pt,
            frame.origin[1] + a[1] * to_pt,
            frame.origin[0] + a[2] * to_pt,
            frame.origin[1] + a[3] * to_pt,
        )
        silhouette = artwork_silhouette(
            source,
            page_index,
            region,
            origin=(region[0], region[1]),
            file_scale=frame.scale,
            white_is_background=cut.white_background != "keep",
        )
        if silhouette is not None and not silhouette.is_empty:
            die = contour_die_line(silhouette, cut.offset_mm * to_pt, cut_holes=cut.cut_holes)
            # File points -> art millimetres (origin at the TrimBox corner).
            k = 1 / to_pt
            contour = affinity.affine_transform(
                die, [k, 0, 0, k, -frame.origin[0] * k, -frame.origin[1] * k]
            )
    return CutPlan(
        cut.name.strip() or "CutContour",
        cut.line_width_pt,
        contour,
        cut.panel_edge,
        cut.close_at_edge,
    )


def _lines(geometry: BaseGeometry) -> list[LineString]:
    if isinstance(geometry, LineString):
        return [geometry] if not geometry.is_empty else []
    if isinstance(geometry, MultiLineString):
        return [g for g in geometry.geoms if not g.is_empty]
    return [g for part in getattr(geometry, "geoms", []) for g in _lines(part)]


def _polygons(geometry: BaseGeometry) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry] if not geometry.is_empty else []
    return [g for part in getattr(geometry, "geoms", []) for g in _polygons(part)]


def _num(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def cut_resources(out: pikepdf.Pdf, plan: CutPlan) -> tuple[pikepdf.Object, pikepdf.Object]:
    """Separation colour space and an overprint state, shared by every page of `out`."""

    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 1, 0, 0], N=1)
    space = out.make_indirect(
        pikepdf.Array(
            [pikepdf.Name.Separation, pikepdf.Name("/" + plan.name), pikepdf.Name.DeviceCMYK, tint]
        )
    )
    overprint = out.make_indirect(
        pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, OP=True, op=True, OPM=1)
    )
    return space, overprint


def cut_ops(
    plan: CutPlan,
    printed: Rect,
    origin: tuple[float, float],
    physical: tuple[float, float, float, float],
    color: str,
    state: str,
) -> tuple[str, int]:
    """Content for one panel page and how many contour pieces it cuts.

    `origin` is where the printed window's lower-left corner sits on the page (points).
    """

    paths: list[str] = []
    pieces = 0

    def to_page(x: float, y: float) -> tuple[float, float]:
        return origin[0] + (x - printed.x) * MM, origin[1] + (y - printed.y) * MM

    def ring(coords) -> str:
        points = [to_page(x, y) for x, y in list(coords)[:-1]]
        head = f"{_num(points[0][0])} {_num(points[0][1])} m "
        return head + " ".join(f"{_num(x)} {_num(y)} l" for x, y in points[1:]) + " h"

    if plan.contour is not None and plan.close_at_edge:
        # The piece of the die line inside the panel, closed along the panel edge.
        window = box(printed.x, printed.y, printed.x + printed.w, printed.y + printed.h)
        for polygon in _polygons(plan.contour.intersection(window)):
            polygon = polygon.simplify(_TOLERANCE_MM)
            if polygon.is_empty or polygon.area <= 0:
                continue
            paths.append(ring(polygon.exterior.coords))
            paths.extend(ring(hole.coords) for hole in polygon.interiors)
            pieces += 1
    elif plan.contour is not None:
        window = box(printed.x, printed.y, printed.x + printed.w, printed.y + printed.h)
        inside = _lines(plan.contour.boundary.intersection(window))
        # The cut of a ring can come back in two pieces that meet where the ring starts.
        merged = _lines(linemerge(inside)) if len(inside) > 1 else inside
        for line in merged:
            line = line.simplify(_TOLERANCE_MM)
            points = [
                (origin[0] + (x - printed.x) * MM, origin[1] + (y - printed.y) * MM)
                for x, y in line.coords
            ]
            if len(points) < 2:
                continue
            closed = line.is_ring
            if closed:
                points = points[:-1]
            head = f"{_num(points[0][0])} {_num(points[0][1])} m "
            body = " ".join(f"{_num(x)} {_num(y)} l" for x, y in points[1:])
            paths.append(head + body + (" h" if closed else ""))
            pieces += 1
    if plan.panel_edge:
        x0, y0, x1, y1 = physical
        paths.append(f"{_num(x0)} {_num(y0)} {_num(x1 - x0)} {_num(y1 - y0)} re")
    if not paths:
        return "", 0
    return (
        f"q {state} gs {color} CS 1 SCN {_num(plan.width_pt)} w 1 J 1 j "
        + " ".join(paths)
        + " S Q",
        pieces,
    )
