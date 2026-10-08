import json
import zipfile
from pathlib import Path

import pikepdf
import pytest
from PIL import Image

from app.contracts.tiling import TilingRequest
from app.tiling.export import neighbours, safe_file_name
from app.tiling.package import build_package

MM = 72 / 25.4


def banner_pdf(path: Path) -> Path:
    """A 3000 x 1500 mm banner drawn at 1:10, with 5 mm of bleed (final size)."""

    pdf = pikepdf.Pdf.new()
    bleed = 0.5 * MM  # 5 mm at final size = 0.5 mm in the 1:10 file
    w, h = 300 * MM, 150 * MM
    pdf.add_blank_page(page_size=(w + 2 * bleed, h + 2 * bleed))
    page = pdf.pages[0]
    page.obj.TrimBox = [bleed, bleed, bleed + w, bleed + h]
    page.obj.BleedBox = [0, 0, w + 2 * bleed, h + 2 * bleed]
    stripes = " ".join(
        f"{c} {1 - c} 0.2 0 k {i * (w + 2 * bleed) / 6:.2f} 0 {(w + 2 * bleed) / 6:.2f} "
        f"{h + 2 * bleed:.2f} re f"
        for i, c in enumerate((0, 0.2, 0.4, 0.6, 0.8, 1))
    )
    page.contents_add(stripes.encode())
    pdf.save(path)
    return path


def request(tmp_path: Path, background: bool = False) -> TilingRequest:
    # Three vertical panels; each later panel repeats 25 mm of the previous one.
    tiles = []
    for i in range(3):
        x = i * 1000
        left = 25 if i else 5  # overlap with the previous panel, or the outer bleed
        right = 5 if i == 2 else 0
        tiles.append(
            {
                "number": i + 1,
                "name": f"Fachada Loja – painel {i + 1:02d}",
                "region": "Fachada",
                "column": i + 1,
                "row": 1,
                "visible": {"x": x, "y": 0, "w": 1000, "h": 1500},
                "printed": {"x": x - left, "y": -5, "w": 1000 + left + right, "h": 1510},
            }
        )
    payload = {
        "tilingId": "t1",
        "callbackUrl": "https://example.com/cb",
        "outputs": {
            "pdf": "https://example.com/a",
            "zip": "https://example.com/b",
            "guide": "https://example.com/c",
        },
        "title": "Loja Centro",
        "source": {"url": "https://example.com/art.pdf"},
        "fileScale": "1:10",
        "tiles": tiles,
        "seams": [
            {
                "orientation": "vertical",
                "position": 1000,
                "start": 0,
                "end": 1500,
                "kind": "overlap",
            },
            {
                "orientation": "vertical",
                "position": 2000,
                "start": 0,
                "end": 1500,
                "kind": "overlap",
            },
        ],
        "config": {"overlapMm": 25},
    }
    if background:
        payload["background"] = {
            "url": "https://example.com/bg.png",
            "xMm": -200,
            "yMm": -300,
            "widthMm": 3400,
        }
    return TilingRequest.model_validate(payload)


def test_panels_guide_and_package(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    reference = Image.new("RGBA", (680, 420), (0, 0, 0, 0))
    reference.paste((40, 40, 40, 255), (0, 380, 680, 420))
    out = build_package(request(tmp_path, background=True), source, tmp_path, reference)

    with pikepdf.open(out.pdf) as pdf:
        assert len(pdf.pages) == 3
        sizes = []
        for page in pdf.pages:
            trim = [float(v) for v in page.TrimBox]
            sizes.append(round((trim[2] - trim[0]) / MM))
            # Printed area at final size, inside a 10 mm margin for marks and label.
            assert round(float(page.MediaBox[2]) / MM) == sizes[-1] + 20
        assert sizes == [1005, 1025, 1030]
        # The artwork is stored once and shared by every panel.
        forms = {
            page.Resources.XObject[k].objgen for page in pdf.pages for k in page.Resources.XObject
        }
        assert len(forms) == 1

    with zipfile.ZipFile(out.zip) as archive:
        names = sorted(archive.namelist())
        assert "GUIA_DE_INSTALACAO.pdf" in names and "configuracao.json" in names
        panels = [n for n in names if n.startswith("paineis/")]
        assert panels == [
            "paineis/Fachada_Loja_painel_01.pdf",
            "paineis/Fachada_Loja_painel_02.pdf",
            "paineis/Fachada_Loja_painel_03.pdf",
        ]
        config = json.loads(archive.read("configuracao.json"))
        assert config["panels"][1]["neighbours"] == {"left": 1, "right": 3}

    with pikepdf.open(out.guide) as guide:
        assert len(guide.pages) == 1
    assert out.summary["panels"] == 3


def test_neighbours_and_file_names():
    req = request(Path("."))
    assert neighbours(req.tiles)[1] == {"right": 2}
    assert safe_file_name("Fiorino 2024 / lateral (esq.)") == "Fiorino_2024_lateral_esq"


def test_panel_outside_the_artwork_is_refused(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    req.tiles[0].printed.x = 9000
    with pytest.raises(Exception, match="fora da arte"):
        build_package(req, source, tmp_path)
