# ruff: noqa: E501 - mensagens ao operador ficam inteiras numa linha
"""Regras do Ghent Workgroup GWG 2022, na variante escolhida no perfil de produção.

Cada ocorrência leva o número da regra GWG no título. Os valores vêm de
app/standards/gwg2022.py (perfis oficiais da GWG). Sem variante escolhida, nada roda.
"""

from __future__ import annotations

from collections import Counter

from app.analyzer.content_scan import Event
from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule
from app.rules.object_rules import (
    _events,
    _in_art,
    _is_cut,
    _is_registration,
    _num,
    _pages_text,
    _trim,
)
from app.standards.gwg2022 import VARIANTS, Gwg2022

PT_PER_MM = 72 / 25.4


def variant(context: DocumentContext) -> Gwg2022 | None:
    return VARIANTS.get(context.profile.gwg_variant or "")


def channels(event: Event) -> int:
    """Quantas tintas o objeto usa (0 = branco/sem tinta). RGB conta como várias: o RIP
    o converte em mais de uma tinta."""

    c, family = event.color, event.space.family
    if not c:
        return 2
    if family in ("cmyk", "icc_cmyk"):
        return sum(1 for v in c[:4] if v > 0.001)
    if family in ("gray", "icc_gray"):
        return 0 if c[0] > 0.999 else 1
    if family == "sep":
        return 1 if c[0] > 0.001 else 0
    if family == "devicen":
        return sum(1 for v in c if v > 0.001)
    if family in ("rgb", "icc_rgb"):
        return 0 if min(c[:3]) > 0.999 else 3
    return 2


def is_white(event: Event) -> bool:
    return bool(event.color) and channels(event) == 0


def pure_black(event: Event) -> str | None:
    c, family = event.color, event.space.family
    if family == "cmyk" and len(c) == 4 and c[3] > 0.999 and max(c[:3]) < 0.001:
        return "cmyk"
    if family == "gray" and c and c[0] < 0.001:
        return "gray"
    return None


class GwgRule(Rule):
    """Base: só roda com variante GWG escolhida."""

    def enabled(self, context: DocumentContext) -> bool:
        return variant(context) is not None and super().enabled(context)

    def gwg_issue(self, context, rule: str, title: str, **kwargs) -> AnalysisIssue:
        v = variant(context)
        kwargs.setdefault("category", "GWG 2022")
        return self.issue(
            context,
            title=f"{rule} · {title}",
            recommendation=kwargs.pop("recommendation"),
            description=kwargs.pop("description") + f" ({v.name}.)",
            **kwargs,
        )


class GwgWhiteOverprintRule(GwgRule):
    code = "GWG_R0007"
    default_severity = "critical"

    def evaluate(self, context):
        texts, paths = Counter(), Counter()
        for events in _events(context).values():
            for e in events:
                if e.overprint and is_white(e) and _in_art(context, e):
                    (texts if e.kind == "text" else paths)[e.page] += 1
        issues = []
        for found, rule, what in (
            (texts, "GWG 2022 R0007", "texto"),
            (paths, "GWG 2022 R0008", "vetor"),
        ):
            if found:
                issues.append(
                    self.gwg_issue(
                        context,
                        rule,
                        f"Branco com sobreimpressão ({what})",
                        page=min(found),
                        found_value=f"{sum(found.values())} objeto(s) ({_pages_text(found)})",
                        expected_value="Branco sem sobreimpressão",
                        description="Branco com sobreimpressão some ou muda conforme o RIP; a GWG não permite",
                        recommendation="Peça ao cliente para tirar a sobreimpressão dos objetos brancos.",
                    )
                )
        return issues


