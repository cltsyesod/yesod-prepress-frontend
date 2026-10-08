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


_Oriented = tuple[float, BaseGeometry, tuple[float, float]]
"""(rotation, outline rotated and touching the axes, shift applied to touch them)."""


def nest(items: list[NestItem], material: Material) -> NestResult:
    """Best of the free greedy layout and the pattern layout (repeated pieces tiled)."""

    if not any(item.quantity >= _PATTERN_MIN for item in items):
        return _nest(items, material, patterns=False)
    patterned = _nest(items, material, patterns=True)
    if all(item.quantity >= _PATTERN_MIN for item in items) and not patterned.unplaced:
        return patterned  # only repeated pieces: the tiling is the layout
    return min(_nest(items, material, patterns=False), patterned, key=_cost)


def _cost(result: NestResult) -> tuple[int, int, float]:
    """Fewer missing pieces, then fewer pages, then a shorter last page."""

    used = [sheet for sheet in result.sheets if sheet.placements]
    return (len(result.unplaced), len(used), used[-1].used_length if used else 0.0)


def _options(item: NestItem, material: Material) -> list[_Oriented]:
    """Every allowed rotation of the piece that fits the usable area."""

    usable_w = material.width - 2 * material.margin
    usable_h = material.page_length - 2 * material.margin
    # Collision tests use a slightly simplified outline (never smaller than the real one).
    outline = item.outline.simplify(0.5).buffer(0.5, join_style="mitre", mitre_limit=2.0)
    return [
        entry
        for entry in ((r, *_oriented(outline, r)) for r in item.rotations)
        if entry[1].bounds[2] <= usable_w + 1e-6 and entry[1].bounds[3] <= usable_h + 1e-6
    ]


def _nest(items: list[NestItem], material: Material, patterns: bool) -> NestResult:
    # Largest first: big pieces define the layout, small ones fill the gaps.
    ordered = sorted(items, key=lambda item: item.outline.area, reverse=True)

    layouts = [_Layout(material, 0)]
    unplaced: list[tuple[str, int, str]] = []

    for item in ordered:
        options = _options(item, material)
        copies = list(range(max(0, item.quantity)))
        if not options:
            reason = "maior que a área útil do material"
            unplaced.extend((item.key, copy, reason) for copy in copies)
            continue
        if patterns and len(copies) >= _PATTERN_MIN:
            copies = _place_pattern(layouts, material, item.key, copies, options)
        for copy in copies:
            if not _place_greedy(layouts, material, item.key, copy, options):
                unplaced.append((item.key, copy, "não coube em uma página vazia"))

    return NestResult(sheets=[layout.sheet for layout in layouts], unplaced=unplaced)


def _place_greedy(
    layouts: list[_Layout], material: Material, key: str, copy: int, options: list[_Oriented]
) -> bool:
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
                best = (score, rotation, shape, shift, spot)
        if best is not None:
            _, rotation, shape, shift, spot = best
            _put(layout, key, copy, rotation, shape, shift, spot)
            return True

    layout = _Layout(material, len(layouts))
    layouts.append(layout)
    rotation, shape, shift = options[0]
    spot = layout.drop(shape, material.margin)
    if spot is None:  # pragma: no cover - an empty page always fits a valid option
        return False
    _put(layout, key, copy, rotation, shape, shift, spot)
    return True


def _put(
    layout: _Layout,
    key: str,
    copy: int,
    rotation: float,
    shape: BaseGeometry,
    shift: tuple[float, float],
    spot: tuple[float, float],
) -> None:
    layout.add(
        Placement(
            key=key,
            copy=copy,
            sheet=layout.sheet.index,
            rotation=rotation,
            offset=(shift[0] + spot[0], shift[1] + spot[1]),
            footprint=affinity.translate(shape, *spot),
        )
    )


# --- Pattern layout --------------------------------------------------------------------
#
# Many copies of the same piece are tiled like a professional nester does: the piece
# (alone, or paired with itself turned 180 degrees, e.g. triangles alternating up and
# down) forms a motif; the motif repeats along x at the tightest gap-clear period and
# the rows stack at the tightest gap-clear height, each row shifted sideways when that
# packs denser. Every candidate spot is still checked against the page, so mixed jobs
# and leftovers keep using the greedy placement.

_PATTERN_MIN = 4  # copies of one piece before tiling it
_ROW_SHIFTS = 8  # sideways shifts tried between rows
_PAIR_OFFSETS = 12  # vertical offsets tried when pairing a piece with its 180-degree turn


