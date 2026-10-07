from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pikepdf

from app.nesting.engine import Material, NestItem, NestResult, efficiency, nest, rotation_steps
from app.nesting.imposition import CutLines, SourcePiece, build_layout
from app.nesting.shapes import contour_pieces, page_pieces, scaled

MM = 72 / 25.4


@dataclass(slots=True)
class PlanItem:
    key: str
    path: Path
    label: str = ""
    quantity: int = 1
    pages: list[int] = field(default_factory=list)
    """Pages to use (1-based); empty = all pages."""
    file_scale: float = 1.0
    bleed_mm: float = 0.0
    """Bleed at final size, used only when the piece has a die line or no BleedBox."""
    cut_names: list[str] = field(default_factory=lambda: ["CutContour", "Corte", "Cut"])
    use_die_line: bool = True


@dataclass(slots=True)
class PlanOptions:
    width_mm: float
    length_mm: float | None = None
    margin_mm: float = 0.0
    gap_mm: float = 0.0
    allow_rotation: bool = True
    rotation_step: float = 90.0
    cut_lines: CutLines = field(default_factory=CutLines)
    max_roll_length_mm: float = 5000.0


def _rotations_for(piece_is_rectangle: bool, steps: tuple[float, ...]) -> tuple[float, ...]:
    if not piece_is_rectangle:
        return steps
    # A rectangle only has two useful orientations; other angles just waste material.
    useful = tuple(r for r in steps if r in (0.0, 90.0))
    return useful or (0.0,)


def plan(items: list[PlanItem], options: PlanOptions, output: Path) -> dict:
    material = Material(
        width=options.width_mm * MM,
        length=options.length_mm * MM if options.length_mm else None,
        margin=options.margin_mm * MM,
        gap=options.gap_mm * MM,
        max_roll_length=options.max_roll_length_mm * MM,
    )
    steps = rotation_steps(options.rotation_step, options.allow_rotation)

    opened: list[pikepdf.Pdf] = []
    sources: dict[str, SourcePiece] = {}
    nest_items: list[NestItem] = []
    try:
        for item in items:
            pdf = pikepdf.open(item.path)
            opened.append(pdf)
            # No page list = every page of the file is part of the job.
            numbers = item.pages or list(range(1, len(pdf.pages) + 1))
            for number in numbers:
                if not 1 <= number <= len(pdf.pages):
                    continue
                page = pdf.pages[number - 1]
                bleed_in_file = item.bleed_mm / item.file_scale * MM
                shapes = page_pieces(page, item.cut_names, bleed_in_file, item.use_die_line)
                if options.cut_lines.add and not shapes[0].from_die_line:
                    # No die line in the file: the system traces it around the artwork.
                    traced = contour_pieces(
                        item.path,
                        page,
                        number - 1,
                        offset_pt=options.cut_lines.offset_mm / item.file_scale * MM,
                        merge_pt=options.cut_lines.merge_mm / item.file_scale * MM,
                    )
                    shapes = traced or shapes
                for index, shape in enumerate(shapes, start=1):
                    key = f"{item.key}#{number}.{index}"
                    sources[key] = SourcePiece(
                        pdf=pdf,
                        page_index=number - 1,
                        scale=item.file_scale,
                        shape=shape,
                        label=item.label,
                    )
                    outline = scaled(shape.bleed, item.file_scale)
                    envelope = outline.envelope.area
                    rectangle = abs(outline.area - envelope) < 1e-6 * envelope
                    nest_items.append(
                        NestItem(
                            key=key,
                            outline=outline,
                            quantity=item.quantity,
                            rotations=_rotations_for(rectangle, steps),
                        )
                    )

        result = nest(nest_items, material)
        layout = build_layout(result, material, sources, options.cut_lines)
        layout.save(output)
        return summarize(result, material, sources)
    finally:
        for pdf in opened:
            pdf.close()


def summarize(result: NestResult, material: Material, sources: dict[str, SourcePiece]) -> dict:
    sheets = [
        {
            "index": sheet.index + 1,
            "pieces": len(sheet.placements),
            "lengthMm": round((material.length or sheet.used_length + material.margin) / MM, 1),
            "efficiency": round(efficiency(sheet, material), 4),
        }
        for sheet in result.sheets
        if sheet.placements
    ]
    return {
        "widthMm": round(material.width / MM, 1),
        "sheets": sheets,
        "totalLengthMm": round(sum(sheet["lengthMm"] for sheet in sheets), 1),
        "placed": len(result.placements),
        "unplaced": [
            {
                "key": key.split("#")[0],
                "label": sources[key].label,
                "copy": copy + 1,
                "reason": reason,
            }
            for key, copy, reason in result.unplaced
        ],
        "dieLines": sorted(
            {sources[key].label for key in sources if sources[key].shape.from_die_line}
        ),
    }
