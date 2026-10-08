"""Upscaling of images below the job's minimum resolution.

The only correction that resamples pixels, and only when the operator asks for it
(always on the corrected copy; the client file is never changed). Each image is
enlarged with Lanczos until it reaches the target effective resolution at final
size, never more than `max_factor` times. Colour values are not converted: the
colour space (ICC included), /Decode and the encoding family are kept, and the soft
mask (transparency) is enlarged with the image so they stay aligned.
"""

from __future__ import annotations

import io
import logging
import math
import zlib
from dataclasses import dataclass

import pikepdf
from pikepdf import PdfImage
from PIL import Image

from app.analyzer.image_inspector import _image_placements

logger = logging.getLogger(__name__)

_MODES = {"L", "RGB", "CMYK"}
_MAX_PIXELS = 250_000_000  # per image, after upscaling


@dataclass(slots=True)
class Upscaled:
    page: int
    name: str
    before: tuple[int, int]
    after: tuple[int, int]
    ppi_before: float
    ppi_after: float


def upscale_images(
    pdf: pikepdf.Pdf, target_ppi: float, file_scale: float, max_factor: float = 4.0
) -> tuple[list[Upscaled], list[str]]:
    """Enlarges every image whose effective resolution at final size is below `target_ppi`.

    Returns what was enlarged and what was skipped (with the reason).
    """

    done: dict[tuple[int, int], Upscaled] = {}
    skipped: list[str] = []
    for number, page in enumerate(pdf.pages, start=1):
        placements = _image_placements(page)
        for name, image in page.images.items():
            uses = placements.get(str(name), [])
            width, height = int(image.get("/Width", 0) or 0), int(image.get("/Height", 0) or 0)
            if not uses or not width or not height or image.objgen in done:
                continue
            ppi = min(min(width * 72 / w, height * 72 / h) for w, h in uses) / file_scale
            if ppi + 0.5 >= target_ppi:
                continue
            factor = min(max_factor, target_ppi / ppi)
            new_w, new_h = math.ceil(width * factor), math.ceil(height * factor)
            if new_w * new_h > _MAX_PIXELS:
                shrink = math.sqrt(_MAX_PIXELS / (new_w * new_h))
                new_w, new_h = int(new_w * shrink), int(new_h * shrink)
            reason = _resample(pdf, image, (new_w, new_h))
            label = f"pág. {number} {str(name).lstrip('/')}"
            if reason:
                skipped.append(f"{label}: {reason}")
                continue
            done[image.objgen] = Upscaled(
                page=number,
                name=str(name).lstrip("/"),
                before=(width, height),
                after=(new_w, new_h),
                ppi_before=ppi,
                ppi_after=ppi * new_w / width,
            )
    return list(done.values()), skipped


def _resample(pdf: pikepdf.Pdf, image: pikepdf.Object, size: tuple[int, int]) -> str:
    """Replaces the image data in place; returns why it was skipped, or ''."""

    if image.get("/ImageMask"):
        return "máscara de 1 bit, mantida"
    if int(image.get("/BitsPerComponent", 8) or 8) != 8:
        return "profundidade diferente de 8 bits, mantida"
    filters = image.get("/Filter")
    filters = [str(f) for f in filters] if isinstance(filters, pikepdf.Array) else [str(filters)]
    if "/JPXDecode" in filters or "/JBIG2Decode" in filters:
        return "compressão JPEG 2000/JBIG2, mantida"
    try:
        source = PdfImage(image)
        if source.indexed or source.mode not in _MODES:
            return f"espaço de cor {source.colorspace or source.mode} não ampliável sem conversão"
        pil = source.as_pil_image()
        if pil.mode not in _MODES:
            return f"modo {pil.mode} não suportado"
        bigger = pil.resize(size, Image.Resampling.LANCZOS)
    except Exception as exc:  # pragma: no cover - unusual encodings
        logger.debug("image could not be decoded", exc_info=True)
        return f"não foi possível ler a imagem ({exc.__class__.__name__})"

    if filters == ["/DCTDecode"]:
        # Same family as the original: a JPEG stays a JPEG (raw values, same /Decode).
        buffer = io.BytesIO()
        bigger.save(buffer, format="JPEG", quality=95, subsampling=0)
        image.write(buffer.getvalue(), filter=pikepdf.Name.DCTDecode)
    else:
        image.write(zlib.compress(bigger.tobytes(), 6), filter=pikepdf.Name.FlateDecode)
    if "/DecodeParms" in image:
        del image["/DecodeParms"]
    image.Width, image.Height = size

    mask = image.get("/SMask")
    if mask is not None:
        try:
            alpha = PdfImage(mask).as_pil_image().convert("L")
            alpha = alpha.resize(size, Image.Resampling.LANCZOS)
            mask.write(zlib.compress(alpha.tobytes(), 6), filter=pikepdf.Name.FlateDecode)
            if "/DecodeParms" in mask:
                del mask["/DecodeParms"]
            mask.Width, mask.Height = size
        except Exception:  # pragma: no cover
            logger.debug("soft mask could not be resized", exc_info=True)
    return ""
