from __future__ import annotations

from app.analyzer.context import DocumentContext, PageInfo
from app.analyzer.page_inspector import bleed_margins_mm, box_size_mm
from app.contracts.issue import AnalysisIssue
from app.contracts.production_profile import ProductionProfile
from app.fixes.geometry import describe_mm, target_trim
from app.rules.base import Rule


def page_boxes_fix(context: DocumentContext, page: PageInfo) -> dict:
    trim, how = target_trim(page, context.profile)
    return {
        "id": "set_page_boxes",
        "target": "pdf",
        "label": "Definir TrimBox e BleedBox",
        "preview": f"Formato final {describe_mm(trim, context.profile.file_scale)} ({how})",
    }


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
                can_auto_correct=True,
                fix=page_boxes_fix(context, page),
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
            # Die-cut piece: the cut follows the die line (usually outside the artwork),
            # so the page's rectangular bleed does not apply.
            if page.die_line_box is not None:
                continue
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
                        can_auto_correct=True,
                        fix=page_boxes_fix(context, page),
                    )
                )
                continue
            # The minimum is expressed at final size; a 1:N file needs 1/N of it.
            scale = context.profile.file_scale
            margins = [value * scale for value in bleed_margins_mm(page.trim_box, page.bleed_box)]
            if min(margins) + 0.01 < minimum:
                suffix = f" no tamanho final (escala 1:{scale:g})" if scale != 1 else ""
                issues.append(
                    self.issue(
                        context,
                        page=page.number,
                        title="Sangria insuficiente",
                        category="Sangria",
                        found_value=" / ".join(f"{value:.2f} mm" for value in margins) + suffix,
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


_COMMON_SCALES = (2, 4, 5, 10, 20, 25, 50, 100)


def _likely_scale(ratio: float) -> int | None:
    """Return N when the ratio between ordered and measured size matches a 1:N file."""

    for factor in _COMMON_SCALES:
        if abs(ratio - factor) / factor <= 0.01:
            return factor
    return None


def _size_candidates(
    page: PageInfo, profile: ProductionProfile
) -> list[tuple[tuple[float, float], str]]:
    """Possible finished sizes in the file, in mm.

    With a TrimBox there is only one reading. Without it, the MediaBox may include
    bleed, so the page minus the job's bleed (at final size or as drawn in the file)
    is also considered.
    """

    if page.trim_box is not None:
        return [(box_size_mm(page.trim_box), "TrimBox")]
    media = box_size_mm(page.media_box)
    if min(media) <= 0:
        return []
    candidates = [(media, "MediaBox")]
    bleeds = {profile.minimum_bleed_mm, profile.minimum_bleed_mm / profile.file_scale}
    for bleed in sorted(value for value in bleeds if value > 0):
        if min(media) > 2 * bleed:
            candidates.append(
                (
                    (media[0] - 2 * bleed, media[1] - 2 * bleed),
                    f"MediaBox sem {bleed:g} mm de sangria",
                )
            )
    return candidates


class DimensionRule(Rule):
    """Compares the final size (TrimBox × file scale) with the size ordered for the job."""

    code = "PAGE_DIMENSION_MISMATCH"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        profile = context.profile
        if profile.final_width_mm is None or profile.final_height_mm is None:
            return []
        expected = (profile.final_width_mm, profile.final_height_mm)
        tolerance = profile.dimension_tolerance_mm
        issues: list[AnalysisIssue] = []
        for page in context.pages:
            measured = []
            for in_file, box in _size_candidates(page, profile):
                final = (in_file[0] * profile.file_scale, in_file[1] * profile.file_scale)
                if (final[0] > final[1]) != (expected[0] > expected[1]):
                    final = (final[1], final[0])
                    in_file = (in_file[1], in_file[0])
                ratios = (expected[0] / final[0], expected[1] / final[1])
                scale = _likely_scale(ratios[0])
                measured.append(
                    (
                        in_file,
                        box,
                        final,
                        ratios,
                        scale,
                        scale is not None and scale == _likely_scale(ratios[1]),
                    )
                )
            if not measured or any(
                all(abs(a - b) <= tolerance for a, b in zip(m[2], expected, strict=True))
                for m in measured
            ):
                continue
            # Prefer the reading that explains the difference as a 1:N file.
            in_file, box, final, ratios, scale, same_scale = next(
                (m for m in measured if m[5]), measured[0]
            )
            fix = None
            if same_scale:
                suggested = scale * profile.file_scale
                description = (
                    f"O arquivo tem a proporção correta, mas parece estar em escala "
                    f"1:{suggested:g}, e o trabalho declara 1:{profile.file_scale:g}."
                )
                recommendation = (
                    f"Se o arquivo foi feito em 1:{suggested:g}, ajuste a escala do trabalho; "
                    "caso contrário, solicite o arquivo no tamanho correto."
                )
                fix = {
                    "id": "set_scale",
                    "target": "ticket",
                    "label": f"Usar escala 1:{suggested:g}",
                    "preview": "Atualiza a ficha do trabalho e reanalisa; o PDF não muda.",
                    "params": {"fileScale": f"1:{suggested:g}"},
                }
            elif abs(ratios[0] - ratios[1]) / max(ratios) <= 0.01:
                description = (
                    "O arquivo tem a proporção do pedido, mas em outro tamanho "
                    f"(fator {ratios[0]:.3f})."
                )
                recommendation = "Confirme se a peça pode ser reescalada proporcionalmente."
            else:
                description = "A proporção do arquivo é diferente da medida pedida."
                recommendation = (
                    "Não reescale sem aprovação: a arte seria distorcida ou cortada. "
                    "Solicite ao cliente o arquivo na medida correta."
                )
            issues.append(
                self.issue(
                    context,
                    page=page.number,
                    title="Dimensão diferente da pedida",
                    category="Página",
                    found_value=(
                        f"{final[0]:.1f} × {final[1]:.1f} mm no tamanho final "
                        f"({box} {in_file[0]:.1f} × {in_file[1]:.1f} mm, "
                        f"escala 1:{profile.file_scale:g})"
                    ),
                    expected_value=(
                        f"{expected[0]:g} × {expected[1]:g} mm (± {tolerance:g} mm)"
                    ),
                    description=description,
                    recommendation=recommendation,
                    can_auto_correct=fix is not None,
                    fix=fix,
                )
            )
        return issues
