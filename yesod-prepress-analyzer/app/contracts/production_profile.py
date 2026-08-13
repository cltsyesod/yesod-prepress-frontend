from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class RuleOverride(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    code: str = Field(validation_alias=AliasChoices("code", "key", "rule_code"))
    enabled: bool = True
    severity: Literal["critical", "warning", "informational"] | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class ProductionProfile(BaseModel):
    """Production tolerances sent by Skip.

    Both the camelCase Skip payload and snake_case internal representation are
    accepted so the analyzer can be rolled out without a frontend change.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    name: str | None = None
    rules: list[RuleOverride] = Field(default_factory=list)
    color_mode_expected: str = Field(
        default="CMYK",
        validation_alias=AliasChoices("colorModeExpected", "color_mode_expected", "colorMode"),
    )
    minimum_resolution_dpi: int = Field(
        default=300,
        ge=1,
        le=2400,
        validation_alias=AliasChoices(
            "minimumResolutionDpi", "minimum_resolution_dpi", "minResolution"
        ),
    )
    minimum_bleed_mm: float = Field(
        default=3.0,
        ge=0,
        le=100,
        validation_alias=AliasChoices("minimumBleedMm", "minimum_bleed_mm", "minBleed"),
    )
    minimum_safety_margin_mm: float = Field(
        default=3.0,
        ge=0,
        le=100,
        validation_alias=AliasChoices(
            "minimumSafetyMarginMm", "minimum_safety_margin_mm", "safetyMargin"
        ),
    )
    requires_cut_layer: bool = Field(
        default=False,
        validation_alias=AliasChoices("requiresCutLayer", "requires_cut_layer", "cutLayerRequired"),
    )
    cut_layer_names: list[str] = Field(
        default_factory=lambda: ["CutContour", "Corte", "Cut"],
        validation_alias=AliasChoices("cutLayerNames", "cut_layer_names"),
    )
    require_pdf_x: bool = Field(
        default=False, validation_alias=AliasChoices("requirePdfX", "require_pdf_x")
    )
    maximum_ink_coverage_percent: int = Field(
        default=320,
        ge=100,
        le=400,
        validation_alias=AliasChoices(
            "maximumInkCoveragePercent", "maximum_ink_coverage_percent", "inkCoverageLimit"
        ),
    )

    def rule_override(self, code: str) -> RuleOverride | None:
        return next((rule for rule in self.rules if rule.code == code), None)
