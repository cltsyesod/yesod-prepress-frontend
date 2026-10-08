"""Silhouette of the printed artwork, used to create a die line around it.

The page is rendered on a transparent background in tiles, at a fixed resolution
per millimetre of the finished piece (so large pieces keep their precision). Every
painted pixel belongs to the artwork, except paper-white background: a white area
connected to the edge of the page, or a white box behind the whole artwork, is not
printed and must not be cut around. White *inside* the artwork (a white border, a
white letter) stays part of it.

Pixel runs are merged into polygons; holes (unprinted areas enclosed by the art)
are kept, so the operator can choose to cut them; tiny specks are ignored.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pypdfium2
import shapely
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

MM = 72 / 25.4
DEFAULT_RESOLUTION_MM = 0.1  # pixel size at final size
_MAX_RASTER_PIXELS = 120_000_000  # whole region; coarser beyond this
_TILE = 4096  # pixels per tile side
_WHITE = 245  # RGB at or above this (opaque) is paper white


def artwork_silhouette(
    path: Path,
    page_index: int,
    region: tuple[float, float, float, float],
    origin: tuple[float, float] = (0.0, 0.0),
    *,
    file_scale: float = 1.0,
    resolution_mm: float = DEFAULT_RESOLUTION_MM,
    white_is_background: bool = True,
) -> BaseGeometry | None:
    """Outline of everything printed inside `region` (PDF points), in PDF points.

    `origin` is the lower-left corner of the rendered area (the CropBox), because the
    raster starts there and not at the PDF origin. `file_scale` turns the resolution
    (given at final size) into file units: a 1:10 file is rendered 10x finer.
    """

    x0, y0, x1, y1 = region
    if x1 <= x0 or y1 <= y0:
        return None
    px = resolution_mm / max(file_scale, 1e-9) * MM  # points per pixel
    pixels = (x1 - x0) * (y1 - y0) / (px * px)
    if pixels > _MAX_RASTER_PIXELS:
        px *= math.sqrt(pixels / _MAX_RASTER_PIXELS)

    color_parts: list[BaseGeometry] = []
    white_parts: list[BaseGeometry] = []
    document = pypdfium2.PdfDocument(str(path))
    try:
        page = document[page_index]
        width_pt, height_pt = page.get_size()
        # Region relative to the rendered page (whose lower-left corner is `origin`).
        rx0, ry0 = max(0.0, x0 - origin[0]), max(0.0, y0 - origin[1])
        rx1, ry1 = min(width_pt, x1 - origin[0]), min(height_pt, y1 - origin[1])
        step = _TILE * px
        ty = ry0
        while ty < ry1 - 1e-6:
            top = min(ty + step, ry1)
            tx = rx0
            while tx < rx1 - 1e-6:
                right = min(tx + step, rx1)
                color, white = _tile(page, (tx, ty, right, top), (width_pt, height_pt), px)
                offset = (origin[0] + tx, origin[1] + ty)
                if color is not None:
                    color_parts.append(affinity.translate(color, *offset))
                if white is not None and white_is_background:
                    white_parts.append(affinity.translate(white, *offset))
                elif white is not None:
                    color_parts.append(affinity.translate(white, *offset))
                tx = right
            ty = top
    finally:
        document.close()

    color = shapely.union_all(color_parts) if color_parts else Polygon()
    if white_parts:
        color = unary_union([color, *_white_artwork(shapely.union_all(white_parts), color, region)])
    if color.is_empty:
        return None

    minimum_area = (3 * px) ** 2  # specks of a few pixels are noise, not artwork
    outlines = []
    for part in _polygons(color):
        if part.area <= minimum_area:
            continue
        holes = [ring for ring in part.interiors if Polygon(ring).area > minimum_area * 4]
        outlines.append(Polygon(part.exterior, holes).simplify(px * 0.75))
    return unary_union(outlines) if outlines else None


def _tile(page, crop, size, px):
    """Polygons (tile coordinates, points) of coloured and of paper-white pixels."""

    left, bottom, right, top = crop
    width_pt, height_pt = size
    bitmap = page.render(
        scale=1.0 / px,
        crop=(left, bottom, width_pt - right, height_pt - top),
        fill_color=(255, 255, 255, 0),
        draw_annots=False,
    )
    rgba = np.asarray(bitmap.to_pil().convert("RGBA"))
    alpha = rgba[:, :, 3]
    whiteish = (rgba[:, :, :3].min(axis=2) >= _WHITE) & (alpha > 16)
    painted = (alpha > 16) & ~whiteish
    height = top - bottom
    return _mask_polygons(painted, px, height), _mask_polygons(whiteish, px, height)


def _mask_polygons(mask: np.ndarray, px: float, height_pt: float) -> BaseGeometry | None:
    """Union of the pixel runs of `mask`; identical runs on consecutive rows merge first."""

    if not mask.any():
        return None
    boxes = []
    open_runs: dict[tuple[int, int], int] = {}  # (start, end) -> first row
    rows = mask.shape[0]
    for row in range(rows + 1):
        runs: set[tuple[int, int]] = set()
        if row < rows and mask[row].any():
            edges = np.diff(np.concatenate([[0], mask[row].astype(np.int8), [0]]))
            starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
            runs = set(zip(starts.tolist(), ends.tolist(), strict=True))
        for run in [r for r in open_runs if r not in runs]:
            first = open_runs.pop(run)
            # A hair of overlap so neighbouring runs and tiles merge into one outline.
            boxes.append(
                (
                    run[0] * px - px * 0.01,
                    height_pt - row * px - px * 0.02,
                    run[1] * px + px * 0.01,
                    height_pt - first * px,
                )
            )
        for run in runs:
            open_runs.setdefault(run, row)
    return shapely.union_all(shapely.box(*np.array(boxes).T)) if boxes else None


def _white_artwork(white: BaseGeometry, color: BaseGeometry, region) -> list[BaseGeometry]:
    """White areas that are part of the artwork (not the paper or a background box)."""

    edge = box(*region).exterior.buffer(1.0)
    color_area = color.area
    kept = []
    for part in _polygons(white):
        if part.intersects(edge):
            continue  # reaches the page edge: background
        # The art painted over the box leaves holes in it: judge the box by its outline.
        filled = Polygon(part.exterior)
        if (
            color_area > 0
            and filled.area >= 0.97 * part.envelope.area
            and filled.intersection(color).area >= 0.9 * color_area
        ):
            continue  # a white box behind the whole artwork
        kept.append(part)
    return kept


def _polygons(geometry: BaseGeometry) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry] if not geometry.is_empty else []
    return [g for g in getattr(geometry, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]


def contour_die_line(
    silhouette: BaseGeometry, offset_pt: float, *, cut_holes: bool = False
) -> BaseGeometry:
    """Die line around the artwork: positive offset goes outward, negative inward.

    With `cut_holes`, unprinted areas enclosed by the artwork are cut too (the cut
    stays off the art: growing the outline shrinks the holes by the same offset).
    """

    grown = (
        silhouette.buffer(offset_pt, join_style="round", quad_segs=8) if offset_pt else silhouette
    )
    return unary_union(
        [Polygon(p.exterior, p.interiors if cut_holes else []) for p in _polygons(grown)]
    )


def outer(geometry: BaseGeometry) -> BaseGeometry:
    """The outlines without holes (the area a piece occupies on the material)."""

    return unary_union([Polygon(p.exterior) for p in _polygons(geometry)])
