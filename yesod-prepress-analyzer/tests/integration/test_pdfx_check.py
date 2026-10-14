"""Preflight PDF/X-4: um PDF cru reprova nos itens certos; um PDF/X-4 montado passa."""

import pikepdf
import pytest

import app.analyzer.document_inspector as di
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings

MM = 72 / 25.4


def fake_icc(space: bytes) -> bytes:
    # Cabeçalho ICC de 128 bytes: o espaço de cor fica nos bytes 16–20.
    header = bytearray(128)
    header[16:20] = space
    header[36:40] = b"acsp"
    return bytes(header)


def build(path, *, pdfx=False, rgb=False):
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(100 * MM, 100 * MM))
    page = pdf.pages[0]
    color = "1 0 0 rg" if rgb else "0 1 0 0 k"
    page.contents_add(f"{color} {10 * MM} {10 * MM} {50 * MM} {50 * MM} re f".encode())
    if pdfx:
        page.obj.TrimBox = [3 * MM, 3 * MM, 97 * MM, 97 * MM]
        page.obj.BleedBox = [0, 0, 100 * MM, 100 * MM]
        icc = pikepdf.Stream(pdf, fake_icc(b"CMYK"))
        icc.N = 4
        pdf.Root.OutputIntents = pikepdf.Array(
            [
                pikepdf.Dictionary(
                    Type=pikepdf.Name.OutputIntent,
                    S=pikepdf.Name.GTS_PDFX,
                    OutputConditionIdentifier="FOGRA39",
                    DestOutputProfile=icc,
                )
            ]
        )
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            meta["pdfxid:GTS_PDFXVersion"] = "PDF/X-4"
        pdf.docinfo["/Trapped"] = pikepdf.Name("/False")
    pdf.save(path, min_version="1.6", force_version="1.6")
    return path


def preflight(path):
    original = di._run_qpdf
    di._run_qpdf = lambda p, t: (True, "")
    try:
        ctx = di.inspect_document(path, ProductionProfile(id="p"), Settings())
    finally:
        di._run_qpdf = original
    result = ctx.facts["pdfx4"]
    return result, {c["id"]: c for c in result["checks"]}


def test_raw_pdf_fails_the_right_items(tmp_path):
    result, checks = preflight(build(tmp_path / "cru.pdf"))
    assert result["conforms"] is False
    assert checks["output_intent"]["ok"] is False
    assert checks["trimbox"]["ok"] is False
    assert checks["device_color"]["ok"] is None  # sem perfil de saída, não se aplica
    assert checks["encryption"]["ok"] is True
    assert checks["declared"]["ok"] is False and checks["declared"]["severity"] == "warning"


def test_built_pdfx4_passes(tmp_path):
    result, checks = preflight(build(tmp_path / "x4.pdf", pdfx=True))
    failed = [c for c in result["checks"] if c["ok"] is False]
    assert result["conforms"] is True, failed
    assert failed == []
    assert "FOGRA39" in checks["output_intent"]["detail"]


def test_rgb_with_cmyk_output_intent_fails(tmp_path):
    result, checks = preflight(build(tmp_path / "rgb.pdf", pdfx=True, rgb=True))
    assert result["conforms"] is False
    assert checks["device_color"]["ok"] is False


@pytest.mark.parametrize("subtype,ok", [("/Link", False), ("/PrinterMark", True)])
def test_annotations_on_the_print_area(tmp_path, subtype, ok):
    path = build(tmp_path / "a.pdf", pdfx=True)
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        annot = pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name(subtype), Rect=[20, 20, 60, 60]
        )
        pdf.pages[0].obj.Annots = pdf.make_indirect(pikepdf.Array([annot]))
        pdf.save(path)
    _, checks = preflight(path)
    assert checks["annotations"]["ok"] is ok
