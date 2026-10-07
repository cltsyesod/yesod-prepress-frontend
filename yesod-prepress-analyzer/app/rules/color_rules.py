from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class RgbContentRule(Rule):
    code = "COLOR_RGB_CONTENT"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        # rg/RG always paint in DeviceRGB, i.e. RGB without a source profile.
        if not context.colors.rgb_operators:
            return []
        cmyk_only = context.profile.rgb_policy == "cmyk_only"
        return [
            self.issue(
                context,
                title="Objetos vetoriais em RGB sem perfil",
                category="Cor",
                found_value=f"{context.colors.rgb_operators} operação(ões) DeviceRGB",
                expected_value=(
                    "CMYK (exigido para este trabalho)"
                    if cmyk_only
                    else "RGB com perfil ICC, ou CMYK"
                ),
                description=(
                    "Vetores em DeviceRGB não carregam perfil de origem; o RIP aplicará o "
                    "perfil RGB padrão dele na conversão."
                ),
                recommendation=(
                    "Converta as cores com o perfil ICC de destino e confira provas."
                    if cmyk_only
                    else "Confirme que o perfil RGB padrão do RIP é o esperado ou reexporte "
                    "com perfil incorporado."
                ),
            )
        ]


def _spot_key(name: str) -> str:
    """Normalize a spot name the way operators read it: PANTONE 186 C == Pantone 186C."""

    return "".join(char for char in name.casefold() if char.isalnum())


_NOT_SPOT = {"cyan", "magenta", "yellow", "black", "all", "none"}


def _spots(context: DocumentContext) -> list[str]:
    return sorted(name for name in context.colors.spot_names if _spot_key(name) not in _NOT_SPOT)


class SpotDuplicateRule(Rule):
    code = "COLOR_SPOT_DUPLICATE"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        groups: dict[str, set[str]] = {}
        for name in _spots(context):
            groups.setdefault(_spot_key(name), set()).add(name)
        return [
            self.issue(
                context,
                title="Cor especial com nomes divergentes",
                category="Cor especial",
                found_value=" | ".join(sorted(names)),
                expected_value="Um único nome por tinta",
                description=(
                    "Nomes que parecem a mesma tinta podem gerar chapas ou canais separados "
                    "no RIP."
                ),
                recommendation="Unifique os nomes da cor especial antes da produção.",
            )
            for names in groups.values()
            if len(names) > 1
        ]


class SpotInventoryRule(Rule):
    code = "COLOR_SPOT_INVENTORY"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        technical = {_spot_key(name) for name in context.profile.cut_layer_names}
        spots = _spots(context)
        if not spots:
            return []
        inks = [name for name in spots if _spot_key(name) not in technical]
        separations = [name for name in spots if _spot_key(name) in technical]
        found = []
        if inks:
            found.append("Tintas: " + ", ".join(inks))
        if separations:
            found.append("Separações técnicas: " + ", ".join(separations))
        return [
            self.issue(
                context,
                title="Cores especiais encontradas",
                category="Cor especial",
                found_value=" — ".join(found),
                expected_value="Conferir com as tintas e acabamentos do trabalho",
                description=(
                    "Lista das separações Separation/DeviceN declaradas no arquivo."
                ),
                recommendation=(
                    "Confirme se cada tinta será impressa como spot ou convertida em processo."
                ),
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
