from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule

# Untagged RGB gets sRGB assigned (values kept); offered only when the RIP converts RGB.
ASSIGN_SRGB_FIX = {
    "id": "assign_rgb_profile",
    "target": "pdf",
    "label": "Atribuir perfil sRGB",
    "preview": (
        "Declara o RGB sem perfil como sRGB; os valores de cor não mudam e o RIP converte "
        "sempre do mesmo jeito."
    ),
}


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
                    else "Atribua o perfil sRGB (os valores não mudam) ou confirme que o perfil "
                    "RGB padrão do RIP é o esperado."
                ),
                can_auto_correct=not cmyk_only,
                fix=None if cmyk_only else ASSIGN_SRGB_FIX,
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
    technologies = ("grafica",)
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


def _pct(value: float) -> str:
    return f"{value * 100:.1f}".replace(".", ",") + "%"


class GamutRule(Rule):
    """Cores que mudam além da tolerância ao ir para o perfil de destino (gestão de cor)."""

    code = "COLOR_OUT_OF_GAMUT"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        gamut = context.facts.get("gamut") or {}
        if not gamut.get("output"):
            return []
        images = [i for i in gamut.get("images", []) if i["share"] > 0]
        vectors = gamut.get("vectors", {})
        if not images and not vectors.get("outOfGamut"):
            return []
        parts = []
        if vectors.get("outOfGamut"):
            parts.append(f"{vectors['outOfGamut']} de {vectors['colors']} cores de vetor/texto")
        for image in images[:5]:
            parts.append(f"imagem {image['name']} (pág. {image['page']}): {_pct(image['share'])}")
        return [
            self.issue(
                context,
                title="Cores que mudam ao ir para o perfil de destino",
                category="Cor",
                found_value="; ".join(parts),
                expected_value=f"Cores alcançáveis em {gamut['output']}",
                description=(
                    "Pela verificação de gamut (Little CMS, colorimétrica relativa) com "
                    f"{gamut['output']}, "
                    "estas cores não são alcançadas pela condição de impressão. "
                    f"RGB sem perfil foi tratado como {gamut['rgbSource']}."
                ),
                recommendation=(
                    "Confira na prova; se a cor for crítica (marca, Pantone), combine com o "
                    "cliente uma alternativa alcançável ou aceite a diferença."
                ),
            )
        ]


class OutputConditionRule(Rule):
    """CMYK preparado para outra condição: o RIP pode converter de novo (conversão dupla)."""

    code = "COLOR_OUTPUT_CONDITION_MISMATCH"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        gamut = context.facts.get("gamut") or {}
        intent = gamut.get("outputIntent") or {}
        if intent.get("matchesDestination") is not False or not context.colors.cmyk_operators:
            return []
        return [
            self.issue(
                context,
                title="Arte preparada para outra condição de impressão",
                category="Cor",
                found_value=f"Perfil de saída da arte: {intent.get('name') or 'outro perfil'}",
                expected_value=f"Destino: {gamut.get('output')}",
                description=(
                    "O CMYK da arte foi feito para outra condição. Se o RIP converter esse CMYK "
                    "para o destino, as cores mudam (conversão dupla); se não converter, a "
                    "impressão usa números feitos para outra máquina."
                ),
                recommendation=(
                    "Confirme com o cliente a condição correta ou configure o RIP para tratar o "
                    "CMYK de origem com o perfil da arte."
                ),
            )
        ]