@dataclass(slots=True)
class _Pattern:
    density: float
    motif: list[tuple[_Oriented, tuple[float, float]]]
    """Each piece of the motif and its spot inside the motif."""
    period: float
    row_height: float
    row_shift: float


def _clear(moving: BaseGeometry, grown: BaseGeometry, dx: float, dy: float) -> bool:
    return not affinity.translate(moving, dx, dy).intersects(grown)


def _tightest(predicate, low: float, high: float) -> float:
    """Smallest value in [low, high] where `predicate` holds (true at `high`), by bisection."""

    if predicate(low):
        return low
    while high - low > _TOLERANCE:
        mid = (low + high) / 2
        if predicate(mid):
            high = mid
        else:
            low = mid
    return high


def _grow(shape: BaseGeometry, gap: float) -> BaseGeometry:
    return shape.buffer(gap, join_style="mitre", mitre_limit=2.0)


def _lattice(
    motif: list[tuple[_Oriented, tuple[float, float]]], gap: float
) -> _Pattern | None:
    union = shapely.union_all(
        [affinity.translate(entry[1], *spot) for entry, spot in motif]
    )
    # Search bounds come from the grown outline: at sharp corners the mitre reaches
    # twice the gap, so "size + gap" is not always clear.
    grown = _grow(union, gap)
    period = _tightest(lambda x: _clear(union, grown, x, 0), 0.0, grown.bounds[2] + 1.0)
    if period <= 0:
        return None
    row = shapely.union_all([affinity.translate(union, i * period, 0) for i in range(-2, 3)])
    row_grown = _grow(row, gap)
    best = None
    for k in range(_ROW_SHIFTS):
        shift = period * k / _ROW_SHIFTS
        height = _tightest(
            lambda y, shift=shift: _clear(union, row_grown, shift, y),
            0.0,
            row_grown.bounds[3] + 1.0,
        )
        if height <= 0:
            continue
        density = union.area / (period * height)
        if best is None or density > best.density:
            best = _Pattern(density, motif, period, height, shift)
    return best


def _pair(first: _Oriented, second: _Oriented, gap: float, dy: float) -> tuple[float, float] | None:
    """Spot of `second` beside `first` (first at the origin), slid left until it touches."""

    a, b = first[1], second[1]
    grown = _grow(a, gap)
    high = grown.bounds[2] + 1.0
    if not _clear(b, grown, high, dy):
        return None
    return _tightest(lambda x: _clear(b, grown, x, dy), 0.0, high), dy


def _best_pattern(options: list[_Oriented], material: Material, quantity: int) -> _Pattern | None:
    """The tiling that needs the least material for `quantity` copies on this width.

    Density alone is not enough: on a finite width the leftover at the row ends
    decides, so every dense candidate is scored by the length it actually uses.
    """

    patterns = _patterns(options, material.gap)
    if not patterns:
        return None
    densest = max(pattern.density for pattern in patterns)
    best, best_score = None, None
    # Options start at 0 degrees: a tilted tiling has to use clearly less material.
    for pattern in patterns:
        if pattern.density < densest * 0.8:
            continue
        score = _fill_score(pattern, material, quantity)
        if score is None:
            continue
        if best_score is None or (score[0], score[1] * 1.005) < best_score:
            best, best_score = pattern, score
    return best


