from __future__ import annotations

import math

import pikepdf

from app.analyzer.context import ImageInfo


def _name(value: object) -> str:
    if value is None:
        return "Unknown"
    if isinstance(value, pikepdf.Array):
        return "/".join(str(item).lstrip("/") for item in value[:2])
    return str(value).lstrip("/")


def _image_placements(page: pikepdf.Page) -> dict[str, list[tuple[float, float]]]:
    """Collect image placement sizes in PDF points from simple cm/Do sequences.

    This covers the dominant generated-PDF pattern. Complex nested form XObjects
    remain detectable but their effective DPI is reported as unknown instead of
    guessed.
    """

    placements: dict[str, list[tuple[float, float]]] = {}
    current = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    stack: list[tuple[float, float, float, float, float, float]] = []
    try:
        instructions = pikepdf.parse_content_stream(page)
    except Exception:
        return placements
    for instruction in instructions:
        operands, operator = instruction
        op = str(operator)
        if op == "q":
            stack.append(current)
        elif op == "Q":
            current = stack.pop() if stack else (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        elif op == "cm" and len(operands) == 6:
            try:
                a, b, c, d, e, f = (float(value) for value in operands)
                ca, cb, cc, cd, ce, cf = current
                current = (
                    ca * a + cc * b,
                    cb * a + cd * b,
                    ca * c + cc * d,
                    cb * c + cd * d,
                    ca * e + cc * f + ce,
                    cb * e + cd * f + cf,
                )
            except (TypeError, ValueError):
                continue
        elif op == "Do" and operands:
            resource_name = str(operands[0])
            a, b, c, d, _, _ = current
            width_pt = math.hypot(a, b)
            height_pt = math.hypot(c, d)
            if width_pt > 0 and height_pt > 0:
                placements.setdefault(resource_name, []).append((width_pt, height_pt))
    return placements


def inspect_images(pdf: pikepdf.Pdf) -> list[ImageInfo]:
    results: list[ImageInfo] = []
    for page_number, page in enumerate(pdf.pages, start=1):
        placements = _image_placements(page)
        for resource_name, image in page.images.items():
            width = int(image.get("/Width", 0) or 0)
            height = int(image.get("/Height", 0) or 0)
            uses = placements.get(str(resource_name), [])
            if uses and width and height:
                # Lowest effective resolution is the relevant production risk.
                dpi_pairs = [
                    (width * 72.0 / width_pt, height * 72.0 / height_pt)
                    for width_pt, height_pt in uses
                ]
                dpi_x, dpi_y = min(dpi_pairs, key=lambda pair: min(pair))
            else:
                dpi_x = dpi_y = None
            results.append(
                ImageInfo(
                    page=page_number,
                    object_id=str(resource_name),
                    width_px=width,
                    height_px=height,
                    effective_dpi_x=dpi_x,
                    effective_dpi_y=dpi_y,
                    color_space=_name(image.get("/ColorSpace")),
                    bits_per_component=(
                        int(image.get("/BitsPerComponent"))
                        if image.get("/BitsPerComponent") is not None
                        else None
                    ),
                    has_transparency=(
                        image.get("/SMask") is not None or image.get("/Mask") is not None
                    ),
                )
            )
    return results
