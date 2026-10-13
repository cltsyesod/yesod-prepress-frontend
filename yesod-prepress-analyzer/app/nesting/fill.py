"""Automatic quantities: fill one sheet, or a roll length, with the selected jobs.

The operator gives the minimum of each job and which jobs may receive extra copies;
the gap and the allowed rotations stay exactly as the operator set them. Quantities
are found with the real nesting, never estimated: a candidate counts only if every
piece is placed on a single sheet (or within the roll length).

1. The minimums alone must fit.
2. Balanced extra sets (one more copy of every fillable job at a time), the largest
   number that fits, found by bisection from a conservative estimate.
3. Top-up: single extra copies, smallest pieces first, while anything still fits.

With automatic rotation, every subset of the allowed angles (all of them, quarter
turns, half turns, none) is measured the same way and the fullest layout wins.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, replace

from app.core.exceptions import AnalyzerError
from app.nesting.engine import Material, NestItem, NestResult, nest, spare_sets

_MAX_SETS = 5000
_BUDGET_SECONDS = 150.0  # whole search; the best layout found so far is kept


class FillError(AnalyzerError):
    code = "NESTING_FILL_FAILED"


@dataclass(slots=True)
class FillGroup:
    key: str
    label: str
    pieces: list[NestItem]
    """One NestItem per piece of the job (pages, separate die lines); a copy = one of each."""
    minimum: int
    fillable: bool


@dataclass(slots=True)
class FillOutcome:
    quantities: dict[str, int]
    result: NestResult
    rotations: str
    """Which set of angles won ("todos os ângulos permitidos", "0° e 90°"...)."""
    tested: int
    """Layouts measured."""


def _fits(result: NestResult) -> bool:
    used = [sheet for sheet in result.sheets if sheet.placements]
    return not result.unplaced and len(used) <= 1


def _items(groups: list[FillGroup], quantities: dict[str, int], rotations) -> list[NestItem]:
    return [
        replace(piece, quantity=quantities[group.key], rotations=rotations(piece))
        for group in groups
        if quantities[group.key] > 0
        for piece in group.pieces
    ]


def _placed_area(result: NestResult) -> float:
    return sum(p.footprint.area for p in result.placements)


class _Search:
    def __init__(self, groups: list[FillGroup], material: Material, deadline: float):
        self.groups = groups
        self.material = material
        self.deadline = deadline
        self.tested = 0

    def run(self, quantities: dict[str, int], rotations) -> NestResult | None:
        items = _items(self.groups, quantities, rotations)
        if not items:
            return NestResult(sheets=[], unplaced=[])
        self.tested += 1
        result = nest(items, self.material)
        return result if _fits(result) else None

    def out_of_time(self) -> bool:
        return time.monotonic() > self.deadline

    def fill(self, rotations) -> tuple[dict[str, int], NestResult] | None:
        base = {g.key: g.minimum for g in self.groups}
        fillable = [g for g in self.groups if g.fillable]
        if not fillable:
            result = self.run(base, rotations)
            return (base, result) if result else None
        # Nothing asked as a minimum: start from one copy of each job to fill.
        if not any(base.values()):
            base = {g.key: (1 if g.fillable else 0) for g in self.groups}
        best = self.run(base, rotations)
        if best is None:
            return None
        quantities = dict(base)

        def with_sets(k: int) -> dict[str, int]:
            return {g.key: base[g.key] + (k if g.fillable else 0) for g in self.groups}

        # Conservative estimate of the free room (tiled copies in the leftover space),
        # then the real limit by doubling and bisection.
        used = [sheet for sheet in best.sheets if sheet.placements]
        pieces = [replace(p, rotations=rotations(p)) for g in fillable for p in g.pieces]
        estimate = spare_sets(used[-1], pieces, self.material) if used else 0
        low, high = 0, max(1, estimate)
        while high <= _MAX_SETS and not self.out_of_time():
            attempt = self.run(with_sets(high), rotations)
            if attempt is None:
                break
            low, best, quantities = high, attempt, with_sets(high)
            high *= 2
        while high - low > 1 and not self.out_of_time():
            middle = (low + high) // 2
            attempt = self.run(with_sets(middle), rotations)
            if attempt is None:
                high = middle
            else:
                low, best, quantities = middle, attempt, with_sets(middle)

        # Top-up job by job, largest pieces first (small ones then use the gaps): the
        # most extra copies of that job alone that still fit, by doubling and bisection.
        order = sorted(fillable, key=lambda g: sum(p.outline.area for p in g.pieces), reverse=True)
        for group in order:
            if self.out_of_time():
                break

            def plus(
                extra: int, key: str = group.key, start: dict[str, int] = quantities
            ) -> dict[str, int]:
                trial = dict(start)
                trial[key] += extra
                return trial

            low, high = 0, 1
            while high <= _MAX_SETS and not self.out_of_time():
                attempt = self.run(plus(high), rotations)
                if attempt is None:
                    break
                low, best = high, attempt
                high *= 2
            while high - low > 1 and not self.out_of_time():
                middle = (low + high) // 2
                attempt = self.run(plus(middle), rotations)
                if attempt is None:
                    high = middle
                else:
                    low, best = middle, attempt
            quantities = plus(low)
        return quantities, best


def _rotation_sets(allowed: tuple[float, ...]) -> list[tuple[str, tuple[float, ...]]]:
    """Subsets of the operator's angles worth comparing (never an angle not allowed)."""

    sets = [("todos os ângulos permitidos", allowed)]
    for label, wanted in (
        ("0°, 90°, 180° e 270°", (0.0, 90.0, 180.0, 270.0)),
        ("0° e 180°", (0.0, 180.0)),
        ("só 0°", (0.0,)),
    ):
        subset = tuple(a for a in allowed if a in wanted)
        if subset and subset != allowed and all(subset != s for _, s in sets):
            sets.append((label, subset))
    return sets


def fill(groups: list[FillGroup], material: Material, auto_rotation: bool) -> FillOutcome:
    """Largest quantities that fit one sheet of `material` (a roll is given its length)."""

    if not any(g.minimum > 0 or g.fillable for g in groups):
        raise FillError("Nenhum trabalho para montar: marque ao menos um para preencher.")
    deadline = time.monotonic() + _BUDGET_SECONDS
    search = _Search(groups, material, deadline)
    allowed = tuple(sorted({a for g in groups for p in g.pieces for a in p.rotations}))
    candidates = _rotation_sets(allowed) if auto_rotation else [("ângulos escolhidos", allowed)]

    best: tuple[str, dict[str, int], NestResult] | None = None
    for label, angles in candidates:
        if best is not None and search.out_of_time():
            break

        def rotations(piece: NestItem, angles=angles) -> tuple[float, ...]:
            # Each piece keeps its own limits (rectangles only 0°/90°) inside the set.
            own = tuple(a for a in piece.rotations if a in angles)
            return own or (piece.rotations[0],)

        found = search.fill(rotations)
        if found is None:
            continue
        quantities, result = found
        if best is None or _placed_area(result) > _placed_area(best[2]) + 1e-6:
            best = (label, quantities, result)

    if best is None:
        raise FillError(
            "Os mínimos pedidos não cabem numa chapa (ou no comprimento de rolo escolhido). "
            "Diminua os mínimos ou aumente o material."
        )
    label, quantities, result = best
    return FillOutcome(quantities=quantities, result=result, rotations=label, tested=search.tested)
