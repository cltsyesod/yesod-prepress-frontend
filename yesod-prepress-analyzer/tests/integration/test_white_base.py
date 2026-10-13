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
