import math

import pytest
from shapely.geometry import Polygon, box

from app.contracts.nesting import NestingRequest
from app.nesting.engine import Material, NestItem, nest, rotation_steps
from app.nesting.fill import FillError, FillGroup, fill

MM = 72 / 25.4


def star(r_out: float, r_in: float) -> Polygon:
    return Polygon(
        [
            (
                (r_out if i % 2 == 0 else r_in) * math.cos(math.pi / 2 + i * math.pi / 5),
                (r_out if i % 2 == 0 else r_in) * math.sin(math.pi / 2 + i * math.pi / 5),
            )
            for i in range(10)
        ]
    )


SHEET = Material(width=600 * MM, length=400 * MM, margin=5 * MM, gap=3 * MM)


def group(key, outline, minimum=0, fillable=True, rotations=(0.0, 90.0)):
    return FillGroup(
        key=key,
        label=key,
        pieces=[NestItem(key, outline, 1, rotations)],
        minimum=minimum,
        fillable=fillable,
    )


def fits(groups, quantities, material) -> bool:
    items = [
        NestItem(g.key, g.pieces[0].outline, quantities[g.key], g.pieces[0].rotations)
        for g in groups
        if quantities[g.key]
    ]
    result = nest(items, material)
    return not result.unplaced and len([s for s in result.sheets if s.placements]) == 1


def test_one_job_fills_the_sheet_and_one_more_copy_does_not_fit():
    groups = [group("rect", box(0, 0, 50 * MM, 30 * MM))]
    outcome = fill(groups, SHEET, auto_rotation=False)
    q = outcome.quantities["rect"]
    assert q > 50
    assert fits(groups, {"rect": q}, SHEET)
    assert not fits(groups, {"rect": q + 1}, SHEET)


def test_minimums_are_kept_and_only_fillable_jobs_grow():
    groups = [
        group("star", star(30 * MM, 13 * MM), minimum=10, rotations=rotation_steps(45)),
        group("rect", box(0, 0, 80 * MM, 50 * MM), minimum=4, fillable=False),
        group("small", box(0, 0, 20 * MM, 20 * MM), minimum=0),
    ]
    outcome = fill(groups, SHEET, auto_rotation=False)
    q = outcome.quantities
    assert q["rect"] == 4  # not marked to fill: stays at its minimum
    assert q["star"] >= 10 and q["small"] > 0
    assert fits(groups, q, SHEET)
    # Full: neither fillable job takes one more copy.
    assert not fits(groups, {**q, "star": q["star"] + 1}, SHEET)
    assert not fits(groups, {**q, "small": q["small"] + 1}, SHEET)


def test_roll_length_is_respected():
    roll = Material(width=600 * MM, length=250 * MM, margin=0, gap=2 * MM)
    groups = [group("rect", box(0, 0, 100 * MM, 60 * MM))]
    outcome = fill(groups, roll, auto_rotation=False)
    used = [s for s in outcome.result.sheets if s.placements]
    assert len(used) == 1 and used[0].used_length <= 250 * MM + 1e-6
    # 5 across (6 would need 610 mm with the gaps) x 4 rows of 60 mm in 250 mm.
    q = outcome.quantities["rect"]
    assert q >= 5 * 4
    assert not fits(groups, {"rect": q + 1}, roll)


def test_automatic_rotation_uses_only_allowed_angles():
    allowed = rotation_steps(45)
    groups = [group("star", star(30 * MM, 13 * MM), rotations=allowed)]
    outcome = fill(groups, SHEET, auto_rotation=True)
    assert {p.rotation for p in outcome.result.placements} <= set(allowed)
    assert outcome.quantities["star"] > 0


def test_minimum_that_does_not_fit_is_reported():
    groups = [group("big", box(0, 0, 300 * MM, 300 * MM), minimum=3)]
    with pytest.raises(FillError):
        fill(groups, SHEET, auto_rotation=False)


def test_request_needs_a_target_for_filling():
    base = {
        "nestingId": "n1",
        "callbackUrl": "https://example.com/cb",
        "outputUploadUrl": "https://example.com/up",
        "items": [{"key": "a", "file": {"url": "https://example.com/a.pdf"}, "quantity": 0}],
    }
    with pytest.raises(ValueError):
        NestingRequest.model_validate({**base, "material": {"widthMm": 1000}})  # nothing to place
    with pytest.raises(ValueError):
        NestingRequest.model_validate(
            {**base, "material": {"widthMm": 1000}, "fill": {"target": "roll"}}
        )
    ok = NestingRequest.model_validate(
        {**base, "material": {"widthMm": 1000}, "fill": {"target": "roll", "rollLengthMm": 2000}}
    )
    assert ok.fill.roll_length_mm == 2000
