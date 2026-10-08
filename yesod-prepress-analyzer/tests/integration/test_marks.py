import re
from pathlib import Path

import pikepdf
import pytest
from shapely.geometry import box

from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes
from app.nesting.marks import Marks, crop_marks, registration_marks
from app.nesting.planner import PlanItem, PlanOptions, plan

MM = 72 / 25.4


def card_pdf(path: Path, rotate: int = 0) -> Path:
    pdf = pikepdf.Pdf.new()
    w, h, b = 90 * MM, 50 * MM, 3 * MM
    pdf.add_blank_page(page_size=(w + 2 * b, h + 2 * b))
    page = pdf.pages[0]
    page.obj.TrimBox = [b, b, w + b, h + b]
    page.obj.BleedBox = [0, 0, w + 2 * b, h + 2 * b]
    if rotate:
        page.obj.Rotate = rotate
    page.contents_add(f"1 0 0 0 k 0 0 {w + 2 * b:.2f} {h + 2 * b:.2f} re f".encode())
    pdf.save(path)
    return path


def _content(page) -> bytes:
    contents = page.obj.Contents
    if isinstance(contents, pikepdf.Array):
        return b"".join(item.read_bytes() for item in contents)
    return contents.read_bytes()


def test_registration_marks_sit_in_the_band_outside_the_pieces(tmp_path):
    marks = Marks(registration="sides", size_mm=3, distance_mm=5, spacing_mm=200, slug="Lote ção")
    options = PlanOptions(width_mm=400, length_mm=600, margin_mm=5, gap_mm=4, marks=marks)
    out = tmp_path / "layout.pdf"
    summary = plan([PlanItem("card", card_pdf(tmp_path / "card.pdf"), "Cartão", 6)], options, out)
    assert summary["placed"] == 6

    band_end = (5 + 3 + 5) * MM  # edge margin + mark + clearance
    with pikepdf.open(out) as pdf:
        page = pdf.pages[0]
        content = _content(page)
        squares = [
            tuple(float(v) for v in m)
            for m in re.findall(rb"([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re", content)
        ]
        marks_found = [s for s in squares if abs(s[2] - 3 * MM) < 0.01]
        # 4 corners + intermediate marks on both long edges (600 mm, every 200 mm).
        assert len(marks_found) >= 8
        for x, _, size, _ in marks_found:
            assert x + size <= band_end - 5 * MM + 0.01 or x >= 400 * MM - band_end + 5 * MM - 0.01
        assert b"Tj" in content and "/Font" in page.obj.Resources
    # Pieces start after the band.
    assert summary["sheets"][0]["usedLengthMm"] > 13


def test_crop_marks_never_reach_another_piece():
    a_trim, a_print = box(0, 0, 100, 100), box(-8, -8, 108, 108)
    b_trim, b_print = box(114, 0, 214, 100), box(112, -8, 222, 108)  # 4 pt apart
    marks = Marks(crop_marks=True, crop_length_mm=5, crop_offset_mm=2)
    ops = crop_marks(marks, [(a_trim, a_print), (b_trim, b_print)], a_print.union(b_print))
    for x0, y0, x1, y1 in re.findall(r"([-\d.]+) ([-\d.]+) m ([-\d.]+) ([-\d.]+) l", ops):
        segment = box(
            min(float(x0), float(x1)) - 0.01,
            min(float(y0), float(y1)) - 0.01,
            max(float(x0), float(x1)) + 0.01,
            max(float(y0), float(y1)) + 0.01,
        )
        assert not segment.intersects(a_print) and not segment.intersects(b_print)
    assert ops  # the outer marks are still there


def test_no_registration_marks_by_default():
    assert registration_marks(Marks(), 1000, 1000, 10) == ""


@pytest.mark.parametrize("rotate", [0, 90])
def test_crop_marks_fix_adds_targets_and_slug(tmp_path, rotate):
    source = card_pdf(tmp_path / "card.pdf", rotate)
    out = tmp_path / "out.pdf"
    apply_fixes(
        source,
        out,
        [
            FixRequest(
                id="add_crop_marks",
                params={"registrationTargets": True, "slug": "Cliente X · cartão"},
            )
        ],
        ProductionProfile(id="p"),
    )
    with pikepdf.open(out) as pdf:
        page = pdf.pages[0]
        media = [float(v) for v in page.MediaBox]
        bleed = [float(v) for v in page.BleedBox]
        assert media[0] < bleed[0] and media[2] > bleed[2]
        content = _content(page)
        assert content.count(b" c ") >= 16  # four targets of four arcs each
        assert b"Tj" in content
