"""Die lines drawn in plain 100% magenta instead of a cut separation.

Many clients draw the die line as a magenta stroke (CMYK 0/100/0/0 or RGB
255/0/255) without naming a spot colour, so the RIP prints it instead of cutting.
Detection counts those strokes; conversion only swaps their *stroke* colour for
the cut separation. Fills (the artwork) are never touched, and nothing moves.
"""

from __future__ import annotations

import logging

import pikepdf

logger = logging.getLogger(__name__)

_MAGENTA = {
    4: (0.0, 1.0, 0.0, 0.0),  # DeviceCMYK
    3: (1.0, 0.0, 1.0),  # DeviceRGB
}
_STROKE_ONLY = {"S", "s"}
_TOLERANCE = 0.02


def _is_magenta(values: list[float]) -> bool:
    target = _MAGENTA.get(len(values))
    return target is not None and all(
        abs(v - t) <= _TOLERANCE for v, t in zip(values, target, strict=True)
    )


def _numbers(operands) -> list[float] | None:
    try:
        return [float(v) for v in operands]
    except (TypeError, ValueError):
        return None


def _scan(page: pikepdf.Page):
    """Yields (index, operator) of every operator that sets the stroke colour to magenta,
    and counts the stroke-only paths painted with it."""

    try:
        instructions = list(pikepdf.parse_content_stream(page))
    except Exception:
        logger.debug("unable to parse page content for magenta die lines", exc_info=True)
        return [], [], 0
    setters: list[int] = []
    stroke_space = "/DeviceGray"
    magenta = False
    pending: list[int] = []
    strokes = 0
    stack: list[tuple[str, bool, list[int]]] = []
    for index, (operands, operator) in enumerate(instructions):
        op = str(operator)
        if op == "q":
            stack.append((stroke_space, magenta, pending))
        elif op == "Q" and stack:
            stroke_space, magenta, pending = stack.pop()
        elif op == "CS" and operands:
            stroke_space = str(operands[0])
            magenta = False
        elif op in {"K", "RG", "G"}:
            values = _numbers(operands)
            magenta = op != "G" and values is not None and _is_magenta(values)
            pending = [index] if magenta else []
        elif op in {"SC", "SCN"} and stroke_space in {"/DeviceCMYK", "/DeviceRGB"}:
            values = _numbers(operands)
            magenta = values is not None and _is_magenta(values)
            pending = [index] if magenta else []
        elif op in _STROKE_ONLY and magenta:
            strokes += 1
            setters.extend(i for i in pending if i not in setters)
    return instructions, setters, strokes


def magenta_strokes(page: pikepdf.Page) -> int:
    """Stroke-only paths painted in plain 100% magenta on the page."""

    return _scan(page)[2]


def convert_magenta_strokes(
    pdf: pikepdf.Pdf, page: pikepdf.Page, cut_space: pikepdf.Object
) -> int:
    """Turns the magenta stroke colour of stroke-only paths into the cut separation.

    Returns how many paths now use the cut separation.
    """

    instructions, setters, strokes = _scan(page)
    if not strokes:
        return 0
    name = page.add_resource(cut_space, pikepdf.Name.ColorSpace, prefix="YesodCut")
    out = []
    for index, (operands, operator) in enumerate(instructions):
        if index in setters:
            # The colour space must be set before SCN; both only affect stroking.
            out.append(pikepdf.ContentStreamInstruction([name], pikepdf.Operator("CS")))
            out.append(pikepdf.ContentStreamInstruction([1], pikepdf.Operator("SCN")))
        else:
            out.append(pikepdf.ContentStreamInstruction(operands, operator))
    page.obj.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    return strokes
