"""Client images (TIFF, JPEG, PNG) placed in a PDF, so every other step works on PDFs.

Nothing is resampled or converted:

* JPEG goes in byte for byte (DCTDecode); CMYK JPEGs written by Adobe software are stored
  inverted, which the /Decode array accounts for, as every PDF writer does;
* TIFF and PNG pixels are copied as decoded and stored with lossless Flate compression;
* the colour space (gray, RGB, CMYK), the embedded ICC profile and the transparency (as a
  soft mask) are kept; palette images are expanded to their colours, which is lossless.

The page size comes from the resolution stored in the image. Without one, one pixel is one
point (72 ppi) and the details say so: the final size is then set by the job ticket (the
scale), like any PDF drawn at another scale.
"""

from __future__ import annotations

import zlib
from pathlib import Path

import pikepdf
from PIL import Image, ImageSequence

from app.contracts.fix import AppliedFix
from app.core.exceptions import AnalyzerError

MM = 72 / 25.4
# Pixels decoded at once; beyond this the server could run out of memory (8 GB VPS).
MAX_PIXELS = 300_000_000

_SIGNATURES = {
    b"%PDF-": "application/pdf",
    b"II*\x00": "image/tiff",
    b"MM\x00*": "image/tiff",
    b"II+\x00": "image/tiff",
    b"MM\x00+": "image/tiff",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
}


class ImageConversionError(AnalyzerError):
    code = "IMAGE_CONVERSION_FAILED"


def sniff(path: Path) -> str | None:
    """The real type of the file, from its first bytes (never from its name)."""

    with path.open("rb") as stream:
        head = stream.read(8)
    for signature, kind in _SIGNATURES.items():
        if head.startswith(signature):
            return kind
    return None


def _icc(pdf: pikepdf.Pdf, profile: bytes | None, components: int):
    if not profile:
        return None
    stream = pdf.make_stream(zlib.compress(profile, 6))
    stream.N = components
    stream.Filter = pikepdf.Name.FlateDecode
    return pikepdf.Array([pikepdf.Name.ICCBased, stream])


_DEVICE = {1: pikepdf.Name.DeviceGray, 3: pikepdf.Name.DeviceRGB, 4: pikepdf.Name.DeviceCMYK}
_MODES = {"L": 1, "RGB": 3, "CMYK": 4}


def _jpeg_image(pdf: pikepdf.Pdf, path: Path, picture: Image.Image) -> tuple[pikepdf.Object, str]:
    components = {"L": 1, "RGB": 3, "CMYK": 4}.get(picture.mode)
    if components is None:
        raise ImageConversionError(f"JPEG em modo de cor não suportado ({picture.mode})")
    image = pdf.make_stream(path.read_bytes())
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height = picture.size
    image.BitsPerComponent = 8
    image.Filter = pikepdf.Name.DCTDecode
    image.ColorSpace = _icc(pdf, picture.info.get("icc_profile"), components) or _DEVICE[components]
    if components == 4 and "adobe" in picture.info:
        image.Decode = pikepdf.Array([1, 0] * 4)
    return image, "JPEG incorporado sem recompressão"


def _raster_image(pdf: pikepdf.Pdf, picture: Image.Image) -> tuple[pikepdf.Object, str]:
    mode = picture.mode
    alpha: Image.Image | None = None
    note = "pixels copiados sem reamostragem (compressão sem perda)"
    if mode == "P":
        picture = picture.convert("RGBA" if "transparency" in picture.info else "RGB")
        mode = picture.mode
        note += "; paleta expandida para as cores"
    elif mode == "1":
        picture = picture.convert("L")
        mode = "L"
    if mode in ("LA", "RGBA", "PA"):
        alpha = picture.getchannel("A")
        picture = picture.convert("L" if mode == "LA" else "RGB")
        mode = picture.mode
        note += "; transparência mantida"
    bits = 8
    if mode in ("I;16", "I;16B", "I;16L"):
        # 16-bit gray: kept at 16 bits, big-endian as PDF expects.
        data = picture.tobytes("raw", "I;16B")
        components, bits = 1, 16
    elif mode in _MODES:
        components = _MODES[mode]
        data = picture.tobytes()
    else:
        raise ImageConversionError(
            f"modo de cor da imagem não suportado ({mode}); salve como RGB, CMYK ou tons de "
            "cinza de 8 bits"
        )
    image = pdf.make_stream(zlib.compress(data, 6))
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height = picture.size
    image.BitsPerComponent = bits
    image.Filter = pikepdf.Name.FlateDecode
    image.ColorSpace = _icc(pdf, picture.info.get("icc_profile"), components) or _DEVICE[components]
    if alpha is not None:
        mask = pdf.make_stream(zlib.compress(alpha.tobytes(), 6))
        mask.Type, mask.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
        mask.Width, mask.Height = alpha.size
        mask.ColorSpace, mask.BitsPerComponent = pikepdf.Name.DeviceGray, 8
        mask.Filter = pikepdf.Name.FlateDecode
        image.SMask = mask
    return image, note


