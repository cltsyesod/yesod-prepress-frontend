from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule
from app.rules.color_rules import (
    InkCoverageRule,
    OutputIntentRule,
    RgbContentRule,
    SpotDuplicateRule,
    SpotInventoryRule,
)
from app.rules.file_rules import PdfSyntaxRule, PdfVersionRule, PdfXRule, PdfiumRenderRule
from app.rules.finishing_rules import CutLayerRule
from app.rules.font_rules import EmbeddedFontsRule, FontProgramRule
from app.rules.image_rules import ImageResolutionRule, ImageRgbRule, ImageTransparencyRule
from app.rules.page_rules import BleedRule, DimensionRule, PageBoxRule, PageSizeConsistencyRule


DEFAULT_RULES: tuple[Rule, ...] = (
    PdfSyntaxRule(),
    PdfiumRenderRule(),
    PdfVersionRule(),
    PdfXRule(),
    PageBoxRule(),
    BleedRule(),
    PageSizeConsistencyRule(),
    DimensionRule(),
    ImageResolutionRule(),
    ImageRgbRule(),
    ImageTransparencyRule(),
    EmbeddedFontsRule(),
    FontProgramRule(),
    RgbContentRule(),
    OutputIntentRule(),
    InkCoverageRule(),
    SpotDuplicateRule(),
    SpotInventoryRule(),
    CutLayerRule(),
)


def run_rules(
    context: DocumentContext, rules: tuple[Rule, ...] = DEFAULT_RULES
) -> list[AnalysisIssue]:
    issues: list[AnalysisIssue] = []
    for rule in rules:
        if rule.enabled(context):
            issues.extend(rule.evaluate(context))
    return issues