class GwgBlackTextOverprintRule(GwgRule):
    code = "GWG_R0009"
    default_severity = "warning"

    def evaluate(self, context):
        limit = variant(context).black_text_overprint_pt
        if not limit:
            return []
        found = {"cmyk": Counter(), "gray": Counter()}
        for events in _events(context).values():
            for e in events:
                kind = pure_black(e) if e.kind == "text" else None
                if kind and e.size_pt and e.size_pt < limit and _in_art(context, e):
                    if not (e.overprint and (e.opm == 1 or kind == "gray")):
                        found[kind][e.page] += 1
        issues = []
        for kind, rule in (("cmyk", "GWG 2022 R0009"), ("gray", "GWG 2022 R0011")):
            if found[kind]:
                issues.append(
                    self.gwg_issue(
                        context,
                        rule,
                        "Texto 100% preto sem sobreimpressão",
                        page=min(found[kind]),
                        found_value=f"{sum(found[kind].values())} texto(s) abaixo de {_num(limit)} pt ({_pages_text(found[kind])})",
                        expected_value=f"Texto 100% preto abaixo de {_num(limit)} pt em sobreimpressão"
                        + (" (OPM 1)" if kind == "cmyk" else ""),
                        description="Texto preto pequeno sem sobreimpressão vaza o fundo e deixa filete branco se o registro variar",
                        recommendation="Peça o texto preto pequeno em sobreimpressão, ou ligue a sobreimpressão do preto no RIP.",
                    )
                )
        return issues


class GwgCourierRule(GwgRule):
    code = "GWG_R0014"
    default_severity = "warning"

    def evaluate(self, context):
        if not variant(context).courier:
            return []
        fonts = sorted({f.name for f in context.fonts if "courier" in f.name.lower()})
        if not fonts:
            return []
        return [
            self.gwg_issue(
                context,
                "GWG 2022 R0014",
                "Fonte Courier no arquivo",
                found_value=", ".join(fonts),
                expected_value="Sem Courier",
                description="Courier costuma aparecer quando uma fonte faltou e foi trocada na criação do PDF",
                recommendation="Confira se o texto em Courier é intencional; se não, peça o arquivo com a fonte certa.",
            )
        ]


class GwgRichBlackTextRule(GwgRule):
    code = "GWG_R0015"
    default_severity = "warning"

    def evaluate(self, context):
        limits = variant(context).rich_black_text
        if not limits:
            return []
        k_min, tac_max = limits
        found = Counter()
        for events in _events(context).values():
            for e in events:
                c = e.color
                if e.kind == "text" and e.space.family in ("cmyk", "icc_cmyk") and len(c) == 4:
                    if c[3] >= k_min - 1e-6 and sum(c) > tac_max + 1e-6 and _in_art(context, e):
                        found[e.page] += 1
        if not found:
            return []
        return [
            self.gwg_issue(
                context,
                "GWG 2022 R0015",
                "Texto em preto rico com tinta demais",
                page=min(found),
                found_value=f"{sum(found.values())} texto(s) ({_pages_text(found)})",
                expected_value=f"Texto preto com no máximo {tac_max * 100:.0f}% de tinta total",
                description=f"Texto com K a partir de {k_min * 100:.0f}% e tinta total acima de {tac_max * 100:.0f}% borra e demora a secar",
                recommendation="Peça o texto em 100% K ou com menos tinta nas outras cores.",
            )
        ]


class GwgSmallTextRule(GwgRule):
    code = "GWG_R0017"
    default_severity = "warning"

    def evaluate(self, context):
        v = variant(context)
        white, multi = Counter(), Counter()
        for events in _events(context).values():
            for e in events:
                if e.kind != "text" or not e.size_pt or not _in_art(context, e):
                    continue
                if v.white_text_pt and is_white(e) and e.size_pt < v.white_text_pt:
                    white[e.page] += 1
                elif v.multi_text_pt and channels(e) > 1 and e.size_pt < v.multi_text_pt:
                    multi[e.page] += 1
        issues = []
        if white:
            issues.append(
                self.gwg_issue(
                    context,
                    "GWG 2022 R0016",
                    "Texto branco pequeno sobre cor",
                    page=min(white),
                    found_value=f"{sum(white.values())} texto(s) abaixo de {_num(v.white_text_pt)} pt ({_pages_text(white)})",
                    expected_value=f"Texto branco vazado com {_num(v.white_text_pt)} pt ou mais",
                    description="Texto branco pequeno vazado em fundo de várias tintas fecha com qualquer variação de registro",
                    recommendation="Peça o texto branco maior ou mais grosso.",
                )
            )
        if multi:
            issues.append(
                self.gwg_issue(
                    context,
                    "GWG 2022 R0017",
                    "Texto pequeno com mais de uma tinta",
                    page=min(multi),
                    found_value=f"{sum(multi.values())} texto(s) abaixo de {_num(v.multi_text_pt)} pt ({_pages_text(multi)})",
                    expected_value=f"Texto com mais de uma tinta a partir de {_num(v.multi_text_pt)} pt",
                    description="Texto pequeno formado por várias tintas sai borrado e fora de registro",
                    recommendation="Peça o texto pequeno em uma tinta só (ex.: 100% K) ou maior.",
                )
            )
        return issues


