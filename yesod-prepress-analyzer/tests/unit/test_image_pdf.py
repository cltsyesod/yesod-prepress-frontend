import io
import zlib
from pathlib import Path

import numpy as np
import pikepdf
import pytest
from PIL import Image, ImageCms

from app.contracts.fix import FixRequest
from app.contracts.job_request import JobRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes
from app.fixes.image_pdf import ImageConversionError, image_to_pdf, sniff

MM = 72 / 25.4


def _image(pdf_path: Path) -> pikepdf.Object:
    pdf = pikepdf.open(pdf_path)
    xobjects = pdf.pages[0].Resources.XObject
    return pdf, xobjects[list(xobjects.keys())[0]]


def test_tiff_cmyk_keeps_pixels_icc_and_physical_size(tmp_path):
    pixels = np.random.default_rng(1).integers(0, 255, (60, 80, 4), dtype=np.uint8)
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    source = tmp_path / "arte.tif"
    Image.fromarray(pixels, "CMYK").save(
        source, dpi=(100, 100), icc_profile=profile, compression="tiff_lzw"
    )
    assert sniff(source) == "image/tiff"

    applied = image_to_pdf(source, tmp_path / "arte.pdf")
    pdf, image = _image(tmp_path / "arte.pdf")
    with pdf:
        # Pixels identical (lossless), colour space kept as an embedded ICC profile.
        data = np.frombuffer(zlib.decompress(image.read_raw_bytes()), np.uint8).reshape(60, 80, 4)
        assert np.array_equal(data, pixels)
        assert str(image.ColorSpace[0]) == "/ICCBased"
        # 80 px at 100 ppi = 0.8 in = 20.32 mm.
        width_mm = float(pdf.pages[0].MediaBox[2]) / MM
        assert abs(width_mm - 20.32) < 0.01
        assert [float(v) for v in pdf.pages[0].TrimBox] == [float(v) for v in pdf.pages[0].MediaBox]
    assert "100 ppi" in applied.details[1]


def test_jpeg_goes_in_byte_for_byte_with_adobe_cmyk_inverted(tmp_path):
    source = tmp_path / "foto.jpg"
    Image.new("CMYK", (40, 30), (10, 20, 30, 40)).save(source, quality=95, dpi=(150, 150))
    image_to_pdf(source, tmp_path / "foto.pdf")
    pdf, image = _image(tmp_path / "foto.pdf")
    with pdf:
        assert image.read_raw_bytes() == source.read_bytes()
        assert str(image.Filter) == "/DCTDecode"
        assert str(image.ColorSpace) == "/DeviceCMYK"
        # Pillow writes Adobe CMYK JPEGs (inverted), so the PDF declares the inversion.
        assert [int(v) for v in image.Decode] == [1, 0] * 4


def test_png_with_transparency_becomes_a_soft_mask(tmp_path):
    source = tmp_path / "logo.png"
    picture = Image.new("RGBA", (20, 10), (255, 0, 0, 255))
    picture.putpixel((0, 0), (0, 0, 0, 0))
    picture.save(source)
    applied = image_to_pdf(source, tmp_path / "logo.pdf")
    pdf, image = _image(tmp_path / "logo.pdf")
    with pdf:
        mask = zlib.decompress(image.SMask.read_raw_bytes())
        assert mask[0] == 0 and mask[1] == 255
    # No resolution stored: 1 px = 1 pt, and the operator is told.
    assert "não tem resolução gravada" in applied.details[1]


def test_16_bit_colour_is_reported(tmp_path):
    source = tmp_path / "16bits.png"
    # A 16-bit RGB PNG written by hand (Pillow cannot write one).
    raw = b"".join(b"\x00" + b"\x12\x34" * 3 * 4 for _ in range(3))
    def chunk(kind, data):
        crc = zlib.crc32(kind + data).to_bytes(4, "big")
        return len(data).to_bytes(4, "big") + kind + data + crc

    ihdr = (4).to_bytes(4, "big") + (3).to_bytes(4, "big") + bytes([16, 2, 0, 0, 0])
    chunks = chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    source.write_bytes(b"\x89PNG\r\n\x1a\n" + chunks)
    applied = image_to_pdf(source, tmp_path / "16bits.pdf")
    assert any("16 bits por canal" in d for d in applied.details)


def test_not_an_image_is_refused(tmp_path):
    source = tmp_path / "falso.tif"
    source.write_bytes(b"isto nao e uma imagem")
    with pytest.raises(ImageConversionError):
        image_to_pdf(source, tmp_path / "x.pdf")


def test_image_then_other_fixes_in_one_run(tmp_path):
    source = tmp_path / "arte.png"
    Image.new("RGB", (100, 50), (0, 120, 200)).save(source, dpi=(25.4, 25.4))
    applied = apply_fixes(
        source,
        tmp_path / "corrigido.pdf",
        [FixRequest(id="image_to_pdf"), FixRequest(id="add_cut_contour")],
        ProductionProfile.model_validate({"id": "p"}),
    )
    assert [fix.id for fix in applied] == ["image_to_pdf", "add_cut_contour"]
    with pikepdf.open(tmp_path / "corrigido.pdf") as pdf:
        # 100 px at 25.4 ppi = 100 mm.
        assert abs(float(pdf.pages[0].MediaBox[2]) / MM - 100) < 0.01


def _job(mime: str, fixes: list[dict]) -> dict:
    return {
        "analysisId": "a",
        "projectId": "p",
        "fileId": "f",
        "productionProfile": {"id": "p"},
        "callbackUrl": "https://example.com/cb",
        "file": {"url": "https://example.com/f", "expectedMimeType": mime},
        "fixes": fixes,
        "outputUploadUrl": "https://example.com/up",
    }


def test_an_image_job_must_ask_for_the_conversion():
    assert JobRequest.model_validate(_job("image/tiff", [{"id": "image_to_pdf"}])).file.is_image
    with pytest.raises(ValueError, match="image_to_pdf"):
        JobRequest.model_validate(_job("image/png", []))
    with pytest.raises(ValueError):
        JobRequest.model_validate(_job("image/gif", [{"id": "image_to_pdf"}]))


def test_sniff_reads_the_content_not_the_name(tmp_path):
    png = tmp_path / "na-verdade-png.tif"
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buffer, format="PNG")
    png.write_bytes(buffer.getvalue())
    assert sniff(png) == "image/png"
