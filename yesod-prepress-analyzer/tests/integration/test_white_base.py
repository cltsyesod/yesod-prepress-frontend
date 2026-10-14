"""Base branca: medida em pixels no próprio arquivo gerado (sem imprimir)."""

import zlib

import numpy as np
import pikepdf
import pytest

from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import FixError, apply_fixes
from app.fixes.white import offset_mask
from app.rules.textile_rules import TextileWhiteBaseRule
from tests.integration.test_textile import context, pdf, rect

PX_PER_MM = 10  # 254 ppi
MM_PT = 72 / 25.4


def profile(**textile) -> ProductionProfile:
    base = {"whiteSpotName": "White", "alphaThreshold": 50, "whiteDensity": 80}
    return ProductionProfile(
        id="p", technology="dtf", minimumResolutionDpi=254, textile={**base, **textile}
    )


def white_of(path):
    with pikepdf.open(path) as doc:
        page = doc.pages[0]
        image = page.Resources.XObject["/YesodWhiteIm"]
        w, h = int(image.Width), int(image.Height)
        bits = np.unpackbits(
            np.frombuffer(zlib.decompress(image.read_raw_bytes()), np.uint8).reshape(h, -1), axis=1
        )[:, :w].astype(bool)
        space = page.Resources.ColorSpace["/YesodWhiteCS"]
        state = page.Resources.ExtGState["/YesodWhiteGS"]
        layers = [str(g.Name) for g in doc.Root.OCProperties.OCGs]
        page.contents_coalesce()
        return bits, str(space[1]), bool(state.OP), layers, page.Contents.read_bytes()


def span_mm(bits):
    cols = np.flatnonzero(bits.any(axis=0))
    rows = np.flatnonzero(bits.any(axis=1))
    return (cols[-1] - cols[0] + 1) / PX_PER_MM, (rows[-1] - rows[0] + 1) / PX_PER_MM


def run(tmp_path, prof, ops=None):
    src = pdf(tmp_path / "a.pdf", ops or rect(10, 10, 50, 30))
    out = tmp_path / "out.pdf"
    applied = apply_fixes(src, out, [FixRequest(id="add_white_underbase")], prof)
    return out, applied


@pytest.mark.parametrize(
    ("textile", "expected"),
    [({}, (50, 30)), ({"chokeMm": 0.5}, (49, 29)), ({"spreadMm": 1}, (52, 32))],
)
def test_choke_and_spread_are_exact_in_mm(tmp_path, textile, expected):
    out, applied = run(tmp_path, profile(**textile))
    bits, name, overprint, layers, _ = white_of(out)
    w, h = span_mm(bits)
    # Precisão: 1 pixel da resolução do trabalho (aqui 0,1 mm).
    tol = 1 / PX_PER_MM + 1e-6
    assert abs(w - expected[0]) <= tol and abs(h - expected[1]) <= tol, (w, h)
    assert name == "/White" and overprint and layers == ["Branco (White)"]
    assert "White" in applied[0].label


def test_art_is_untouched_and_white_goes_on_top(tmp_path):
    out, _ = run(tmp_path, profile())
    *_, contents = white_of(out)
    art = rect(10, 10, 50, 30).strip().encode()
    assert art in contents and contents.index(art) < contents.index(b"/YesodWhiteIm Do")


def test_no_white_below_the_opacity_threshold(tmp_path):
    ops = rect(10, 10, 20, 20) + "/GS1 gs " + rect(40, 10, 20, 20)
    src = pdf(tmp_path / "a.pdf", ops, extgstate={"/ca": 0.3})
    # O gs vale até o fim: só o primeiro quadrado (opaco) recebe branco.
    out = tmp_path / "o.pdf"
    apply_fixes(src, out, [FixRequest(id="add_white_underbase")], profile())
    w, _ = span_mm(white_of(out)[0])
    assert abs(w - 20) <= 1 / PX_PER_MM + 1e-6


def test_choke_follows_curves_as_a_disk():
    yy, xx = np.mgrid[:201, :201]
    disk = (yy - 100) ** 2 + (xx - 100) ** 2 <= 80**2
    choked = offset_mask(disk, -10)
    expected = (yy - 100) ** 2 + (xx - 100) ** 2 <= 70**2
    assert (choked ^ expected).sum() < 0.01 * expected.sum()


def test_missing_profile_values_stop_the_fix(tmp_path):
    prof = ProductionProfile(id="p", technology="dtf", textile={"whiteSpotName": "White"})
    with pytest.raises(FixError, match="opacidade mínima"):
        run(tmp_path, prof)


def test_rule_offers_the_fix_only_when_it_can_run(tmp_path):
    path = pdf(tmp_path / "a.pdf", rect(10, 10, 20, 20))
    ok = TextileWhiteBaseRule().evaluate(context(path, profile(whiteMode="generate")))
    assert ok[0].fix["id"] == "add_white_underbase"
    lacking = ProductionProfile(id="p", technology="dtf", textile={"whiteMode": "generate"})
    assert TextileWhiteBaseRule().evaluate(context(path, lacking))[0].fix is None
    from_file = TextileWhiteBaseRule().evaluate(context(path, profile(whiteMode="from_file")))
    assert from_file[0].severity == "critical"
    assert TextileWhiteBaseRule().evaluate(context(path, profile(whiteMode="rip"))) == []


