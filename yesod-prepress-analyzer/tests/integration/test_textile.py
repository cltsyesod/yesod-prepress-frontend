"""DTF / DTG: medição do alfa em PDFs sintéticos com medidas conhecidas."""

from pathlib import Path

import numpy as np
import pikepdf

from app.analyzer.alpha_inspector import inspect_alpha, opening
from app.analyzer.context import DocumentContext
from app.contracts.production_profile import ProductionProfile
from app.rules.registry import DEFAULT_RULES, run_rules
from app.rules.textile_rules import (
    TextileBackgroundRule,
    TextilePrintAreaRule,
    TextileSemiTransparencyRule,
    TextileThinDetailsRule,
)

MM = 72 / 25.4


def pdf(path: Path, ops: str, w_mm=100, h_mm=100, extgstate=None) -> Path:
    doc = pikepdf.Pdf.new()
    doc.add_blank_page(page_size=(w_mm * MM, h_mm * MM))
    page = doc.pages[0]
    if extgstate:
        page.obj.Resources = pikepdf.Dictionary(
            ExtGState=pikepdf.Dictionary(GS1=pikepdf.Dictionary(extgstate))
        )
    page.contents_add(ops.encode())
    doc.save(path)
    return path


def rect(x, y, w, h, extra=""):
    return f"{extra} 0 0 1 0 k {x * MM:.3f} {y * MM:.3f} {w * MM:.3f} {h * MM:.3f} re f\n"


def profile(technology="dtf", **textile) -> ProductionProfile:
    return ProductionProfile(id="p", technology=technology, textile=textile)


def context(path: Path, prof: ProductionProfile) -> DocumentContext:
    ctx = DocumentContext(path=path, profile=prof, file_size=1, sha256="a" * 64)
    ctx.facts["textile_pages"] = inspect_alpha(path, prof)
    return ctx


def test_art_bounds_are_measured_at_final_size(tmp_path):
    path = pdf(tmp_path / "a.pdf", rect(10, 20, 30, 40))
    page = inspect_alpha(path, profile(minLineMm=0.5))[0]
    x0, y0, x1, y1 = page.art_mm
    # Resolução de 6 px/mm: erro de no máximo 1 px.
    assert abs(x0 - 10) < 0.2 and abs(y0 - 20) < 0.2
    assert abs(x1 - 40) < 0.2 and abs(y1 - 60) < 0.2
    assert abs(page.painted_mm2 - 1200) < 30


def test_scale_multiplies_the_size(tmp_path):
    path = pdf(tmp_path / "a.pdf", rect(0, 0, 50, 10), w_mm=50, h_mm=10)
    prof = ProductionProfile(id="p", technology="dtf", fileScale="1:4")
    w, h = inspect_alpha(path, prof)[0].art_size_mm
    assert abs(w - 200) < 1 and abs(h - 40) < 1


def test_print_area_dtf_width_and_rotation(tmp_path):
    path = pdf(tmp_path / "a.pdf", rect(0, 0, 80, 40))
    ok = TextilePrintAreaRule().evaluate(context(path, profile(printWidthMm=90)))
    rotated = TextilePrintAreaRule().evaluate(context(path, profile(printWidthMm=50)))
    too_big = TextilePrintAreaRule().evaluate(context(path, profile(printWidthMm=30)))
    missing = TextilePrintAreaRule().evaluate(context(path, profile()))
    assert ok == []
    assert rotated[0].severity == "informational"
    assert too_big[0].severity == "critical"
    assert missing[0].severity == "informational" and "largura útil" in missing[0].description


def test_print_area_dtg_both_sides(tmp_path):
    path = pdf(tmp_path / "a.pdf", rect(0, 0, 80, 40))
    fits = profile("dtg", printWidthMm=80.5, printHeightMm=41)
    tall = profile("dtg", printWidthMm=100, printHeightMm=30)
    assert TextilePrintAreaRule().evaluate(context(path, fits)) == []
    issue = TextilePrintAreaRule().evaluate(context(path, tall))[0]
    assert issue.severity == "critical" and "mm na altura" in issue.description
    assert 10 <= float(issue.description.split(" e ")[-1].split()[0].replace(",", ".")) <= 10.3


def test_semi_transparency_and_threshold(tmp_path):
    solid = pdf(tmp_path / "s.pdf", rect(10, 10, 50, 50))
    glow = pdf(tmp_path / "g.pdf", rect(10, 10, 50, 50, "/GS1 gs"), extgstate={"/ca": 0.4})
    assert TextileSemiTransparencyRule().evaluate(context(solid, profile())) == []
    issue = TextileSemiTransparencyRule().evaluate(context(glow, profile(alphaThreshold=50)))[0]
    assert issue.found_value.startswith("9")  # quase toda a arte é parcial (bordas fora)
    assert "fica sem branco" in issue.description


