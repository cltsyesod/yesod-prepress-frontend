"""True-shape nesting on a roll or on sheets.

Greedy bottom-left placement with gravity: pieces go largest first; for every
allowed rotation and a set of candidate columns, the piece is dropped from above
the current layout and then pushed left, stopping at the first contact. The
placement that leaves the lowest top edge wins. Clearances are exact (shapely
geometry, not a raster), so the gap between pieces is always respected.

All lengths are PDF points at final size.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely import STRtree, affinity
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry

_TOLERANCE = 0.25  # pt (~0.09 mm): final precision of the drop/slide search
_COARSE = 14.0  # pt (~5 mm): candidate grid over every rotation and column
_REFINE = 4  # best coarse candidates refined at full precision
_MAX_COLUMNS = 24


@dataclass(slots=True)
class Material:
    width: float
    """Usable roll/sheet width, edge to edge."""
    length: float | None
    """Sheet length; None for a roll."""
    margin: float = 0.0
    gap: float = 0.0
    max_roll_length: float = 5000 * 72 / 25.4
    """A roll layout is split into pages no longer than this."""

    @property
    def page_length(self) -> float:
        return self.length if self.length is not None else self.max_roll_length


@dataclass(slots=True)
class NestItem:
    key: str
    outline: BaseGeometry
    """Footprint to keep clear (printed area), final size, any position."""
    quantity: int = 1
    rotations: tuple[float, ...] = (0.0,)


@dataclass(slots=True)
class Placement:
    key: str
    copy: int
    sheet: int
    rotation: float
    offset: tuple[float, float]
    """Translation applied after rotating the item's outline about the origin."""
    footprint: BaseGeometry


@dataclass(slots=True)
class Sheet:
    index: int
    placements: list[Placement] = field(default_factory=list)
    used_length: float = 0.0


@dataclass(slots=True)
class NestResult:
    sheets: list[Sheet]
    unplaced: list[tuple[str, int, str]]
    """(key, copy, reason) for pieces that cannot fit the material at all."""

    @property
    def placements(self) -> list[Placement]:
        return [p for sheet in self.sheets for p in sheet.placements]


class _Layout:
    def __init__(self, material: Material, index: int):
        self.material = material
        self.sheet = Sheet(index=index)
        self._obstacles: list[BaseGeometry] = []
        self._tree: STRtree | None = None

    def free(self, shape: BaseGeometry, x: float, y: float) -> bool:
        """Whether `shape` (touching the axes at the origin) fits when moved to (x, y)."""

        m = self.material
        _, _, w, h = shape.bounds
        if (
            x < m.margin - 1e-6
            or y < m.margin - 1e-6
            or x + w > m.width - m.margin + 1e-6
            or y + h > m.page_length - m.margin + 1e-6
        ):
            return False
        if self._tree is None:
            return True
        # Bounding boxes first: most positions touch nothing and need no real geometry.
        near = self._tree.query(box(x, y, x + w, y + h))
        if len(near) == 0:
            return True
        moved = affinity.translate(shape, x, y)
        return not any(moved.intersects(self._obstacles[i]) for i in near)

    def add(self, placement: Placement) -> None:
        self.sheet.placements.append(placement)
        # Obstacles are grown by the gap, so a free candidate is always gap-clear.
        grown = placement.footprint.buffer(self.material.gap, join_style="mitre", mitre_limit=2.0)
        self._obstacles.append(grown)
        self._tree = STRtree(self._obstacles)
        self.sheet.used_length = max(self.sheet.used_length, placement.footprint.bounds[3])

    def columns(self, width: float) -> list[float]:
        m = self.material
        right = m.width - m.margin - width
        xs = {m.margin, right}
        for placement in self.sheet.placements:
            minx, _, maxx, _ = placement.footprint.bounds
            xs.update({maxx + m.gap, minx, maxx - width})
        valid = sorted(x for x in xs if m.margin - 1e-6 <= x <= right + 1e-6)
        if len(valid) > _MAX_COLUMNS:
            step = len(valid) / _MAX_COLUMNS
            valid = sorted({valid[int(i * step)] for i in range(_MAX_COLUMNS)} | {m.margin})
        return valid

    def lowest_spots(self, shape: BaseGeometry, step: float) -> list[tuple[float, float]]:
        """Lowest free position in each column, tested on a grid in one vectorized call."""

        m = self.material
        _, _, w, h = shape.bounds
        xs = np.array(self.columns(w))
        if not len(xs):
            return []
        top = min(max(m.margin, self.sheet.used_length + m.gap + 1.0), m.page_length - m.margin - h)
        if top < m.margin - 1e-6:
            return []
        ys = np.append(np.arange(m.margin, top, step), top)
        grid_x, grid_y = (axis.ravel() for axis in np.meshgrid(xs, ys))
        if self._tree is None:
            free = np.ones(len(grid_x), dtype=bool)
        else:
            base = shapely.get_coordinates(shape)
            offsets = np.repeat(np.column_stack([grid_x, grid_y]), len(base), axis=0)
            moved = shapely.transform(
                np.full(len(grid_x), shape, dtype=object), lambda c: c + offsets
            )
            hits = self._tree.query(moved, predicate="intersects")
            free = np.ones(len(grid_x), dtype=bool)
            free[np.unique(hits[0])] = False
        spots = []
        for x in xs:
            column = free & (grid_x == x)
            if column.any():
                spots.append((float(x), float(grid_y[column].min())))
        return spots

    def drop(
        self, shape: BaseGeometry, x: float, tolerance: float = _COARSE
    ) -> tuple[float, float] | None:
        """Lowest free y in column x, then pushed left; None if nothing fits."""

        m = self.material
        top = self.sheet.used_length + m.gap + 1.0
        y = max(m.margin, top)
        if not self.free(shape, x, y):
            return None
        return self.settle(shape, (x, y), tolerance)

    def settle(
        self, shape: BaseGeometry, spot: tuple[float, float], tolerance: float = _TOLERANCE
    ) -> tuple[float, float]:
        """Push a free piece down and left until it touches something."""

        x, y = spot
        for _ in range(2):
            y = self._slide(shape, x, y, axis="y", tolerance=tolerance)
            x = self._slide(shape, x, y, axis="x", tolerance=tolerance)
        return x, y

    def _slide(self, shape: BaseGeometry, x: float, y: float, axis: str, tolerance: float) -> float:
        m = self.material
        value = y if axis == "y" else x
        step = value - m.margin
        while step > tolerance:
            candidate = value - step
            fits = self.free(shape, x, candidate) if axis == "y" else self.free(shape, candidate, y)
            if fits:
                value = candidate
            else:
                step /= 2
        return value


