"""Virtual print: the exported panels, cut at their print window and laid side by side,
must be the original artwork, pixel for pixel, at final size.

This is what a physical test would show (position, scale, overlaps, bleed), measured
on the real export instead of on paper.
"""

import random
from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2 as pdfium

from app.contracts.tiling import TilingRequest
from app.tiling.package import build_package

MM = 72 / 25.4
PX_PER_MM = 0.4  # render at final size: 3000 mm -> 1200 px
SCALE = 10  # the art is drawn at 1:10
BLEED = 5  # mm, final size


def art_pdf(path: Path) -> Path:
    """3000 x 1500 mm at 1:10 with 5 mm of bleed: a grid of random colour blocks, so every
    region of the art is unique and any shift or wrong scale shows up."""

    rng = random.Random(7)
    pdf = pikepdf.Pdf.new()
    bleed = BLEED / SCALE * MM
    w, h = 300 * MM, 150 * MM
    pdf.add_blank_page(page_size=(w + 2 * bleed, h + 2 * bleed))
    page = pdf.pages[0]
    page.obj.TrimBox = [bleed, bleed, bleed + w, bleed + h]
    page.obj.BleedBox = [0, 0, w + 2 * bleed, h + 2 * bleed]
    cols, rows = 30, 15
    cw, ch = (w + 2 * bleed) / cols, (h + 2 * bleed) / rows
    ops = []
    for r in range(rows):
        for c in range(cols):
            cmyk = [rng.choice((0, 0.3, 0.6, 1)) for _ in range(3)] + [0]
            ops.append(
                f"{' '.join(map(str, cmyk))} k {c * cw:.3f} {r * ch:.3f} {cw:.3f} {ch:.3f} re f"
            )
    page.contents_add("\n".join(ops).encode())
    pdf.save(path)
    return path


def request() -> TilingRequest:
    """2 rows x 3 columns, 30 mm overlaps, 5 mm outer bleed (as the screen computes them)."""

    tiles, number = [], 0
    xs, ys, overlap = [0, 1000, 2000, 3000], [0, 750, 1500], 30
    for row in range(2):
        for col in range(3):
            number += 1
            x0, x1, y0, y1 = xs[col], xs[col + 1], ys[row], ys[row + 1]
            left = overlap if col else BLEED
            right = BLEED if col == 2 else 0
            bottom = overlap if row else BLEED
            top = BLEED if row == 1 else 0
            tiles.append(
                {
                    "number": number,
                    "name": f"L{row + 1}C{col + 1}",
                    "column": col + 1,
                    "row": row + 1,
                    "visible": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},
                    "printed": {
                        "x": x0 - left,
                        "y": y0 - bottom,
                        "w": x1 - x0 + left + right,
                        "h": y1 - y0 + bottom + top,
                    },
                }
            )
    return TilingRequest.model_validate(
        {
            "tilingId": "virtual",
            "callbackUrl": "https://example.com/cb",
            "outputs": {
                "pdf": "https://e.com/a",
                "zip": "https://e.com/b",
                "guide": "https://e.com/c",
            },
            "title": "Impressão virtual",
            "source": {"url": "https://example.com/art.pdf"},
            "fileScale": f"1:{SCALE}",
            "tiles": tiles,
            "seams": [],
            "config": {"overlapMm": overlap},
        }
    )


def render(path: Path, index: int, px_per_pt: float) -> np.ndarray:
    doc = pdfium.PdfDocument(str(path))
    image = np.asarray(doc[index].render(scale=px_per_pt).to_pil().convert("RGB")).astype(int)
    doc.close()
    return image


def test_panels_rebuild_the_artwork_exactly(tmp_path):
    source = art_pdf(tmp_path / "art.pdf")
    req = request()
    out = build_package(req, source, tmp_path, None)

    # Reference: the original art at final size (1 file pt = SCALE final pt).
    reference = render(source, 0, PX_PER_MM * SCALE / MM)
    ref_h = reference.shape[0]

    def ref_crop(x_mm: float, y_mm: float, w_mm: float, h_mm: float) -> np.ndarray:
        # Poster origin = lower-left of the TrimBox; the reference starts BLEED mm before it.
        left = round((x_mm + BLEED) * PX_PER_MM)
        top = ref_h - round((y_mm + h_mm + BLEED) * PX_PER_MM)
        return reference[top : top + round(h_mm * PX_PER_MM), left : left + round(w_mm * PX_PER_MM)]

    with pikepdf.open(out.pdf) as pdf:
        boxes = [[float(v) for v in page.BleedBox] for page in pdf.pages]
        heights = [float(page.MediaBox[3]) - float(page.MediaBox[1]) for page in pdf.pages]
    assert len(boxes) == len(req.tiles) == 6

    worst = 0.0
    for index, tile in enumerate(req.tiles):
        panel = render(out.pdf, index, PX_PER_MM / MM)
        x0, y0, x1, y1 = boxes[index]
        # Page is at final size: the BleedBox is the print window, in points.
        left, top = round(x0 / MM * PX_PER_MM), round((heights[index] - y1) / MM * PX_PER_MM)
        w, h = round((x1 - x0) / MM * PX_PER_MM), round((y1 - y0) / MM * PX_PER_MM)
        window = panel[top : top + h, left : left + w]
        printed = tile.printed
        expected = ref_crop(printed.x, printed.y, printed.w, printed.h)
        assert window.shape == expected.shape, (tile.name, window.shape, expected.shape)
        # Same picture, apart from anti-aliasing on block edges (< 2% of the pixels).
        differs = np.abs(window - expected).max(axis=2) > 40
        share = differs.mean()
        worst = max(worst, share)
        assert share < 0.02, f"{tile.name}: {share:.1%} of the print window differs from the art"
    assert worst < 0.02