class GwgThinLineRule(GwgRule):
    code = "GWG_R0019"
    default_severity = "warning"

    def evaluate(self, context):
        v = variant(context)
        white, multi = Counter(), Counter()
        for events in _events(context).values():
            for e in events:
                if e.kind != "stroke" or e.width_mm is None or not _in_art(context, e):
                    continue
                if e.space.family == "sep" and (
                    _is_cut(context, e.space.name) or _is_registration(e)
                ):
                    continue
                width_pt = e.width_mm * PT_PER_MM
                if v.white_line_pt and is_white(e) and width_pt < v.white_line_pt:
                    white[e.page] += 1
                elif v.multi_line_pt and channels(e) > 1 and width_pt < v.multi_line_pt:
                    multi[e.page] += 1
        issues = []
        for found, rule, title, limit in (
            (white, "GWG 2022 R0018", "Linha branca fina sobre cor", v.white_line_pt),
            (multi, "GWG 2022 R0019", "Linha fina com mais de uma tinta", v.multi_line_pt),
        ):
            if found:
                issues.append(
                    self.gwg_issue(
                        context,
                        rule,
                        title,
                        page=min(found),
                        found_value=f"{sum(found.values())} linha(s) abaixo de {_num(limit)} pt ({_pages_text(found)})",
                        expected_value=f"{_num(limit)} pt ou mais",
                        description="Linhas finas vazadas ou formadas por várias tintas somem ou saem fora de registro",
                        recommendation="Peça as linhas mais grossas, ou em uma tinta só.",
                    )
                )
        return issues


def _ppi(image, scale: float) -> float | None:
    values = [v for v in (image.effective_dpi_x, image.effective_dpi_y) if v]
    return min(values) / scale if values else None


class GwgImageResolutionRule(GwgRule):
    code = "GWG_R0031"
    default_severity = "warning"

    def evaluate(self, context):
        v, scale = variant(context), context.profile.file_scale
        issues = []
        for rule, limits, lineart, label in (
            ("GWG 2022 R0031", v.image_ppi, False, "Resolução de imagem"),
            ("GWG 2022 R0032", v.lineart_ppi, True, "Resolução de imagem de traço (1 bit)"),
        ):
            if not limits:
                continue
            low, high = limits
            errors, warnings = [], []
            for image in context.images:
                is_lineart = image.bits_per_component == 1
                if is_lineart != lineart or (
                    lineart and max(image.width_px, image.height_px) <= 16
                ):
                    continue
                ppi = _ppi(image, scale)
                if ppi is None:
                    continue
                if ppi <= low:
                    errors.append((image, ppi))
                elif ppi < high:
                    warnings.append((image, ppi))
            for found, severity, expected in (
                (errors, "critical", f"acima de {_num(low)} ppi"),
                (warnings, "warning", f"{_num(high)} ppi ou mais"),
            ):
                if found:
                    issues.append(
                        self.gwg_issue(
                            context,
                            rule,
                            label,
                            page=found[0][0].page,
                            severity=severity,
                            found_value=", ".join(
                                f"pág. {img.page}: {ppi:.0f} ppi" for img, ppi in found[:5]
                            ),
                            expected_value=f"Tamanho final: {expected}",
                            description="Resolução abaixo da faixa da GWG para esta impressão, medida no tamanho final",
                            recommendation="Peça a imagem em maior resolução ou aceite com o motivo.",
                        )
                    )
        return issues


