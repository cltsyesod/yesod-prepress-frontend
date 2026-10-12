from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2 as pdfium

from app.analyzer.color_inspector import inspect_colors
from app.analyzer.image_inspector import inspect_images
from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes
from app.rules.image_rules import _is_unmanaged_rgb


def untagged_rgb(path: Path) -> Path:
    """RGB without a profile everywhere: a filled rectangle, an image, and a form
    XObject that strokes in RGB."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(200, 100))
    page = pdf.pages[0]
    pixels = bytes([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
    image = pdf.make_stream(
        pixels, Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=2, Height=2,
        ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8,
    )
    form = pdf.make_stream(
        b"0.2 0.4 0.6 RG 4 w 10 10 m 90 90 l S",
        Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Form, BBox=[0, 0, 100, 100],
    )
    page.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im=image, Fm=form))
    page.contents_add(
        b"0.9 0.5 0.1 rg 0 0 100 100 re f q 80 0 0 80 110 10 cm /Im Do Q /Fm Do"
    )
    pdf.save(path)
    return path


def render(path: Path) -> np.ndarray:
    doc = pdfium.PdfDocument(str(path))
    image = np.asarray(doc[0].render(scale=2).to_pil().convert("RGB")).astype(int)
    doc.close()
    return image


def test_srgb_is_assigned_without_changing_any_colour(tmp_path):
    source = untagged_rgb(tmp_path / "in.pdf")
    out = tmp_path / "out.pdf"
    [applied] = apply_fixes(
        source, out, [FixRequest(id="assign_rgb_profile")], ProductionProfile(id="p")
    )
    assert any("2 cor(es)" in d for d in applied.details)
    assert any("1 imagem" in d for d in applied.details)

    with pikepdf.open(out) as pdf:
        assert inspect_colors(pdf).rgb_operators == 0
        [image] = inspect_images(pdf)
        assert not _is_unmanaged_rgb(image.color_space)
        space = pdf.pages[0].Resources.XObject.Im.ColorSpace
        assert space[0] == pikepdf.Name.ICCBased and space[1].N == 3

    # sRGB is how viewers read untagged RGB: the picture is the same, value for value.
    assert np.abs(render(out) - render(source)).max() <= 2


def test_nothing_to_do_on_cmyk_files(tmp_path):
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(100, 100))
    pdf.pages[0].contents_add(b"0 1 0 0 k 0 0 50 50 re f")
    pdf.save(tmp_path / "in.pdf")
    [applied] = apply_fixes(
        tmp_path / "in.pdf", tmp_path / "out.pdf", [FixRequest(id="assign_rgb_profile")],
        ProductionProfile(id="p"),
    )
    assert applied.details == []
    with pikepdf.open(tmp_path / "out.pdf") as pdf:
        assert "/ColorSpace" not in pdf.pages[0].Resources
