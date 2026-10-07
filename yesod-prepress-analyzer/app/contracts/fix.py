from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Fixes that change the PDF. "set_scale" is offered on issues too, but it only
# changes the job ticket, so the frontend handles it and it never reaches here.
FixId = Literal["set_page_boxes", "add_cut_contour", "add_crop_marks"]


class FixRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: FixId
    params: dict[str, Any] = Field(default_factory=dict)


class AppliedFix(BaseModel):
    id: FixId
    label: str
    details: list[str] = Field(default_factory=list)
