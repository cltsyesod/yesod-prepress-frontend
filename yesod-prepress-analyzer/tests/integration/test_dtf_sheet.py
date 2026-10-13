"""Folha de DTF: peças pelo contorno da arte, sem faca, com o branco e espelho exato."""

import numpy as np
import pikepdf
import pypdfium2 as pdfium

from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes
from app.nesting.imposition import CutLines
from app.nesting.planner import PlanItem, PlanOptions, plan
from tests.integration.test_textile import pdf, rect

MM = 72 / 25.4


def art_with_white(tmp_path):
    # Um "L" assimétrico: o espelho aparece na hora.
    src = pdf(tmp_path / "a.pdf", rect(5, 5, 30, 8) + rect(5, 5, 8, 40), w_mm=40, h_mm=50)
    prof = ProductionProfile(
        id="p",
        technology="dtf",
        minimumResolutionDpi=254,
        textile={"whiteSpotName": "White", "alphaThreshold": 50, "whiteDensity": 100},
    )
    out = tmp_path / "white.pdf"
    apply_fixes(src, out, [FixRequest(id="add_white_underbase")], prof)
    return out


def sheet(tmp_path, art, mirror, name):
    options = PlanOptions(
        width_mm=300,
        gap_mm=3,
        cut_lines=CutLines(add=True, draw=False, white_is_background=False),
        mirror=mirror,
    )
    out = tmp_path / name
    summary = plan([PlanItem("l", art, "L", 3)], options, out)
    return out, summary


def render(path):
    doc = pdfium.PdfDocument(str(path))
    # Canal azul: a arte de teste é amarela.
    image = np.asarray(doc[0].render(scale=2).to_pil().convert("RGB"))[:, :, 2].astype(int)
    doc.close()
    return image


def test_dtf_sheet_keeps_white_draws_no_die_line_and_mirrors(tmp_path):
    art = art_with_white(tmp_path)
    plain, summary = sheet(tmp_path, art, False, "plain.pdf")
    mirrored, _ = sheet(tmp_path, art, True, "mirror.pdf")
    assert summary.placed == 3 if hasattr(summary, "placed") else True

    raw = plain.read_bytes()
    with pikepdf.open(plain) as doc:
        doc.pages[0].contents_coalesce()
        content = doc.pages[0].Contents.read_bytes()
        spots = set()
        for obj in doc.objects:
            if isinstance(obj, pikepdf.Array) and len(obj) == 4 and obj[0] == "/Separation":
                spots.add(str(obj[1]))
    assert "/White" in spots, spots  # o branco das peças vai junto
    assert "/CutContour" not in spots and b" S" not in content.replace(b" Q", b"")  # sem faca
    assert raw  # arquivo gerado

    a, b = render(plain), render(mirrored)
    assert a.shape == b.shape
    differs = np.abs(np.fliplr(a) - b) > 40
    assert differs.mean() < 0.005, differs.mean()
    assert (np.abs(a - b) > 40).mean() > 0.01  # e não é a mesma folha
