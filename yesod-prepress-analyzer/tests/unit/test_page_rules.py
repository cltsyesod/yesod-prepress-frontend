from pathlib import Path

from app.analyzer.context import DocumentContext, PageInfo
from app.contracts.production_profile import ProductionProfile
from app.rules.page_rules import BleedRule, PageBoxRule


def context_with_page(page: PageInfo) -> DocumentContext:
    return DocumentContext(
        path=Path("test.pdf"),
        profile=ProductionProfile(id="profile", minimumBleedMm=3),
        file_size=1,
        sha256="a" * 64,
        pages=[page],
    )


def test_missing_trimbox_creates_page_issue():
    context = context_with_page(PageInfo(number=1, media_box=(0, 0, 100, 100)))
    issues = PageBoxRule().evaluate(context)
    assert [issue.rule_code for issue in issues] == ["PAGE_TRIMBOX_MISSING"]


def test_three_mm_bleed_passes():
    bleed = 3 * 72 / 25.4
    context = context_with_page(
        PageInfo(
            number=1,
            media_box=(-bleed, -bleed, 100 + bleed, 100 + bleed),
            trim_box=(0, 0, 100, 100),
            bleed_box=(-bleed, -bleed, 100 + bleed, 100 + bleed),
        )
    )
    assert BleedRule().evaluate(context) == []


def test_zero_bleed_fails():
    context = context_with_page(
        PageInfo(
            number=1,
            media_box=(0, 0, 100, 100),
            trim_box=(0, 0, 100, 100),
            bleed_box=(0, 0, 100, 100),
        )
    )
    issues = BleedRule().evaluate(context)
    assert issues[0].severity == "critical"
