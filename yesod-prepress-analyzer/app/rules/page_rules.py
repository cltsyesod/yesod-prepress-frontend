from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.analyzer.page_inspector import bleed_margins_mm, box_size_mm
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class PageBoxRule(Rule):
    code = "PAGE_TRIMBOX_MISSING"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        return [
            self.issue(
                context,
                page=page.number,
                title="TrimBox ausente",
                category="Página",
                found_value="TrimBox não definido",
                expected_value="TrimBox explícito",
                description="A caixa de corte final não está definida nesta página.",
                recommendation="Defina o formato final (TrimBox) durante a exportação.",
            )
            for page in context.pages
            if page.trim_box is None
        ]


class BleedRule(Rule):
    code = "PAGE_BLEED_INSUFFICIENT"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        minimum = context.profile.minimum_bleed_mm
        if minimum <= 0:
            return []
        issues: list[AnalysisIssue] = []
        for page in context.pages:
            if page.trim_box is None or page.bleed_box is None:
                issues.append(
                    self.issue(
                        context,
                        page=page.number,
                        title="Sangria não verificável",
                        category="Sangria",
                        found_value="TrimBox ou BleedBox ausente",
                        expected_value=f"Sangria mínima de {minimum:g} mm",
                        description=(
                            "As caixas necessárias para medir a sangria não estão definidas."
                        ),
                        recommendation="Exporte o PDF com TrimBox e BleedBox explícitos.",
                    )
                )
                continue
            margins = bleed_margins_mm(page.trim_box, page.bleed_box)
            if min(margins) + 0.01 < minimum:
                issues.append(
                    self.issue(
                        context,
                        page=page.number,
                        title="Sangria insuficiente",
                        category="Sangria",
                        found_value=" / ".join(f"{value:.2f} mm" for value in margins),
                        expected_value=f"Ao menos {minimum:g} mm em todos os lados",
                        description="A BleedBox não cobre a sangria mínima definida no perfil.",
                        recommendation="Amplie a arte e reexporte com a sangria correta.",
                    )
                )
        return issues


class PageSizeConsistencyRule(Rule):
    code = "PAGE_SIZE_INCONSISTENT"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if len(context.pages) < 2:
            return []
        reference = box_size_mm(context.pages[0].trim_box or context.pages[0].media_box)
        issues: list[AnalysisIssue] = []
        for page in context.pages[1:]:
            current = box_size_mm(page.trim_box or page.media_box)
            same = all(
                abs(a - b) <= 0.2 for a, b in zip(reference, current, strict=True)
            )
            rotated = (
                abs(reference[0] - current[1]) <= 0.2
                and abs(reference[1] - current[0]) <= 0.2
            )
            if not same and not rotated:
                issues.append(
                    self.issue(
                        context,
                        page=page.number,
                        title="Formato de página divergente",
                        category="Página",
                        found_value=f"{current[0]:.2f} × {current[1]:.2f} mm",
                        expected_value=f"{reference[0]:.2f} × {reference[1]:.2f} mm",
                        description="A página possui dimensões diferentes da primeira página.",
                        recommendation="Confirme se a variação é intencional antes da produção.",
                    )
                )
        return issues
