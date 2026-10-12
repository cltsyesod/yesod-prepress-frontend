from pathlib import Path

from app.analyzer.context import ColorInfo, DocumentContext, FontInfo, ImageInfo, PageInfo
from app.analyzer.file_profile import file_profile
from app.contracts.production_profile import ProductionProfile

MM = 72 / 25.4


def _context() -> DocumentContext:
    profile = ProductionProfile.model_validate(
        {
            "id": "p",
            "fileScale": 10,
            "minimumResolutionDpi": 100,
            "minimumBleedMm": 5,
            "cutLayerNames": ["CutContour"],
            "finalWidthMm": 3000,
            "finalHeightMm": 1500,
        }
    )
    # Página de 300 × 150 mm (1:10) com 0,5 mm de sangria no arquivo = 5 mm no final.
    b = 0.5 * MM
    trim = (b, b, b + 300 * MM, b + 150 * MM)
    return DocumentContext(
        path=Path("x.pdf"),
        profile=profile,
        file_size=1234,
        sha256="0" * 64,
        pdf_version="1.6",
        page_count=1,
        qpdf_ok=True,
        pdfium_ok=True,
        metadata={"xmp:CreatorTool": "Illustrator"},
        pages=[
            PageInfo(
                number=1,
                media_box=(0, 0, 301 * MM, 151 * MM),
                trim_box=trim,
                bleed_box=(0, 0, 301 * MM, 151 * MM),
                die_line_box=trim,
            )
        ],
        images=[ImageInfo(1, "10 0 R", 3000, 1500, 254.0, 254.0, "DeviceCMYK", 8, False)],
        fonts=[
            FontInfo(1, "1", "/ABCDEF+Helvetica", "/Type1", True, True, True),
            FontInfo(1, "2", "/Arial", "/TrueType", False, False, False),
        ],
        colors=ColorInfo(
            rgb_operators=2, cmyk_operators=40, spot_names={"PANTONE 485 C", "CutContour"}
        ),
        layers={"Arte", "Faca"},
    )


def test_profile_shows_final_sizes_bleed_ppi_fonts_and_targets():
    profile = file_profile(_context())
    page = profile["pages"][0]
    assert page["fileMm"] == [300.0, 150.0]
    assert page["finalMm"] == [3000.0, 1500.0]
    assert page["bleedMm"] == {"left": 5.0, "bottom": 5.0, "right": 5.0, "top": 5.0}
    assert page["dieLine"] and page["dieLineFinalMm"] == [3000.0, 1500.0]
    # 254 ppi no arquivo em 1:10 = 25 ppi no tamanho final.
    assert profile["images"]["minFinalPpi"] == 25
    assert profile["images"]["items"][0]["filePpi"] == 254
    assert profile["fonts"]["notEmbedded"] == 1
    assert profile["fonts"]["items"][0]["name"] == "Arial"  # as não incorporadas primeiro
    assert profile["colors"]["spots"] == ["PANTONE 485 C"]
    assert profile["colors"]["technicalSpots"] == ["CutContour"]
    assert profile["targets"]["minPpi"] == 100
    assert profile["targets"]["finalWidthMm"] == 3000
    assert profile["document"]["creator"] == "Illustrator"
