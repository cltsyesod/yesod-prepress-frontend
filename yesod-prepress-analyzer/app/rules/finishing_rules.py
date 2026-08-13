from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class CutLayerRule(Rule):
    code = "FINISHING_CUT_LAYER"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if not context.profile.requires_cut_layer:
            return []
        expected = {name.casefold() for name in context.profile.cut_layer_names}
        found = {name.casefold() for name in context.layers | context.colors.spot_names}
        if expected & found:
            return []
        return [
            self.issue(
                context,
                title="Camada de corte não encontrada",
                category="Acabamento",
                found_value=(
                    ", ".join(sorted(context.layers | context.colors.spot_names)) or "Nenhuma"
                ),
                expected_value=", ".join(context.profile.cut_layer_names),
                description="O perfil exige uma camada ou cor especial destinada ao corte.",
                recommendation=(
                    "Crie a faca como spot color/camada usando o nome previsto no perfil."
                ),
            )
        ]
