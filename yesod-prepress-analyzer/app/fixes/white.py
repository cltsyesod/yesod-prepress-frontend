"""Base branca (DTF / DTG) gerada numa cópia, a partir da própria arte.

A arte é renderizada com fundo transparente (no estado em que está neste ponto do pedido);
recebe branco o que tem opacidade a partir do limite do perfil. O branco é então recuado
(choke) ou expandido (spread) por um disco do raio pedido, em milímetros no tamanho
final, e gravado como máscara 1 bit na cor especial com o nome que o RIP espera, numa
camada própria, com sobreimpressão: não apaga nem muda a arte, só soma o canal do branco.
Nenhum valor é suposto: nome, limite, densidade e choke vêm do perfil ou da ficha.
"""

from __future__ import annotations

import io
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2 as pdfium
from PIL import Image

from app.contracts.production_profile import ProductionProfile

MM_PER_PT = 25.4 / 72
MAX_PIXELS = 40_000_000


class WhiteSettingsMissing(ValueError):
    """Falta um valor do perfil; a mensagem diz qual."""


@dataclass(slots=True)
class WhiteSettings:
    spot_name: str
    threshold_percent: float
    density_percent: float
    offset_mm: float
    """Spread menos choke: negativo recua o branco para dentro da cor."""
    px_per_mm: float
    max_luma: float | None = None
    """DTG peça escura, sem branco no preto: cores até esta luminosidade (0–1) ficam sem branco."""
    min_luma: float | None = None
    """DTG peça clara, branco só nas cores claras: a partir desta luminosidade (0–1)."""
    strategy: str = "full"


def settings_for(profile: ProductionProfile, params: dict) -> WhiteSettings:
    t = profile.textile
    merged = {
        "spotName": t.white_spot_name,
        "alphaThreshold": t.alpha_threshold_percent,
        "whiteDensity": t.white_density_percent,
        "chokeMm": t.choke_mm,
        "spreadMm": t.spread_mm,
        **{k: v for k, v in params.items() if v not in (None, "")},
    }
    missing = [
        label
        for key, label in (
            ("spotName", "nome da cor do branco"),
            ("alphaThreshold", "opacidade mínima para branco"),
            ("whiteDensity", "densidade do branco"),
        )
        if merged.get(key) in (None, "")
    ]
    if missing:
        raise WhiteSettingsMissing("Cadastre no perfil: " + ", ".join(missing))
    strategy, max_luma, min_luma = dtg_strategy(profile)
    choke = float(merged.get("chokeMm") or 0)
    spread = float(merged.get("spreadMm") or 0)
    # Resolução do branco = a mínima pedida para o trabalho (nada fixo aqui).
    return WhiteSettings(
        spot_name=str(merged["spotName"]).strip(),
        threshold_percent=float(merged["alphaThreshold"]),
        density_percent=float(merged["whiteDensity"]),
        offset_mm=spread - choke,
        px_per_mm=profile.minimum_resolution_dpi / 25.4,
        max_luma=max_luma,
        min_luma=min_luma,
        strategy=strategy,
    )


STRATEGY_TEXT = {
    "full": "sob toda a estampa",
    "no_black": "menos no preto (o tecido faz o preto)",
    "light_colors": "só sob as cores claras",
    "none": "sem branco (peça clara)",
}


def dtg_strategy(profile: ProductionProfile) -> tuple[str, float | None, float | None]:
    """Estratégia do branco no DTG pela cor da peça; DTF e peça sem cor: branco cheio."""

    t = profile.textile
    if profile.technology != "dtg" or t.garment_is_dark is None:
        return "full", None, None
    if t.garment_is_dark:
        if t.white_dark is None:
            raise WhiteSettingsMissing("Cadastre no perfil: branco em peça escura")
        if t.white_dark == "no_black":
            if t.black_threshold_percent is None:
                raise WhiteSettingsMissing("Cadastre no perfil: limite do preto (peça escura)")
            return "no_black", t.black_threshold_percent / 100, None
        return "full", None, None
    if t.white_light is None:
        raise WhiteSettingsMissing("Cadastre no perfil: branco em peça clara")
    if t.white_light == "light_colors":
        if t.light_threshold_percent is None:
            raise WhiteSettingsMissing("Cadastre no perfil: limite de cor clara (peça clara)")
        return "light_colors", None, t.light_threshold_percent / 100
    if t.white_light == "full":
        return "full", None, None
    return "none", None, None