def _fill_score(pattern: _Pattern, material: Material, quantity: int) -> tuple[int, float] | None:
    """(pages, top edge on the last page) when `quantity` copies follow the tiling."""

    tops = sorted(spot[1] + entry[1].bounds[3] for entry, spot in _pattern_spots(pattern, material))
    if not tops:
        return None
    pages = -(-quantity // len(tops))
    last = quantity - (pages - 1) * len(tops)
    return pages, tops[last - 1]


def _patterns(options: list[_Oriented], gap: float) -> list[_Pattern]:
    by_rotation = {round(entry[0] % 360, 4): entry for entry in options}
    found = []
    for entry in options:
        motifs = [[(entry, (0.0, 0.0))]]
        turned = by_rotation.get(round((entry[0] + 180) % 360, 4))
        if turned is not None:
            h_a, h_b = entry[1].bounds[3], turned[1].bounds[3]
            pairs = []
            for i in range(_PAIR_OFFSETS + 1):
                dy = -h_b + (h_a + h_b) * i / _PAIR_OFFSETS
                spot = _pair(entry, turned, gap, dy)
                if spot is not None:
                    union = shapely.union_all([entry[1], affinity.translate(turned[1], *spot)])
                    pairs.append((union.envelope.area, spot))
            # Only the tightest pairings are worth tiling.
            for _, spot in sorted(pairs, key=lambda pair: pair[0])[:3]:
                miny = min(0.0, spot[1])
                motifs.append([(entry, (0.0, -miny)), (turned, (spot[0], spot[1] - miny))])
        for motif in motifs:
            pattern = _lattice(motif, gap)
            if pattern is not None:
                found.append(pattern)
    return found


def _place_pattern(
    layouts: list[_Layout],
    material: Material,
    key: str,
    copies: list[int],
    options: list[_Oriented],
) -> list[int]:
    """Places copies on the tiling; returns the copies left for the greedy placement."""

    pattern = _best_pattern(options, material, len(copies))
    if pattern is None:
        return copies
    remaining = list(copies)
    index = 0
    while remaining:
        if index == len(layouts):
            layouts.append(_Layout(material, index))
        layout = layouts[index]
        placed_here = 0
        for entry, spot in _pattern_spots(pattern, material):
            if not remaining:
                break
            rotation, shape, shift = entry
            # Exactly on the tiling: sliding one piece would take its neighbour's slot.
            if layout.free(shape, *spot):
                _put(layout, key, remaining.pop(0), rotation, shape, shift, spot)
                placed_here += 1
        if placed_here == 0 and not layout.sheet.placements:
            break  # nothing of the tiling fits an empty page: leave it to the greedy placement
        index += 1
    return remaining


def _pattern_spots(pattern: _Pattern, material: Material):
    """Tiling spots inside the usable area, row by row from the bottom-left corner."""

    m = material
    right, top = m.width - m.margin + 1e-6, m.page_length - m.margin + 1e-6
    spots = []
    row = 0
    while m.margin + row * pattern.row_height <= top:
        y = m.margin + row * pattern.row_height
        shift = (row * pattern.row_shift) % pattern.period
        x = m.margin + shift - pattern.period
        while x <= right:
            for entry, (ox, oy) in pattern.motif:
                sx, sy = x + ox, y + oy
                _, _, w, h = entry[1].bounds
                if sx >= m.margin - 1e-6 and sx + w <= right and sy + h <= top:
                    spots.append((entry, (sx, sy)))
            x += pattern.period
        row += 1
    spots.sort(key=lambda spot: (round(spot[1][1], 1), spot[1][0]))
    return spots


_FILL_LIMIT = 2000  # sets counted when measuring the spare room of a sheet


def spare_sets(sheet: Sheet, items: list[NestItem], material: Material) -> int:
    """How many more complete sets of `items` (one copy of each) fit in the free part of `sheet`.

    Used to tell the operator how many copies would fill the sheet. The extra copies
    follow the tiling of each piece, so the count is conservative (never overstated).
    """

    layout = _Layout(material, sheet.index)
    for placement in sheet.placements:
        layout._obstacles.append(_grow(placement.footprint, material.gap))
    layout._tree = STRtree(layout._obstacles) if layout._obstacles else None
    layout.sheet.used_length = sheet.used_length

    pieces = []
    for item in items:
        options = _options(item, material)
        pattern = _best_pattern(options, material, _FILL_LIMIT) if options else None
        if pattern is None:
            return 0
        pieces.append([_pattern_spots(pattern, material), 0])

    sets = 0
    while sets < _FILL_LIMIT:
        for piece in pieces:
            spots, cursor = piece
            while cursor < len(spots) and not layout.free(spots[cursor][0][1], *spots[cursor][1]):
                cursor += 1
            if cursor == len(spots):
                return sets
            (rotation, shape, shift), spot = spots[cursor]
            _put(layout, "spare", sets, rotation, shape, shift, spot)
            piece[1] = cursor + 1
        sets += 1
    return sets


def used_efficiency(sheet: Sheet, material: Material) -> float:
    """Share of the material taken by pieces up to the top of the last piece."""

    if not sheet.placements or sheet.used_length <= 0:
        return 0.0
    area = sum(p.footprint.area for p in sheet.placements)
    return area / (material.width * (sheet.used_length + material.margin))


def rotation_steps(step_degrees: float, allow_rotation: bool = True) -> tuple[float, ...]:
    """0, step, 2*step... below 360. A step of 0 (or no rotation) means 0 only."""

    if not allow_rotation or step_degrees <= 0:
        return (0.0,)
    count = max(1, round(360 / step_degrees))
    return tuple(round(i * 360 / count, 4) for i in range(count))


def efficiency(sheet: Sheet, material: Material) -> float:
    """Share of the material taken by pieces: the whole sheet, or the roll length used."""

    if not sheet.placements or sheet.used_length <= 0:
        return 0.0
    area = sum(p.footprint.area for p in sheet.placements)
    length = material.length if material.length is not None else sheet.used_length + material.margin
    return area / (material.width * length)
