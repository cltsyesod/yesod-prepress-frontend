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
        if any(page.magenta_strokes for page in context.pages):
            return []  # MagentaDieLineRule offers to convert the faca the client drew
        name = (context.profile.cut_layer_names or ["CutContour"])[0]
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
                    "Crie a faca como spot color/camada usando o nome previsto no perfil, "
                    "ou gere automaticamente pelo contorno da arte (por fora dela)."
                ),
                can_auto_correct=True,
                fix={
                    "id": "add_contour_cut",
                    "target": "pdf",
                    "label": "Gerar faca pelo contorno da arte",
                    "preview": (
                        f"Faca na cor especial {name}, em camada própria, contornando a arte "
                        "por fora com o afastamento que você definir"
                    ),
                    "params": {"name": name},
                },
            )
        ]


class MagentaDieLineRule(Rule):
    """A die line drawn in plain 100% magenta prints instead of being cut."""

    code = "FINISHING_MAGENTA_DIE_LINE"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        pages = [page for page in context.pages if page.magenta_strokes]
        if not pages:
            return []
        name = (context.profile.cut_layer_names or ["CutContour"])[0]
        count = sum(page.magenta_strokes for page in pages)
        numbers = ", ".join(str(page.number) for page in pages)
        # When the job needs a die line, this is the one the client meant to send.
        required = context.profile.requires_cut_layer
        return [
            self.issue(
                context,
                page=pages[0].number,
                title="Faca em magenta comum, sem cor especial",
                category="Acabamento",
                severity="critical" if required else self.severity(context),
                found_value=f"{count} linha(s) só de contorno em 100% magenta (pág. {numbers})",
                expected_value=f"Faca na cor especial {name}",
                description=(
                    "Linhas magenta sem cor especial são impressas pelo RIP em vez de cortadas. "
                    "Confira se essas linhas são mesmo a faca e não parte da arte."
                ),
                recommendation=f"Converta as linhas magenta para a cor especial {name}.",
                can_auto_correct=True,
                fix={
                    "id": "convert_magenta_die_line",
                    "target": "pdf",
                    "label": f"Converter linhas magenta em faca ({name})",
                    "preview": (
                        f"Só a cor do contorno das linhas magenta muda para {name}; "
                        "preenchimentos e posição não são alterados"
                    ),
                    "params": {"name": name},
                },
            )
        ]