def _dilate_disk(mask: np.ndarray, radius: int) -> np.ndarray:
    """Dilatação por um disco: faixas horizontais de largura variável, uma por linha."""

    if radius <= 0:
        return mask.copy()
    h, w = mask.shape
    out = np.zeros_like(mask)
    rows: dict[int, np.ndarray] = {}
    for dy in range(-radius, radius + 1):
        half = int((radius * radius - dy * dy) ** 0.5)
        if half not in rows:
            padded = np.pad(mask, ((0, 0), (half, half)))
            rows[half] = _hwin(padded, half)
        row = rows[half]
        if dy >= 0:
            out[dy:, :] |= row[: h - dy, :]
        else:
            out[: h + dy, :] |= row[-dy:, :]
    return out


def _hwin(padded: np.ndarray, half: int) -> np.ndarray:
    k = 2 * half + 1
    s = np.zeros((padded.shape[0], padded.shape[1] + 1), dtype=np.int32)
    s[:, 1:] = padded.astype(np.int32).cumsum(1)
    return (s[:, k:] - s[:, :-k]) > 0


def offset_mask(mask: np.ndarray, offset_px: int) -> np.ndarray:
    if offset_px > 0:
        return _dilate_disk(mask, offset_px)
    if offset_px < 0:
        # Fora da página é transparente: o choke também recua na borda.
        r = -offset_px
        padded = np.pad(mask, r)
        return ~_dilate_disk(~padded, r)[r:-r, r:-r]
    return mask.copy()


def white_mask(
    rendered: Path, index: int, profile: ProductionProfile, settings: WhiteSettings
) -> tuple[np.ndarray, float, tuple[float, float, float, float]]:
    """Máscara do branco (linha 0 = topo), pixels por ponto do PDF e a caixa coberta."""

    doc = pdfium.PdfDocument(str(rendered))
    try:
        page = doc[index]
        page.set_rotation(0)  # medido no espaço do PDF, sem o /Rotate de exibição
        box = tuple(float(v) for v in page.get_cropbox())
        w_pt, h_pt = box[2] - box[0], box[3] - box[1]
        px_per_pt = settings.px_per_mm * MM_PER_PT * profile.file_scale
        if w_pt * h_pt * px_per_pt**2 > MAX_PIXELS:
            px_per_pt = (MAX_PIXELS / (w_pt * h_pt)) ** 0.5
        bitmap = page.render(scale=px_per_pt, fill_color=(255, 255, 255, 0), draw_annots=False)
        rgba = np.asarray(bitmap.to_pil().convert("RGBA")).astype(np.float32)
    finally:
        doc.close()
    alpha = rgba[:, :, 3]
    mask = alpha >= settings.threshold_percent / 100 * 255
    if settings.max_luma is not None or settings.min_luma is not None:
        # Luminosidade da cor como sai na tela (0–1): preto ou claro conforme o perfil.
        luma = (0.2126 * rgba[:, :, 0] + 0.7152 * rgba[:, :, 1] + 0.0722 * rgba[:, :, 2]) / 255
        if settings.max_luma is not None:
            mask &= luma > settings.max_luma
        if settings.min_luma is not None:
            mask &= luma >= settings.min_luma
    px_per_mm = px_per_pt / (MM_PER_PT * profile.file_scale)
    mask = offset_mask(mask, round(settings.offset_mm * px_per_mm))
    return mask, px_per_pt, box


def draw_white(
    pdf: pikepdf.Pdf, page: pikepdf.Page, mask: np.ndarray, box, settings: WhiteSettings, layer
) -> int:
    """Desenha a máscara por cima, em sobreimpressão, na camada do branco. Pixels marcados."""

    h, w = mask.shape
    image = pikepdf.Stream(pdf, zlib.compress(np.packbits(mask, axis=1).tobytes()))
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height = w, h
    image.ImageMask, image.BitsPerComponent = True, 1
    image.Decode = pikepdf.Array([1, 0])  # 1 = pinta
    image.Filter = pikepdf.Name.FlateDecode
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 0, 0, 0], N=1)
    space = pdf.make_indirect(
        pikepdf.Array(
            [pikepdf.Name.Separation, pikepdf.Name("/" + settings.spot_name),
             pikepdf.Name.DeviceCMYK, tint]
        )
    )
    # Sobreimpressão + Multiplicar: o RIP recebe o canal do branco sem apagar a arte, e
    # visualizadores sem simulação de sobreimpressão continuam mostrando a arte.
    state = pikepdf.Dictionary(
        Type=pikepdf.Name.ExtGState, OP=True, op=True, OPM=1, BM=pikepdf.Name.Multiply
    )
    if "/Resources" not in page.obj:
        page.obj.Resources = pikepdf.Dictionary()
    resources = page.obj.Resources
    for kind, key, value in (
        ("/XObject", "/YesodWhiteIm", pdf.make_indirect(image)),
        ("/ColorSpace", "/YesodWhiteCS", space),
        ("/ExtGState", "/YesodWhiteGS", state),
        ("/Properties", "/YesodWhiteOC", layer),
    ):
        if kind not in resources:
            resources[kind] = pikepdf.Dictionary()
        resources[kind][key] = value
    x0, y0, x1, y1 = box
    density = settings.density_percent / 100
    page.contents_add(
        (
            "\n/OC /YesodWhiteOC BDC q /YesodWhiteGS gs /YesodWhiteCS cs "
            f"{density:.4f} scn {x1 - x0:.4f} 0 0 {y1 - y0:.4f} {x0:.4f} {y0:.4f} cm "
            "/YesodWhiteIm Do Q EMC\n"
        ).encode()
    )
    return int(mask.sum())


