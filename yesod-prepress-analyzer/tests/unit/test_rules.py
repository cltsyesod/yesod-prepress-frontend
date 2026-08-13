from pathlib import Path

from app.analyzer.context import ColorInfo, DocumentContext, FontInfo, ImageInfo
from app.contracts.production_profile import ProductionProfile
from app.rules.color_rules import InkCoverageRule, RgbContentRule
from app.rules.finishing_rules import CutLayerRule
from app.rules.font_rules import EmbeddedFontsRule
from app.rules.image_rules import ImageResolutionRule


def make_context(**kwargs) -> DocumentContext:
    profile = kwargs.pop(
        "profile",
        ProductionProfile(
            id="profile",
            minimumResolutionDpi=300,
            requiresCutLayer=True,
            maximumInkCoveragePercent=320,
        ),
    )
    return DocumentContext(
        path=Path("test.pdf"), profile=profile, file_size=1, sha256="a" * 64, **kwargs
    )


def test_low_resolution_is_measured_from_effective_dpi():
    context = make_context(
        images=[
            ImageInfo(
                page=2,
                object_id="/Im1",
                width_px=600,
                height_px=600,
                effective_dpi_x=150,
                effective_dpi_y=150,
                color_space="DeviceCMYK",
                bits_per_component=8,
                has_transparency=False,
            )
        ]
    )
    assert ImageResolutionRule().evaluate(context)[0].page == 2


def test_unembedded_font_is_critical():
    context = make_context(
        fonts=[
            FontInfo(
                page=1,
                object_id="/F1",
                name="Helvetica",
                subtype="Type1",
                embedded=False,
                subset=False,
                to_unicode=False,
            )
        ]
    )
    assert EmbeddedFontsRule().evaluate(context)[0].severity == "critical"


def test_rgb_and_high_ink_are_reported():
    colors = ColorInfo(rgb_operators=2, maximum_declared_ink_coverage=380)
    context = make_context(colors=colors)
    assert RgbContentRule().evaluate(context)
    assert InkCoverageRule().evaluate(context)


def test_cut_layer_accepts_spot_color_name():
    colors = ColorInfo(spot_names={"CutContour"})
    context = make_context(colors=colors)
    assert CutLayerRule().evaluate(context) == []
