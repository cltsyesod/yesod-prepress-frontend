from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import AliasChoices, AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator

from app.contracts.job_request import DownloadSource


class NestingSource(BaseModel):
    """One job (PDF) to place on the material. Everything comes from the job ticket."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    key: str = Field(min_length=1)
    label: str = ""
    file: DownloadSource
    quantity: int = Field(default=1, ge=1, le=10_000)
    pages: list[int] = Field(default_factory=list)  # vazio = todas as páginas
    file_scale: float = Field(
        default=1.0, gt=0, le=1000, validation_alias=AliasChoices("fileScale", "file_scale")
    )
    bleed_mm: float = Field(
        default=0.0, ge=0, le=500, validation_alias=AliasChoices("bleedMm", "bleed_mm")
    )
    cut_names: list[str] = Field(
        default_factory=lambda: ["CutContour", "Corte", "Cut"],
        validation_alias=AliasChoices("cutNames", "cut_names"),
    )
    use_die_line: bool = Field(
        default=True, validation_alias=AliasChoices("useDieLine", "use_die_line")
    )

    @field_validator("file_scale", mode="before")
    @classmethod
    def parse_ratio(cls, value: object) -> object:
        if isinstance(value, str) and ":" in value:
            left, _, right = value.partition(":")
            try:
                return float(right.split()[0]) / float(left)
            except (ValueError, ZeroDivisionError, IndexError):
                return value
        return value


class NestingMaterial(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    width_mm: float = Field(gt=0, le=5080, validation_alias=AliasChoices("widthMm", "width_mm"))
    length_mm: float | None = Field(
        default=None, gt=0, le=5080, validation_alias=AliasChoices("lengthMm", "length_mm")
    )
    margin_mm: float = Field(
        default=0.0, ge=0, le=500, validation_alias=AliasChoices("marginMm", "margin_mm")
    )
    gap_mm: float = Field(
        default=0.0, ge=0, le=500, validation_alias=AliasChoices("gapMm", "gap_mm")
    )
    max_roll_length_mm: float = Field(
        default=5000.0,
        gt=0,
        le=5080,
        validation_alias=AliasChoices("maxRollLengthMm", "max_roll_length_mm"),
    )


class NestingRotation(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    allow: bool = True
    step_degrees: float = Field(
        default=90.0, ge=0, le=360, validation_alias=AliasChoices("stepDegrees", "step_degrees")
    )


class NestingCutLines(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    add: bool = False
    name: str = "CutContour"


class NestingRequest(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    nesting_id: str = Field(min_length=1, validation_alias=AliasChoices("nestingId", "nesting_id"))
    callback_url: AnyHttpUrl = Field(validation_alias=AliasChoices("callbackUrl", "callback_url"))
    output_upload_url: AnyHttpUrl = Field(
        repr=False, validation_alias=AliasChoices("outputUploadUrl", "output_upload_url")
    )
    material: NestingMaterial
    rotation: NestingRotation = Field(default_factory=NestingRotation)
    cut_lines: NestingCutLines = Field(
        default_factory=NestingCutLines, validation_alias=AliasChoices("cutLines", "cut_lines")
    )
    items: list[NestingSource] = Field(min_length=1, max_length=200)


class NestingCallback(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["nesting"] = "nesting"
    event: Literal["progress", "completed", "failed"]
    event_id: str
    nestingId: str
    sequence: int = Field(ge=1)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    status: str
    progress: int = Field(ge=0, le=100)
    currentStep: str
    summary: dict[str, Any] = Field(default_factory=dict)
    errorMessage: str = ""