PREVIEW_MAX_PX = 2400


def white_plate_png(page: pikepdf.Page) -> tuple[bytes, list[float]] | None:
    """A placa do branco gerada pelo sistema, em PNG reduzido (só para a tela), e a caixa
    do PDF que ela cobre. None se a página não tem branco gerado."""

    xobjects = page.obj.get("/Resources", {}).get("/XObject", {})
    image = xobjects.get("/YesodWhiteIm") if xobjects else None
    if image is None:
        return None
    w, h = int(image.Width), int(image.Height)
    rows = np.frombuffer(image.read_bytes(), np.uint8).reshape(h, -1)
    mask = np.unpackbits(rows, axis=1)[:, :w].astype(bool)
    step = max(1, int(np.ceil(max(w, h) / PREVIEW_MAX_PX)))
    if step > 1:
        # Máximo em cada bloco: um detalhe fino do branco não some da prévia.
        hh, ww = (h // step) * step, (w // step) * step
        mask = mask[:hh, :ww].reshape(hh // step, step, ww // step, step).any(axis=(1, 3))
    alpha = Image.fromarray((mask * 255).astype(np.uint8), "L")
    rgba = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    rgba.putalpha(alpha)
    buffer = io.BytesIO()
    rgba.save(buffer, "PNG", optimize=True)
    box = page.obj.get("/CropBox") or page.obj.get("/MediaBox")
    return buffer.getvalue(), [float(v) for v in box]


_STROKES = {"S", "s"}


def _is_cut_name(name: str, cut_names: list[str]) -> bool:
    key = name.lstrip("/").lower()
    return any(key == n.lower() for n in cut_names) or any(
        word in key for word in ("cutcontour", "corte", "faca", "kiss")
    )


def _separation_name(spaces, operand) -> str | None:
    space = spaces.get(operand) if isinstance(operand, pikepdf.Name) else None
    if isinstance(space, pikepdf.Array) and len(space) >= 2 and space[0] == "/Separation":
        return str(space[1])
    return None


def _layer_name(props, operand) -> str:
    layer = props.get(operand) if isinstance(operand, pikepdf.Name) else None
    return str(layer.get("/Name", "")) if isinstance(layer, pikepdf.Dictionary) else ""


def without_cut_lines(source: Path, destination: Path, cut_names: list[str]) -> int:
    """Cópia (só para medir o branco) sem os traços da faca: contornos na cor especial de
    corte ou dentro de uma camada de corte. A faca não é estampa e não recebe branco.
    Devolve quantos traços foram tirados."""

    removed = 0
    with pikepdf.open(source) as pdf:
        for page in pdf.pages:
            resources = page.obj.get("/Resources") or pikepdf.Dictionary()
            spaces = resources.get("/ColorSpace") or {}
            props = resources.get("/Properties") or {}

            try:
                instructions = list(pikepdf.parse_content_stream(page))
            except Exception:  # noqa: BLE001, S112 - conteúdo ilegível: mede como está
                continue
            out, stack, stroke_cut, in_layer = [], [], [False], False
            for item in instructions:
                if isinstance(item, pikepdf.ContentStreamInlineImage):
                    out.append(item)
                    continue
                op = str(item.operator)
                if op == "q":
                    stack.append(stroke_cut[-1])
                elif op == "Q" and stack:
                    stroke_cut.append(stack.pop())
                elif op == "CS" and item.operands:
                    name = _separation_name(spaces, item.operands[0])
                    stroke_cut.append(bool(name) and _is_cut_name(name, cut_names))
                elif op == "BDC" and len(item.operands) >= 2 and item.operands[0] == "/OC":
                    name = _layer_name(props, item.operands[1])
                    in_layer = _is_cut_name(name, cut_names) if name else in_layer
                elif op == "EMC":
                    in_layer = False
                if op in _STROKES and (stroke_cut[-1] or in_layer):
                    out.append(pikepdf.ContentStreamInstruction([], pikepdf.Operator("n")))
                    removed += 1
                    continue
                out.append(item)
            if removed:
                page.obj.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
        pdf.save(destination)
    return removed
