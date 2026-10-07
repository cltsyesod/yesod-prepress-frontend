import math
from pathlib import Path

import pikepdf
import pytest
from shapely.geometry import Point, Polygon, box

from app.nesting.engine import Material, NestItem, nest, rotation_steps
from app.nesting.imposition import CutLines
from app.nesting.planner import PlanItem, PlanOptions, plan
from app.nesting.shapes import die_line

MM = 72 / 25.4


def star_pdf(path: Path) -> Path:
    pdf = pikepdf.Pdf.new()
    size = 110 * MM
    pdf.add_blank_page(page_size=(size, size))
    page = pdf.pages[0]
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 1, 0, 0], N=1)
    space = pikepdf.Array(
        [pikepdf.Name.Separation, pikepdf.Name("/CutContour"), pikepdf.Name.DeviceCMYK, tint]
    )
    page.obj.Resources = pikepdf.Dictionary(ColorSpace=pikepdf.Dictionary(CS0=space))
    c = size / 2
    points = [
        (
            c + math.cos(a * math.pi / 5 + math.pi / 2) * (50 if a % 2 == 0 else 22) * MM,
            c + math.sin(a * math.pi / 5 + math.pi / 2) * (50 if a % 2 == 0 else 22) * MM,
        )
        for a in range(10)
    ]
    path = " ".join(
        [f"{points[0][0]:.2f} {points[0][1]:.2f} m"]
        + [f"{x:.2f} {y:.2f} l" for x, y in points[1:]]
        + ["h"]
    )
    page.contents_add(f"0 0 1 0 k 0 0 {size:.2f} {size:.2f} re f /CS0 CS 1 SCN {path} S".encode())
    pdf.save(path)
    return path


def card_pdf(path: Path, width_mm=90, height_mm=50, bleed_mm=3) -> Path:
    pdf = pikepdf.Pdf.new()
    w, h, b = width_mm * MM, height_mm * MM, bleed_mm * MM
    pdf.add_blank_page(page_size=(w + 2 * b, h + 2 * b))
    page = pdf.pages[0]
    page.obj.TrimBox = [b, b, w + b, h + b]
    page.obj.BleedBox = [0, 0, w + 2 * b, h + 2 * b]
    page.contents_add(f"1 0 0 0 k 0 0 {w + 2 * b:.2f} {h + 2 * b:.2f} re f".encode())
    pdf.save(path)
    return path


def test_die_line_is_read_from_cut_separation(tmp_path):
    with pikepdf.open(star_pdf(tmp_path / "star.pdf")) as pdf:
        shape = die_line(pdf.pages[0], ["CutContour"])
    assert shape is not None
    # A 5-point star with 50/22 mm radii, not the 110 mm page square.
    assert 40 * 40 < shape.area / MM**2 < 60 * 60


def test_nesting_keeps_gap_and_stays_inside_material():
    star = Polygon(
        [
            (
                math.cos(a * math.pi / 5) * (60 if a % 2 == 0 else 25) * MM,
                math.sin(a * math.pi / 5) * (60 if a % 2 == 0 else 25) * MM,
            )
            for a in range(10)
        ]
    )
    items = [
        NestItem("rect", box(0, 0, 200 * MM, 120 * MM), 3, (0.0, 90.0)),
        NestItem("star", star, 6, rotation_steps(22.5)),
        NestItem("circle", Point(0, 0).buffer(30 * MM), 5, (0.0,)),
    ]
    material = Material(width=600 * MM, length=None, margin=10 * MM, gap=5 * MM)
    result = nest(items, material)

    placed = result.placements
    assert len(placed) == 14 and not result.unplaced
    for i, a in enumerate(placed):
        minx, miny, maxx, _ = a.footprint.bounds
        assert minx >= material.margin - 0.01 and miny >= material.margin - 0.01
        assert maxx <= material.width - material.margin + 0.01
        for b in placed[:i]:
            if a.sheet == b.sheet:
                assert a.footprint.distance(b.footprint) >= material.gap - 0.01


def test_rotation_steps():
    assert rotation_steps(22.5) == tuple(i * 22.5 for i in range(16))
    assert rotation_steps(90, allow_rotation=False) == (0.0,)


def test_sheet_material_opens_new_sheets():
    items = [NestItem("rect", box(0, 0, 100 * MM, 100 * MM), 5, (0.0,))]
    material = Material(width=220 * MM, length=220 * MM, margin=5 * MM, gap=5 * MM)
    result = nest(items, material)
    assert [len(sheet.placements) for sheet in result.sheets] == [4, 1]


def test_piece_larger_than_material_is_reported():
    items = [NestItem("big", box(0, 0, 500 * MM, 100 * MM), 1, (0.0,))]
    result = nest(items, Material(width=300 * MM, length=None))
    assert result.unplaced == [("big", 0, "maior que a área útil do material")]


