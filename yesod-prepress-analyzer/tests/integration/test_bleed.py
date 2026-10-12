from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2 as pdfium

from app.analyzer.page_inspector import bleed_margins_mm, inspect_pages
from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes

MM = 72 / 25.4
DPI = 72 * 4  # 4 px per pt: 0.088 mm per pixel


def banner(path: Path) -> Path:
    """106 × 56 mm with 0.5 mm of bleed: cyan left half, yellow right half, and a
    black stripe 1–2 mm inside the left trim edge."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(107 * MM, 57 * MM))
    page = pdf.pages[0]
    page.obj.TrimBox = pikepdf.Array([0.5 * MM, 0.5 * MM, 106.5 * MM, 56.5 * MM])
    page.obj.BleedBox = pikepdf.Array([0, 0, 107 * MM, 57 * MM])
    page.contents_add(
        (
            f"1 0 0 0 k 0 0 {53.5 * MM:.3f} {57 * MM:.3f} re f "
            f"0 0 1 0 k {53.5 * MM:.3f} 0 {53.5 * MM:.3f} {57 * MM:.3f} re f "
            f"0 0 0 1 k {1.5 * MM:.3f} 0 {1 * MM:.3f} {57 * MM:.3f} re f"
        ).encode()
    )
    pdf.save(path)
    return path


def render(path: Path) -> tuple[np.ndarray, tuple[float, float]]:
    """Pixels of the whole page and its lower-left corner (pt)."""

    doc = pdfium.PdfDocument(str(path))
    page = doc[0]
    image = np.asarray(page.render(scale=DPI / 72).to_pil().convert("RGB")).astype(int)
    left, bottom, _, _ = page.get_mediabox()
    doc.close()
    return image, (left, bottom)


def pixel(image: np.ndarray, origin: tuple[float, float], x_mm: float, y_mm: float) -> np.ndarray:
    """Colour at a point given in mm from the trim's lower-left corner (trim at 0.5 mm)."""

    x_pt, y_pt = (x_mm + 0.5) * MM - origin[0], (y_mm + 0.5) * MM - origin[1]
    return image[image.shape[0] - 1 - int(y_pt * DPI / 72), int(x_pt * DPI / 72)]



def near(color: np.ndarray, expected: np.ndarray) -> bool:
    return bool(np.abs(color - expected).max() < 30)


def colours(image: np.ndarray, origin: tuple[float, float]) -> tuple[np.ndarray, ...]:
    """Cyan, yellow and black as rendered, sampled inside the trim."""

    return pixel(image, origin, 20, 28), pixel(image, origin, 80, 28), pixel(image, origin, 1.5, 28)


def fixed(tmp_path: Path, method: str) -> Path:
    source = banner(tmp_path / "in.pdf")
    out = tmp_path / f"{method}.pdf"
    [applied] = apply_fixes(
        source,
        out,
        [FixRequest(id="add_bleed", params={"method": method, "bleedMm": 5})],
        ProductionProfile(id="p", minimum_bleed_mm=5),
    )
    assert "5 mm de sangria" in applied.details[0]
    return out


def test_stretch_continues_the_edge_and_keeps_the_trim(tmp_path):
    out = fixed(tmp_path, "stretch")
    with pikepdf.open(out) as pdf:
        [info] = inspect_pages(pdf, [])
        margins = bleed_margins_mm(info.trim_box, info.bleed_box)
        assert all(abs(m - 5) < 0.01 for m in margins)
        assert info.media_box[2] - info.media_box[0] > 115 * MM

    image, origin = render(out)
    CYAN, YELLOW, _ = colours(image, origin)
    # Outside the trim: the edge colour continues (the black stripe is not copied).
    assert near(pixel(image, origin, -4, 28), CYAN)
    assert near(pixel(image, origin, 110, 28), YELLOW)
    assert near(pixel(image, origin, 20, -4), CYAN)
    assert near(pixel(image, origin, -4, -4), CYAN)  # corner
    # Inside the trim nothing changed.
    before, before_origin = render(tmp_path / "in.pdf")
    for x, y in ((1.5, 10), (20, 28), (80, 50), (105.5, 0.5)):
        assert np.array_equal(pixel(image, origin, x, y), pixel(before, before_origin, x, y))


def test_mirror_reflects_the_artwork_across_the_edge(tmp_path):
    out = fixed(tmp_path, "mirror")
    image, origin = render(out)
    CYAN, YELLOW, BLACK = colours(image, origin)
    # The stripe 1–2 mm inside the edge appears 1–2 mm outside it (measured from the
    # old bleed edge at −0.5 mm: stripe at 1–2 mm → reflected at −3…−2 mm).
    assert near(pixel(image, origin, -2.5, 28), BLACK)
    assert near(pixel(image, origin, -4.5, 28), CYAN)
    assert near(pixel(image, origin, 110, 28), YELLOW)


def test_skips_pages_that_already_have_the_bleed(tmp_path):
    source = banner(tmp_path / "in.pdf")
    [applied] = apply_fixes(
        source,
        tmp_path / "out.pdf",
        [FixRequest(id="add_bleed", params={"bleedMm": 0.5})],
        ProductionProfile(id="p", minimum_bleed_mm=0.5),
    )
    assert "já tinha" in applied.details[0]
