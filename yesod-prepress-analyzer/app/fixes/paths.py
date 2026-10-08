"""PDF path operators for outlines (die lines, clips).

Traced outlines are dense polylines. For die lines they are written as smooth cubic
Bézier curves through the points (Catmull-Rom), so a circle is cut as a curve and
not as a faceted polygon; sharp corners (a star tip, a rectangle corner) stay sharp.
"""

from __future__ import annotations

import math

from shapely.geometry import LinearRing, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

_CORNER_DEGREES = 40.0  # turning more than this at a point keeps it a corner


def _num(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def _rings(geometry: BaseGeometry) -> list[LinearRing]:
    polygons = geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]
    rings: list[LinearRing] = []
    for polygon in polygons:
        if isinstance(polygon, Polygon) and not polygon.is_empty:
            rings.extend([polygon.exterior, *polygon.interiors])
    return rings


def pdf_path(geometry: BaseGeometry, *, smooth: bool = False, tolerance: float = 0.0) -> str:
    """Path operators (m/l/c/h) for every ring of the polygons in `geometry`."""

    ops: list[str] = []
    for ring in _rings(geometry):
        if tolerance > 0:
            ring = ring.simplify(tolerance)
        points = list(ring.coords)[:-1]
        if len(points) < 3:
            continue
        ops.append(_curved(points) if smooth else _straight(points))
    return " ".join(ops)


def _straight(points: list[tuple[float, float]]) -> str:
    head = f"{_num(points[0][0])} {_num(points[0][1])} m "
    return head + " ".join(f"{_num(x)} {_num(y)} l" for x, y in points[1:]) + " h"


def _turn(prev, point, nxt) -> float:
    a = math.atan2(point[1] - prev[1], point[0] - prev[0])
    b = math.atan2(nxt[1] - point[1], nxt[0] - point[0])
    return abs((math.degrees(b - a) + 180) % 360 - 180)


def _handle(point, before, after, length: float) -> tuple[float, float]:
    """Control point at `point`, along the before->after tangent, `length` away."""

    dx, dy = after[0] - before[0], after[1] - before[1]
    norm = math.hypot(dx, dy)
    if norm == 0:
        return point
    return point[0] + dx / norm * length, point[1] + dy / norm * length


def _curved(points: list[tuple[float, float]]) -> str:
    n = len(points)
    corner = [
        _turn(points[i - 1], points[i], points[(i + 1) % n]) > _CORNER_DEGREES for i in range(n)
    ]
    ops = [f"{_num(points[0][0])} {_num(points[0][1])} m"]
    for i in range(n):
        p0, p1 = points[i - 1], points[i]
        p2, p3 = points[(i + 1) % n], points[(i + 2) % n]
        if corner[i] and corner[(i + 1) % n]:
            ops.append(f"{_num(p2[0])} {_num(p2[1])} l")
            continue
        # Handles follow the tangent at each point but never reach past a third of this
        # segment: next to a long straight edge a curve must not bulge out.
        length = math.dist(p1, p2) / 3
        c1 = p1 if corner[i] else _handle(p1, p0, p2, length)
        c2 = p2 if corner[(i + 1) % n] else _handle(p2, p3, p1, length)
        ops.append(
            f"{_num(c1[0])} {_num(c1[1])} {_num(c2[0])} {_num(c2[1])} "
            f"{_num(p2[0])} {_num(p2[1])} c"
        )
    ops.append("h")
    return " ".join(ops)
