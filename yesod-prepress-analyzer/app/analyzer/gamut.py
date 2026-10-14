"""Gestão de cor: o que muda quando a arte vai para o perfil de destino (Little CMS).

Para cada cor RGB (vetores e imagens), a conversão de origem → destino é simulada com a
intenção e a compensação do ponto preto do perfil de produção, e a cor resultante volta
para Lab: a diferença (ΔE2000) mostra o que a impressão não alcança (fora do gamut) ou
o quanto a conversão muda a cor. Nada é convertido no arquivo; é só medição.

RGB sem perfil usa o perfil de origem do perfil de produção ou, sem ele, sRGB (e o
relatório diz que é uma premissa). Imagens dentro de formulários (form XObjects) ainda
não entram na conta.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image, ImageCms

from app.analyzer.context import DocumentContext

INTENT = {"perceptual": 0, "relative": 1, "saturation": 2, "absolute": 3}
MODE = {"CMYK": "CMYK", "RGB": "RGB", "GRAY": "L"}
ALARM = 127
MAX_IMAGE_SIDE = 500
MAX_IMAGES = 40


def delta_e00(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIEDE2000 (Sharma, Wu e Dalal, 2005), vetorizado; entradas (N, 3) em L*a*b*."""

    l1, a1, b1 = lab1[:, 0], lab1[:, 1], lab1[:, 2]
    l2, a2, b2 = lab2[:, 0], lab2[:, 1], lab2[:, 2]
    c1, c2 = np.hypot(a1, b1), np.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    g = 0.5 * (1 - np.sqrt(c_bar**7 / (c_bar**7 + 25.0**7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dl, dc = l2 - l1, c2p - c1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dh = np.where(c1p * c2p == 0, 0, dh)
    d_h = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh / 2))
    l_bar, c_barp = (l1 + l2) / 2, (c1p + c2p) / 2
    h_sum = h1p + h2p
    h_bar = np.where(
        c1p * c2p == 0,
        h_sum,
        np.where(
            np.abs(h1p - h2p) <= 180,
            h_sum / 2,
            np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2),
        ),
    )
    t = (
        1
        - 0.17 * np.cos(np.radians(h_bar - 30))
        + 0.24 * np.cos(np.radians(2 * h_bar))
        + 0.32 * np.cos(np.radians(3 * h_bar + 6))
        - 0.20 * np.cos(np.radians(4 * h_bar - 63))
    )
    sl = 1 + 0.015 * (l_bar - 50) ** 2 / np.sqrt(20 + (l_bar - 50) ** 2)
    sc = 1 + 0.045 * c_barp
    sh = 1 + 0.015 * c_barp * t
    rt = (
        -2
        * np.sqrt(c_barp**7 / (c_barp**7 + 25.0**7))
        * np.sin(np.radians(60 * np.exp(-(((h_bar - 275) / 25) ** 2))))
    )
    return np.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (d_h / sh) ** 2 + rt * (dc / sc) * (d_h / sh))


def _lab(image: Image.Image, profile, mode: str) -> np.ndarray:
    """Pixels (1 × N) para L*a*b* D50 (o Lab de 8 bits do Little CMS)."""

    to_lab = ImageCms.buildTransform(
        profile, ImageCms.createProfile("LAB"), mode, "LAB", renderingIntent=1
    )
    lab = np.asarray(ImageCms.applyTransform(image, to_lab)).reshape(-1, 3).astype(np.float64)
    lab[:, 0] *= 100 / 255
    # a e b vêm como bytes com sinal (complemento de dois).
    lab[:, 1:] = np.where(lab[:, 1:] > 127, lab[:, 1:] - 256, lab[:, 1:])
    return lab


class Converter:
    def __init__(self, output: Path, space: str, rgb_source: Path | None, intent: str, bpc: bool):
        self.output = ImageCms.getOpenProfile(str(output))
        self.mode = MODE[space]
        self.rgb = (
            ImageCms.getOpenProfile(str(rgb_source))
            if rgb_source
            else ImageCms.createProfile("sRGB")
        )
        # Verificação de gamut: sempre colorimétrica relativa, sem compensação do ponto preto
        # (a definição usual). A intenção e a compensação do perfil valem para a conversão.
        self.intent = INTENT["relative"]
        self.flags = ImageCms.Flags.NONE
        self.conversion = (intent, bpc)
        self._cache: dict = {}

    def delta(self, rgb: np.ndarray, source=None) -> np.ndarray:
        """ΔE00 de cada cor RGB (N × 3, 0–255) entre a origem e o destino."""

        source = source or self.rgb
        image = Image.fromarray(rgb.reshape(1, -1, 3).astype(np.uint8), "RGB")
        key = id(source)
        if key not in self._cache:
            self._cache[key] = ImageCms.buildTransform(
                source, self.output, "RGB", self.mode, renderingIntent=self.intent, flags=self.flags
            )
        printed = ImageCms.applyTransform(image, self._cache[key])
        return delta_e00(_lab(image, source, "RGB"), _lab(printed, self.output, self.mode))

    def out_of_gamut(self, rgb: np.ndarray, source=None) -> np.ndarray:
        """Verificação de gamut do Little CMS (prova com o destino, marcação de alarme): a
        mesma lógica do aviso de gamut dos programas de imagem, que já desconta o erro de
        ida e volta do próprio perfil."""

        source = source or self.rgb
        image = Image.fromarray(rgb.reshape(1, -1, 3).astype(np.uint8), "RGB")
        key = ("gamut", id(source))
        if key not in self._cache:
            flags = ImageCms.Flags.SOFTPROOFING
            self._cache[key] = tuple(
                ImageCms.buildProofTransform(
                    source,
                    source,
                    self.output,
                    "RGB",
                    "RGB",
                    renderingIntent=self.intent,
                    proofRenderingIntent=self.intent,
                    flags=f,
                )
                for f in (flags | ImageCms.Flags.GAMUTCHECK, flags)
            )
        checked, plain = (
            np.asarray(ImageCms.applyTransform(image, t)).reshape(-1, 3) for t in self._cache[key]
        )
        # Fora do gamut o Little CMS pinta a cor de alarme (127, 127, 127).
        return (checked == ALARM).all(axis=1) & (plain != ALARM).any(axis=1)


