"""Regras de DTF e DTG, a partir da medição do alfa (alpha_inspector).

Os limites (largura do filme, área imprimível, linha mínima, opacidade mínima do branco)
vêm do perfil ou da ficha. Sem o valor cadastrado, a regra pede o cadastro em vez de
supor um número.
"""

from __future__ import annotations

from app.analyzer.alpha_inspector import AlphaPage
from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule

TEXTILE = ("dtf", "dtg")
PARTIAL_SHARE = 0.005  # 0,5% da arte com opacidade parcial já aparece na base branca
BACKGROUND_SHARE = 0.98


def _pages(context: DocumentContext) -> list[AlphaPage]:
    return context.facts.get("textile_pages", [])


def _name(context: DocumentContext) -> str:
    return "DTF" if context.profile.technology == "dtf" else "DTG"


def _mm(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


class TextileMeasureRule(Rule):
    code = "TEXTILE_NOT_MEASURED"
    default_severity = "warning"
    technologies = TEXTILE

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        error = context.facts.get("textile_error")
        if not error:
            return []
        return [
            self.issue(
                context,
                title="Não foi possível medir a transparência",
                category="Têxtil",
                found_value="Medição falhou",
                expected_value="Arte renderizável",
                description=f"A renderização para medir a base branca falhou: {error}",
                recommendation="Confira a arte manualmente ou peça o arquivo novamente.",
            )
        ]


class TextilePrintAreaRule(Rule):
    code = "TEXTILE_PRINT_AREA"
    default_severity = "critical"
    technologies = TEXTILE

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        textile, dtf = context.profile.textile, context.profile.technology == "dtf"
        pages = [p for p in _pages(context) if p.art_size_mm]
        if not pages:
            return []
        if not textile.print_width_mm or (not dtf and not textile.print_height_mm):
            missing = "largura útil do filme" if dtf else "área imprimível (largura e altura)"
            return [
                self.issue(
                    context,
                    severity="informational",
                    title=f"Limite de impressão não cadastrado ({_name(context)})",
                    category="Têxtil",
                    found_value="Sem limite no perfil",
                    expected_value=missing.capitalize(),
                    description=(
                        f"O tamanho da arte não foi conferido porque o perfil não tem a {missing}."
                    ),
                    recommendation=(
                        "Cadastre o valor do equipamento (manual do fabricante) no perfil ou na "
                        "ficha do trabalho."
                    ),
                )
            ]
        issues = []
        width, height = textile.print_width_mm, textile.print_height_mm
        for page in pages:
            w, h = page.art_size_mm
            tol = 1 / page.px_per_mm  # precisão da medida: 1 pixel
            size = f"{_mm(w)} × {_mm(h)} mm"
            if dtf:
                if w <= width + tol:
                    continue
                rotated = h <= width + tol
                issues.append(
                    self.issue(
                        context,
                        page=page.page,
                        severity="informational" if rotated else self.severity(context),
                        title=(
                            "Arte só cabe girada no filme" if rotated else "Arte maior que o filme"
                        ),
                        category="Têxtil",
                        found_value=f"Arte {size}",
                        expected_value=f"Largura útil {_mm(width)} mm",
                        description=(
                            "A largura da arte passa da largura útil do filme"
                            + (", mas cabe girada 90°." if rotated else " nas duas posições.")
                        ),
                        recommendation=(
                            "Permita o giro na montagem."
                            if rotated
                            else "Reduza a arte (com o cliente) ou divida em partes; o sistema "
                            "não muda o tamanho sozinho."
                        ),
                    )
                )
            elif w > width + tol or h > height + tol:
                issues.append(
                    self.issue(
                        context,
                        page=page.page,
                        title="Arte maior que a área imprimível",
                        category="Têxtil",
                        found_value=f"Arte {size}",
                        expected_value=f"Área {_mm(width)} × {_mm(height)} mm",
                        description=(
                            "A arte passa da área imprimível do equipamento/gabarito: "
                            f"{_mm(max(0, w - width))} mm na largura e "
                            f"{_mm(max(0, h - height))} mm na altura."
                        ),
                        recommendation=(
                            "Ajuste o tamanho final na ficha (com aprovação do cliente) ou use "
                            "um gabarito com área maior."
                        ),
                    )
                )
        return issues


class TextileSemiTransparencyRule(Rule):
    code = "TEXTILE_SEMI_TRANSPARENT"
    default_severity = "warning"
    technologies = TEXTILE

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        threshold = context.profile.textile.alpha_threshold_percent
        issues = []
        for page in _pages(context):
            if page.partial_share < PARTIAL_SHARE:
                continue
            below = page.below_threshold_share
            extra = (
                f" Com o limite do perfil ({threshold:g}%), {below:.1%} da arte fica sem branco "
                "embaixo."
                if below is not None
                else " O perfil não define o limite de opacidade para o branco."
            )
            issues.append(
                self.issue(
                    context,
                    page=page.page,
                    title="Transparência parcial na arte",
                    category="Têxtil",
                    found_value=f"{page.partial_share:.1%} da arte com opacidade parcial",
                    expected_value="Cores sólidas ou efeito confirmado",
                    description=(
                        "Sombras, brilhos e degradês para o transparente não têm meio-termo na "
                        "base branca: ela é impressa cheia ou cortada, o que gera manchas, halo "
                        "ou contorno duro." + extra
                    ),
                    recommendation=(
                        "Confirme o efeito com o cliente ou peça a arte com cores sólidas; "
                        "converter em retícula ou achatar é uma decisão do operador."
                    ),
                )
            )
        return issues


class TextileBackgroundRule(Rule):
    code = "TEXTILE_SOLID_BACKGROUND"
    default_severity = "warning"
    technologies = TEXTILE

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        return [
            self.issue(
                context,
                page=page.page,
                title="Fundo chapado na arte inteira",
                category="Têxtil",
                found_value=f"{page.opaque_share_of_box:.0%} da página opaca",
                expected_value="Fundo transparente, salvo se o retângulo for intencional",
                description=(
                    "A página inteira é tinta: a peça sai como um retângulo cheio (com base "
                    "branca embaixo), inclusive se o fundo for branco ou da cor do tecido."
                ),
                recommendation=(
                    "Confirme com o cliente. Se o fundo não deve sair, peça a arte sem fundo; "
                    "o sistema não remove fundos sozinho."
                ),
            )
            for page in _pages(context)
            if page.opaque_share_of_box >= BACKGROUND_SHARE
        ]


class TextileThinDetailsRule(Rule):
    code = "TEXTILE_THIN_DETAILS"
    default_severity = "warning"
    technologies = TEXTILE

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        minimum = context.profile.textile.min_line_mm
        if not minimum:
            return []
        issues = []
        for page in _pages(context):
            if not page.thin_measured:
                issues.append(
                    self.issue(
                        context,
                        page=page.page,
                        severity="informational",
                        title="Detalhes finos não medidos",
                        category="Têxtil",
                        found_value="Página grande demais para a medição",
                        expected_value=f"Linhas de {_mm(minimum)} mm ou mais",
                        description="A página é grande demais para medir esse mínimo com precisão.",
                        recommendation="Confira os traços finos na visualização.",
                    )
                )
                continue
            # Ruído: menos que um quadrado do próprio mínimo não conta.
            if page.thin_mm2 is None or page.thin_mm2 <= minimum * minimum:
                continue
            issues.append(
                self.issue(
                    context,
                    page=page.page,
                    title="Detalhes mais finos que o mínimo",
                    category="Têxtil",
                    found_value=f"{_mm(page.thin_mm2)} mm² em traços abaixo de {_mm(minimum)} mm",
                    expected_value=f"Traços de {_mm(minimum)} mm ou mais",
                    description=(
                        "Traços, pontas e textos mais finos que o mínimo do perfil tendem a "
                        "falhar ou soltar na transferência/lavagem, e o choke do branco os reduz "
                        "ainda mais."
                    ),
                    recommendation="Peça ao cliente para engrossar os traços ou aceite o risco.",
                )
            )
        return issues
