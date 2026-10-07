from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.contracts.production_profile import ProductionProfile


@dataclass(slots=True)
class PageInfo:
    number: int
    media_box: tuple[float, float, float, float]
    crop_box: tuple[float, float, float, float] | None = None
    trim_box: tuple[float, float, float, float] | None = None
    bleed_box: tuple[float, float, float, float] | None = None
    art_box: tuple[float, float, float, float] | None = None
    rotation: int = 0
    die_line_box: tuple[float, float, float, float] | None = None
    """Bounds of the die line (cut separation paths), when the page has one."""


@dataclass(slots=True)
class ImageInfo:
    page: int
    object_id: str
    width_px: int
    height_px: int
    effective_dpi_x: float | None
    effective_dpi_y: float | None
    color_space: str
    bits_per_component: int | None
    has_transparency: bool


@dataclass(slots=True)
class FontInfo:
    page: int
    object_id: str
    name: str
    subtype: str
    embedded: bool
    subset: bool
    to_unicode: bool
    valid_font_program: bool | None = None


@dataclass(slots=True)
class ColorInfo:
    rgb_operators: int = 0
    cmyk_operators: int = 0
    gray_operators: int = 0
    spot_names: set[str] = field(default_factory=set)
    maximum_declared_ink_coverage: float = 0.0
    output_intent_identifier: str = ""
    output_intent_valid: bool | None = None


@dataclass(slots=True)
class DocumentContext:
    path: Path
    profile: ProductionProfile
    file_size: int
    sha256: str
    pdf_version: str = ""
    page_count: int = 0
    encrypted: bool = False
    linearized: bool = False
    pdfx_version: str = ""
    qpdf_ok: bool = False
    qpdf_output: str = ""
    pdfium_ok: bool = False
    metadata: dict[str, str] = field(default_factory=dict)
    pages: list[PageInfo] = field(default_factory=list)
    images: list[ImageInfo] = field(default_factory=list)
    fonts: list[FontInfo] = field(default_factory=list)
    colors: ColorInfo = field(default_factory=ColorInfo)
    layers: set[str] = field(default_factory=set)
    facts: dict[str, Any] = field(default_factory=dict)
