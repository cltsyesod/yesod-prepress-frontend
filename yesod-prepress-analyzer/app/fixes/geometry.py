from __future__ import annotations

from app.analyzer.context import PageInfo
from app.contracts.production_profile import ProductionProfile

Box = tuple[float, float, float, float]

MM = 72.0 / 25.4
"""Points per millimetre."""


def normalize(box: Box) -> Box:
    return (min(box[0], box[2]), min(box[1], box[3]), max(box[0], box[2]), max(box[1], box[3]))


def visible_box(page: PageInfo) -> Box:
    """The area the viewer and the RIP see: CropBox clipped to MediaBox."""

    media = normalize(page.media_box)
    if page.crop_box is None:
        return media
    crop = normalize(page.crop_box)
    return (
        max(media[0], crop[0]),
        max(media[1], crop[1]),
        min(media[2], crop[2]),
        min(media[3], crop[3]),
    )


def expand(box: Box, by: float) -> Box:
    return (box[0] - by, box[1] - by, box[2] + by, box[3] + by)


def intersect(box: Box, limit: Box) -> Box:
    return (
        max(box[0], limit[0]),
        max(box[1], limit[1]),
        min(box[2], limit[2]),
        min(box[3], limit[3]),
    )


def target_trim(page: PageInfo, profile: ProductionProfile) -> tuple[Box, str]:
    """TrimBox the fixer will use, and how it was chosen (shown to the operator).

    An existing TrimBox always wins. Otherwise, when the job ticket gives the final
    size and it fits on the page, the trim is that size centred on the page (the
    extra area is treated as bleed); when it does not, the whole visible page is
    the finished format.
    """

    if page.trim_box is not None:
        return normalize(page.trim_box), "TrimBox existente"
    visible = visible_box(page)
    width, height = visible[2] - visible[0], visible[3] - visible[1]
    if profile.final_width_mm and profile.final_height_mm:
        w = profile.final_width_mm / profile.file_scale * MM
        h = profile.final_height_mm / profile.file_scale * MM
        if (w > h) != (width > height):
            w, h = h, w
        tolerance = profile.dimension_tolerance_mm / profile.file_scale * MM
        if w <= width + tolerance and h <= height + tolerance:
            w, h = min(w, width), min(h, height)
            x = visible[0] + (width - w) / 2
            y = visible[1] + (height - h) / 2
            return (x, y, x + w, y + h), "medida da ficha centralizada na página"
    return visible, "página inteira como formato final"


def describe_mm(box: Box, scale: float = 1.0) -> str:
    width = (box[2] - box[0]) / MM * scale
    height = (box[3] - box[1]) / MM * scale
    return f"{width:.1f} × {height:.1f} mm"
