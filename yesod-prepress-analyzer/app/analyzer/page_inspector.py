from __future__ import annotations

from typing import cast

import pikepdf

from app.analyzer.context import PageInfo
from app.fixes.magenta import magenta_strokes


def _box(page: pikepdf.Page, name: str) -> tuple[float, float, float, float] | None:
    value = page.obj.get(name)
    if value is None or len(value) != 4:
        return None
    try:
        return cast(tuple[float, float, float, float], tuple(float(item) for item in value))
    except (TypeError, ValueError):
        return None


def _die_line_box(
    page: pikepdf.Page, cut_names: list[str] | None
) -> tuple[float, float, float, float] | None:
    if not cut_names:
        return None
    from app.nesting.shapes import die_line  # shapely is only needed when there are cut names

    shape = die_line(page, cut_names)
    return None if shape is None or shape.is_empty else tuple(shape.bounds)  # type: ignore[return-value]


def inspect_pages(pdf: pikepdf.Pdf, cut_names: list[str] | None = None) -> list[PageInfo]:
    pages: list[PageInfo] = []
    for number, page in enumerate(pdf.pages, start=1):
        media = _box(page, "/MediaBox") or (0.0, 0.0, 0.0, 0.0)
        die_line_box = _die_line_box(page, cut_names)
        pages.append(
            PageInfo(
                number=number,
                media_box=media,
                crop_box=_box(page, "/CropBox"),
                trim_box=_box(page, "/TrimBox"),
                bleed_box=_box(page, "/BleedBox"),
                art_box=_box(page, "/ArtBox"),
                rotation=int(page.obj.get("/Rotate", 0) or 0),
                die_line_box=die_line_box,
                # Only meaningful when the page has no proper die line.
                magenta_strokes=magenta_strokes(page) if die_line_box is None else 0,
            )
        )
    return pages


def box_size_mm(box: tuple[float, float, float, float]) -> tuple[float, float]:
    points_to_mm = 25.4 / 72.0
    return (
        abs(box[2] - box[0]) * points_to_mm,
        abs(box[3] - box[1]) * points_to_mm,
    )


def bleed_margins_mm(
    trim: tuple[float, float, float, float], bleed: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    pt_to_mm = 25.4 / 72.0
    left = (trim[0] - bleed[0]) * pt_to_mm
    bottom = (trim[1] - bleed[1]) * pt_to_mm
    right = (bleed[2] - trim[2]) * pt_to_mm
    top = (bleed[3] - trim[3]) * pt_to_mm
    return left, bottom, right, top
