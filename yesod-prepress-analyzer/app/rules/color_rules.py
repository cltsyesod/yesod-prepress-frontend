from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class RgbContentRule(Rule):
    code = "COLOR_RGB_CONTENT"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if (
            "CMYK" not in context.profile.color_mode_expected.upper()
            or not context.colors.rgb_operators
        ):
            return []
        return [
            self.issue(
                context,
                title="Objetos vetoriais em RGB",
                category="Cor",
                found_value=f"{context.colors.rgb_operators} operação(ões) RGB",
                expected_value=context.profile.color_mode_expected,
                description="Foram encontrados operadores de pintura RGB no conteúdo vetorial.",
                recommendation="Converta as cores com o perfil ICC de destino e confira provas.",
            )
        ]


class OutputIntentRule(Rule):
    code = "COLOR_OUTPUT_INTENT"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if (
            context.colors.output_intent_identifier
            and context.colors.output_intent_valid is not False
        ):
            return []
        invalid = context.colors.output_intent_valid is False
        return [
            self.issue(
                context,
                title="Perfil de saída ausente ou inválido",
                category="Cor",
                found_value="ICC inválido" if invalid else "OutputIntent ausente",
                expected_value="OutputIntent ICC válido",
                description="O PDF não declara de forma confiável a condição de impressão.",
                recommendation="Exporte usando o perfil ICC fornecido pela produção.",
                source="lcms",
            )
        ]


class InkCoverageRule(Rule):
    code = "COLOR_INK_COVERAGE"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        found = context.colors.maximum_declared_ink_coverage
        maximum = context.profile.maximum_ink_coverage_percent
        if found <= maximum + 0.01:
            return []
        return [
            self.issue(
                context,
                title="Cobertura total de tinta elevada",
                category="Cor",
                found_value=f"Até {found:.0f}% em cores CMYK declaradas",
                expected_value=f"Máximo {maximum}%",
                description="Uma cor CMYK direta excede o limite de cobertura do perfil.",
                recommendation="Ajuste a separação de cores/geração de preto para o substrato.",
            )
        ]
