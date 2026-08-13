from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.contracts.issue import AnalysisIssue

CallbackEvent = Literal["progress", "issues", "completed", "failed", "cancelled"]


class CallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: str = "2026-08-04"
    event: CallbackEvent
    event_id: str
    analysisId: str
    externalJobId: str
    sequence: int = Field(ge=1)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    status: str
    progress: int = Field(ge=0, le=100)
    currentStep: str
    issues: list[AnalysisIssue] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    errorCode: str = ""
    errorMessage: str = ""
