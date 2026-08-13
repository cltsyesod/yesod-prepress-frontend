from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class EmbeddedFontsRule(Rule):
    code = "FONT_NOT_EMBEDDED"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        return [
            self.issue(
                context,
                page=font.page,
                object_id=font.object_id,
                title="Fonte não incorporada",
                category="Fonte",
                found_value=font.name,
                expected_value="Fonte incorporada ou convertida em contornos",
                description="A fonte depende de substituição no ambiente de produção.",
                recommendation="Incorpore a fonte na exportação ou converta o texto em contornos.",
                source="fonttools",
            )
            for font in context.fonts
            if not font.embedded
        ]


class FontProgramRule(Rule):
    code = "FONT_PROGRAM_INVALID"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        return [
            self.issue(
                context,
                page=font.page,
                object_id=font.object_id,
                title="Programa de fonte inválido",
                category="Fonte",
                found_value=font.name,
                expected_value="Programa de fonte TrueType/OpenType válido",
                description="O fontTools não conseguiu interpretar a fonte incorporada.",
                recommendation="Reincorpore a fonte ou reexporte o documento.",
                source="fonttools",
            )
            for font in context.fonts
            if font.valid_font_program is False
        ]
