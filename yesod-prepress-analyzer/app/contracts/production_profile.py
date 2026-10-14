from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class RuleOverride(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    code: str = Field(validation_alias=AliasChoices("code", "key", "rule_code"))
    enabled: bool = True
    severity: Literal["critical", "warning", "informational"] | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)

    @field_validator("severity", mode="before")
    @classmethod
    def accept_short_severity(cls, value: object) -> object:
        return "informational" if value == "info" else value


class TextileSettings(BaseModel):
    """DTF / DTG: tudo cadastrado no perfil (e ajustável na ficha); nada é suposto.

    Campo vazio = a verificação correspondente não roda e o relatório pede o valor.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    print_width_mm: float | None = Field(
        default=None, gt=0, validation_alias=AliasChoices("printWidthMm", "print_width_mm")
    )
    """DTF: largura útil do filme. DTG: largura da área imprimível."""
    print_height_mm: float | None = Field(
        default=None, gt=0, validation_alias=AliasChoices("printHeightMm", "print_height_mm")
    )
    """DTG: altura da área imprimível (DTF: rolo, sem limite de comprimento)."""
    min_line_mm: float | None = Field(
        default=None, gt=0, validation_alias=AliasChoices("minLineMm", "min_line_mm")
    )
    alpha_threshold_percent: float | None = Field(
        default=None,
        ge=0,
        le=100,
        validation_alias=AliasChoices("alphaThreshold", "alpha_threshold_percent"),
    )
    """Abaixo desta opacidade o branco não é impresso (definido pelo fluxo do operador)."""
    choke_mm: float | None = Field(
        default=None, ge=0, le=10, validation_alias=AliasChoices("chokeMm", "choke_mm")
    )
    spread_mm: float | None = Field(
        default=None, ge=0, le=10, validation_alias=AliasChoices("spreadMm", "spread_mm")
    )
    white_mode: Literal["generate", "from_file", "rip"] | None = Field(
        default=None, validation_alias=AliasChoices("whiteMode", "white_mode")
    )
    white_spot_name: str | None = Field(
        default=None, validation_alias=AliasChoices("whiteSpotName", "white_spot_name")
    )
    white_density_percent: float | None = Field(
        default=None,
        gt=0,
        le=100,
        validation_alias=AliasChoices("whiteDensity", "white_density_percent"),
    )

    # DTG: estratégia do branco conforme a cor da peça (cor vem da ficha do trabalho).
    garment_color: str | None = Field(
        default=None, validation_alias=AliasChoices("garmentColor", "garment_color")
    )
    white_dark: Literal["full", "no_black"] | None = Field(
        default=None, validation_alias=AliasChoices("whiteDark", "white_dark")
    )
    white_light: Literal["none", "light_colors", "full"] | None = Field(
        default=None, validation_alias=AliasChoices("whiteLight", "white_light")
    )
    black_threshold_percent: float | None = Field(
        default=None,
        ge=0,
        le=100,
        validation_alias=AliasChoices("blackThreshold", "black_threshold_percent"),
    )
    """Luminosidade até a qual a cor conta como preto (sem branco embaixo em peça escura)."""
    light_threshold_percent: float | None = Field(
        default=None,
        ge=0,
        le=100,
        validation_alias=AliasChoices("lightThreshold", "light_threshold_percent"),
    )
    """Luminosidade a partir da qual a cor é clara (recebe branco em peça clara)."""

    @property
    def garment_is_dark(self) -> bool | None:
        """Pela luminância da cor da peça; None sem cor informada."""

        value = (self.garment_color or "").lstrip("#")
        if len(value) != 6:
            return None
        try:
            r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            return None
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128

    @field_validator("white_mode", "white_spot_name", "white_dark", "white_light", mode="before")
    @classmethod
    def blank_is_none(cls, value: object) -> object:
        return value.strip() or None if isinstance(value, str) else value


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
    # Job ticket parameters. All are chosen per job by the operator; none is a fixed rule.
    rgb_policy: Literal["managed", "cmyk_only"] = Field(
        default="managed",
        validation_alias=AliasChoices("rgbPolicy", "rgb_policy"),
        description=(
            "managed: RGB with an ICC profile is accepted and converted by the RIP; "
            "cmyk_only: any RGB content is reported."
        ),
    )
    file_scale: float = Field(
        default=1.0,
        gt=0,
        le=1000,
        validation_alias=AliasChoices("fileScale", "file_scale", "scale"),
        description="Scale factor to the final size: 2 for a 1:2 file, 10 for 1:10.",
    )
    final_width_mm: float | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("finalWidthMm", "final_width_mm"),
    )
    final_height_mm: float | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("finalHeightMm", "final_height_mm"),
    )
    dimension_tolerance_mm: float = Field(
        default=1.0,
        ge=0,
        validation_alias=AliasChoices("dimensionToleranceMm", "dimension_tolerance_mm"),
    )

    technology: Literal["grafica", "dtf", "dtg"] = Field(
        default="grafica",
        description="grafica: impressão gráfica; dtf: filme; dtg: direto na peça.",
    )
    textile: TextileSettings = Field(default_factory=lambda: TextileSettings())

    @field_validator("technology", mode="before")
    @classmethod
    def known_technology(cls, value: object) -> object:
        return value if value in ("dtf", "dtg") else "grafica"

    @property
    def is_textile(self) -> bool:
        return self.technology in ("dtf", "dtg")

    @field_validator("file_scale", mode="before")
    @classmethod
    def parse_ratio(cls, value: object) -> object:
        """Accept the operator notation "1:5" as well as the factor 5."""

        if isinstance(value, str) and ":" in value:
            left, _, right = value.partition(":")
            try:
                return float(right) / float(left)
            except (ValueError, ZeroDivisionError):
                return value
        return value

    def rule_override(self, code: str) -> RuleOverride | None:
        return next((rule for rule in self.rules if rule.code == code), None)
