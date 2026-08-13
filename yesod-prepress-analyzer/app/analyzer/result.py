from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from app.contracts.issue import AnalysisIssue


@dataclass(slots=True)
class AnalysisResult:
    issues: list[AnalysisIssue] = field(default_factory=list)
    summary: dict[str, object] = field(default_factory=dict)

    def finalize(self, *, page_count: int, sha256: str) -> AnalysisResult:
        severities = Counter(issue.severity for issue in self.issues)
        categories = Counter(issue.category for issue in self.issues)
        self.summary = {
            "page_count": page_count,
            "sha256": sha256,
            "issue_count": len(self.issues),
            "severity_counts": dict(severities),
            "category_counts": dict(categories),
        }
        return self

    @property
    def final_status(self) -> str:
        if any(issue.severity == "critical" for issue in self.issues):
            return "completed_with_warnings"
        if self.issues:
            return "completed_with_warnings"
        return "completed"