def _source_bits(path: Path, kind: str, picture: Image.Image) -> int:
    """Bits per channel in the file (Pillow opens 16-bit colour images at 8 bits)."""

    if kind == "image/png":
        with path.open("rb") as stream:
            header = stream.read(25)
        return header[24] if len(header) == 25 else 8
    if kind == "image/tiff":
        bits = getattr(picture, "tag_v2", {}).get(258)
        if isinstance(bits, tuple | list) and bits:
            return int(max(bits))
        if isinstance(bits, int):
            return bits
    return 8


def _resolution(picture: Image.Image) -> tuple[float, float] | None:
    dpi = picture.info.get("dpi")
    if not dpi:
        return None
    try:
        x, y = float(dpi[0]), float(dpi[1])
    except (TypeError, ValueError, IndexError):
        return None
    return (x, y) if x >= 1 and y >= 1 else None


def image_to_pdf(source: Path, destination: Path) -> AppliedFix:
    kind = sniff(source)
    if kind not in ("image/tiff", "image/jpeg", "image/png"):
        raise ImageConversionError("o arquivo não é TIFF, JPEG nem PNG")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(source) as opened:
            frames = getattr(opened, "n_frames", 1)
            picture = next(ImageSequence.Iterator(opened))
            if picture.width * picture.height > MAX_PIXELS:
                raise ImageConversionError(
                    f"imagem de {picture.width} × {picture.height} px passa do limite de "
                    f"{MAX_PIXELS // 1_000_000} milhões de pixels"
                )
            resolution = _resolution(picture)
            source_bits = _source_bits(source, kind, picture)
            pdf = pikepdf.Pdf.new()
            if kind == "image/jpeg":
                image, how = _jpeg_image(pdf, source, picture)
            else:
                picture.load()
                image, how = _raster_image(pdf, picture)
    except Image.DecompressionBombError as exc:
        raise ImageConversionError(f"imagem grande demais para converter ({exc})") from None
    except (OSError, ValueError, SyntaxError) as exc:
        raise ImageConversionError(f"não foi possível ler a imagem ({exc})") from None

    px_w, px_h = int(image.Width), int(image.Height)
    ppi_x, ppi_y = resolution or (72.0, 72.0)
    width, height = px_w / ppi_x * 72, px_h / ppi_y * 72
    pdf.add_blank_page(page_size=(width, height))
    page = pdf.pages[0]
    name = page.add_resource(image, pikepdf.Name.XObject, prefix="Im")
    page.contents_add(f"q {width:.4f} 0 0 {height:.4f} 0 0 cm {name} Do Q".encode())
    # The image edge is the finished format.
    page.obj.TrimBox = pikepdf.Array([0, 0, round(width, 4), round(height, 4)])
    pdf.save(destination)

    label = {"image/tiff": "TIFF", "image/jpeg": "JPEG", "image/png": "PNG"}[kind]
    size = f"{width / MM:.1f} × {height / MM:.1f} mm"
    details = [
        f"{label} de {px_w} × {px_h} px convertido em PDF: {how}",
        (
            f"Tamanho pela resolução gravada ({ppi_x:g} ppi): {size}"
            if resolution
            else f"A imagem não tem resolução gravada: página de {size} (1 px = 1 pt). "
            "Informe o tamanho final ou a escala na ficha."
        ),
    ]
    if frames > 1:
        details.append(f"O TIFF tem {frames} páginas: só a primeira foi usada.")
    if source_bits > 8 and int(image.BitsPerComponent) == 8:
        details.append(
            f"A imagem tem {source_bits} bits por canal e foi gravada com 8 bits por canal "
            "(a profundidade que a impressão usa)."
        )
    return AppliedFix(id="image_to_pdf", label=f"{label} convertido em PDF", details=details)
