"""GWG 2022: cada regra com os valores oficiais da variante, o erro e o certo ao lado."""

import pikepdf
import pytest

from tests.integration.test_object_checks import MM, RECT, build, issues


def text(color, size, extra=""):
    return f"BT /F1 {size} Tf {extra} {color} {30 * MM} {50 * MM} Td (Texto) Tj ET"


def gwg(path, variant, **profile):
    return issues(path, gwgVariant=variant, **profile)


def test_without_a_variant_no_gwg_rule_runs(tmp_path):
    found = issues(build(tmp_path, f"q /OP1 gs 0 0 0 0 k {RECT} f Q"))
    assert not [code for code in found if code.startswith("GWG_")]


def test_white_overprint_any_mode_and_replaces_the_own_check(tmp_path):
    found = gwg(build(tmp_path, f"q /OP0 gs 0 0 0 0 k {RECT} f Q"), "wide_format")
    assert found["GWG_R0007"].severity == "critical"  # a GWG não aceita branco em sobreimpressão
    assert "R0008" in found["GWG_R0007"].title
    assert "OBJECT_WHITE_OVERPRINT" not in found


@pytest.mark.parametrize(
    ("variant", "ops", "expected"),
    [
        ("sheet", text("0 0 0 1 k", 6), True),
        ("sheet", f"q /OP1 gs {text('0 0 0 1 k', 6)} Q", False),
        ("sheet", text("0 0 0 1 k", 14), False),
        ("digital", text("0 0 0 1 k", 6), False),  # a variante digital não pede
    ],
)
def test_small_pure_black_text_must_overprint(tmp_path, variant, ops, expected):
    assert ("GWG_R0009" in gwg(build(tmp_path, ops), variant)) is expected


@pytest.mark.parametrize(
    ("color", "expected"), [("0.6 0.6 0.6 1 k", False), ("0.7 0.7 0.7 1 k", True)]
)
def test_rich_black_text_k85_tac280(tmp_path, color, expected):
    assert ("GWG_R0015" in gwg(build(tmp_path, text(color, 20)), "digital")) is expected


@pytest.mark.parametrize(
    ("color", "size", "expected"),
    [("0.5 0.5 0 0 k", 6, True), ("0.5 0.5 0 0 k", 10, False), ("0 0 0 1 k", 6, False)],
)
def test_small_multi_channel_text_sheet_8pt(tmp_path, color, size, expected):
    assert ("GWG_R0017" in gwg(build(tmp_path, text(color, size)), "sheet")) is expected


@pytest.mark.parametrize(("width", "expected"), [(0.1, True), (0.2, False)])
def test_thin_multi_channel_lines_wide_format_015pt(tmp_path, width, expected):
    ops = f"1 1 0 0 K {width} w {30 * MM} {30 * MM} m {60 * MM} {30 * MM} l S"
    assert ("GWG_R0019" in gwg(build(tmp_path, ops), "wide_format")) is expected


def test_packaging_wants_colours_already_converted(tmp_path):
    rgb = gwg(build(tmp_path, f"1 0 0 rg {RECT} f"), "packaging_offset")
    assert rgb["GWG_R0027"].severity == "critical"
    cmyk = gwg(build(tmp_path, f"0 1 1 0 k {RECT} f", name="b.pdf"), "packaging_offset")
    assert "GWG_R0027" not in cmyk
    # Comunicação visual é late binding: RGB é o normal.
    assert "GWG_R0027" not in gwg(
        build(tmp_path, f"1 0 0 rg {RECT} f", name="c.pdf"), "wide_format"
    )


@pytest.mark.parametrize(("px", "severity"), [(600, None), (160, "warning"), (100, "critical")])
def test_image_resolution_two_levels_sheet_149_224(tmp_path, px, severity):
    # Imagem de 20 mm: 600 px = 762 ppi, 160 px = 203 ppi, 100 px = 127 ppi.
    photo = (bytes(3 * px * px), px, px, pikepdf.Name.DeviceRGB)
    ops = f"q {20 * MM} 0 0 {20 * MM} {30 * MM} {30 * MM} cm /Im0 Do Q " + text("0 0 0 1 k", 20)
    found = gwg(build(tmp_path, ops, images={"/Im0": photo}), "sheet")
    if severity is None:
        assert "GWG_R0031" not in found
    else:
        assert found["GWG_R0031"].severity == severity
    assert "IMAGE_LOW_RESOLUTION" not in found  # a regra da GWG toma o lugar


def test_cropbox_and_courier(tmp_path):
    path = build(tmp_path, text("0 0 0 1 k", 20))
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        pdf.pages[0].obj.CropBox = [5 * MM, 5 * MM, 95 * MM, 95 * MM]
        pdf.pages[0].obj.Resources.Font.F1.BaseFont = pikepdf.Name.Courier
        pdf.save(path)
    found = gwg(path, "sheet")
    assert "GWG_R0003" in found
    assert "Courier" in found["GWG_R0014"].found_value
    assert "GWG_R0014" not in gwg(path, "wide_format")  # Courier não é regra do wide format
