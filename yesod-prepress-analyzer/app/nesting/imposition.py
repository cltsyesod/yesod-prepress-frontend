"""Builds the nested layout PDF: every piece placed as a form XObject.

Pieces keep their own content (vectors, images, fonts, spot colours and die line)
untouched; each one is only scaled to final size, rotated, moved and clipped to its
printed area so neighbours never overlap.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pikepdf
import shapely
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, unary_union

from app.fixes.paths import pdf_path
from app.nesting.engine import Material, NestResult, Placement
from app.nesting.marks import SLUG_BAND, Marks, crop_marks, registration_marks, slug
from app.nesting.shapes import PieceShape

MM_PT = 72 / 25.4
_PATH_TOLERANCE_PT = 0.03 * MM_PT  # generated die lines, at final size
_COMMON_LINE_GAP = 0.05  # pt: with no gap between pieces, touching edges share one cut
_SNAP_PT = 0.6  # placement tolerance between touching rectangles


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
    """Generate the die line of pieces that have none: traced around the artwork."""
    name: str = "CutContour"
    width_pt: float = 0.25
    offset_mm: float = 0.0
    """Distance from the artwork to the generated die line, at final size (+ = outside)."""
    merge_mm: float = 3.0
    """Artwork closer than this is one piece (letters of a word); farther apart, separate."""
    cut_holes: bool = False
    """Also cut unprinted areas enclosed by the artwork (and nest small pieces in them)."""
    white_is_background: bool = True
    """Paper-white background (white box behind the art) is not part of the piece."""


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


def _is_rectangle(geometry: BaseGeometry) -> bool:
    envelope = geometry.minimum_rotated_rectangle.area
    return isinstance(geometry, Polygon) and abs(geometry.area - envelope) < 1e-4 * envelope


def _common_lines(rectangles: list[BaseGeometry]) -> str:
    """Cut paths for touching rectangles: a shared edge is cut once (common-line cutting)."""

    # Neighbours sit within the placement tolerance of each other: snap each outline
    # onto the lines already drawn so a shared edge becomes one line.
    edges = rectangles[0].boundary
    for rect in rectangles[1:]:
        edges = unary_union([edges, shapely.snap(rect.boundary, edges, _SNAP_PT)])
    merged = linemerge(edges) if not isinstance(edges, LineString) else edges
    lines = merged.geoms if hasattr(merged, "geoms") else [merged]
    ops = []
    for line in lines:
        coords = list(line.coords)
        ops.append(
            f"{_num(coords[0][0])} {_num(coords[0][1])} m "
            + " ".join(f"{_num(x)} {_num(y)} l" for x, y in coords[1:])
        )
    return " ".join(ops)


def _register_layers(out: pikepdf.Pdf, form: pikepdf.Object, known: dict) -> None:
    """Optional-content groups used by a piece (e.g. its die line) become layers of the layout.

    Layers are merged by name: the CutContour of every job is one CutContour layer.
    """

    properties = form.get("/Resources", {}).get("/Properties", {})
    for key, group in list(properties.items()):
        if not isinstance(group, pikepdf.Dictionary) or group.get("/Type") != pikepdf.Name.OCG:
            continue
        properties[key] = _layer(out, group, known)


def _layer(out: pikepdf.Pdf, group: pikepdf.Object, known: dict) -> pikepdf.Object:
    """The layout's layer with this group's name (registered on first use)."""

    name = str(group.get("/Name", ""))
    if name not in known:
        known[name] = group
        _add_layer(out, group)
    return known[name]


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
    marks: Marks | None = None,
) -> pikepdf.Pdf:
    """`material.margin` already includes the band kept free for registration marks."""

    marks = marks or Marks()
    edge = max(0.0, material.margin - marks.band)  # the real material margin
    out = pikepdf.Pdf.new()
    font = out.make_indirect(
        pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.Type1,
            BaseFont=pikepdf.Name.Helvetica,
            Encoding=pikepdf.Name.WinAnsiEncoding,
        )
    )
    used_sheets = [sheet for sheet in result.sheets if sheet.placements]
    forms: dict[tuple[int, int], pikepdf.Object] = {}
    layers: dict[str, pikepdf.Object] = {}

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

    for number, sheet in enumerate(used_sheets, start=1):
        length = (
            material.length
            if material.length is not None
            else sheet.used_length + material.margin + (SLUG_BAND if marks.slug else 0.0)
        )
        out.add_blank_page(page_size=(material.width, length))
        page = out.pages[-1]
        content: list[str] = []
        cut_paths: list[str] = []
        straight: list[BaseGeometry] = []  # rectangles touching each other share cut lines
        printed: list[BaseGeometry] = []
        rectangles: list[tuple[BaseGeometry, BaseGeometry]] = []  # (trim, printed) for crop marks
        names: dict[tuple[int, int], pikepdf.Name] = {}

        for placement in sheet.placements:
            source = sources[placement.key]
            # One form per source page: pieces cut from the same sheet share it.
            page_key = (id(source.pdf), source.page_index)
            if page_key not in forms:
                src_page = source.pdf.pages[source.page_index]
                form = src_page.as_form_xobject(handle_transformations=False)
                # qpdf clips the form at the TrimBox; the bleed must stay printable.
                form.BBox = pikepdf.Array([float(v) for v in src_page.obj.MediaBox])
                forms[page_key] = out.copy_foreign(form)
                _register_layers(out, forms[page_key], layers)
            if page_key not in names:
                names[page_key] = page.add_resource(
                    forms[page_key], pikepdf.Name.XObject, prefix="Pc"
                )
            name = names[page_key]
            area = placed(source.shape.bleed, source, placement)
            printed.append(area)
            # Even-odd: holes cut out of a piece stay out of its clip.
            content.append(f"q {_path(area)} W* n {_matrix(source, placement)} {name} Do Q")
            trim = placed(source.shape.cut, source, placement)
            if not source.shape.from_die_line and _is_rectangle(trim):
                rectangles.append((trim, area))
            if cut_lines.add and not source.shape.from_die_line:
                cut = trim
                if material.gap <= _COMMON_LINE_GAP and _is_rectangle(cut):
                    straight.append(cut)
                else:
                    cut_paths.append(pdf_path(cut, smooth=True, tolerance=_PATH_TOLERANCE_PT))
        if straight:
            cut_paths.append(_common_lines(straight))

        if cut_paths and cut_space is not None:
            layer = _layer(out, cut_layer, layers)
            cs = page.add_resource(cut_space, pikepdf.Name.ColorSpace, prefix="Cut")
            oc = page.add_resource(layer, pikepdf.Name.Properties, prefix="OC")
            gs = page.add_resource(overprint, pikepdf.Name.ExtGState, prefix="GS")
            content.append(
                f"/OC {oc} BDC q {gs} gs {cs} CS 1 SCN {_num(cut_lines.width_pt)} w "
                + " ".join(f"{path} S" for path in cut_paths)
                + " Q EMC"
            )

        # Marks: in the free band along the edges or clear of every piece, never on art.
        keep_out = unary_union(printed)
        content.append(registration_marks(marks, material.width, length, edge))
        content.append(crop_marks(marks, rectangles, keep_out))
        if marks.slug.strip() and label_fits(sheet.used_length, length, material.margin):
            text = marks.slug + (f" · {number}/{len(used_sheets)}" if len(used_sheets) > 1 else "")
            content.append(
                slug(
                    text,
                    material.margin,
                    sheet.used_length + max(material.gap, 1 * MM_PT),
                    material.width - material.margin,
                    keep_out,
                    str(page.add_resource(font, pikepdf.Name.Font, prefix="Slug")),
                )
            )
        # Slug text is WinAnsi; everything else is ASCII.
        page.contents_add("\n".join(c for c in content if c).encode("cp1252", "replace"))
    return out


def label_fits(used_length: float, length: float, margin: float) -> bool:
    return used_length + SLUG_BAND <= length - margin + 1e-6
