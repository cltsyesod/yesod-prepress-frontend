from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


def _is_unmanaged_rgb(color_space: str) -> bool:
    return "DeviceRGB" in color_space or color_space == "RGB"


def _is_rgb(color_space: str) -> bool:
    return _is_unmanaged_rgb(color_space) or "RGB" in color_space


class ImageResolutionRule(Rule):
    """Effective resolution measured at the final printed size (file scale applied).

    The minimum is a job parameter, not a universal 300 ppi: large-format work
    viewed from a distance is routinely accepted at much lower values.
    """

    code = "IMAGE_LOW_RESOLUTION"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        minimum = context.profile.minimum_resolution_dpi
        scale = context.profile.file_scale
        issues: list[AnalysisIssue] = []
        for image in context.images:
            if image.effective_dpi_x is None or image.effective_dpi_y is None:
                continue
            in_file = min(image.effective_dpi_x, image.effective_dpi_y)
            final = in_file / scale
            if final + 0.5 >= minimum:
                continue
            if scale != 1:
                found = (
                    f"{in_file:.0f} ppi no arquivo → {final:.0f} ppi no tamanho final "
                    f"(escala 1:{scale:g})"
                )
            else:
                found = f"{final:.0f} ppi efetivos"
            issues.append(
                self.issue(
                    context,
                    page=image.page,
                    object_id=image.object_id,
                    title="Imagem com resolução abaixo do definido para o trabalho",
                    category="Imagem",
                    found_value=found,
                    expected_value=f"Mínimo {minimum} ppi no tamanho final",
                    description=(
                        "A resolução efetiva considera os pixels da imagem, a escala de uso "
                        "no PDF e a escala do arquivo em relação ao tamanho final."
                    ),
                    recommendation=(
                        "Substitua a imagem, reduza sua escala ou use upscaling. Se a distância "
                        "de observação justificar, aceite como exceção registrada."
                    ),
                    can_auto_correct=True,
                    fix={
                        "id": "upscale_images",
                        "target": "pdf",
                        "label": "Ampliar imagens (upscaling)",
                        "preview": (
                            f"Imagens abaixo de {minimum} ppi ampliadas com Lanczos até {minimum} "
                            "ppi no tamanho final (no máximo 4×), em uma cópia; cores e "
                            "transparência preservadas"
                        ),
                        "params": {"targetPpi": minimum},
                    },
                )
            )
        return issues


class ImageRgbRule(Rule):
    code = "IMAGE_RGB"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if context.profile.rgb_policy == "cmyk_only":
            return [
                self.issue(
                    context,
                    page=image.page,
                    object_id=image.object_id,
                    title="Imagem em RGB",
                    category="Cor",
                    found_value=image.color_space,
                    expected_value="CMYK (exigido para este trabalho)",
                    description="Uma imagem raster utiliza espaço de cor RGB.",
                    recommendation=(
                        "Converta com o perfil ICC de destino e revise a aparência."
                    ),
                )
                for image in context.images
                if _is_rgb(image.color_space)
            ]
        # Managed workflow: the RIP converts RGB. Only RGB without a profile is ambiguous.
        return [
            self.issue(
                context,
                page=image.page,
                object_id=image.object_id,
                title="Imagem RGB sem perfil ICC",
                category="Cor",
                found_value=image.color_space,
                expected_value="RGB com perfil ICC incorporado, ou CMYK",
                description=(
                    "Sem perfil de origem, o RIP interpreta a imagem com o perfil RGB padrão "
                    "dele, e a cor pode mudar entre equipamentos."
                ),
                recommendation=(
                    "Exporte incorporando o perfil de origem (ex.: sRGB). A conversão para "
                    "CMYK continua a cargo do RIP; convertê-la aqui é opcional."
                ),
            )
            for image in context.images
            if _is_unmanaged_rgb(image.color_space)
        ]


class ImageTransparencyRule(Rule):
    code = "IMAGE_TRANSPARENCY"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        return [
            self.issue(
                context,
                page=image.page,
                object_id=image.object_id,
                title="Transparência em imagem",
                category="Imagem",
                found_value="Máscara/SMask presente",
                expected_value="Compatível com o RIP de destino",
                description=(
                    "A imagem contém transparência e pode exigir achatamento em fluxos legados."
                ),
                recommendation=(
                    "Confirme a compatibilidade do RIP; achate somente quando necessário."
                ),
            )
            for image in context.images
            if image.has_transparency
        ]
