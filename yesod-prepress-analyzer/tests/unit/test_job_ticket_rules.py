from pathlib import Path

from app.analyzer.context import ColorInfo, DocumentContext, ImageInfo, PageInfo
from app.contracts.production_profile import ProductionProfile
from app.rules.color_rules import RgbContentRule, SpotDuplicateRule, SpotInventoryRule
from app.rules.image_rules import ImageResolutionRule, ImageRgbRule
from app.rules.page_rules import BleedRule, DimensionRule

MM = 72 / 25.4


def make_context(profile: ProductionProfile, **kwargs) -> DocumentContext:
    return DocumentContext(
        path=Path("test.pdf"), profile=profile, file_size=1, sha256="a" * 64, **kwargs
    )


def image(color_space: str = "DeviceCMYK", dpi: float = 300) -> ImageInfo:
    return ImageInfo(
        page=1,
        object_id="/Im1",
        width_px=1000,
        height_px=1000,
        effective_dpi_x=dpi,
        effective_dpi_y=dpi,
        color_space=color_space,
        bits_per_component=8,
        has_transparency=False,
    )


def page(width_mm: float, height_mm: float, bleed_mm: float = 0) -> PageInfo:
    w, h, b = width_mm * MM, height_mm * MM, bleed_mm * MM
    return PageInfo(
        number=1,
        media_box=(-b, -b, w + b, h + b),
        trim_box=(0, 0, w, h),
        bleed_box=(-b, -b, w + b, h + b),
    )


def test_resolution_is_judged_at_final_size():
    profile = ProductionProfile(id="p", minimumResolutionDpi=150, fileScale=5)
    issues = ImageResolutionRule().evaluate(make_context(profile, images=[image(dpi=300)]))
    assert issues and "60 ppi no tamanho final" in issues[0].found_value
    assert issues[0].severity == "warning"


def test_resolution_accepts_large_format_minimum():
    profile = ProductionProfile(id="p", minimumResolutionDpi=150)
    assert ImageResolutionRule().evaluate(make_context(profile, images=[image(dpi=150)])) == []


def test_managed_rgb_is_left_to_the_rip():
    profile = ProductionProfile(id="p")
    images = [image("ICCBased RGB"), image("DeviceRGB")]
    issues = ImageRgbRule().evaluate(make_context(profile, images=images))
    assert [issue.found_value for issue in issues] == ["DeviceRGB"]


def test_cmyk_only_policy_reports_every_rgb_image():
    profile = ProductionProfile(id="p", rgbPolicy="cmyk_only")
    images = [image("ICCBased RGB"), image("Indexed DeviceRGB"), image("ICCBased CMYK")]
    assert len(ImageRgbRule().evaluate(make_context(profile, images=images))) == 2


def test_vector_rgb_is_reported_without_cmyk_expectation():
    profile = ProductionProfile(id="p", colorModeExpected="RGB")
    context = make_context(profile, colors=ColorInfo(rgb_operators=3))
    assert RgbContentRule().evaluate(context)


def test_spot_names_are_normalized():
    colors = ColorInfo(spot_names={"PANTONE 186 C", "Pantone 186C", "CutContour", "Cyan"})
    context = make_context(ProductionProfile(id="p"), colors=colors)
    duplicates = SpotDuplicateRule().evaluate(context)
    assert len(duplicates) == 1
    inventory = SpotInventoryRule().evaluate(context)[0].found_value
    assert "Separações técnicas: CutContour" in inventory
    assert "Cyan" not in inventory


def test_bleed_is_measured_at_final_size():
    profile = ProductionProfile(id="p", minimumBleedMm=10, fileScale=10)
    assert BleedRule().evaluate(make_context(profile, pages=[page(300, 200, bleed_mm=1)])) == []


def test_dimension_matches_with_rotation_and_scale():
    profile = ProductionProfile(id="p", finalWidthMm=3000, finalHeightMm=2000, fileScale=10)
    assert DimensionRule().evaluate(make_context(profile, pages=[page(200, 300)])) == []


def test_dimension_detects_undeclared_scale():
    profile = ProductionProfile(id="p", finalWidthMm=3000, finalHeightMm=2000)
    issues = DimensionRule().evaluate(make_context(profile, pages=[page(1500, 1000)]))
    assert issues and "1:2" in issues[0].description


def test_dimension_detects_wrong_proportion():
    profile = ProductionProfile(id="p", finalWidthMm=3000, finalHeightMm=2000)
    issues = DimensionRule().evaluate(make_context(profile, pages=[page(3000, 1000)]))
    assert issues and "proporção" in issues[0].description


def test_dimension_skipped_without_ordered_size():
    context = make_context(ProductionProfile(id="p"), pages=[page(1, 1)])
    assert DimensionRule().evaluate(context) == []


def test_profile_accepts_operator_notation():
    profile = ProductionProfile(
        id="p", scale="1:10", rules=[{"key": "IMAGE_RGB", "severity": "info"}]
    )
    assert profile.file_scale == 10
    assert profile.rules[0].severity == "informational"
