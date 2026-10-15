"""Leitura do conteúdo do PDF objeto a objeto, com o estado de pintura de cada um.

Para cada preenchimento, traço, texto e imagem: espaço de cor, cor, sobreimpressão
(OP/op/OPM), espessura e tamanho no tamanho final, e a caixa na página. É a base das
conferências de vetor, texto e cor que não dependem de máquina nem de perfil.
Formulários (form XObjects) são percorridos com a matriz e os recursos deles.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import pikepdf

Matrix = tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1, 0, 0, 1, 0, 0)
MAX_EVENTS_PER_PAGE = 20000
MAX_FORM_DEPTH = 12


def mul(a: Matrix, b: Matrix) -> Matrix:
    """a depois de b (convenção do PDF: [a] × [b])."""

    return (
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    )


def apply(m: Matrix, x: float, y: float) -> tuple[float, float]:
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def scale_of(m: Matrix) -> float:
    return math.sqrt(abs(m[0] * m[3] - m[1] * m[2]))


@dataclass(slots=True)
class Space:
    family: str  # rgb, cmyk, gray, icc_rgb, icc_cmyk, icc_gray, sep, devicen, lab, pattern, indexed
    name: str = ""  # nome da separação (sep) ou nomes (devicen)
    icc: str = ""  # descrição do perfil ICC embutido, quando houver


@dataclass(slots=True)
class Event:
    page: int
    kind: str  # fill, stroke, text, image
    space: Space
    color: tuple[float, ...] = ()
    overprint: bool = False
    opm: int = 0
    width_mm: float | None = None  # traço, no tamanho final
    size_pt: float | None = None  # texto, no tamanho final
    box: tuple[float, float, float, float] | None = None  # espaço da página (pt)
    image_mask: bool = False


@dataclass
class _State:
    ctm: Matrix = IDENTITY
    fill: Space = field(default_factory=lambda: Space("gray"))
    stroke: Space = field(default_factory=lambda: Space("gray"))
    fill_color: tuple[float, ...] = (0.0,)
    stroke_color: tuple[float, ...] = (0.0,)
    op_fill: bool = False
    op_stroke: bool = False
    opm: int = 0
    width: float = 1.0
    font_size: float = 0.0
    text_rise: float = 0.0
    hscale: float = 1.0
    render: int = 0

    def copy(self) -> _State:
        return _State(**{k: getattr(self, k) for k in self.__dataclass_fields__})


def _icc_description(stream) -> str:
    try:
        from io import BytesIO

        from PIL import ImageCms

        return ImageCms.getProfileDescription(
            ImageCms.getOpenProfile(BytesIO(stream.read_bytes()))
        ).strip()
    except Exception:  # noqa: BLE001 - perfil ilegível: sem descrição
        return ""


def resolve_space(value, resources) -> Space:
    if isinstance(value, pikepdf.Name):
        name = str(value)
        if name in ("/DeviceRGB", "/RGB"):
            return Space("rgb")
        if name in ("/DeviceCMYK", "/CMYK"):
            return Space("cmyk")
        if name in ("/DeviceGray", "/G"):
            return Space("gray")
        if name == "/Pattern":
            return Space("pattern")
        spaces = resources.get("/ColorSpace") if resources is not None else None
        if spaces is not None and name in spaces:
            return resolve_space(spaces[name], resources)
        return Space("gray")
    if isinstance(value, pikepdf.Array) and len(value):
        head = str(value[0])
        if head == "/ICCBased":
            stream = value[1]
            n = int(stream.get("/N", 3))
            family = {1: "icc_gray", 3: "icc_rgb", 4: "icc_cmyk"}.get(n, "icc_rgb")
            return Space(family, icc=_icc_description(stream))
        if head == "/Separation":
            return Space("sep", name=str(value[1]).lstrip("/"))
        if head == "/DeviceN":
            names = ", ".join(str(n).lstrip("/") for n in value[1])
            return Space("devicen", name=names)
        if head in ("/Lab", "/CalRGB", "/CalGray"):
            return Space({"/Lab": "lab", "/CalRGB": "rgb", "/CalGray": "gray"}[head])
        if head == "/Indexed":
            return Space("indexed", name=resolve_space(value[1], resources).family)
        if head == "/Pattern":
            return Space("pattern")
    return Space("gray")


def _box(points: list[tuple[float, float]]):
    if not points:
        return None
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


class Scanner:
    def __init__(self, file_scale: float):
        self.file_scale = file_scale
        self.events: list[Event] = []
        self.page = 0

    def scan_page(self, number: int, page: pikepdf.Page) -> list[Event]:
        self.page = number
        self.events = []
        resources = page.obj.get("/Resources") or pikepdf.Dictionary()
        try:
            instructions = list(pikepdf.parse_content_stream(page))
        except Exception:  # noqa: BLE001 - conteúdo ilegível: página sem eventos
            return []
        self._run(instructions, resources, _State(), 0)
        return self.events

    def _emit(self, event: Event) -> None:
        if len(self.events) < MAX_EVENTS_PER_PAGE:
            self.events.append(event)

    def _paint(self, state: _State, fill: bool, stroke: bool, points) -> None:
        box = _box([apply(state.ctm, *p) for p in points])
        if fill:
            self._emit(
                Event(
                    self.page,
                    "fill",
                    state.fill,
                    state.fill_color,
                    state.op_fill,
                    state.opm,
                    box=box,
                )
            )
        if stroke:
            width_pt = state.width * scale_of(state.ctm)
            self._emit(
                Event(
                    self.page,
                    "stroke",
                    state.stroke,
                    state.stroke_color,
                    state.op_stroke,
                    state.opm,
                    width_mm=width_pt * self.file_scale * 25.4 / 72,
                    box=box,
                )
            )

    def _run(self, instructions, resources, state: _State, depth: int) -> None:
        stack: list[_State] = []
        points: list[tuple[float, float]] = []
        tm: Matrix = IDENTITY
        tlm: Matrix = IDENTITY
        leading = 0.0
        for item in instructions:
            if isinstance(item, pikepdf.ContentStreamInlineImage):
                corners = [apply(state.ctm, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
                self._emit(
                    Event(
                        self.page,
                        "image",
                        state.fill,
                        (),
                        state.op_fill,
                        state.opm,
                        box=_box(corners),
                    )
                )
                continue
            ops, op = item.operands, str(item.operator)
            try:
                if op == "q":
                    stack.append(state.copy())
                elif op == "Q":
                    if stack:
                        state = stack.pop()
                elif op == "cm":
                    state.ctm = mul(tuple(float(v) for v in ops), state.ctm)
                elif op == "w":
                    state.width = float(ops[0])
                elif op == "gs":
                    gs = (resources.get("/ExtGState") or {}).get(ops[0])
                    if gs is not None:
                        if "/OP" in gs:
                            state.op_stroke = bool(gs.OP)
                            state.op_fill = bool(gs.get("/op", gs.OP))
                        if "/op" in gs:
                            state.op_fill = bool(gs.op)
                        if "/OPM" in gs:
                            state.opm = int(gs.OPM)
                        if "/LW" in gs:
                            state.width = float(gs.LW)
                elif op in ("g", "G", "rg", "RG", "k", "K"):
                    space = Space({"g": "gray", "rg": "rgb", "k": "cmyk"}[op.lower()])
                    color = tuple(float(v) for v in ops)
                    if op.islower():
                        state.fill, state.fill_color = space, color
                    else:
                        state.stroke, state.stroke_color = space, color
                elif op in ("cs", "CS"):
                    space = resolve_space(ops[0], resources)
                    if op == "cs":
                        state.fill, state.fill_color = (
                            space,
                            (1.0,) if space.family == "sep" else (0.0,),
                        )
                    else:
                        state.stroke, state.stroke_color = (
                            space,
                            (1.0,) if space.family == "sep" else (0.0,),
                        )
                elif op in ("sc", "scn", "SC", "SCN"):
                    # Padrões (pattern) trazem um nome no fim: só os números são a cor.
                    color = tuple(float(v) for v in ops if not isinstance(v, pikepdf.Name))
                    if op.islower():
                        state.fill_color = color
                    else:
                        state.stroke_color = color
                elif op in ("m", "l"):
                    points.append((float(ops[0]), float(ops[1])))
                elif op == "c":
                    points.extend([(float(ops[i]), float(ops[i + 1])) for i in (0, 2, 4)])
                elif op in ("v", "y"):
                    points.extend([(float(ops[i]), float(ops[i + 1])) for i in (0, 2)])
                elif op == "re":
                    x, y, w, h = (float(v) for v in ops)
                    points.extend([(x, y), (x + w, y + h)])
                elif op in ("f", "F", "f*"):
                    self._paint(state, True, False, points)
                    points = []
                elif op in ("S", "s"):
                    self._paint(state, False, True, points)
                    points = []
                elif op in ("B", "B*", "b", "b*"):
                    self._paint(state, True, True, points)
                    points = []
                elif op == "n":
                    points = []
                elif op == "BT":
                    tm = tlm = IDENTITY
                elif op == "Tf":
                    state.font_size = float(ops[1])
                elif op == "Tz":
                    state.hscale = float(ops[0]) / 100
                elif op == "Tr":
                    state.render = int(ops[0])
                elif op == "TL":
                    leading = float(ops[0])
                elif op == "Tm":
                    tm = tlm = tuple(float(v) for v in ops)
                elif op in ("Td", "TD"):
                    tlm = mul((1, 0, 0, 1, float(ops[0]), float(ops[1])), tlm)
                    tm = tlm
                    if op == "TD":
                        leading = -float(ops[1])
                elif op == "T*":
                    tlm = mul((1, 0, 0, 1, 0, -leading), tlm)
                    tm = tlm
                elif op in ("Tj", "TJ", "'", '"'):
                    full = mul(tm, state.ctm)
                    size = abs(state.font_size) * scale_of(full) * self.file_scale
                    origin = apply(full, 0, 0)
                    height = abs(state.font_size) * scale_of(full)
                    box = (origin[0], origin[1], origin[0] + height, origin[1] + height)
                    mode = state.render % 4
                    if mode in (0, 2):
                        self._emit(
                            Event(
                                self.page,
                                "text",
                                state.fill,
                                state.fill_color,
                                state.op_fill,
                                state.opm,
                                size_pt=size,
                                box=box,
                            )
                        )
                    if mode in (1, 2):
                        self._emit(
                            Event(
                                self.page,
                                "text",
                                state.stroke,
                                state.stroke_color,
                                state.op_stroke,
                                state.opm,
                                size_pt=size,
                                box=box,
                            )
                        )
                elif op == "Do" and depth < MAX_FORM_DEPTH:
                    xobject = (resources.get("/XObject") or {}).get(ops[0])
                    if xobject is None:
                        continue
                    subtype = xobject.get("/Subtype")
                    if subtype == pikepdf.Name.Image:
                        corners = [
                            apply(state.ctm, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))
                        ]
                        mask = bool(xobject.get("/ImageMask", False))
                        # Máscara de imagem pinta com a cor de preenchimento atual.
                        space = (
                            state.fill
                            if mask
                            else resolve_space(
                                xobject.get("/ColorSpace", pikepdf.Name.DeviceGray), resources
                            )
                        )
                        self._emit(
                            Event(
                                self.page,
                                "image",
                                space,
                                state.fill_color if mask else (),
                                state.op_fill,
                                state.opm,
                                box=_box(corners),
                                image_mask=mask,
                            )
                        )
                    elif subtype == pikepdf.Name.Form:
                        inner = state.copy()
                        if "/Matrix" in xobject:
                            inner.ctm = mul(tuple(float(v) for v in xobject.Matrix), state.ctm)
                        try:
                            body = list(pikepdf.parse_content_stream(xobject))
                        except Exception:  # noqa: BLE001, S112 - formulário ilegível: pula
                            continue
                        self._run(body, xobject.get("/Resources") or resources, inner, depth + 1)
            except (ValueError, TypeError, IndexError, KeyError, AttributeError):
                continue


def scan_document(
    pdf: pikepdf.Pdf, file_scale: float, max_pages: int = 50
) -> dict[int, list[Event]]:
    scanner = Scanner(file_scale)
    return {
        number: scanner.scan_page(number, page)
        for number, page in enumerate(list(pdf.pages)[:max_pages], start=1)
    }
