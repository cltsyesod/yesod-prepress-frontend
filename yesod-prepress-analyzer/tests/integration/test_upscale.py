import io
import zlib
from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2
import pytest
from PIL import Image

from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes

MM = 72 / 25.4


def _gradient(mode: str, size=(40, 30)) -> Image.Image:
    w, h = size
    x = np.linspace(30, 220, w, dtype=np.uint8)[None, :].repeat(h, 0)
    y = np.linspace(200, 40, h, dtype=np.uint8)[:, None].repeat(w, 1)
    if mode == "L":
        return Image.fromarray(x)
    if mode == "RGB":
        return Image.fromarray(np.dstack([x, y, 255 - x]))
    return Image.fromarray(np.dstack([x, y, 255 - x, y // 3]), mode="CMYK")


def image_pdf(path: Path, mode: str, encoding: str, with_mask: bool = False) -> Path:
    """A 40x30 px image placed at 100x75 mm (about 10 ppi)."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(120 * MM, 95 * MM))
    picture = _gradient(mode)
    space = {"L": "/DeviceGray", "RGB": "/DeviceRGB", "CMYK": "/DeviceCMYK"}[mode]
    if encoding == "jpeg":
        buffer = io.BytesIO()
        picture.save(buffer, format="JPEG", quality=95)
        data, filt = buffer.getvalue(), pikepdf.Name.DCTDecode
    else:
        data, filt = zlib.compress(picture.tobytes()), pikepdf.Name.FlateDecode
    image = pdf.make_stream(data)
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height = picture.size
    image.ColorSpace, image.BitsPerComponent, image.Filter = pikepdf.Name(space), 8, filt
    if mode == "CMYK" and encoding == "jpeg":
        # How Photoshop-style (Adobe) CMYK JPEGs are usually tagged in PDFs.
        image.Decode = pikepdf.Array([1, 0, 1, 0, 1, 0, 1, 0])
    if with_mask:
        alpha = Image.new("L", picture.size, 0)
        alpha.paste(255, (5, 5, 35, 25))
        mask = pdf.make_stream(zlib.compress(alpha.tobytes()))
        mask.Type, mask.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
        mask.Width, mask.Height = alpha.size
        mask.ColorSpace, mask.BitsPerComponent = pikepdf.Name.DeviceGray, 8
        mask.Filter = pikepdf.Name.FlateDecode
        image.SMask = mask
    page = pdf.pages[0]
    page.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=image))
    place = f"{100 * MM:.2f} 0 0 {75 * MM:.2f} {10 * MM:.2f} {10 * MM:.2f} cm"
    page.contents_add(f"q {place} /Im0 Do Q".encode())
    pdf.save(path)
    return path


def _render(path: Path) -> np.ndarray:
    document = pypdfium2.PdfDocument(str(path))
    try:
        return np.asarray(document[0].render(scale=1).to_pil().convert("RGB"), dtype=float)
    finally:
        document.close()


@pytest.mark.parametrize(
    "mode,encoding,mask",
    [
        ("RGB", "flate", False),
        ("RGB", "jpeg", False),
        ("L", "flate", False),
        ("CMYK", "flate", False),
        ("CMYK", "jpeg", False),
        ("RGB", "flate", True),
    ],
)
def test_upscaling_keeps_colours_and_reaches_the_target(tmp_path, mode, encoding, mask):
    source = image_pdf(tmp_path / "in.pdf", mode, encoding, mask)
    out = tmp_path / "out.pdf"
    [applied] = apply_fixes(
        source,
        out,
        [FixRequest(id="upscale_images", params={"targetPpi": 30})],
        ProductionProfile(id="p"),
    )
    assert "40×30 → 119×89 px" in applied.details[0], applied.details

    with pikepdf.open(out) as pdf:
        image = next(iter(pdf.pages[0].images.values()))
        assert (int(image.Width), int(image.Height)) == (119, 89)
        if mask:
            assert (int(image.SMask.Width), int(image.SMask.Height)) == (119, 89)

    before, after = _render(source), _render(out)
    # Same picture, only smoother: the average colour barely moves.
    assert np.abs(before.mean(axis=(0, 1)) - after.mean(axis=(0, 1))).max() < 4


def test_images_already_sharp_enough_are_left_alone(tmp_path):
    source = image_pdf(tmp_path / "in.pdf", "RGB", "flate")
    out = tmp_path / "out.pdf"
    [applied] = apply_fixes(
        source,
        out,
        [FixRequest(id="upscale_images", params={"targetPpi": 5})],
        ProductionProfile(id="p"),
    )
    assert applied.details == []