class GwgSingleImagePageRule(GwgRule):
    code = "GWG_R0033"
    default_severity = "warning"

    def evaluate(self, context):
        v = variant(context)
        if not v.single_image_ppi:
            return []
        low, high = v.single_image_ppi
        issues = []
        for page, events in _events(context).items():
            trim = _trim(context, page)
            images = [e for e in events if e.kind == "image" and e.box]
            others = [
                e for e in events if e.kind in ("text", "fill", "stroke") and _in_art(context, e)
            ]
            if trim is None or len(images) != 1 or others:
                continue
            ppis = [
                _ppi(img, context.profile.file_scale) for img in context.images if img.page == page
            ]
            ppi = min((p for p in ppis if p), default=None)
            if ppi is None or ppi >= high:
                continue
            issues.append(
                self.gwg_issue(
                    context,
                    "GWG 2022 R0033",
                    "Página feita de uma só imagem",
                    page=page,
                    severity="critical" if ppi <= low else "warning",
                    found_value=f"{ppi:.0f} ppi no tamanho final",
                    expected_value=f"{_num(high)} ppi ou mais (abaixo de {_num(low)} é erro)",
                    description="A página inteira é uma imagem: textos e traços dependem só da resolução dela",
                    recommendation="Peça o arquivo com textos em vetor ou a imagem em maior resolução.",
                )
            )
        return issues


class GwgOptionalContentRule(GwgRule):
    code = "GWG_R0034"
    default_severity = "warning"

    def evaluate(self, context):
        if not variant(context).optional_content or not context.layers:
            return []
        return [
            self.gwg_issue(
                context,
                "GWG 2022 R0034",
                "Arquivo com camadas",
                found_value=", ".join(sorted(context.layers)[:8]),
                expected_value="Sem camadas (conteúdo opcional)",
                description="Camadas podem ser ligadas ou desligadas de forma diferente em cada etapa da produção",
                recommendation="Peça o arquivo sem camadas, só com o que deve imprimir.",
            )
        ]


class GwgEarlyBindingRule(GwgRule):
    code = "GWG_R0027"
    default_severity = "critical"

    def evaluate(self, context):
        if variant(context).binding != "early":
            return []
        found = Counter(
            e.page
            for events in _events(context).values()
            for e in events
            if e.space.family in ("rgb", "icc_rgb", "lab") and _in_art(context, e)
        )
        if not found:
            return []
        return [
            self.gwg_issue(
                context,
                "GWG 2022 R0027",
                "Cores RGB num fluxo de cor já convertida",
                page=min(found),
                found_value=f"{sum(found.values())} objeto(s) ({_pages_text(found)})",
                expected_value="Só CMYK e cores especiais",
                description="Nesta variante as cores chegam já convertidas para a impressão (early binding)",
                recommendation="Peça o arquivo convertido para a condição de impressão da embalagem.",
            )
        ]


class GwgCropBoxRule(GwgRule):
    code = "GWG_R0003"
    default_severity = "warning"

    def evaluate(self, context):
        pages = [
            p.number
            for p in context.pages
            if p.crop_box
            and any(abs(a - b) > 0.01 for a, b in zip(p.crop_box, p.media_box, strict=False))
        ]
        if not pages:
            return []
        return [
            self.gwg_issue(
                context,
                "GWG 2022 R0003",
                "CropBox diferente da página",
                page=pages[0],
                found_value="Páginas " + ", ".join(map(str, pages[:10])),
                expected_value="CropBox igual à MediaBox (ou ausente)",
                description="A CropBox esconde parte da página; o que fica de fora pode sumir ou aparecer conforme o programa",
                recommendation="Peça o PDF sem recorte de página (CropBox).",
            )
        ]
