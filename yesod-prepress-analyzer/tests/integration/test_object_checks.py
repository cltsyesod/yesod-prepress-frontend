"""Conferências de vetor, texto e cor: cada erro montado de propósito, e o certo ao lado."""

import zlib

import pikepdf
import pytest

import app.analyzer.document_inspector as di
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings
from app.rules.registry import DEFAULT_RULES, run_rules

MM = 72 / 25.4
W = H = 100 * MM


def sep(name, cmyk):
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=cmyk, N=1)
    return pikepdf.Array(
        [pikepdf.Name.Separation, pikepdf.Name("/" + name), pikepdf.Name.DeviceCMYK, tint]
    )


def build(tmp_path, ops, *, name="t.pdf", images=None, hidden=None):
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(W, H))
    page = pdf.pages[0]
    page.obj.TrimBox = [10 * MM, 10 * MM, 90 * MM, 90 * MM]
    resources = pikepdf.Dictionary(
        Font=pikepdf.Dictionary(
            F1=pikepdf.Dictionary(
                Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica
            )
        ),
        ColorSpace=pikepdf.Dictionary(
            Reg=sep("All", [1, 1, 1, 1]), Cut=sep("CutContour", [0, 1, 0, 0])
        ),
        ExtGState=pikepdf.Dictionary(
            OP1=pikepdf.Dictionary(OP=True, op=True, OPM=1),
            OP0=pikepdf.Dictionary(OP=True, op=True, OPM=0),
        ),
        XObject=pikepdf.Dictionary(),
    )
    for key, (pixels, w, h, space) in (images or {}).items():
        image = pikepdf.Stream(pdf, zlib.compress(pixels))
        image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
        image.Width, image.Height, image.BitsPerComponent = w, h, 8
        image.Filter = pikepdf.Name.FlateDecode
        if space == "mask":
            image.ImageMask, image.BitsPerComponent = True, 1
        else:
            image.ColorSpace = space(pdf) if callable(space) else space
        resources.XObject[key] = image
    page.obj.Resources = resources
    if hidden:
        layer = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=hidden))
        pdf.Root.OCProperties = pikepdf.Dictionary(
            OCGs=[layer], D=pikepdf.Dictionary(ON=[], OFF=[layer])
        )
    page.contents_add(ops.encode())
    path = tmp_path / name
    pdf.save(path)
    return path


def issues(path, **profile):
    original = di._run_qpdf
    di._run_qpdf = lambda p, t: (True, "")
    try:
        ctx = di.inspect_document(path, ProductionProfile(id="p", **profile), Settings())
    finally:
        di._run_qpdf = original
    return {i.rule_code: i for i in run_rules(ctx, DEFAULT_RULES)}


RECT = f"{30 * MM} {30 * MM} {20 * MM} {20 * MM} re"


def text(color, size=6):
    return f"BT /F1 {size} Tf {color} {30 * MM} {50 * MM} Td (Texto) Tj ET"


def test_white_overprint_disappears_only_when_it_really_does(tmp_path):
    bad = issues(build(tmp_path, f"q /OP1 gs 0 0 0 0 k {RECT} f Q", name="a.pdf"))
    assert bad["OBJECT_WHITE_OVERPRINT"].severity == "critical"
    gray = issues(build(tmp_path, f"q /OP0 gs 1 g {RECT} f Q", name="b.pdf"))
    assert "OBJECT_WHITE_OVERPRINT" in gray  # cinza vai só para o preto: some
    ok = issues(build(tmp_path, f"q /OP0 gs 0 0 0 0 k {RECT} f Q", name="c.pdf"))
    assert "OBJECT_WHITE_OVERPRINT" not in ok  # OPM 0 pinta os zeros: o branco aparece
    plain = issues(build(tmp_path, f"0 0 0 0 k {RECT} f", name="d.pdf"))
    assert "OBJECT_WHITE_OVERPRINT" not in plain


def test_registration_in_art_but_not_in_crop_marks(tmp_path):
    inside = issues(build(tmp_path, f"/Reg cs 1 scn {RECT} f", name="a.pdf"))
    assert "OBJECT_REGISTRATION_IN_ART" in inside
    marks = issues(build(tmp_path, "/Reg CS 1 SCN 0.25 w 2 2 m 20 2 l S", name="b.pdf"))
    assert "OBJECT_REGISTRATION_IN_ART" not in marks


def test_small_rich_black_and_rgb_black_text(tmp_path):
    rich = issues(build(tmp_path, text("0.6 0.4 0.4 1 k"), name="a.pdf"), smallTextPt=8)
    assert rich["TEXT_RICH_BLACK"].severity == "warning"
    pure = issues(build(tmp_path, text("0 0 0 1 k"), name="b.pdf"), smallTextPt=8)
    assert "TEXT_RICH_BLACK" not in pure
    rgb = issues(build(tmp_path, text("0 0 0 rg"), name="c.pdf"), smallTextPt=8)
    assert rgb["TEXT_RICH_BLACK"].severity == "informational"
    big = issues(build(tmp_path, text("0.6 0.4 0.4 1 k", size=20), name="d.pdf"), smallTextPt=8)
    assert "TEXT_RICH_BLACK" not in big


