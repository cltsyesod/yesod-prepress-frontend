"""Folha editada à mão: o sistema confere a geometria real e só então monta."""

import pytest

from app.nesting.manual import ManualLayoutError, ManualPlacement
from app.nesting.planner import PlanItem, PlanOptions, plan
from tests.integration.test_nesting import card_pdf, star_pdf


def manual_from(summary, **changes):
    out = []
    for p in summary["placements"]:
        out.append(
            ManualPlacement(
                key=p["key"], copy=p["copy"], sheet=p["sheet"], rotation=p["rotation"],
                x_mm=p["xMm"], y_mm=p["yMm"],
            )
        )
    for index, patch in changes.items():
        for field, value in patch.items():
            setattr(out[int(index[1:])], field, value)
    return out


def test_auto_layout_exports_positions_and_shapes(tmp_path):
    items = [PlanItem("card", card_pdf(tmp_path / "c.pdf"), "Cartão", 3)]
    summary = plan(items, PlanOptions(width_mm=300, gap_mm=4), tmp_path / "a.pdf")
    assert len(summary["placements"]) == 3
    key = summary["placements"][0]["key"]
    ring = summary["shapes"][key]
    assert len(ring) >= 4  # contorno (mm) para a tela
    # Cartão 90 × 50 + 3 mm de sangria em cada lado.
    p = summary["placements"][0]
    assert {round(p["wMm"]), round(p["hMm"])} in ({96, 56}, {56, 96})


def test_manual_layout_is_built_exactly_where_the_operator_put_it(tmp_path):
    items = [PlanItem("card", card_pdf(tmp_path / "c.pdf"), "Cartão", 2)]
    options = PlanOptions(width_mm=300, gap_mm=4)
    auto = plan(items, options, tmp_path / "a.pdf")
    moved = manual_from(auto, p1={"x_mm": 150.0, "y_mm": 120.0, "rotation": 90.0})
    options.manual = moved
    result = plan(items, options, tmp_path / "m.pdf")
    second = next(p for p in result["placements"] if p["copy"] == moved[1].copy)
    assert second["xMm"] == pytest.approx(150, abs=0.01)
    assert second["yMm"] == pytest.approx(120, abs=0.01)
    assert second["rotation"] == 90
    assert result["placed"] == 2
    assert (tmp_path / "m.pdf").stat().st_size > 0


def test_manual_layout_refuses_overlap_and_outside(tmp_path):
    items = [PlanItem("star", star_pdf(tmp_path / "s.pdf"), "Estrela", 2)]
    options = PlanOptions(width_mm=300, gap_mm=5)
    auto = plan(items, options, tmp_path / "a.pdf")
    first = auto["placements"][0]
    # Segunda peça em cima da primeira: recusa e diz o quê.
    options.manual = manual_from(
        auto, p1={"x_mm": first["xMm"] + 1, "y_mm": first["yMm"], "rotation": first["rotation"]}
    )
    with pytest.raises(ManualLayoutError, match="espaçamento"):
        plan(items, options, tmp_path / "x.pdf")
    options.manual = manual_from(auto, p1={"x_mm": 290.0})
    with pytest.raises(ManualLayoutError, match="fora da área"):
        plan(items, options, tmp_path / "y.pdf")
