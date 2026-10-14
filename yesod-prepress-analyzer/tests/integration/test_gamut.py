"""Gestão de cor: ΔE2000 conferido com a referência e gamut com um perfil CMYK real."""

import glob
import os
import zlib
from pathlib import Path

import numpy as np
import pikepdf
import pytest
from PIL import ImageCms

from app.analyzer.context import DocumentContext
from app.analyzer.gamut import analyze_gamut, delta_e00
from app.contracts.production_profile import ProductionProfile
from app.rules.color_rules import GamutRule, OutputConditionRule

CANDIDATES = [
    "C:/Windows/System32/spool/drivers/color/RSWOP.icm",
    "/usr/share/color/icc/ghostscript/default_cmyk.icc",
    *glob.glob("/usr/share/ghostscript/**/default_cmyk.icc", recursive=True),
    *glob.glob("/usr/share/color/icc/**/*cmyk*.ic*", recursive=True),
]
CMYK = next((Path(p) for p in CANDIDATES if Path(p).is_file()), None)
needs_cmyk = pytest.mark.skipif(
    CMYK is None and not os.environ.get("CI"), reason="sem perfil CMYK nesta máquina"
)


def test_delta_e00_matches_the_published_reference():
    # Pares 1, 7 e 17 da tabela de Sharma, Wu e Dalal (2005).
    lab1 = np.array([[50, 2.6772, -79.7751], [50, 0, 0], [50, 2.5, 0]])
    lab2 = np.array([[50, 0, -82.7485], [50, -1, 2], [56, -27, -3]])
    assert delta_e00(lab1, lab2) == pytest.approx([2.0425, 2.3669, 31.9030], abs=1e-3)


def profile_with_destination(**color):
    return ProductionProfile(
        id="p",
        color={
            "output": {
                "url": "https://example.com/out.icc",
                "name": "CMYK teste",
                "colorSpace": "CMYK",
            },
            **color,
        },
    )


def rgb_image_pdf(path: Path) -> Path:
    # Metade verde puro (fora do gamut CMYK), metade cinza médio (dentro).
    w, h = 40, 20
    pixels = np.zeros((h, w, 3), np.uint8)
    pixels[:, : w // 2] = (0, 255, 0)
    pixels[:, w // 2 :] = (128, 128, 128)
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(200, 100))
    image = pikepdf.Stream(pdf, zlib.compress(pixels.tobytes()))
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height, image.BitsPerComponent = w, h, 8
    image.ColorSpace, image.Filter = pikepdf.Name.DeviceRGB, pikepdf.Name.FlateDecode
    page = pdf.pages[0]
    page.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=image))
    page.contents_add(b"q 200 0 0 100 0 0 cm /Im0 Do Q")
    pdf.save(path)
    return path


@needs_cmyk
def test_gamut_finds_the_bright_green_and_keeps_the_gray(tmp_path):
    path = rgb_image_pdf(tmp_path / "rgb.pdf")
    context = DocumentContext(
        path=path, profile=profile_with_destination(), file_size=1, sha256="a" * 64
    )
    context.colors.rgb_colors = {(0.0, 1.0, 0.0), (0.5, 0.5, 0.5)}
    result = analyze_gamut(path, context, {"output": CMYK})
    assert result["error"] == ""
    assert result["vectors"]["colors"] == 2
    assert result["vectors"]["outOfGamut"] == 1
    assert result["vectors"]["worst"][0]["rgb"] == [0, 255, 0]
    [image] = result["images"]
    assert image["share"] == pytest.approx(0.5, abs=0.05)
    assert "premissa" in result["rgbSource"]
    issue = GamutRule().evaluate(_with(context, result))[0]
    assert "1 de 2 cores" in issue.found_value


def _with(context, gamut):
    context.facts["gamut"] = gamut
    return context


@needs_cmyk
def test_output_intent_for_another_condition_warns_of_double_conversion(tmp_path):
    path = rgb_image_pdf(tmp_path / "rgb.pdf")
    context = DocumentContext(
        path=path, profile=profile_with_destination(), file_size=1, sha256="a" * 64
    )
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    context.colors.output_intent_profile = srgb
    context.colors.output_intent_identifier = "sRGB"
    context.colors.cmyk_operators = 3
    _with(context, analyze_gamut(path, context, {"output": CMYK}))
    assert context.facts["gamut"]["outputIntent"]["matchesDestination"] is False
    [issue] = OutputConditionRule().evaluate(context)
    assert issue.severity == "warning"
    context.colors.output_intent_profile = CMYK.read_bytes()
    _with(context, analyze_gamut(path, context, {"output": CMYK}))
    assert OutputConditionRule().evaluate(context) == []


def test_without_destination_nothing_is_measured(tmp_path):
    path = rgb_image_pdf(tmp_path / "rgb.pdf")
    context = DocumentContext(
        path=path, profile=ProductionProfile(id="p"), file_size=1, sha256="a" * 64
    )
    assert analyze_gamut(path, context, {}) == {}
    assert GamutRule().evaluate(_with(context, {})) == []
