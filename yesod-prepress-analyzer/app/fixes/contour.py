"""Silhouette of the printed artwork, used to create a die line around it.

The page is rendered on a transparent background; every painted pixel (vectors,
images, text, even white objects) belongs to the artwork. Pixel runs are merged
into polygons, holes are dropped (the cut follows the outside), tiny specks are
ignored, and the result is offset by the operator's distance.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pypdfium2
import shapely
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

_MAX_PIXELS = 1600  # longest side of the analysis raster


def artwork_silhouette(
    path: Path,
    page_index: int,
    region: tuple[float, float, float, float],
    origin: tuple[float, float] = (0.0, 0.0),
) -> BaseGeometry | None:
    """Outline of everything painted inside `region` (PDF points), in PDF points.

    `origin` is the lower-left corner of the rendered area (the CropBox), because the
    raster starts there and not at the PDF origin.
    """

    document = pypdfium2.PdfDocument(str(path))
    try:
        page = document[page_index]
        width_pt, height_pt = page.get_size()
        scale = _MAX_PIXELS / max(width_pt, height_pt)
        bitmap = page.render(scale=scale, fill_color=(255, 255, 255, 0), draw_annots=False)
        rgba = np.asarray(bitmap.to_pil().convert("RGBA"))
    finally:
        document.close()

    painted = rgba[:, :, 3] > 16
    rows, cols = painted.shape
    px = 1.0 / scale  # points per pixel
    boxes = []
    for row in range(rows):
        line = painted[row]
        if not line.any():
            continue
        edges = np.diff(np.concatenate([[0], line.astype(np.int8), [0]]))
        starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
        top = origin[1] + height_pt - row * px
        for start, end in zip(starts, ends, strict=True):
            # Rows overlap a hair so neighbouring runs merge into one outline.
            boxes.append((origin[0] + start * px, top - px * 1.02, origin[0] + end * px, top))
    if not boxes:
        return None

    union = shapely.union_all(shapely.box(*np.array(boxes).T))
    x0, y0, x1, y1 = region
    union = union.intersection(shapely.box(x0, y0, x1, y1))
    parts = union.geoms if isinstance(union, MultiPolygon) else [union]
    minimum_area = (2 * px) ** 2 * 4  # specks of a few pixels are noise, not artwork
    outlines = [
        Polygon(part.exterior).simplify(px * 0.75)
        for part in parts
        if isinstance(part, Polygon) and part.area > minimum_area
    ]
    return unary_union(outlines) if outlines else None


def contour_die_line(silhouette: BaseGeometry, offset_pt: float) -> BaseGeometry:
    """Die line around the artwork: positive offset goes outward, negative inward."""

    grown = (
        silhouette.buffer(offset_pt, join_style="round", quad_segs=8) if offset_pt else silhouette
    )
    parts = grown.geoms if isinstance(grown, MultiPolygon) else [grown]
    return unary_union([Polygon(p.exterior) for p in parts if isinstance(p, Polygon)])