def _oriented(outline: BaseGeometry, rotation: float) -> tuple[BaseGeometry, tuple[float, float]]:
    """Outline rotated about the origin and moved to touch the axes, plus that shift."""

    rotated = affinity.rotate(outline, rotation, origin=(0, 0))
    minx, miny, _, _ = rotated.bounds
    return affinity.translate(rotated, -minx, -miny), (-minx, -miny)


def _score(shape: BaseGeometry, spot: tuple[float, float]) -> tuple[float, float, float]:
    """Lower top edge first (shorter roll), then lower, then further left."""

    return (round(shape.bounds[3] + spot[1], 1), round(spot[1], 1), spot[0])


def nest(items: list[NestItem], material: Material) -> NestResult:
    usable = box(
        material.margin,
        material.margin,
        material.width - material.margin,
        material.page_length - material.margin,
    )
    queue = [(item, copy) for item in items for copy in range(max(0, item.quantity))]
    # Largest first: big pieces define the layout, small ones fill the gaps.
    queue.sort(key=lambda entry: entry[0].outline.area, reverse=True)

    shapes: dict[str, list[tuple[float, BaseGeometry, tuple[float, float]]]] = {}
    for item in items:
        # Collision tests use a slightly simplified outline (never smaller than the real one).
        outline = item.outline.simplify(0.5).buffer(0.5, join_style="mitre", mitre_limit=2.0)
        shapes[item.key] = [(r, *_oriented(outline, r)) for r in item.rotations]

    layouts = [_Layout(material, 0)]
    unplaced: list[tuple[str, int, str]] = []

    for item, copy in queue:
        options = [
            entry
            for entry in shapes[item.key]
            if entry[1].bounds[2] <= usable.bounds[2] - usable.bounds[0] + 1e-6
            and entry[1].bounds[3] <= usable.bounds[3] - usable.bounds[1] + 1e-6
        ]
        if not options:
            unplaced.append((item.key, copy, "maior que a área útil do material"))
            continue

        placed = False
        for layout in layouts:
            coarse = []
            for rotation, shape, shift in options:
                for spot in layout.lowest_spots(shape, _COARSE):
                    coarse.append((_score(shape, spot), rotation, shape, shift, spot))
            coarse.sort(key=lambda entry: entry[0])
            best = None
            for _, rotation, shape, shift, spot in coarse[:_REFINE]:
                spot = layout.settle(shape, spot)
                score = _score(shape, spot)
                if best is None or score < best[0]:
                    offset = (shift[0] + spot[0], shift[1] + spot[1])
                    best = (score, rotation, offset, affinity.translate(shape, *spot))
            if best is not None:
                _, rotation, offset, footprint = best
                layout.add(
                    Placement(
                        key=item.key,
                        copy=copy,
                        sheet=layout.sheet.index,
                        rotation=rotation,
                        offset=offset,
                        footprint=footprint,
                    )
                )
                placed = True
                break
        if not placed:
            layout = _Layout(material, len(layouts))
            layouts.append(layout)
            rotation, shape, shift = options[0]
            spot = layout.drop(shape, material.margin)
            if spot is None:  # pragma: no cover - an empty page always fits a valid option
                unplaced.append((item.key, copy, "não coube em uma página vazia"))
                continue
            layout.add(
                Placement(
                    key=item.key,
                    copy=copy,
                    sheet=layout.sheet.index,
                    rotation=rotation,
                    offset=(shift[0] + spot[0], shift[1] + spot[1]),
                    footprint=affinity.translate(shape, *spot),
                )
            )

    return NestResult(sheets=[layout.sheet for layout in layouts], unplaced=unplaced)


def rotation_steps(step_degrees: float, allow_rotation: bool = True) -> tuple[float, ...]:
    """0, step, 2*step... below 360. A step of 0 (or no rotation) means 0 only."""

    if not allow_rotation or step_degrees <= 0:
        return (0.0,)
    count = max(1, round(360 / step_degrees))
    return tuple(round(i * 360 / count, 4) for i in range(count))


def efficiency(sheet: Sheet, material: Material) -> float:
    if not sheet.placements or sheet.used_length <= 0:
        return 0.0
    area = sum(p.footprint.area for p in sheet.placements)
    return area / (material.width * (sheet.used_length + material.margin))