def test_antialiased_edges_are_not_semi_transparency(tmp_path):
    # Círculo: a borda tem opacidade parcial pela renderização, não pela arte.
    k = 0.5523
    r, c = 30 * MM, 50 * MM
    circle = (
        f"0 0 1 0 k {c + r} {c} m {c + r} {c + k * r} {c + k * r} {c + r} {c} {c + r} c "
        f"{c - k * r} {c + r} {c - r} {c + k * r} {c - r} {c} c "
        f"{c - r} {c - k * r} {c - k * r} {c - r} {c} {c - r} c "
        f"{c + k * r} {c - r} {c + r} {c - k * r} {c + r} {c} c f"
    )
    path = pdf(tmp_path / "c.pdf", circle)
    assert inspect_alpha(path, profile())[0].partial_share < 0.001


def test_solid_background(tmp_path):
    full = pdf(tmp_path / "f.pdf", "1 1 1 rg 0 0 1000 1000 re f\n" + rect(10, 10, 20, 20))
    art = pdf(tmp_path / "a.pdf", rect(10, 10, 20, 20))
    assert TextileBackgroundRule().evaluate(context(full, profile()))[0].page == 1
    assert TextileBackgroundRule().evaluate(context(art, profile())) == []


def test_thin_details_against_the_profile_minimum(tmp_path):
    lines = rect(10, 10, 60, 0.3) + rect(10, 30, 60, 1.0)  # 0,3 mm e 1 mm de espessura
    path = pdf(tmp_path / "l.pdf", lines)
    issue = TextileThinDetailsRule().evaluate(context(path, profile(minLineMm=0.5)))[0]
    page = context(path, profile(minLineMm=0.5)).facts["textile_pages"][0]
    # Só a linha de 0,3 mm (60 × 0,3 = 18 mm²) é fina; a de 1 mm fica.
    assert 12 < page.thin_mm2 < 26, page.thin_mm2
    assert "abaixo de 0,5 mm" in issue.found_value
    assert TextileThinDetailsRule().evaluate(context(path, profile(minLineMm=0.2))) == []
    assert TextileThinDetailsRule().evaluate(context(path, profile())) == []


def test_opening_keeps_squares_and_drops_lines():
    mask = np.zeros((40, 40), dtype=bool)
    mask[5:20, 5:20] = True  # quadrado 15 px
    mask[30, 5:35] = True  # linha de 1 px
    opened = opening(mask, 3)
    assert opened[5:20, 5:20].all() and not opened[30].any()


def test_print_rules_are_off_for_textile_and_textile_rules_off_for_print(tmp_path):
    path = pdf(tmp_path / "a.pdf", "1 1 1 rg 0 0 1000 1000 re f\n")
    textile = context(path, profile(printWidthMm=10))
    codes = {issue.rule_code for issue in run_rules(textile, DEFAULT_RULES)}
    assert {"TEXTILE_SOLID_BACKGROUND", "TEXTILE_PRINT_AREA"} <= codes
    assert not codes & {"PAGE_BLEED_INSUFFICIENT", "PAGE_TRIMBOX_MISSING", "FINISHING_CUT_LAYER"}
    printing = DocumentContext(
        path=path, profile=ProductionProfile(id="p"), file_size=1, sha256="a" * 64
    )
    printing.facts["textile_pages"] = textile.facts["textile_pages"]
    assert not any(
        i.rule_code.startswith("TEXTILE") for i in run_rules(printing, DEFAULT_RULES)
    )


def test_die_line_in_the_art_is_not_measured_as_print(tmp_path):
    import app.analyzer.document_inspector as di
    from app.core.config import Settings

    doc = pikepdf.Pdf.new()
    doc.add_blank_page(page_size=(100 * MM, 100 * MM))
    page = doc.pages[0]
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 1, 0, 0], N=1)
    space = [pikepdf.Name.Separation, pikepdf.Name("/CutContour"), pikepdf.Name.DeviceCMYK, tint]
    page.obj.Resources = pikepdf.Dictionary(ColorSpace=pikepdf.Dictionary(C=pikepdf.Array(space)))
    die = f"q /C CS 1 SCN 0.5 w {5 * MM} {5 * MM} {90 * MM} {90 * MM} re S Q\n"
    page.contents_add((rect(30, 30, 40, 20) + die).encode())
    path = tmp_path / "faca.pdf"
    doc.save(path)
    original = di._run_qpdf
    di._run_qpdf = lambda p, t: (True, "")
    try:
        ctx = di.inspect_document(path, profile(minLineMm=0.5), Settings())
    finally:
        di._run_qpdf = original
    measured = ctx.facts["textile_pages"][0]
    w, h = measured.art_size_mm
    assert abs(w - 40) < 0.5 and abs(h - 20) < 0.5, (w, h)  # a faca de 90 mm não conta
    assert (measured.thin_mm2 or 0) < 1
    assert ctx.facts["textile_cut_strokes"] == 1
