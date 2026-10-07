"""Builds the nested layout PDF: every piece placed as a form XObject.

Pieces keep their own content (vectors, images, fonts, spot colours and die line)
untouched; each one is only scaled to final size, rotated, moved and clipped to its
printed area so neighbours never overlap.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pikepdf
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from app.nesting.engine import Material, NestResult, Placement
from app.nesting.shapes import PieceShape


@dataclass(slots=True)
class SourcePiece:
    pdf: pikepdf.Pdf
    page_index: int
    scale: float
    """Factor from the file to final size (10 for a 1:10 file)."""
    shape: PieceShape
    """Outlines in source points."""
    label: str = ""


@dataclass(slots=True)
class CutLines:
    add: bool = False
    """Draw the cut line of pieces that have no die line of their own."""
    name: str = "CutContour"
    width_pt: float = 0.25


def _num(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def placed(geometry: BaseGeometry, source: SourcePiece, placement: Placement) -> BaseGeometry:
    """Source outline -> position on the layout (same transform as the content)."""

    scaled = affinity.scale(geometry, source.scale, source.scale, origin=(0, 0))
    rotated = affinity.rotate(scaled, placement.rotation, origin=(0, 0))
    return affinity.translate(rotated, *placement.offset)


def _matrix(source: SourcePiece, placement: Placement) -> str:
    angle = math.radians(placement.rotation)
    s = source.scale
    a, b = s * math.cos(angle), s * math.sin(angle)
    e, f = placement.offset
    return f"{_num(a)} {_num(b)} {_num(-b)} {_num(a)} {_num(e)} {_num(f)} cm"


def _path(geometry: BaseGeometry) -> str:
    polygons = geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]
    ops: list[str] = []
    for polygon in polygons:
        if not isinstance(polygon, Polygon) or polygon.is_empty:
            continue
        for ring in [polygon.exterior, *polygon.interiors]:
            coords = list(ring.coords)
            ops.append(f"{_num(coords[0][0])} {_num(coords[0][1])} m")
            ops.extend(f"{_num(x)} {_num(y)} l" for x, y in coords[1:-1])
            ops.append("h")
    return " ".join(ops)


def _register_layers(out: pikepdf.Pdf, form: pikepdf.Object, known: set) -> None:
    """Optional-content groups used by a piece (e.g. its die line) become layers of the layout."""

    properties = form.get("/Resources", {}).get("/Properties", {})
    for _, group in properties.items():
        if not isinstance(group, pikepdf.Dictionary) or group.get("/Type") != pikepdf.Name.OCG:
            continue
        if group.objgen in known:
            continue
        known.add(group.objgen)
        _add_layer(out, group)


def _add_layer(out: pikepdf.Pdf, group: pikepdf.Object) -> None:
    root = out.Root
    if "/OCProperties" not in root:
        root.OCProperties = pikepdf.Dictionary(
            OCGs=pikepdf.Array(), D=pikepdf.Dictionary(Order=pikepdf.Array(), ON=pikepdf.Array())
        )
    root.OCProperties.OCGs.append(group)
    root.OCProperties.D.Order.append(group)
    root.OCProperties.D.ON.append(group)


def build_layout(
    result: NestResult,
    material: Material,
    sources: dict[str, SourcePiece],
    cut_lines: CutLines,
) -> pikepdf.Pdf:
    out = pikepdf.Pdf.new()
    forms: dict[str, pikepdf.Object] = {}
    layers: set = set()

    cut_space = cut_layer = overprint = None
    if cut_lines.add:
        tint = pikepdf.Dictionary(
            FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 1, 0, 0], N=1
        )
        cut_space = out.make_indirect(
            pikepdf.Array(
                [
                    pikepdf.Name.Separation,
                    pikepdf.Name("/" + cut_lines.name),
                    pikepdf.Name.DeviceCMYK,
                    tint,
                ]
            )
        )
        cut_layer = out.make_indirect(
            pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=cut_lines.name)
        )
        overprint = out.make_indirect(
            pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, OP=True, op=True, OPM=1)
        )

    for sheet in result.sheets:
        if not sheet.placements:
            continue
        length = (
            material.length if material.length is not None else sheet.used_length + material.margin
        )
        out.add_blank_page(page_size=(material.width, length))
        page = out.pages[-1]
        content: list[str] = []
        cut_paths: list[str] = []

        for placement in sheet.placements:
            source = sources[placement.key]
            if placement.key not in forms:
                src_page = source.pdf.pages[source.page_index]
                form = src_page.as_form_xobject(handle_transformations=False)
                # qpdf clips the form at the TrimBox; the bleed must stay printable.
                form.BBox = pikepdf.Array([float(v) for v in src_page.obj.MediaBox])
                forms[placement.key] = out.copy_foreign(form)
                _register_layers(out, forms[placement.key], layers)
            name = page.add_resource(forms[placement.key], pikepdf.Name.XObject, prefix="Pc")
            clip = _path(placed(source.shape.bleed, source, placement))
            content.append(f"q {clip} W n {_matrix(source, placement)} {name} Do Q")
            if cut_lines.add and not source.shape.from_die_line:
                cut_paths.append(_path(placed(source.shape.cut, source, placement)))

        if cut_paths and cut_space is not None:
            if not any(
                g.objgen == cut_layer.objgen
                for g in out.Root.get("/OCProperties", {}).get("/OCGs", [])
            ):
                _add_layer(out, cut_layer)
            cs = page.add_resource(cut_space, pikepdf.Name.ColorSpace, prefix="Cut")
            oc = page.add_resource(cut_layer, pikepdf.Name.Properties, prefix="OC")
            gs = page.add_resource(overprint, pikepdf.Name.ExtGState, prefix="GS")
            content.append(
                f"/OC {oc} BDC q {gs} gs {cs} CS 1 SCN {_num(cut_lines.width_pt)} w "
                + " ".join(f"{path} S" for path in cut_paths)
                + " Q EMC"
            )
        page.contents_add("\n".join(content).encode())
    return out
