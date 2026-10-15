# ruff: noqa: E501 - mensagens ao operador ficam inteiras numa linha
"""Conferências objeto a objeto: vetor, traço, texto e cor no próprio arquivo.

Não dependem de máquina, RIP nem perfil de cor: são fatos do arquivo que dão problema em
qualquer impressão. Os limites (texto mínimo, traço mínimo…) vêm do perfil ou da ficha;
sem eles, a conferência correspondente não roda e o sistema pede o valor.
"""

from __future__ import annotations

from collections import Counter

from app.analyzer.content_scan import Event
from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule

MM = 72 / 25.4
_CUT_WORDS = ("cut", "corte", "faca", "contour", "kiss")


def _events(context: DocumentContext) -> dict[int, list[Event]]:
    return context.facts.get("scan") or {}


def _trim(context: DocumentContext, page: int):
    info = next((p for p in context.pages if p.number == page), None)
    if info is None:
        return None
    return info.trim_box or info.crop_box or info.media_box


def _overlaps(box, area, inset: float = 0.0) -> bool:
    if box is None or area is None:
        return False
    x0, y0, x1, y1 = area[0] + inset, area[1] + inset, area[2] - inset, area[3] - inset
    return box[0] < x1 and box[2] > x0 and box[1] < y1 and box[3] > y0


def _is_cut(context: DocumentContext, name: str) -> bool:
    key = name.lower()
    return key in {n.lower() for n in context.profile.cut_layer_names} or any(
        word in key for word in _CUT_WORDS
    )


def _is_registration(event: Event) -> bool:
    return event.space.family == "sep" and event.space.name.lower() == "all"


def _in_art(context: DocumentContext, event: Event) -> bool:
    """Dentro do formato final (marcas e faixas de identificação ficam fora)."""

    return _overlaps(event.box, _trim(context, event.page), inset=0.5)


def _pages_text(counter: Counter) -> str:
    return ", ".join(f"pág. {page}: {n}" for page, n in sorted(counter.items()))


def _num(value: float) -> str:
    return f"{value:g}".replace(".", ",")


class WhiteOverprintRule(Rule):
    """Branco com sobreimpressão some na impressão (não pinta nenhuma tinta)."""

    code = "OBJECT_WHITE_OVERPRINT"
    default_severity = "critical"

    @staticmethod
    def disappears(event: Event) -> bool:
        if not event.overprint or event.kind == "image" or not event.color:
            return False
        family = event.space.family
        if family in ("cmyk", "icc_cmyk"):
            # Com OPM 1, os componentes zero não pintam: o branco CMYK some.
            return event.opm == 1 and all(abs(v) < 0.001 for v in event.color)
        if family in ("gray", "icc_gray"):
            # Cinza vai só para o preto: branco (1) em sobreimpressão não pinta nada.
            return event.color[0] > 0.999
        return False

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        found = Counter(
            e.page
            for events in _events(context).values()
            for e in events
            if self.disappears(e) and _in_art(context, e)
        )
        if not found:
            return []
        return [
            self.issue(
                context,
                page=min(found),
                title="Objeto branco com sobreimpressão",
                category="Cor",
                found_value=f"{sum(found.values())} objeto(s) ({_pages_text(found)})",
                expected_value="Branco sem sobreimpressão (vazado)",
                description=(
                    "Branco em sobreimpressão não pinta nenhuma tinta: o objeto some na impressão "
                    "e aparece o que estiver por baixo."
                ),
                recommendation=(
                    "Peça ao cliente para tirar a sobreimpressão do branco (Atributos/Overprint) "
                    "e reenviar o arquivo."
                ),
            )
        ]


class RegistrationInArtRule(Rule):
    code = "OBJECT_REGISTRATION_IN_ART"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        found = Counter(
            e.page
            for events in _events(context).values()
            for e in events
            if _is_registration(e) and _in_art(context, e)
        )
        if not found:
            return []
        return [
            self.issue(
                context,
                page=min(found),
                title="Cor de registro (All) usada na arte",
                category="Cor",
                found_value=f"{sum(found.values())} objeto(s) ({_pages_text(found)})",
                expected_value="Registro só em marcas fora do formato final",
                description=(
                    "A cor de registro imprime com todas as tintas ao mesmo tempo: na arte ela "
                    "borra, demora a secar e pode estourar o limite de tinta."
                ),
                recommendation="Peça ao cliente para trocar por preto (100% K) ou pela cor certa.",
            )
        ]


