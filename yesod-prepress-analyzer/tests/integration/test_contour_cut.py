import math
from pathlib import Path

import pikepdf
import pytest
from shapely.geometry import Polygon

from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.contour import artwork_silhouette, contour_die_line
from app.fixes.engine import apply_fixes
from app.nesting.shapes import die_line

MM = 72 / 25.4


def star_art_pdf(path: Path) -> Path:
    """A yellow star with no die line, on a page larger than the star."""

    pdf = pikepdf.Pdf.new()
    size = 120 * MM
    pdf.add_blank_page(page_size=(size, size))
    c = size / 2
    points = [
        (
            c + math.cos(math.radians(90 + i * 36)) * (50 if i % 2 == 0 else 21) * MM,
            c + math.sin(math.radians(90 + i * 36)) * (50 if i % 2 == 0 else 21) * MM,
        )
        for i in range(10)
    ]
    path = " ".join(
        [f"{points[0][0]:.2f} {points[0][1]:.2f} m"]
        + [f"{x:.2f} {y:.2f} l" for x, y in points[1:]]
        + ["h"]
    )
    pdf.pages[0].contents_add(f"0 0.2 1 0 k {path} f".encode())
    pdf.save(path)
    return path


@pytest.mark.parametrize("offset_mm", [0, 2])
def test_contour_cut_wraps_the_artwork_from_outside(tmp_path, offset_mm):
    source = star_art_pdf(tmp_path / "star.pdf")
    out = tmp_path / "out.pdf"
    applied = apply_fixes(
        source,
        out,
        [FixRequest(id="add_contour_cut", params={"offsetMm": offset_mm})],
        ProductionProfile(id="p", minimumBleedMm=0),
    )
    assert "1 contorno(s)" in applied[0].details[0]

    with pikepdf.open(out) as pdf:
        page = pdf.pages[0]
        cut = die_line(page, ["CutContour"])
        assert cut is not None
        star = 2 * 50 * math.cos(math.radians(18)) * MM  # star width, tip to tip
        width = cut.bounds[2] - cut.bounds[0]
        # The die line contains the whole star: never smaller, grown by the offset.
        assert width == pytest.approx(star + 2 * offset_mm * MM, abs=1.5 * MM)
        trim = [float(v) for v in page.TrimBox]
        assert trim[2] - trim[0] == pytest.approx(width, abs=0.5)


def _circle(cx: float, cy: float, r: float) -> str:
    k = 0.5523 * r
    return (
        f"{cx + r:.2f} {cy:.2f} m "
        f"{cx + r:.2f} {cy + k:.2f} {cx + k:.2f} {cy + r:.2f} {cx:.2f} {cy + r:.2f} c "
        f"{cx - k:.2f} {cy + r:.2f} {cx - r:.2f} {cy + k:.2f} {cx - r:.2f} {cy:.2f} c "
        f"{cx - r:.2f} {cy - k:.2f} {cx - k:.2f} {cy - r:.2f} {cx:.2f} {cy - r:.2f} c "
        f"{cx + k:.2f} {cy - r:.2f} {cx + r:.2f} {cy - k:.2f} {cx + r:.2f} {cy:.2f} c h"
    )


def _page(path: Path, content: str, size_mm=(200, 200)) -> Path:
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(size_mm[0] * MM, size_mm[1] * MM))
    pdf.pages[0].contents_add(content.encode())
    pdf.save(path)
    return path


def _width_mm(geometry) -> float:
    return (geometry.bounds[2] - geometry.bounds[0]) / MM


def _silhouette(path: Path, size_mm=(200, 200), **kwargs):
    region = (0.0, 0.0, size_mm[0] * MM, size_mm[1] * MM)
    return artwork_silhouette(path, 0, region, **kwargs)


RED_CIRCLE = "0 1 1 0 k " + _circle(100 * MM, 100 * MM, 40 * MM) + " f"


@pytest.mark.parametrize("margin_mm", [0, 10])
def test_white_box_behind_the_art_is_not_artwork(tmp_path, margin_mm):
    side = (200 - 2 * margin_mm) * MM
    white = f"0 0 0 0 k {margin_mm * MM:.2f} {margin_mm * MM:.2f} {side:.2f} {side:.2f} re f "
    path = _page(tmp_path / "boxed.pdf", white + RED_CIRCLE)
    assert _width_mm(_silhouette(path)) == pytest.approx(80, abs=0.5)
    # The operator can still say the white box is part of the piece.
    kept = _silhouette(path, white_is_background=False)
    assert _width_mm(kept) == pytest.approx(200 - 2 * margin_mm, abs=0.5)


def test_white_border_of_a_sticker_is_kept(tmp_path):
    border = "0 0 0 0 k " + _circle(100 * MM, 100 * MM, 45 * MM) + " f "
    path = _page(tmp_path / "border.pdf", border + RED_CIRCLE)
    assert _width_mm(_silhouette(path)) == pytest.approx(90, abs=0.5)


def test_inner_holes_are_cut_on_request(tmp_path):
    ring = (
        "0 1 1 0 k "
        + _circle(100 * MM, 100 * MM, 40 * MM)
        + " "
        + _circle(100 * MM, 100 * MM, 20 * MM)
        + " f*"
    )
    silhouette = _silhouette(_page(tmp_path / "ring.pdf", ring))
    assert len(contour_die_line(silhouette, 0).interiors) == 0
    die = contour_die_line(silhouette, 2 * MM, cut_holes=True)
    [hole] = die.interiors
    # The hole is cut 2 mm inside the unprinted centre (off the artwork).
    assert _width_mm(Polygon(hole)) == pytest.approx(40 - 4, abs=0.5)


def test_large_piece_keeps_precision(tmp_path):
    size = (600, 300)
    art = "0 1 1 0 k " + f"{100 * MM:.2f} {50 * MM:.2f} {400 * MM:.2f} {200 * MM:.2f} re f"
    path = _page(tmp_path / "big.pdf", art, size)
    silhouette = _silhouette(path, size, resolution_mm=0.2)
    assert _width_mm(silhouette) == pytest.approx(400, abs=0.3)


def test_contour_cut_is_written_as_curves(tmp_path):
    source = _page(tmp_path / "circle.pdf", RED_CIRCLE)
    out = tmp_path / "out.pdf"
    apply_fixes(
        source, out, [FixRequest(id="add_contour_cut")], ProductionProfile(id="p", minimumBleedMm=0)
    )
    with pikepdf.open(out) as pdf:
        content = pdf.pages[0].Contents.read_bytes() if not isinstance(
            pdf.pages[0].Contents, pikepdf.Array
        ) else b"".join(s.read_bytes() for s in pdf.pages[0].Contents)
        cut = die_line(pdf.pages[0], ["CutContour"])
    assert b" c " in content
    assert _width_mm(cut) == pytest.approx(80, abs=0.5)


def test_contour_cut_is_not_added_twice(tmp_path):
    source = star_art_pdf(tmp_path / "star.pdf")
    profile = ProductionProfile(id="p", minimumBleedMm=0)
    once, twice = tmp_path / "once.pdf", tmp_path / "twice.pdf"
    apply_fixes(source, once, [FixRequest(id="add_contour_cut")], profile)
    applied = apply_fixes(once, twice, [FixRequest(id="add_contour_cut")], profile)
    assert "já tinha faca" in applied[0].details[0]
