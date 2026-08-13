from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class ImageResolutionRule(Rule):
    code = "IMAGE_LOW_RESOLUTION"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        minimum = context.profile.minimum_resolution_dpi
        issues: list[AnalysisIssue] = []
        for image in context.images:
            if image.effective_dpi_x is None or image.effective_dpi_y is None:
                continue
            effective = min(image.effective_dpi_x, image.effective_dpi_y)
            if effective + 0.5 >= minimum:
                continue
            issues.append(
                self.issue(
                    context,
                    page=image.page,
                    object_id=image.object_id,
                    title="Imagem com baixa resolução",
                    category="Imagem",
                    found_value=f"{effective:.1f} dpi efetivos",
                    expected_value=f"Mínimo {minimum} dpi",
                    description=(
                        "A resolução efetiva considera o tamanho em pixels "
                        "e a escala de uso no PDF."
                    ),
                    recommendation=(
                        "Substitua a imagem por uma versão de maior resolução ou reduza sua escala."
                    ),
                )
            )
        return issues


class ImageRgbRule(Rule):
    code = "IMAGE_RGB"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if "CMYK" not in context.profile.color_mode_expected.upper():
            return []
        return [
            self.issue(
                context,
                page=image.page,
                object_id=image.object_id,
                title="Imagem em RGB",
                category="Cor",
                found_value=image.color_space,
                expected_value="CMYK ou perfil aceito pela produção",
                description="Uma imagem raster utiliza espaço de cor RGB.",
                recommendation="Converta com o perfil ICC de destino e revise a aparência.",
            )
            for image in context.images
            if "DeviceRGB" in image.color_space or image.color_space == "RGB"
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