def _image_rgb(obj: pikepdf.Object):
    """(pixels N × 3, contagem de cada cor, perfil embutido, total) de uma imagem RGB."""

    pdf_image = pikepdf.PdfImage(obj)
    if pdf_image.mode != "RGB":
        return None
    pil = pdf_image.as_pil_image().convert("RGB")
    pil.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    pixels = np.asarray(pil).reshape(-1, 3)
    unique, counts = np.unique(pixels, axis=0, return_counts=True)
    icc = None
    try:
        raw = pdf_image.icc
        if raw is not None:
            icc = (
                raw
                if not isinstance(raw, bytes | bytearray)
                else ImageCms.getOpenProfile(io.BytesIO(raw))
            )
    except Exception:  # noqa: BLE001 - perfil ilegível: usa a origem do perfil de produção
        icc = None
    return unique, counts, icc, pixels.shape[0]


def _same_profile(a: bytes, b: Path) -> bool:
    other = b.read_bytes()
    if a == other:
        return True
    try:
        return (
            ImageCms.getProfileDescription(ImageCms.getOpenProfile(io.BytesIO(a))).strip()
            == ImageCms.getProfileDescription(ImageCms.getOpenProfile(str(b))).strip()
        )
    except Exception:  # noqa: BLE001
        return False


def analyze_gamut(path: Path, context: DocumentContext, files: dict) -> dict:
    color = context.profile.color
    if files.get("error"):
        return {"error": f"Perfis ICC indisponíveis: {files['error']}"}
    output = files.get("output")
    if not output or not color.output:
        return {}
    space = (color.output.color_space or "").upper() or ImageCms.getOpenProfile(
        str(output)
    ).profile.xcolor_space.strip().upper()
    if space not in MODE:
        return {"error": f"Perfil de destino em {space}: só CMYK, RGB ou cinza são analisados"}
    conv = Converter(output, space, files.get("rgb"), color.intent, color.black_point_compensation)
    result: dict = {
        "output": color.output.name,
        "outputSpace": space,
        "rgbSource": color.rgb_source.name
        if color.rgb_source
        else "sRGB (premissa: RGB sem perfil)",
        "intent": color.intent,
        "blackPointCompensation": color.black_point_compensation,
        "check": "Little CMS, colorimétrica relativa",
        "images": [],
        "vectors": {"colors": 0, "outOfGamut": 0, "worst": []},
        "error": "",
    }

    if context.colors.rgb_colors:
        rgb = np.array(sorted(context.colors.rgb_colors), dtype=np.float64).clip(0, 1) * 255
        rgb = np.round(rgb)
        de = conv.delta(rgb)
        out = conv.out_of_gamut(rgb)
        order = np.argsort(-de)
        result["vectors"] = {
            "colors": len(rgb),
            "outOfGamut": int(out.sum()),
            "worst": [
                {"rgb": [int(v) for v in np.round(rgb[i])], "de": round(float(de[i]), 1)}
                for i in order[:8]
                if out[i]
            ],
        }

    with pikepdf.open(path) as pdf:
        seen = 0
        for number, page in enumerate(pdf.pages, start=1):
            for name, obj in page.images.items():
                if seen >= MAX_IMAGES:
                    break
                try:
                    data = _image_rgb(obj)
                except Exception:  # noqa: BLE001 - imagem que não decodifica fica de fora
                    data = None
                if data is None:
                    continue
                seen += 1
                unique, counts, icc, total = data
                de = conv.delta(unique, icc)
                out = counts[conv.out_of_gamut(unique, icc)].sum()
                weighted = np.repeat(de, counts)
                result["images"].append(
                    {
                        "page": number,
                        "name": str(name).lstrip("/"),
                        "share": round(float(out / total), 4),
                        "maxDe": round(float(de.max()), 1),
                        "p95De": round(float(np.percentile(weighted, 95)), 1),
                        "embeddedProfile": icc is not None,
                    }
                )
    oi = context.colors.output_intent_profile
    result["outputIntent"] = {
        "name": context.colors.output_intent_identifier,
        "matchesDestination": _same_profile(oi, Path(output)) if oi else None,
    }
    return result
