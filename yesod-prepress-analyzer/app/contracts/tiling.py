"""Tiling (panelling): a large artwork split into printable panels.

The panel layout is planned on screen (where the operator edits it) and arrives
here as explicit rectangles, in millimetres at final size, with the origin at the
lower-left corner of the artwork's finished format (TrimBox). The analyzer only
validates, exports the panels and draws the installation guide.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import AliasChoices, AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator

from app.contracts.job_request import DownloadSource


class Rect(BaseModel):
    model_config = ConfigDict(extra="ignore")

    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class Edges(BaseModel):
    model_config = ConfigDict(extra="ignore")

    top: float = Field(default=0, ge=0, le=1000)
    right: float = Field(default=0, ge=0, le=1000)
    bottom: float = Field(default=0, ge=0, le=1000)
    left: float = Field(default=0, ge=0, le=1000)


class TilingTile(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    number: int = Field(ge=1, le=10_000)
    id: str = Field(default="", max_length=20)
    """Grid identification, e.g. L1C2 (row from the top, column from the left)."""
    name: str = Field(min_length=1, max_length=200)
    """File name chosen by the operator (without extension)."""
    region: str = Field(default="", max_length=120, validation_alias=AliasChoices("region", "zone"))
    """Where it goes (e.g. "Lateral esquerda", "Fachada - térreo")."""
    column: int = Field(default=1, ge=1)
    row: int = Field(default=1, ge=1)
    visible: Rect = Field(validation_alias=AliasChoices("visible", "logical"))
    """Logical tile: the part of the artwork this panel is responsible for."""
    printed: Rect = Field(validation_alias=AliasChoices("printed", "print"))
    """Print window: the logical part plus overlaps and the outer bleed."""
    white: Edges = Field(default_factory=Edges)
    """Unprinted glue/weld area added outside the print window, per edge."""
    rotation: Literal[0, 90, 180, 270] = 0
    """How the panel goes on the media (clockwise): 90 = lying, +180 for flip-flop."""


class TilingConstraint(BaseModel):
    """Printable area of the material, checked again before any file is made."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    printable_width_mm: float = Field(
        default=0, ge=0, validation_alias=AliasChoices("printableWidth", "printable_width_mm")
    )
    printable_length_mm: float = Field(
        default=0, ge=0, validation_alias=AliasChoices("printableLength", "printable_length_mm")
    )
    direction: Literal["standing", "lying", "auto"] = "standing"
    """With "auto" each panel brings its own rotation."""


class TilingSeam(BaseModel):
    """A joint between panels, drawn in the guide."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    orientation: Literal["vertical", "horizontal"]
    position: float
    start: float
    end: float
    kind: Literal["overlap", "gap", "butt"] = "overlap"
    width_mm: float = Field(default=0, ge=0, validation_alias=AliasChoices("widthMm", "width_mm"))


class TilingBackground(BaseModel):
    """Reference picture (vehicle, building) shown under the panels in the guide only."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    url: AnyHttpUrl = Field(repr=False)
    """Signed URL of a PNG, JPEG, WebP or PDF (first page)."""
    x_mm: float = Field(default=0, validation_alias=AliasChoices("xMm", "x_mm"))
    y_mm: float = Field(default=0, validation_alias=AliasChoices("yMm", "y_mm"))
    width_mm: float = Field(gt=0, validation_alias=AliasChoices("widthMm", "width_mm"))
    opacity: float = Field(default=0.6, ge=0, le=1)


class TilingMarks(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    margin_mm: float = Field(
        default=10, ge=0, le=200, validation_alias=AliasChoices("marginMm", "margin_mm")
    )
    """Blank border around the printed area of each panel, where marks and the label go."""
    crop_marks: bool = Field(default=True, validation_alias=AliasChoices("cropMarks", "crop_marks"))
    label: bool = True


class TilingOutputs(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    pdf: AnyHttpUrl = Field(repr=False)
    """All panels in one PDF (one page each; the artwork is stored once)."""
    zip: AnyHttpUrl = Field(repr=False)
    """One PDF per panel, the guide and the configuration."""
    guide: AnyHttpUrl = Field(repr=False)


class TilingRequest(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    tiling_id: str = Field(min_length=1, validation_alias=AliasChoices("tilingId", "tiling_id"))
    callback_url: AnyHttpUrl = Field(validation_alias=AliasChoices("callbackUrl", "callback_url"))
    outputs: TilingOutputs
    title: str = Field(default="", max_length=200)
    source: DownloadSource
    page: int = Field(default=1, ge=1)
    file_scale: float = Field(
        default=1.0, gt=0, le=1000, validation_alias=AliasChoices("fileScale", "file_scale")
    )
    tiles: list[TilingTile] = Field(min_length=1, max_length=500)
    seams: list[TilingSeam] = Field(default_factory=list)
    background: TilingBackground | None = None
    marks: TilingMarks = Field(default_factory=TilingMarks)
    constraint: TilingConstraint = Field(default_factory=TilingConstraint)
    config: dict[str, Any] = Field(default_factory=dict)
    """The screen's configuration, saved next to the panels for reuse."""

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


class TilingCallback(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["tiling"] = "tiling"
    event: Literal["progress", "completed", "failed"]
    event_id: str
    tilingId: str
    sequence: int = Field(ge=1)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    status: str
    progress: int = Field(ge=0, le=100)
    currentStep: str
    summary: dict[str, Any] = Field(default_factory=dict)
    errorMessage: str = ""
