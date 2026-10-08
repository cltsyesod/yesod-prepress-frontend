"""Marks drawn on a nested layout, always outside the printed pieces.

- Registration marks for print-and-cut plotters (optical sensors read them to align
  the cut with the print). They sit in a band along the material edges that the
  nesting keeps free, so they never touch a piece.
- Crop marks for rectangular pieces without a die line: short lines in line with the
  trim edges, starting outside the bleed and clipped wherever they would reach
  another piece.
- A slug line identifying the layout, in the bottom margin.

Shapes, sizes and spacing come from the operator (each plotter brand has its own
pattern); nothing here is a fixed production value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import LineString, MultiLineString, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.fixes.paths import circle

MM = 72 / 25.4


@dataclass(slots=True)
class Marks:
    registration: str = "none"
    """"none", "sides" (squares along both long edges), "corners" (four corners)."""
    shape: str = "square"
    """"square" or "circle"."""
    size_mm: float = 3.0
    distance_mm: float = 5.0
    """Clearance between the marks and the nearest piece."""
    spacing_mm: float = 500.0
    """Largest distance between marks along an edge ("sides")."""
    crop_marks: bool = False
    crop_length_mm: float = 5.0
    crop_offset_mm: float = 2.0
    slug: str = ""
    """Text printed in the bottom margin (empty = no slug)."""

    @property
    def band(self) -> float:
        """Width (pt) of the edge band reserved for registration marks."""

        if self.registration == "none":
            return 0.0
        return (self.size_mm + self.distance_mm) * MM


def _num(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def registration_marks(marks: Marks, width: float, length: float, edge: float) -> str:
    """Filled marks (100% K) in the band between `edge` (material margin) and the pieces."""

    if marks.registration == "none":
        return ""
    size = marks.size_mm * MM
    left, right = edge, width - edge - size
    bottom, top = edge, length - edge - size
    positions = {(left, bottom), (right, bottom), (left, top), (right, top)}
    if marks.registration == "sides" and marks.spacing_mm > 0:
        span = top - bottom
        count = max(1, math.ceil(span / (marks.spacing_mm * MM) - 1e-9))
        for i in range(1, count):
            y = bottom + span * i / count
            positions.update({(left, y), (right, y)})
    shapes = []
    for x, y in sorted(positions):
        if marks.shape == "circle":
            shapes.append(circle(x + size / 2, y + size / 2, size / 2))
        else:
            shapes.append(f"{_num(x)} {_num(y)} {_num(size)} {_num(size)} re")
    return "q 0 0 0 1 k " + " ".join(shapes) + " f Q"


def crop_marks(
    marks: Marks, rectangles: list[tuple[BaseGeometry, BaseGeometry]], keep_out: BaseGeometry
) -> str:
    """Corner marks for (trim, printed area) rectangles; segments over any piece are dropped."""

    if not marks.crop_marks or not rectangles:
        return ""
    length, offset = marks.crop_length_mm * MM, marks.crop_offset_mm * MM
    clearance = keep_out.buffer(0.5 * MM)
    segments = []
    for trim, printed in rectangles:
        x0, y0, x1, y1 = trim.bounds
        px0, py0, px1, py1 = printed.bounds
        for x in (x0, x1):
            segments.append(LineString([(x, py0 - offset), (x, py0 - offset - length)]))
            segments.append(LineString([(x, py1 + offset), (x, py1 + offset + length)]))
        for y in (y0, y1):
            segments.append(LineString([(px0 - offset, y), (px0 - offset - length, y)]))
            segments.append(LineString([(px1 + offset, y), (px1 + offset + length, y)]))
    free = unary_union(segments).difference(clearance)
    lines = free.geoms if isinstance(free, MultiLineString) else [free]
    ops = []
    for line in lines:
        if not isinstance(line, LineString) or line.length < 1 * MM:
            continue
        (ax, ay), (bx, by) = line.coords[0], line.coords[-1]
        ops.append(f"{_num(ax)} {_num(ay)} m {_num(bx)} {_num(by)} l")
    if not ops:
        return ""
    return "q 0 0 0 1 K 0.25 w 0 J " + " ".join(ops) + " S Q"


SLUG_SIZE = 6.0  # pt
SLUG_BAND = SLUG_SIZE + 2 * MM  # height reserved above the last piece


def slug(text: str, x: float, y: float, right: float, keep_out: BaseGeometry, font: str) -> str:
    """One line of text (Helvetica, 100% K) at (x, y), only if it stays clear of the pieces."""

    if not text.strip():
        return ""
    if box(x, y, right, y + SLUG_SIZE).intersects(keep_out.buffer(1 * MM)):
        return ""
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    safe = safe.encode("cp1252", "replace").decode("cp1252")
    return f"BT {font} {_num(SLUG_SIZE)} Tf 0 0 0 1 k {_num(x)} {_num(y)} Td ({safe}) Tj ET"