class RichBlackTextRule(Rule):
    code = "TEXT_RICH_BLACK"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        limit = context.profile.small_text_pt
        if not limit:
            return []
        rich, rgb = Counter(), Counter()
        for events in _events(context).values():
            for e in events:
                if (
                    e.kind != "text"
                    or not e.size_pt
                    or e.size_pt > limit
                    or not _in_art(context, e)
                ):
                    continue
                c = e.color
                if e.space.family in ("cmyk", "icc_cmyk") and len(c) == 4:
                    if c[3] > 0.999 and sum(c[:3]) > 0.001:
                        rich[e.page] += 1
                elif e.space.family in ("rgb", "icc_rgb") and len(c) == 3 and max(c) < 0.001:
                    rgb[e.page] += 1
        issues = []
        if rich:
            issues.append(
                self.issue(
                    context,
                    page=min(rich),
                    title="Texto pequeno em preto de quatro cores",
                    category="Texto",
                    found_value=f"{sum(rich.values())} texto(s) até {_num(limit)} pt ({_pages_text(rich)})",
                    expected_value="Texto pequeno só em preto (100% K)",
                    description=(
                        "Texto pequeno com preto de quatro cores fica borrado e fora de registro: "
                        "qualquer deslocamento entre as tintas aparece na borda das letras."
                    ),
                    recommendation="Peça os textos pequenos em 100% K (sem C, M e Y).",
                )
            )
        if rgb:
            issues.append(
                self.issue(
                    context,
                    page=min(rgb),
                    severity="informational",
                    title="Texto pequeno em preto RGB",
                    category="Texto",
                    found_value=f"{sum(rgb.values())} texto(s) até {_num(limit)} pt ({_pages_text(rgb)})",
                    expected_value="Preto que o RIP imprima só com K",
                    description=(
                        "Preto RGB é convertido pelo RIP; sem a opção de preservar o preto puro, "
                        "vira preto de quatro cores nas letras pequenas."
                    ),
                    recommendation="Confirme no RIP a opção de preservar o preto (100% K).",
                )
            )
        return issues


class SmallTextRule(Rule):
    code = "TEXT_TOO_SMALL"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        limit = context.profile.min_text_pt
        if not limit:
            return []
        found = Counter()
        smallest = None
        for events in _events(context).values():
            for e in events:
                if e.kind == "text" and e.size_pt and e.size_pt < limit and _in_art(context, e):
                    found[e.page] += 1
                    smallest = e.size_pt if smallest is None else min(smallest, e.size_pt)
        if not found:
            return []
        return [
            self.issue(
                context,
                page=min(found),
                title="Texto menor que o mínimo",
                category="Texto",
                found_value=f"{sum(found.values())} texto(s), menor com {_num(round(smallest, 1))} pt",
                expected_value=f"{_num(limit)} pt ou mais no tamanho final",
                description="Texto abaixo do mínimo deste trabalho fica ilegível ou falha na impressão.",
                recommendation="Peça ao cliente para aumentar o texto ou aceite com o motivo.",
            )
        ]


class StrokeRule(Rule):
    """Linha de espessura zero (sai com um ponto da máquina) e linha mais fina que o mínimo."""

    code = "STROKE_TOO_THIN"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        minimum = context.profile.min_stroke_mm
        zero, thin = Counter(), Counter()
        thinnest = None
        for events in _events(context).values():
            for e in events:
                if e.kind != "stroke" or e.width_mm is None or not _in_art(context, e):
                    continue
                if e.space.family == "sep" and (
                    _is_cut(context, e.space.name) or _is_registration(e)
                ):
                    continue  # faca e marcas são linhas técnicas
                if e.width_mm == 0:
                    zero[e.page] += 1
                elif minimum and e.width_mm < minimum:
                    thin[e.page] += 1
                    thinnest = e.width_mm if thinnest is None else min(thinnest, e.width_mm)
        issues = []
        if zero:
            issues.append(
                self.issue(
                    context,
                    page=min(zero),
                    title="Linha de espessura zero",
                    category="Vetor",
                    found_value=f"{sum(zero.values())} linha(s) ({_pages_text(zero)})",
                    expected_value="Espessura definida em mm",
                    description=(
                        "Linha com espessura 0 sai com a menor linha que cada máquina consegue: "
                        "quase invisível e diferente de uma impressora para outra."
                    ),
                    recommendation="Peça ao cliente para definir a espessura das linhas.",
                )
            )
        if thin:
            issues.append(
                self.issue(
                    context,
                    page=min(thin),
                    title="Linha mais fina que o mínimo",
                    category="Vetor",
                    found_value=f"{sum(thin.values())} linha(s), a mais fina com {_num(round(thinnest, 3))} mm",
                    expected_value=f"{_num(minimum)} mm ou mais no tamanho final",
                    description="Linhas abaixo do mínimo deste trabalho podem falhar ou sumir.",
                    recommendation="Peça ao cliente para engrossar as linhas ou aceite com o motivo.",
                )
            )
        return issues


