"""Proporção de tintas: separação real (Ghostscript) em PDFs de cobertura conhecida."""

import os
import shutil

import pikepdf
import pytest

from app.analyzer import ink_coverage
from app.analyzer.ink_coverage import measure_inks

MM = 72 / 25.4
# No CI (Linux, como o servidor) o Ghostscript é obrigatório: lá estes testes nunca pulam.
needs_gs = pytest.mark.skipif(
    ink_coverage._gs() is None and not os.environ.get("CI"), reason="Ghostscript não instalado"
)


def spot(name: str, cmyk: list[float]) -> pikepdf.Array:
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=cmyk, N=1)
    sep = pikepdf.Name.Separation
    return pikepdf.Array([sep, pikepdf.Name("/" + name), pikepdf.Name.DeviceCMYK, tint])


def sample(tmp_path, overprint=False):
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(100 * MM, 100 * MM))
    page = pdf.pages[0]
    page.obj.Resources = pikepdf.Dictionary(
        ColorSpace=pikepdf.Dictionary(P=spot("PANTONE 185 C", [0, 0.91, 0.76, 0])),
        ExtGState=pikepdf.Dictionary(OP=pikepdf.Dictionary(OP=True, op=True, OPM=1)),
    )
    full, half = 100 * MM, 50 * MM
    ops = [
        f"0 0.5 0 0 k 0 0 {full} {full} re f",  # Magenta 50% na página toda
        ("/OP gs " if overprint else "") + f"1 0 0 0 k 0 0 {half} {full} re f",  # Ciano à esquerda
        f"/P cs 1 scn {60 * MM} {60 * MM} {20 * MM} {20 * MM} re f",  # Pantone 20×20 mm
    ]
    page.contents_add("\n".join(ops).encode())
    path = tmp_path / "tintas.pdf"
    pdf.save(path)
    return path


@needs_gs
def test_inks_are_measured_per_separation(tmp_path):
    result = measure_inks(sample(tmp_path))
    assert result["error"] == ""
    inks = {i["name"]: i for i in result["pages"][0]["inks"]}
    assert set(inks) >= {"Cyan", "Magenta", "Yellow", "Black", "PANTONE 185 C"}
    assert inks["Cyan"]["coverage"] == pytest.approx(0.5, abs=0.02)
    assert inks["Cyan"]["area"] == pytest.approx(0.5, abs=0.02)
    # O ciano vaza o magenta por baixo (sem sobreimpressão); o Pantone também.
    assert inks["Magenta"]["coverage"] == pytest.approx(0.5 * (0.5 - 0.04), abs=0.02)
    assert inks["PANTONE 185 C"]["coverage"] == pytest.approx(0.04, abs=0.01)
    assert inks["Yellow"]["coverage"] == pytest.approx(0, abs=0.005)
    assert result["pages"][0]["maxProcessTotal"] == pytest.approx(100, abs=3)


@needs_gs
def test_overprint_adds_ink_instead_of_knocking_out(tmp_path):
    result = measure_inks(sample(tmp_path, overprint=True))
    inks = {i["name"]: i for i in result["pages"][0]["inks"]}
    # Com sobreimpressão o magenta continua sob o ciano: 150% de tinta ali.
    assert inks["Magenta"]["coverage"] == pytest.approx(0.5 - 0.5 * 0.04, abs=0.02)
    assert result["pages"][0]["maxProcessTotal"] == pytest.approx(150, abs=3)


def test_without_ghostscript_the_analysis_goes_on(tmp_path, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: None)
    result = measure_inks(sample(tmp_path))
    assert result["pages"] == [] and "Ghostscript" in result["error"]
