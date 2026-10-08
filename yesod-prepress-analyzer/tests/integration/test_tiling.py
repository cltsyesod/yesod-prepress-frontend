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
            bleed = [float(v) for v in page.BleedBox]
            # TrimBox = the logical tile; BleedBox = the print window with the overlaps.
            assert round((trim[2] - trim[0]) / MM) == 1000
            sizes.append(round((bleed[2] - bleed[0]) / MM))
            # Print window at final size, inside a 10 mm margin for marks and label.
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
        manifest = archive.read("manifesto.csv").decode("utf-8-sig").splitlines()
        assert manifest[0].startswith("Projeto;Revisão;Nº;Posição;Arquivo")
        assert len(manifest) == 4
        assert manifest[2].split(";")[:3] == ["Loja Centro", "R1", "02"]
        assert manifest[2].endswith("esq. 01, dir. 03")

    with pikepdf.open(out.guide) as guide:
        # Overview + one sheet per panel.
        assert len(guide.pages) == 4
        sheet = _page_text(guide.pages[2])
        assert "Painel 02 de 3" in sheet
        # Panel 2 prints 25 mm over panel 1 and panel 3 prints over it.
        assert "este fica por cima \\(25 mm\\)" in sheet
        assert "este fica por baixo \\(25 mm\\)" in sheet
    assert out.summary["panels"] == 3
    assert out.summary["revision"] == 1


def test_guide_has_one_sheet_per_area_in_installation_order(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    # Later panels print over earlier ones: install 1, 2, 3; two areas.
    areas = ("Térreo", "Térreo", "Loja")
    for tile, region, install in zip(req.tiles, areas, (1, 2, 3), strict=True):
        tile.region = region
        tile.install = install
    out = build_package(req, source, tmp_path)
    with pikepdf.open(out.guide) as guide:
        # Overview + 2 areas + 3 panels.
        assert len(guide.pages) == 6
        terreo = _page_text(guide.pages[1])
        assert "(Área: Térreo) Tj" in terreo
        assert "(1º) Tj" in terreo and "(2º) Tj" in terreo
        assert "(Área: Loja) Tj" in _page_text(guide.pages[2])
        assert "1º de 3" in _page_text(guide.pages[3])
    with zipfile.ZipFile(out.zip) as archive:
        manifest = archive.read("manifesto.csv").decode("utf-8-sig").splitlines()
        assert manifest[1].split(";")[5:7] == ["Térreo", "1º"]


def _page_text(page) -> str:
    contents = page.obj.Contents
    streams = contents if isinstance(contents, pikepdf.Array) else [contents]
    return b"".join(item.read_bytes() for item in streams).decode("cp1252")


def test_label_lines_from_the_screen_and_mark_types(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    req.tiles[0].label_top = "Loja · painel 01/3 · R2"
    req.tiles[0].label_bottom = ""
    req.marks.overlap_marks = False
    req.marks.center_marks = True
    req.config["revision"] = 2
    out = build_package(req, source, tmp_path)
    assert out.summary["revision"] == 2
    with pikepdf.open(out.pdf) as pdf:
        first = _page_text(pdf.pages[0])
        assert "(Loja · painel 01/3 · R2) Tj".encode("cp1252").decode("cp1252") in first
        assert "Vizinhos" not in first
        # No dashed overlap ticks; the centre ticks are drawn thicker.
        second = _page_text(pdf.pages[1])
        assert "[2 1.5] 0 d" not in second
        assert "0.6 w" in second


def test_label_moves_past_the_ticks_or_is_cut_short():
    from app.tiling.export import _fit

    # Free stretches: 0..100 and 100..300 (tick at 100), 1.5 mm padding each side.
    x, text = _fit("x" * 20, 10, 0, 300, [100.0])
    assert x > 100 and text == "x" * 20
    x, text = _fit("x" * 200, 10, 0, 300, [100.0])
    assert x > 100 and text.endswith("…") and len(text) < 200


def test_neighbours_and_file_names():
    req = request(Path("."))
    assert neighbours(req.tiles)[1] == {"right": 2}
    assert safe_file_name("Fiorino 2024 / lateral (esq.)") == "Fiorino_2024_lateral_esq"


def test_white_glue_area_is_blank_and_outside_the_print(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    req.tiles[0].white.right = 30
    out = build_package(req, source, tmp_path)
    with pikepdf.open(out.pdf) as pdf:
        page = pdf.pages[0]
        bleed = [float(v) for v in page.BleedBox]
        media = [float(v) for v in page.MediaBox]
        # 1005 printed + 30 of glue area + 2 × 10 margin.
        assert round(media[2] / MM) == 1055
        assert round((bleed[2] - bleed[0]) / MM) == 1005
        # The art is clipped to the print window: the glue area gets no ink.
        contents = page.obj.Contents
        streams = contents if isinstance(contents, pikepdf.Array) else [contents]
        text = b"".join(item.read_bytes() for item in streams).decode("cp1252")
        clip_width = f"{bleed[2] - bleed[0]:.3f}".rstrip("0").rstrip(".")
        assert f"{clip_width} " in text and "re W n" in text


def test_panels_that_do_not_fit_the_material_are_refused(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    req.constraint.printable_width_mm = 1010
    with pytest.raises(Exception, match="não cabem no material"):
        build_package(req, source, tmp_path)


def test_lying_and_flip_flop_panels_are_rotated_and_checked_lying(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    req.constraint.direction = "auto"
    # 1510 mm tall panels only fit a 1600 × 1100 mm sheet lying down.
    req.constraint.printable_width_mm = 1600
    req.constraint.printable_length_mm = 1100
    for tile, rotation in zip(req.tiles, (90, 270, 90), strict=True):
        tile.rotation = rotation
    out = build_package(req, source, tmp_path)
    with pikepdf.open(out.pdf) as pdf:
        assert [int(page.obj.Rotate) for page in pdf.pages] == [90, 270, 90]
    assert [f["rotation"] for f in out.summary["files"]] == [90, 270, 90]

    req.tiles[1].rotation = 0
    with pytest.raises(Exception, match="não cabem no material"):
        build_package(req, source, tmp_path)


def test_panel_outside_the_artwork_is_refused(tmp_path):
    source = banner_pdf(tmp_path / "banner.pdf")
    req = request(tmp_path)
    req.tiles[0].printed.x = 9000
    with pytest.raises(Exception, match="fora da arte"):
        build_package(req, source, tmp_path)