class MixedColorSpacesRule(Rule):
    code = "COLOR_MIXED_SPACES"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        families = Counter()
        for events in _events(context).values():
            for e in events:
                if _in_art(context, e) and e.space.family in ("rgb", "icc_rgb", "cmyk", "icc_cmyk"):
                    families["RGB" if "rgb" in e.space.family else "CMYK"] += 1
        if len(families) < 2:
            return []
        return [
            self.issue(
                context,
                title="Arte com RGB e CMYK misturados",
                category="Cor",
                found_value=f"RGB: {families['RGB']} objeto(s) · CMYK: {families['CMYK']} objeto(s)",
                expected_value="Um só espaço de cor na arte",
                description=(
                    "O RIP converte o RGB e passa o CMYK direto: a mesma cor (um cinza, um preto, "
                    "a cor da marca) pode sair em dois tons diferentes na mesma peça."
                ),
                recommendation=(
                    "Peça a arte toda em RGB (o fluxo de vocês) ou confira na prova se as cores "
                    "que se repetem casam."
                ),
            )
        ]


class ImageProfilesRule(Rule):
    code = "IMAGE_PROFILES_MIXED"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        profiles = Counter()
        for events in _events(context).values():
            for e in events:
                if e.kind == "image" and e.space.family in ("rgb", "icc_rgb"):
                    profiles[e.space.icc or "sem perfil"] += 1
        if len(profiles) < 2:
            return []
        return [
            self.issue(
                context,
                title="Fotos com perfis de cor diferentes",
                category="Imagem",
                found_value="; ".join(f"{name}: {n}" for name, n in profiles.most_common()),
                expected_value="As fotos no mesmo perfil RGB",
                description=(
                    "Fotos em perfis diferentes (ex.: Adobe RGB e sRGB, ou sem perfil) saem com "
                    "cores diferentes para os mesmos números, conforme o RIP lê cada uma."
                ),
                recommendation="Confira na prova; se precisar, peça as fotos no mesmo perfil.",
            )
        ]


class FlattenedArtRule(Rule):
    code = "ART_FLATTENED"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        issues = []
        for page, events in _events(context).items():
            trim = _trim(context, page)
            if trim is None:
                continue
            area = (trim[2] - trim[0]) * (trim[3] - trim[1])
            covered = 0.0
            for e in events:
                if e.kind == "image" and e.box is not None:
                    w = max(0.0, min(e.box[2], trim[2]) - max(e.box[0], trim[0]))
                    h = max(0.0, min(e.box[3], trim[3]) - max(e.box[1], trim[1]))
                    covered = max(covered, w * h / area if area else 0)
            texts = sum(1 for e in events if e.kind == "text" and _in_art(context, e))
            vectors = sum(
                1
                for e in events
                if e.kind in ("fill", "stroke")
                and _in_art(context, e)
                and not (
                    e.space.family == "sep"
                    and (_is_cut(context, e.space.name) or _is_registration(e))
                )
            )
            if covered >= 0.9 and texts == 0 and vectors <= 3:
                issues.append(
                    self.issue(
                        context,
                        page=page,
                        title="Arte inteira em imagem (sem vetor)",
                        category="Vetor",
                        found_value=f"Uma imagem cobre {covered:.0%} da página; nenhum texto em vetor",
                        expected_value="Textos e logos em vetor",
                        description=(
                            "A arte foi achatada numa imagem: textos e logos perderam o vetor e "
                            "saem serrilhados ou borrados, principalmente em tamanho grande."
                        ),
                        recommendation=(
                            "Peça o arquivo original com textos e logos em vetor (PDF do programa "
                            "de criação, sem achatar)."
                        ),
                    )
                )
        return issues


class CutInImageRule(Rule):
    code = "CUT_IN_IMAGE"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        found = Counter(
            e.page
            for events in _events(context).values()
            for e in events
            if e.kind == "image" and e.space.family == "sep" and _is_cut(context, e.space.name)
        )
        if not found:
            return []
        return [
            self.issue(
                context,
                page=min(found),
                title="Faca em imagem (não é vetor)",
                category="Acabamento",
                found_value=f"{sum(found.values())} imagem(ns) na cor de corte ({_pages_text(found)})",
                expected_value="Faca em linha vetorial",
                description="O plotter ou a faca só cortam linhas em vetor; faca em imagem não corta.",
                recommendation=(
                    "Peça a faca em vetor ou gere a faca no sistema (pelo contorno ou retangular)."
                ),
            )
        ]