def test_art_stays_visible_and_inspection_carries_the_plate(tmp_path):
    import io
    import json

    import pypdfium2 as pdfium
    from PIL import Image

    from app.analyzer.inspection import build_inspection

    out, _ = run(tmp_path, profile(chokeMm=1))
    # Multiplicar: num visualizador comum a arte continua aparecendo (não fica branca).
    doc = pdfium.PdfDocument(str(out))
    # Arte amarela: o canal azul cai onde há tinta.
    gray = np.asarray(doc[0].render(scale=1).to_pil().convert("RGB"))[:, :, 2]
    doc.close()
    assert gray.min() < 100
    insp = tmp_path / "insp.pdf"
    build_inspection(out, insp, ["CutContour"])
    with pikepdf.open(insp) as doc:
        manifest = json.loads(doc.attachments["objects.json"].get_file().read_bytes())
        entry = manifest["white"][0]
        png = doc.attachments[entry["file"]].get_file().read_bytes()
    alpha = np.asarray(Image.open(io.BytesIO(png)))[:, :, 3] > 0
    cols = np.flatnonzero(alpha.any(axis=0))
    scale = alpha.shape[1] / 100  # página de 100 mm
    assert abs((cols[-1] - cols[0] + 1) / scale - 48) <= 1 / scale + 0.11


def test_die_line_in_the_art_gets_no_white(tmp_path):
    # Arte 50 × 30 mm e uma faca CutContour 70 × 50 mm em volta (traço de 0,5 pt).
    doc = pikepdf.Pdf.new()
    doc.add_blank_page(page_size=(100 * MM_PT, 100 * MM_PT))
    page = doc.pages[0]
    tint = pikepdf.Dictionary(FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=[0, 1, 0, 0], N=1)
    page.obj.Resources = pikepdf.Dictionary(
        ColorSpace=pikepdf.Dictionary(
            CS0=pikepdf.Array(
                [pikepdf.Name.Separation, pikepdf.Name("/CutContour"), pikepdf.Name.DeviceCMYK,
                 tint]
            )
        )
    )
    x, w, h = 15 * MM_PT, 70 * MM_PT, 50 * MM_PT
    die = f"q /CS0 CS 1 SCN 0.5 w {x:.3f} {x:.3f} {w:.3f} {h:.3f} re S Q\n"
    page.contents_add((rect(25, 25, 50, 30) + die).encode())
    src = tmp_path / "faca.pdf"
    doc.save(src)
    out = tmp_path / "o.pdf"
    applied = apply_fixes(src, out, [FixRequest(id="add_white_underbase")], profile())
    w, h = span_mm(white_of(out)[0])
    assert abs(w - 50) <= 1 / PX_PER_MM + 1e-6 and abs(h - 30) <= 1 / PX_PER_MM + 1e-6, (w, h)
    assert "faca" in applied[0].details[0]


def dtg(**textile):
    base = {
        "whiteSpotName": "White",
        "alphaThreshold": 50,
        "whiteDensity": 80,
        "whiteMode": "generate",
    }
    return ProductionProfile(
        id="g", technology="dtg", minimumResolutionDpi=254, textile={**base, **textile}
    )




def two_squares(tmp_path):
    # Quadrado preto (20 mm) à esquerda e amarelo (20 mm) à direita.
    x, s = 10 * MM_PT, 20 * MM_PT
    ops = f"0 0 0 1 k {x} {x} {s} {s} re f\n" + rect(50, 10, 20, 20)
    return pdf(tmp_path / "q.pdf", ops)


def white_cols(tmp_path, prof):
    out = tmp_path / "o.pdf"
    apply_fixes(two_squares(tmp_path), out, [FixRequest(id="add_white_underbase")], prof)
    bits = white_of(out)[0]
    return np.flatnonzero(bits.any(axis=0)) / PX_PER_MM


def test_dark_garment_full_or_without_black(tmp_path):
    full = white_cols(tmp_path, dtg(garmentColor="#111111", whiteDark="full"))
    assert full.min() < 15 and full.max() > 65  # branco sob os dois quadrados
    no_black = white_cols(
        tmp_path, dtg(garmentColor="#111111", whiteDark="no_black", blackThreshold=20)
    )
    assert no_black.min() > 45  # o preto ficou sem branco: o tecido faz o preto


def test_light_garment_only_light_colors_or_none(tmp_path):
    light = white_cols(
        tmp_path, dtg(garmentColor="#f5f5f5", whiteLight="light_colors", lightThreshold=70)
    )
    assert light.min() > 45  # só o amarelo (claro) recebe branco
    prof = dtg(garmentColor="#f5f5f5", whiteLight="none")
    with pytest.raises(FixError, match="sem branco"):
        fix = [FixRequest(id="add_white_underbase")]
        apply_fixes(two_squares(tmp_path), tmp_path / "x.pdf", fix, prof)
    issue = TextileWhiteBaseRule().evaluate(context(two_squares(tmp_path), prof))[0]
    assert issue.fix is None and "Peça clara" in issue.title


def test_strategy_must_be_chosen_for_the_garment(tmp_path):
    prof = dtg(garmentColor="#111111")
    issue = TextileWhiteBaseRule().evaluate(context(two_squares(tmp_path), prof))[0]
    assert issue.fix is None and "peça escura" in issue.found_value
