import math
from pathlib import Path

import pikepdf
import pytest

from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
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


def test_contour_cut_is_not_added_twice(tmp_path):
    source = star_art_pdf(tmp_path / "star.pdf")
    profile = ProductionProfile(id="p", minimumBleedMm=0)
    once, twice = tmp_path / "once.pdf", tmp_path / "twice.pdf"
    apply_fixes(source, once, [FixRequest(id="add_contour_cut")], profile)
    applied = apply_fixes(once, twice, [FixRequest(id="add_contour_cut")], profile)
    assert "já tinha faca" in applied[0].details[0]
