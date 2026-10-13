"""Folha editada à mão: as posições vêm do operador e o sistema só confere e monta.

A posição de cada peça é o canto inferior esquerdo da peça já girada, em mm a partir
do canto inferior esquerdo do material (a mesma conta da tela). Antes de montar, a
geometria real é conferida: dentro da margem, dentro do comprimento da folha e com o
espaçamento entre peças. Qualquer problema recusa a montagem com a lista do que corrigir;
nada é empurrado ou ajustado sozinho.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely import affinity
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from app.nesting.engine import _TOUCH, Material, NestResult, Placement, Sheet, _grow

MM = 72 / 25.4
OUTLINE_TOLERANCE_MM = 0.3
MAX_OUTLINE_POINTS = 240


@dataclass(slots=True)
class ManualPlacement:
    key: str
    copy: int
    sheet: int
    """1, 2, …"""
    rotation: float
    x_mm: float
    y_mm: float


class ManualLayoutError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _placed(outline: BaseGeometry, rotation: float, x_mm: float, y_mm: float):
    rotated = affinity.rotate(outline, rotation, origin=(0, 0))
    minx, miny, _, _ = rotated.bounds
    offset = (x_mm * MM - minx, y_mm * MM - miny)
    return affinity.translate(rotated, *offset), offset


def manual_result(
    placements: list[ManualPlacement],
    outlines: dict[str, BaseGeometry],
    labels: dict[str, str],
    material: Material,
) -> NestResult:
    problems: list[str] = []
    by_sheet: dict[int, list[Placement]] = {}
    tol = 0.05 * MM  # 0,05 mm: arredondamento da tela
    for item in placements:
        outline = outlines.get(item.key)
        name = f"{labels.get(item.key, item.key)} #{item.copy + 1}"
        if outline is None:
            problems.append(f"{name}: peça desconhecida")
            continue
        footprint, offset = _placed(outline, item.rotation, item.x_mm, item.y_mm)
        minx, miny, maxx, maxy = footprint.bounds
        top = material.page_length - material.margin
        if (
            minx < material.margin - tol
            or maxx > material.width - material.margin + tol
            or miny < material.margin - tol
            or maxy > top + tol
        ):
            problems.append(f"{name} (folha {item.sheet}): fora da área útil do material")
        by_sheet.setdefault(item.sheet, []).append(
            Placement(
                key=item.key,
                copy=item.copy,
                sheet=item.sheet - 1,
                rotation=item.rotation,
                offset=offset,
                footprint=footprint,
            )
        )

    for number, sheet in by_sheet.items():
        tree = STRtree([_grow(p.footprint, material.gap) for p in sheet])
        for i, piece in enumerate(sheet):
            for j in tree.query(piece.footprint):
                if j <= i:
                    continue
                grown = _grow(sheet[j].footprint, material.gap)
                if grown.intersection(piece.footprint).area > _TOUCH * _TOUCH:
                    a = f"{labels.get(piece.key, piece.key)} #{piece.copy + 1}"
                    b = f"{labels.get(sheet[j].key, sheet[j].key)} #{sheet[j].copy + 1}"
                    problems.append(f"{a} e {b} (folha {number}): menos que o espaçamento")
    if problems:
        raise ManualLayoutError(problems)

    count = max(by_sheet, default=0)
    sheets = []
    for index in range(count):
        pieces = by_sheet.get(index + 1, [])
        used = max((p.footprint.bounds[3] for p in pieces), default=0.0)
        sheets.append(Sheet(index=index, placements=pieces, used_length=used))
    return NestResult(sheets=sheets, unplaced=[])


def _ring(geometry: BaseGeometry) -> list[list[float]]:
    """Contorno externo simplificado (mm) da maior parte da peça, para a tela."""

    parts = getattr(geometry, "geoms", [geometry])
    biggest = max(parts, key=lambda g: g.area)
    simple = biggest.simplify(OUTLINE_TOLERANCE_MM * MM)
    coords = list(simple.exterior.coords) if hasattr(simple, "exterior") else []
    if len(coords) > MAX_OUTLINE_POINTS:
        coords = list(biggest.envelope.exterior.coords)
    return [[round(x / MM, 2), round(y / MM, 2)] for x, y in coords]


def export_layout(result: NestResult, outlines: dict[str, BaseGeometry]) -> dict:
    """Formas (sem giro, coordenadas do próprio contorno) e posições, para editar na tela."""

    used = {p.key for p in result.placements}
    placements = []
    for p in result.placements:
        minx, miny, maxx, maxy = p.footprint.bounds
        placements.append(
            {
                "key": p.key,
                "copy": p.copy,
                "sheet": p.sheet + 1,
                "rotation": round(p.rotation, 4),
                "xMm": round(minx / MM, 3),
                "yMm": round(miny / MM, 3),
                "wMm": round((maxx - minx) / MM, 2),
                "hMm": round((maxy - miny) / MM, 2),
            }
        )
    return {
        "shapes": {key: _ring(outlines[key]) for key in used if key in outlines},
        "placements": placements,
    }