class SafetyMarginRule(Rule):
    code = "TEXT_IN_SAFETY_MARGIN"
    default_severity = "warning"
    technologies = ("grafica",)

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        margin_mm = context.profile.minimum_safety_margin_mm
        if not margin_mm:
            return []
        margin = margin_mm / context.profile.file_scale * MM
        found, samples = Counter(), []
        for obj in context.facts.get("text_objects", []):
            trim, box = _trim(context, obj["page"]), obj.get("box")
            if trim is None or box is None or not _overlaps(box, trim):
                continue
            inside = (
                box[0] >= trim[0] + margin
                and box[1] >= trim[1] + margin
                and box[2] <= trim[2] - margin
                and box[3] <= trim[3] - margin
            )
            if not inside:
                found[obj["page"]] += 1
                if obj.get("text") and len(samples) < 3:
                    samples.append(f"“{obj['text'][:30]}”")
        if not found:
            return []
        return [
            self.issue(
                context,
                page=min(found),
                title="Texto dentro da margem de segurança",
                category="Formato",
                found_value=f"{sum(found.values())} texto(s) ({_pages_text(found)})"
                + (f": {', '.join(samples)}" if samples else ""),
                expected_value=f"Textos a {_num(margin_mm)} mm ou mais do corte",
                description="Textos colados no corte podem ser cortados com a variação do acabamento.",
                recommendation="Peça ao cliente para afastar os textos do corte ou aceite com o motivo.",
            )
        ]


class HiddenLayersRule(Rule):
    code = "LAYERS_HIDDEN"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        layers = context.facts.get("hidden_layers") or []
        if not layers:
            return []
        return [
            self.issue(
                context,
                title="Camadas ocultas no arquivo",
                category="Arquivo",
                found_value=", ".join(layers[:8]),
                expected_value="Sem camadas ocultas (ou removidas)",
                description=(
                    "Camadas desligadas na tela podem ser impressas: muitos RIPs imprimem todas "
                    "as camadas do PDF."
                ),
                recommendation=(
                    "Peça o arquivo sem as camadas que não devem sair, ou confirme no RIP."
                ),
            )
        ]


class ExcessiveResolutionRule(Rule):
    code = "IMAGE_EXCESSIVE_PPI"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        maximum = context.profile.max_image_ppi
        if not maximum:
            return []
        heavy = []
        for image in context.images:
            ppi = min(filter(None, (image.effective_dpi_x, image.effective_dpi_y)), default=None)
            if ppi and ppi / context.profile.file_scale > maximum:
                heavy.append((image, ppi / context.profile.file_scale))
        if not heavy:
            return []
        return [
            self.issue(
                context,
                page=heavy[0][0].page,
                title="Imagem com resolução acima do necessário",
                category="Imagem",
                found_value=", ".join(f"pág. {img.page}: {ppi:.0f} ppi" for img, ppi in heavy[:5]),
                expected_value=f"Até {_num(maximum)} ppi no tamanho final",
                description="Resolução acima do necessário só pesa o arquivo e deixa o RIP lento.",
                recommendation="Pode seguir assim; se o arquivo estiver pesado, reduza as imagens.",
            )
        ]


class MissingLimitsRule(Rule):
    """Conferências que não rodaram por falta de limite no perfil (nada é suposto)."""

    code = "CHECK_LIMITS_MISSING"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        events = [e for page in _events(context).values() for e in page]
        has_text = any(e.kind == "text" for e in events)
        has_stroke = any(e.kind == "stroke" for e in events)
        missing = []
        if has_text and not context.profile.min_text_pt:
            missing.append("texto mínimo (pt)")
        if has_text and not context.profile.small_text_pt:
            missing.append("texto pequeno em preto (pt)")
        if has_stroke and not context.profile.min_stroke_mm:
            missing.append("traço mínimo (mm)")
        if not missing:
            return []
        return [
            self.issue(
                context,
                title="Conferências sem limite definido",
                category="Arquivo",
                found_value="Falta: " + ", ".join(missing),
                expected_value="Limites no perfil de produção ou na ficha",
                description=(
                    "Estas conferências não rodaram porque o perfil não define o limite; o sistema "
                    "não supõe valores."
                ),
                recommendation="Defina os limites no perfil de produção (Conferências de vetor e texto).",
            )
        ]
