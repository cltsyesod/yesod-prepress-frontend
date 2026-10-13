from __future__ import annotations

from abc import ABC, abstractmethod

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue, IssueSeverity


class Rule(ABC):
    code: str
    default_severity: IssueSeverity
    technologies: tuple[str, ...] = ("grafica", "dtf", "dtg")
    """Tecnologias de produção em que a regra faz sentido."""

    def enabled(self, context: DocumentContext) -> bool:
        if context.profile.technology not in self.technologies:
            return False
        override = context.profile.rule_override(self.code)
        return override.enabled if override else True

    def severity(self, context: DocumentContext) -> IssueSeverity:
        override = context.profile.rule_override(self.code)
        return override.severity if override and override.severity else self.default_severity

    @abstractmethod
    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]: ...

    def issue(self, context: DocumentContext, **kwargs) -> AnalysisIssue:
        kwargs.setdefault("rule_code", self.code)
        kwargs.setdefault("severity", self.severity(context))
        return AnalysisIssue(**kwargs)
