from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

IssueSeverity = Literal["critical", "warning", "informational"]


class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class AnalysisIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_code: str
    title: str
    category: str
    severity: IssueSeverity
    status: Literal["pending"] = "pending"
    page: int = Field(default=0, ge=0)
    object_id: str = ""
    coordinates: str = ""
    found_value: str = ""
    expected_value: str = ""
    description: str
    recommendation: str
    confidence: int = Field(default=100, ge=0, le=100)
    source: Literal["qpdf", "pikepdf", "pdfium", "fonttools", "lcms"] = "pikepdf"
    can_auto_correct: bool = False

    @classmethod
    def with_box(cls, *, box: BoundingBox | None = None, **kwargs):
        if box is not None:
            kwargs["coordinates"] = box.model_dump_json()
        return cls(**kwargs)
