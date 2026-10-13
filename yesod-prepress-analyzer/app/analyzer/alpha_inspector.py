"""DTF / DTG: o que a tinta branca vai encontrar.

Cada página é renderizada uma vez, com fundo transparente, no tamanho final. Do canal
alfa saem as medidas: área pintada, fundo chapado, opacidade parcial (sombras, brilhos,
degradês para o transparente: o branco embaixo não tem meio-termo) e detalhes mais
finos que o mínimo do perfil (o que some com a abertura morfológica de lado = mínimo).
Só mede; nada é alterado.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium

from app.contracts.production_profile import ProductionProfile

MM_PER_PT = 25.4 / 72
MAX_PIXELS = 12_000_000
BASE_PX_PER_MM = 4.0
PAINTED = 8  # alfa (0-255) acima disto é tinta
OPAQUE = 247  # alfa acima disto é opaco
EDGE_PX = 2  # antisserrilhado da renderização: opacidade parcial junto ao transparente


@dataclass(slots=True)
class AlphaPage:
    page: int
    px_per_mm: float
    box_mm: tuple[float, float]
    """Caixa medida (TrimBox, CropBox ou MediaBox) no tamanho final."""
    art_mm: tuple[float, float, float, float] | None
    """Limites da tinta (x0, y0, x1, y1) a partir do canto inferior esquerdo da caixa."""
    painted_mm2: float
    opaque_share_of_box: float
    partial_share: float
    """Parte da arte com opacidade parcial longe das bordas."""
    below_threshold_share: float | None
    """Parte da arte abaixo do limite de opacidade do perfil (sem branco embaixo)."""
    thin_mm2: float | None
    """Área de detalhes mais finos que o mínimo (None: mínimo não cadastrado ou não medível)."""
    thin_measured: bool

    @property
    def art_size_mm(self) -> tuple[float, float] | None:
        if not self.art_mm:
            return None
        x0, y0, x1, y1 = self.art_mm
        return (x1 - x0, y1 - y0)

    def to_dict(self) -> dict:
        data = asdict(self)
        data["artSizeMm"] = self.art_size_mm
        return data


def window_counts(mask: np.ndarray, k: int) -> np.ndarray:
    """Pixels marcados em cada janela k×k (posição = canto superior esquerdo)."""

    s = np.zeros((mask.shape[0] + 1, mask.shape[1] + 1), dtype=np.int64)
    s[1:, 1:] = mask.astype(np.int64).cumsum(0).cumsum(1)
    return s[k:, k:] - s[:-k, k:] - s[k:, :-k] + s[:-k, :-k]


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    k = 2 * radius + 1
    padded = np.pad(mask, radius)
    return window_counts(padded, k) > 0


def opening(mask: np.ndarray, k: int) -> np.ndarray:
    """União de todos os quadrados k×k inteiros dentro da máscara."""

    if k <= 1:
        return mask.copy()
    if min(mask.shape) < k:
        return np.zeros_like(mask)
    starts = window_counts(mask, k) == k * k
    padded = np.zeros((mask.shape[0] + k - 1, mask.shape[1] + k - 1), dtype=bool)
    padded[k - 1 : k - 1 + starts.shape[0], k - 1 : k - 1 + starts.shape[1]] = starts
    return window_counts(padded, k) > 0


def _box(page: pdfium.PdfPage) -> tuple[float, float, float, float]:
    for getter in ("get_trimbox", "get_cropbox", "get_mediabox"):
        try:
            box = getattr(page, getter)()
        except Exception:  # noqa: BLE001, S112 - caixa ausente: tenta a próxima
            continue
        if box and box[2] > box[0] and box[3] > box[1]:
            return tuple(float(v) for v in box)
    raise ValueError("página sem caixa")


def measure_alpha(alpha: np.ndarray, px_per_mm: float, min_line_mm: float | None,
                  threshold_percent: float | None, height_mm: float | None = None) -> dict:
    """Medidas de um canal alfa (linha 0 = topo) no tamanho final."""

    painted = alpha > PAINTED
    total = int(painted.sum())
    opaque = alpha >= OPAQUE
    h, w = alpha.shape
    result: dict = {
        "painted_mm2": total / px_per_mm**2,
        "opaque_share_of_box": float(opaque.mean()) if alpha.size else 0.0,
        "partial_share": 0.0,
        "below_threshold_share": None,
        "art_mm": None,
        "thin_mm2": None,
        "thin_measured": False,
    }
    if not total:
        return result
    # Limites com fração de pixel: a coluna/linha da borda conta pela cobertura dela.
    def span(profile: np.ndarray) -> tuple[float, float]:
        cover = profile / 255.0
        idx = np.flatnonzero(profile > PAINTED)
        return idx[0] + 1 - cover[idx[0]], idx[-1] + cover[idx[-1]]

    # Medido a partir do topo da caixa real (o bitmap tem altura arredondada).
    top_mm = height_mm if height_mm is not None else h / px_per_mm
    left, right = span(alpha.max(axis=0))
    top, bottom = span(alpha.max(axis=1))
    result["art_mm"] = (
        left / px_per_mm,
        top_mm - bottom / px_per_mm,
        right / px_per_mm,
        top_mm - top / px_per_mm,
    )
    partial = painted & ~opaque
    interior = partial & ~dilate(~painted, EDGE_PX)
    result["partial_share"] = float(interior.sum()) / total
    if threshold_percent is not None:
        cut = threshold_percent / 100 * 255
        result["below_threshold_share"] = float((painted & (alpha < cut)).sum()) / total
    if min_line_mm:
        k = round(min_line_mm * px_per_mm)
        if k >= 2:
            thin = painted & ~opening(painted, k)
            result["thin_mm2"] = float(thin.sum()) / px_per_mm**2
            result["thin_measured"] = True
    return result


def inspect_alpha(path: Path, profile: ProductionProfile) -> list[AlphaPage]:
    textile = profile.textile
    pages: list[AlphaPage] = []
    doc = pdfium.PdfDocument(str(path))
    try:
        for index in range(len(doc)):
            page = doc[index]
            x0, y0, x1, y1 = _box(page)
            cx0, cy0, cx1, cy1 = page.get_cropbox()
            w_mm = (x1 - x0) * MM_PER_PT * profile.file_scale
            h_mm = (y1 - y0) * MM_PER_PT * profile.file_scale
            wanted = BASE_PX_PER_MM
            if textile.min_line_mm:
                wanted = max(wanted, 3 / textile.min_line_mm)
            px_per_mm = min(wanted, math.sqrt(MAX_PIXELS / max(w_mm * h_mm, 1e-6)))
            scale = px_per_mm * MM_PER_PT * profile.file_scale
            crop = (
                max(0.0, x0 - cx0),
                max(0.0, y0 - cy0),
                max(0.0, cx1 - x1),
                max(0.0, cy1 - y1),
            )
            bitmap = page.render(
                scale=scale, crop=crop, fill_color=(255, 255, 255, 0), draw_annots=False
            )
            alpha = np.asarray(bitmap.to_pil().convert("RGBA"))[:, :, 3]
            measured = measure_alpha(
                alpha, px_per_mm, textile.min_line_mm, textile.alpha_threshold_percent, h_mm
            )
            # Mínimo cadastrado mas a página é grande demais para medi-lo a 3 px por linha.
            if textile.min_line_mm and px_per_mm * textile.min_line_mm < 2:
                measured["thin_measured"] = False
                measured["thin_mm2"] = None
            pages.append(
                AlphaPage(page=index + 1, px_per_mm=px_per_mm, box_mm=(w_mm, h_mm), **measured)
            )
    finally:
        doc.close()
    return pages