def test_plan_builds_layout_pdf(tmp_path):
    items = [
        PlanItem("star", star_pdf(tmp_path / "star.pdf"), "Estrela", 4, bleed_mm=3),
        PlanItem("card", card_pdf(tmp_path / "card.pdf"), "Cartão", 6),
    ]
    options = PlanOptions(
        width_mm=400, margin_mm=10, gap_mm=4, rotation_step=45, cut_lines=CutLines(add=True)
    )
    out = tmp_path / "layout.pdf"
    summary = plan(items, options, out)

    assert summary["placed"] == 10 and summary["unplaced"] == []
    assert summary["dieLines"] == ["Estrela"]
    with pikepdf.open(out) as pdf:
        page = pdf.pages[0]
        assert float(page.MediaBox[2]) == pytest.approx(400 * MM, abs=0.01)
        # One form per source page, reused by every copy.
        assert len(page.Resources.XObject) == 2
        layers = {str(group.Name) for group in pdf.Root.OCProperties.OCGs}
        assert "CutContour" in layers


def test_scaled_file_is_nested_at_final_size(tmp_path):
    # A 1:10 card file is 9 x 5 mm on the page and must occupy 90 x 50 mm on the roll.
    item = PlanItem("card", card_pdf(tmp_path / "small.pdf", 9, 5, 0.3), "Cartão", 1, file_scale=10)
    summary = plan([item], PlanOptions(width_mm=200), tmp_path / "out.pdf")
    assert summary["sheets"][0]["lengthMm"] == pytest.approx(56, abs=0.5)


def sheet_of_shapes_pdf(path: Path) -> Path:
    """One page with a circle, a square and a triangle, each with its own die line."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(330 * MM, 120 * MM))
    page = pdf.pages[0]
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 1, 0, 0], N=1)
    space = pikepdf.Array(
        [pikepdf.Name.Separation, pikepdf.Name("/CutContour"), pikepdf.Name.DeviceCMYK, tint]
    )
    page.obj.Resources = pikepdf.Dictionary(ColorSpace=pikepdf.Dictionary(CS0=space))
    circle = Point(60 * MM, 60 * MM).buffer(45 * MM, 32)
    square = box(120 * MM, 15 * MM, 210 * MM, 105 * MM)
    triangle = Polygon([(230 * MM, 15 * MM), (320 * MM, 15 * MM), (275 * MM, 105 * MM)])
    paths = []
    for shape in (circle, square, triangle):
        coords = list(shape.exterior.coords)[:-1]
        paths.append(
            " ".join([f"{coords[0][0]:.2f} {coords[0][1]:.2f} m"])
            + " "
            + " ".join(f"{x:.2f} {y:.2f} l" for x, y in coords[1:])
            + " h"
        )
    page.contents_add(f"/CS0 CS 1 SCN {' '.join(paths)} S".encode())
    pdf.save(path)
    return path


def test_each_die_line_on_a_sheet_is_its_own_piece(tmp_path):
    item = PlanItem("sheet", sheet_of_shapes_pdf(tmp_path / "sheet.pdf"), "Formas", 2, bleed_mm=2)
    summary = plan([item], PlanOptions(width_mm=250, gap_mm=5), tmp_path / "out.pdf")
    # 3 shapes x 2 copies, each placed on its own (the sheet is 330 mm, wider than the roll).
    assert summary["placed"] == 6 and summary["unplaced"] == []


def art_only_pdf(path: Path) -> Path:
    """Client file with artwork only: a circle and a square, no die line."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(230 * MM, 110 * MM))
    k = 0.5523 * 50 * MM
    cx, cy, r = 55 * MM, 55 * MM, 50 * MM
    circle = (
        f"{cx + r:.2f} {cy:.2f} m "
        f"{cx + r:.2f} {cy + k:.2f} {cx + k:.2f} {cy + r:.2f} {cx:.2f} {cy + r:.2f} c "
        f"{cx - k:.2f} {cy + r:.2f} {cx - r:.2f} {cy + k:.2f} {cx - r:.2f} {cy:.2f} c "
        f"{cx - r:.2f} {cy - k:.2f} {cx - k:.2f} {cy - r:.2f} {cx:.2f} {cy - r:.2f} c "
        f"{cx + k:.2f} {cy - r:.2f} {cx + r:.2f} {cy - k:.2f} {cx + r:.2f} {cy:.2f} c h"
    )
    square = f"{125 * MM:.2f} {5 * MM:.2f} {100 * MM:.2f} {100 * MM:.2f} re"
    pdf.pages[0].contents_add(f"0 1 1 0 k {circle} f 1 0 1 0 k {square} f".encode())
    pdf.save(path)
    return path


def test_system_generates_die_line_around_the_art(tmp_path):
    item = PlanItem("art", art_only_pdf(tmp_path / "art.pdf"), "Arte", 1)
    options = PlanOptions(
        width_mm=400, gap_mm=5, cut_lines=CutLines(add=True, offset_mm=2), allow_rotation=False
    )
    out = tmp_path / "out.pdf"
    summary = plan([item], options, out)
    # Two separate shapes -> two pieces, each with a generated die line.
    assert summary["placed"] == 2 and summary["dieLines"] == []
    with pikepdf.open(out) as pdf:
        cut = die_line(pdf.pages[0], ["CutContour"])
    assert cut is not None
    widths = sorted(round((g.bounds[2] - g.bounds[0]) / MM) for g in cut.geoms)
    # 100 mm shapes + 2 mm of clearance on each side, outside the artwork.
    assert widths == [104, 104]
