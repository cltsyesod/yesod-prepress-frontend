from pathlib import Path

import pikepdf

from app.analyzer.page_inspector import inspect_pages
from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes
from app.nesting.shapes import die_line

MM = 72 / 25.4


def magenta_pdf(path: Path) -> Path:
    """Magenta artwork (a filled square) and a die line stroked in plain magenta."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(120 * MM, 120 * MM))
    art = f"0 1 0 0 k {20 * MM:.2f} {20 * MM:.2f} {80 * MM:.2f} {80 * MM:.2f} re f"
    cut = f"q 0 1 0 0 K 0.5 w {15 * MM:.2f} {15 * MM:.2f} {90 * MM:.2f} {90 * MM:.2f} re S Q"
    pdf.pages[0].contents_add(f"{art}\n{cut}".encode())
    pdf.save(path)
    return path


def test_magenta_stroke_is_detected_and_converted(tmp_path):
    source = magenta_pdf(tmp_path / "in.pdf")
    with pikepdf.open(source) as pdf:
        [info] = inspect_pages(pdf, ["CutContour"])
        assert info.die_line_box is None and info.magenta_strokes == 1

    out = tmp_path / "out.pdf"
    [applied] = apply_fixes(
        source,
        out,
        [FixRequest(id="convert_magenta_die_line", params={"name": "CutContour"})],
        ProductionProfile(id="p"),
    )
    assert "1 linha(s)" in applied.details[0]
    with pikepdf.open(out) as pdf:
        page = pdf.pages[0]
        cut = die_line(page, ["CutContour"])
        assert cut is not None
        assert round((cut.bounds[2] - cut.bounds[0]) / MM) == 90
        # The magenta fill of the artwork is untouched.
        content = page.Contents.read_bytes()
        assert b"0 1 0 0 k" in content and b" K" not in content
        [info] = inspect_pages(pdf, ["CutContour"])
        assert info.magenta_strokes == 0