def test_text_size_is_measured_at_final_size(tmp_path):
    path = build(tmp_path, text("0 0 0 1 k", size=6))
    assert "TEXT_TOO_SMALL" in issues(path, minTextPt=7)
    # Arquivo em 1:10: 6 pt no arquivo são 60 pt na peça.
    assert "TEXT_TOO_SMALL" not in issues(path, minTextPt=7, fileScale="1:10")


def test_zero_and_thin_strokes_but_not_the_die_line(tmp_path):
    ops = (
        f"0 0 0 1 K 0 w {30 * MM} {30 * MM} m {60 * MM} {30 * MM} l S "
        f"0 0 0 1 K 0.1 w {30 * MM} {40 * MM} m {60 * MM} {40 * MM} l S "
        f"/Cut CS 1 SCN 0 w {30 * MM} {60 * MM} m {60 * MM} {60 * MM} l S"
    )
    found = issues(build(tmp_path, ops), minStrokeMm=0.1)
    assert "1 linha" in found["STROKE_TOO_THIN"].found_value  # a de espessura zero (sem a faca)
    codes = [i for i in run_rules_all(build(tmp_path, ops, name="b.pdf"), minStrokeMm=0.1)]
    assert sum(1 for i in codes if i.rule_code == "STROKE_TOO_THIN") == 2  # zero e fina


def run_rules_all(path, **profile):
    original = di._run_qpdf
    di._run_qpdf = lambda p, t: (True, "")
    try:
        ctx = di.inspect_document(path, ProductionProfile(id="p", **profile), Settings())
    finally:
        di._run_qpdf = original
    return run_rules(ctx, DEFAULT_RULES)


def test_mixed_rgb_and_cmyk(tmp_path):
    mixed = issues(build(tmp_path, f"1 0 0 rg {RECT} f 0 1 0 0 k {RECT} f"))
    assert "COLOR_MIXED_SPACES" in mixed
    rgb_only = issues(build(tmp_path, f"1 0 0 rg {RECT} f 0 1 0 rg {RECT} f", name="b.pdf"))
    assert "COLOR_MIXED_SPACES" not in rgb_only


def test_flattened_art_and_vector_art(tmp_path):
    photo = (bytes(3 * 16 * 16), 16, 16, pikepdf.Name.DeviceRGB)
    full = f"q {80 * MM} 0 0 {80 * MM} {10 * MM} {10 * MM} cm /Im0 Do Q"
    flat = issues(build(tmp_path, full, images={"/Im0": photo}))
    assert "ART_FLATTENED" in flat
    with_text = issues(
        build(tmp_path, full + " " + text("0 0 0 1 k", 20), name="b.pdf", images={"/Im0": photo})
    )
    assert "ART_FLATTENED" not in with_text


def test_die_line_drawn_as_an_image(tmp_path):
    mask = (bytes(16 * 2), 16, 16, "mask")
    ops = f"/Cut cs 1 scn q {20 * MM} 0 0 {20 * MM} {30 * MM} {30 * MM} cm /Mk Do Q"
    assert issues(build(tmp_path, ops, images={"/Mk": mask}))["CUT_IN_IMAGE"].severity == "critical"


def test_text_in_the_safety_margin(tmp_path):
    near = f"BT /F1 12 Tf 0 0 0 1 k {11 * MM} {50 * MM} Td (Corte) Tj ET"
    far = f"BT /F1 12 Tf 0 0 0 1 k {40 * MM} {50 * MM} Td (Centro) Tj ET"
    assert "TEXT_IN_SAFETY_MARGIN" in issues(build(tmp_path, near), minimumSafetyMarginMm=5)
    assert "TEXT_IN_SAFETY_MARGIN" not in issues(
        build(tmp_path, far, name="b.pdf"), minimumSafetyMarginMm=5
    )


def test_hidden_layers(tmp_path):
    found = issues(build(tmp_path, f"0 0 0 1 k {RECT} f", hidden="Rascunho"))
    assert "Rascunho" in found["LAYERS_HIDDEN"].found_value


def test_missing_limits_are_asked_not_guessed(tmp_path):
    found = issues(build(tmp_path, text("0 0 0 1 k")))
    assert "texto mínimo" in found["CHECK_LIMITS_MISSING"].found_value
    assert "TEXT_TOO_SMALL" not in found


@pytest.mark.parametrize("ppi_limit,expected", [(100, True), (5000, False)])
def test_excessive_resolution(tmp_path, ppi_limit, expected):
    photo = (bytes(3 * 600 * 600), 600, 600, pikepdf.Name.DeviceRGB)
    ops = f"q {20 * MM} 0 0 {20 * MM} {30 * MM} {30 * MM} cm /Im0 Do Q"
    found = issues(build(tmp_path, ops, images={"/Im0": photo}), maxImagePpi=ppi_limit)
    assert ("IMAGE_EXCESSIVE_PPI" in found) is expected
