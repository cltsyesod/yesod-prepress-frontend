from pathlib import Path

import pikepdf
import pytest

from app.analyzer.engine import AnalyzerEngine
from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings
from app.fixes.engine import apply_fixes

MM = 72 / 25.4


def blank_pdf(path: Path, width_mm: float, height_mm: float) -> Path:
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(width_mm * MM, height_mm * MM))
    pdf.pages[0].contents_add(b"0 0 1 0 k 10 10 100 100 re f")
    pdf.save(path)
    return path


def analyze(path: Path, profile: ProductionProfile, monkeypatch) -> set[str]:
    monkeypatch.setattr(
        "app.analyzer.document_inspector._run_qpdf", lambda *_: (True, "No syntax errors")
    )
    monkeypatch.setattr("app.analyzer.document_inspector._validate_pdfium", lambda *_: (True, 1))
    result = AnalyzerEngine(Settings()).analyze(path, profile)
    return {issue.rule_code for issue in result.issues}


def boxes(path: Path) -> dict[str, list[float]]:
    with pikepdf.open(path) as pdf:
        page = pdf.pages[0].obj
        return {
            name: [float(v) for v in page[f"/{name}"]]
            for name in ("MediaBox", "TrimBox", "BleedBox")
            if f"/{name}" in page
        }


def test_page_boxes_use_ticket_size_centred_on_larger_page(tmp_path):
    # 206 x 306 mm page for a 200 x 300 mm job: 3 mm of artwork around the trim.
    source = blank_pdf(tmp_path / "in.pdf", 206, 306)
    profile = ProductionProfile(id="p", minimumBleedMm=3, finalWidthMm=200, finalHeightMm=300)
    out = tmp_path / "out.pdf"
    applied = apply_fixes(source, out, [FixRequest(id="set_page_boxes")], profile)

    result = boxes(out)
    trim, bleed = result["TrimBox"], result["BleedBox"]
    assert trim[2] - trim[0] == pytest.approx(200 * MM, abs=0.01)
    assert trim[0] == pytest.approx(3 * MM, abs=0.01)
    assert bleed == pytest.approx(result["MediaBox"], abs=0.01)
    assert "medida da ficha" in applied[0].details[0]


def test_page_boxes_report_missing_bleed_area(tmp_path, monkeypatch):
    source = blank_pdf(tmp_path / "in.pdf", 200, 300)
    profile = ProductionProfile(id="p", minimumBleedMm=3)
    out = tmp_path / "out.pdf"
    applied = apply_fixes(source, out, [FixRequest(id="set_page_boxes")], profile)

    assert "não tem área" in applied[0].details[0]
    codes = analyze(out, profile, monkeypatch)
    assert "PAGE_TRIMBOX_MISSING" not in codes
    # The fix never invents bleed: the corrected file still reports it honestly.
    assert "PAGE_BLEED_INSUFFICIENT" in codes


def test_cut_contour_satisfies_cut_layer_rule(tmp_path, monkeypatch):
    source = blank_pdf(tmp_path / "in.pdf", 200, 300)
    profile = ProductionProfile(id="p", requiresCutLayer=True, cutLayerNames=["Faca"])
    assert "FINISHING_CUT_LAYER" in analyze(source, profile, monkeypatch)

    out = tmp_path / "out.pdf"
    apply_fixes(source, out, [FixRequest(id="add_cut_contour", params={"name": "Faca"})], profile)

    assert "FINISHING_CUT_LAYER" not in analyze(out, profile, monkeypatch)
    with pikepdf.open(out) as pdf:
        assert [str(group.Name) for group in pdf.Root.OCProperties.OCGs] == ["Faca"]
        streams = pdf.pages[0].obj.Contents
        content = b"".join(stream.read_bytes() for stream in streams)
        # The client's content is isolated before the die line is drawn.
        assert content.startswith(b"q\n") and b"re S" in content


def test_crop_marks_enlarge_page_outside_bleed(tmp_path):
    source = blank_pdf(tmp_path / "in.pdf", 206, 306)
    profile = ProductionProfile(id="p", minimumBleedMm=3, finalWidthMm=200, finalHeightMm=300)
    out = tmp_path / "out.pdf"
    fixes = [FixRequest(id="add_crop_marks"), FixRequest(id="set_page_boxes")]
    applied = apply_fixes(source, out, fixes, profile)

    # Boxes run first regardless of the requested order.
    assert [fix.id for fix in applied] == ["set_page_boxes", "add_crop_marks"]
    result = boxes(out)
    media, bleed = result["MediaBox"], result["BleedBox"]
    # 3 mm bleed + 2 mm gap + 5 mm mark + 2 mm margin beyond the trim.
    assert media[2] - media[0] == pytest.approx((200 + 2 * 12) * MM, abs=0.05)
    assert bleed[0] > media[0]
    with pikepdf.open(out) as pdf:
        assert "/Separation" in str(pdf.pages[0].Resources.ColorSpace)


def test_reapplying_drawn_fixes_does_not_duplicate(tmp_path):
    source = blank_pdf(tmp_path / "in.pdf", 206, 306)
    profile = ProductionProfile(id="p", minimumBleedMm=3, finalWidthMm=200, finalHeightMm=300)
    fixes = [FixRequest(id="add_cut_contour"), FixRequest(id="add_crop_marks")]
    once, twice = tmp_path / "once.pdf", tmp_path / "twice.pdf"
    apply_fixes(source, once, fixes, profile)
    applied = apply_fixes(once, twice, fixes, profile)

    assert all("já tinha" in fix.details[0] for fix in applied)
    assert boxes(twice)["MediaBox"] == boxes(once)["MediaBox"]
    with pikepdf.open(twice) as pdf:
        assert len(pdf.Root.OCProperties.OCGs) == 1


def test_page_boxes_find_trim_in_undeclared_scale_file(tmp_path):
    # 1:10 file of a 1000 x 500 mm banner, sent while the ticket still says 1:1:
    # the ordered size cannot fit, but the page minus 3 mm of bleed has its proportion.
    source = blank_pdf(tmp_path / "in.pdf", 106, 56)
    profile = ProductionProfile(id="p", minimumBleedMm=3, finalWidthMm=1000, finalHeightMm=500)
    out = tmp_path / "out.pdf"
    applied = apply_fixes(source, out, [FixRequest(id="set_page_boxes")], profile)

    trim = boxes(out)["TrimBox"]
    assert trim[2] - trim[0] == pytest.approx(100 * MM, abs=0.01)
    assert "proporção da ficha" in applied[0].details[0]


def test_scaled_file_draws_marks_at_file_scale(tmp_path):
    # 1:10 file: 20 x 30 mm on the page for a 200 x 300 mm piece.
    source = blank_pdf(tmp_path / "in.pdf", 20, 30)
    profile = ProductionProfile(
        id="p", minimumBleedMm=0, finalWidthMm=200, finalHeightMm=300, fileScale="1:10"
    )
    out = tmp_path / "out.pdf"
    apply_fixes(source, out, [FixRequest(id="add_crop_marks")], profile)
    media = boxes(out)["MediaBox"]
    assert media[2] - media[0] == pytest.approx((20 + 2 * 0.9) * MM, abs=0.05)


def test_page_boxes_follow_the_die_line_of_a_die_cut_piece(tmp_path):
    # Star sticker without TrimBox on a page larger than the piece: the boxes must wrap
    # the die line (never cross the artwork), not the page or a centred ticket size.
    from tests.integration.test_nesting import star_pdf

    source = star_pdf(tmp_path / "star.pdf")
    profile = ProductionProfile(id="p", minimumBleedMm=3, finalWidthMm=100, finalHeightMm=100)
    out = tmp_path / "out.pdf"
    applied = apply_fixes(source, out, [FixRequest(id="set_page_boxes")], profile)

    trim = boxes(out)["TrimBox"]
    assert "contorno externo da faca" in applied[0].details[0]
    # 5-point star, outer radius 50 mm: about 95 x 90 mm, smaller than the 110 mm page.
    assert 90 * MM < trim[2] - trim[0] < 100 * MM
    assert trim[0] > 2 * MM
