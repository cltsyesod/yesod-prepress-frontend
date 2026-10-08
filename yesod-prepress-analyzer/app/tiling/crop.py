"""Smaller per-panel files: each image keeps only the pixels its panel shows.

A panel file normally carries the whole artwork, so a 500 MB file split in 20
panels would weigh 10 GB in the ZIP. Here, for every image drawn by the page
itself (axis-aligned, as large-format art almost always is), the pixels outside
the panel's print window are dropped and the kept block is placed exactly where
it was. Only losslessly compressed images are cropped: their pixels are copied
exactly, never resampled; colour space, /Decode, /Intent and the soft mask go
along. Everything else (JPEG, JPEG 2000, JBIG2, stencil masks, rotated images,
images inside forms) is kept whole, byte for byte. Vector content is small and
stays whole: the panel window clips it as before.
"""

from __future__ import annotations

import math
import zlib
from dataclasses import dataclass, field

import numpy as np
import pikepdf

from app.contracts.tiling import Rect
from app.tiling.export import MM, ArtFrame

_MARGIN_PX = 2  # extra pixels kept around the window (interpolation at the edge)
_KEEP_WHOLE = 0.85  # a crop keeping more than this of the image is not worth it
_LOSSLESS = {"/FlateDecode", "/LZWDecode", "/RunLengthDecode", "/ASCIIHexDecode", "/ASCII85Decode"}
_CACHE_BYTES = 800_000_000
_DEVICE_COMPONENTS = {
    "/DeviceGray": 1,
    "/DeviceRGB": 3,
    "/DeviceCMYK": 4,
    "/CalGray": 1,
    "/CalRGB": 3,
}


@dataclass
class CropStats:
    cropped: int = 0
    dropped: int = 0
    kept: int = 0
    reasons: set[str] = field(default_factory=set)


def _filters(stream: pikepdf.Object) -> list[str]:
    value = stream.get("/Filter")
    if value is None:
        return []
    return [str(v) for v in value] if isinstance(value, pikepdf.Array) else [str(value)]


def _components(space: pikepdf.Object | None) -> int | None:
    if space is None:
        return None
    if isinstance(space, pikepdf.Name):
        return _DEVICE_COMPONENTS.get(str(space))
    if isinstance(space, pikepdf.Array) and len(space) > 0:
        kind = str(space[0])
        if kind == "/ICCBased":
            return int(space[1].get("/N", 0)) or None
        if kind in ("/Indexed", "/Separation"):
            return 1
        if kind == "/DeviceN":
            return len(space[1])
        if kind == "/Lab":
            return 3
        if kind in ("/CalGray",):
            return 1
        if kind in ("/CalRGB",):
            return 3
    return None


def _multiply(m: list[float], n: list[float]) -> list[float]:
    """m × n for PDF matrices [a b c d e f] (m applied first)."""

    a, b, c, d, e, f = m
    a2, b2, c2, d2, e2, f2 = n
    return [
        a * a2 + b * c2,
        a * b2 + b * d2,
        c * a2 + d * c2,
        c * b2 + d * d2,
        e * a2 + f * c2 + e2,
        e * b2 + f * d2 + f2,
    ]


class ImageCache:
    """Decoded samples of images, shared by the panels (bounded memory)."""

    def __init__(self) -> None:
        self.cache: dict[tuple[int, int], np.ndarray] = {}
        self.size = 0

    def get(self, image: pikepdf.Object, rows: int, row_bytes: int) -> np.ndarray:
        key = image.objgen
        if key in self.cache:
            return self.cache[key]
        raw = image.read_bytes(decode_level=pikepdf.StreamDecodeLevel.all)
        if len(raw) < rows * row_bytes:
            raise ValueError("image data shorter than its size")
        data = np.frombuffer(raw, dtype=np.uint8)[: rows * row_bytes].reshape(rows, row_bytes)
        if key != (0, 0) and self.size + data.nbytes <= _CACHE_BYTES:
            self.cache[key] = data
            self.size += data.nbytes
        return data


def _crop_plan(image: pikepdf.Object) -> tuple[int, int] | str:
    """(components, bytes per sample) when the image can be cropped, else the reason not to."""

    if image.get("/ImageMask", False):
        return "máscara"
    filters = _filters(image)
    # JPEG stays whole, byte for byte: decoding it here (qpdf) and storing the pixels would
    # not match what the RIP's decoder produces (colour edges differ by tens of levels).
    if "/DCTDecode" in filters:
        return "JPEG"
    if any(f not in _LOSSLESS for f in filters):
        return "compressão JPEG 2000/JBIG2"
    components = _components(image.get("/ColorSpace"))
    if components is None:
        return "espaço de cor"
    bits = int(image.get("/BitsPerComponent", 8))
    if bits not in (8, 16):
        return "bits por componente"
    mask = image.get("/Mask")
    if isinstance(mask, pikepdf.Stream):
        return "máscara"
    return components, bits // 8


def cropped_source(
    source: pikepdf.Pdf,
    page_index: int,
    frame: ArtFrame,
    window: Rect,
    decoded: ImageCache | None = None,
    stats: CropStats | None = None,
) -> pikepdf.Pdf:
    """A one-page copy of the artwork whose images keep only what `window` (art mm) shows."""

    decoded = decoded or ImageCache()
    stats = stats if stats is not None else CropStats()
    out = pikepdf.Pdf.new()
    out.pages.append(source.pages[page_index])
    page = out.pages[0]
    to_pt = MM / frame.scale
    wx0 = frame.origin[0] + window.x * to_pt
    wy0 = frame.origin[1] + window.y * to_pt
    wx1 = wx0 + window.w * to_pt
    wy1 = wy0 + window.h * to_pt

    resources = page.obj.get("/Resources")
    xobjects = resources.get("/XObject") if resources is not None else None
    if xobjects is None:
        return out
    originals = {str(k): xobjects[k] for k in xobjects.keys()}
    source_xobjects = source.pages[page_index].obj.Resources.XObject

    ctm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    stack: list[list[float]] = []
    result: list = []
    counter = 0
    for operands, operator in pikepdf.parse_content_stream(page):
        op = str(operator)
        if op == "q":
            stack.append(ctm)
        elif op == "Q":
            ctm = stack.pop() if stack else ctm
        elif op == "cm" and len(operands) == 6:
            ctm = _multiply([float(v) for v in operands], ctm)
        elif op == "Do" and operands:
            name = str(operands[0])
            image = originals.get(name)
            if image is not None and image.get("/Subtype") == pikepdf.Name.Image:
                replaced = _crop_one(
                    out,
                    (source_xobjects.get(name), image),
                    ctm,
                    (wx0, wy0, wx1, wy1),
                    decoded,
                    stats,
                )
                if replaced == "drop":
                    continue
                if replaced is not None:
                    new_image, sub = replaced
                    counter += 1
                    new_name = pikepdf.Name(f"/YesodCrop{counter}")
                    xobjects[new_name] = new_image
                    result.append(([], pikepdf.Operator("q")))
                    result.append(([round(v, 9) for v in sub], pikepdf.Operator("cm")))
                    result.append(([new_name], pikepdf.Operator("Do")))
                    result.append(([], pikepdf.Operator("Q")))
                    continue
        result.append((operands, operator))

    page.obj.Contents = out.make_stream(pikepdf.unparse_content_stream(result))
    # Images no longer drawn are left out of the file.
    used = {str(o[0]) for o, op in result if str(op) == "Do" and o}
    for key in list(xobjects.keys()):
        if str(key) not in used and xobjects[key].get("/Subtype") == pikepdf.Name.Image:
            del xobjects[key]
    return out


def _crop_one(out, images, ctm, window, decoded: ImageCache, stats: CropStats):
    """(new image, placement matrix) for the cropped image, "drop" when nothing is visible,
    None to keep the image as it is.

    `images` is the image in the source (its pixels are decoded once for all panels) and
    its copy in `out` (whose dictionary entries belong to `out`).
    """

    image, copy = images
    if image is None:
        return None
    a, b, c, d, e, f = ctm
    if abs(b) > 1e-9 or abs(c) > 1e-9 or a <= 0 or d <= 0:
        stats.kept += 1
        stats.reasons.add("imagem girada")
        return None
    width, height = int(image.Width), int(image.Height)
    wx0, wy0, wx1, wy1 = window
    # The image fills the unit square: x = a·u + e, y = d·v + f; row 0 is the top (v = 1).
    u0, u1 = (wx0 - e) / a, (wx1 - e) / a
    v0, v1 = (wy0 - f) / d, (wy1 - f) / d
    if u1 <= 0 or u0 >= 1 or v1 <= 0 or v0 >= 1:
        stats.dropped += 1
        return "drop"
    c0 = max(0, math.floor(max(0.0, u0) * width) - _MARGIN_PX)
    c1 = min(width, math.ceil(min(1.0, u1) * width) + _MARGIN_PX)
    r0 = max(0, math.floor((1 - min(1.0, v1)) * height) - _MARGIN_PX)
    r1 = min(height, math.ceil((1 - max(0.0, v0)) * height) + _MARGIN_PX)
    if (c1 - c0) * (r1 - r0) > _KEEP_WHOLE * width * height:
        stats.kept += 1
        return None
    plan = _crop_plan(image)
    if isinstance(plan, str):
        stats.kept += 1
        stats.reasons.add(plan)
        return None
    smask = image.get("/SMask")
    if smask is not None:
        mask_plan = _crop_plan(smask)
        if (
            isinstance(mask_plan, str)
            or int(smask.Width) != width
            or int(smask.Height) != height
        ):
            stats.kept += 1
            stats.reasons.add("máscara de transparência")
            return None
    try:
        new_image = _cropped_stream(out, image, copy, plan, (c0, r0, c1, r1), decoded)
        if smask is not None:
            new_image.SMask = _cropped_stream(
                out, smask, copy.SMask, mask_plan, (c0, r0, c1, r1), decoded
            )
    except (ValueError, pikepdf.PdfError):
        stats.kept += 1
        stats.reasons.add("dados da imagem")
        return None
    stats.cropped += 1
    sub = [
        (c1 - c0) / width,
        0.0,
        0.0,
        (r1 - r0) / height,
        c0 / width,
        (height - r1) / height,
    ]
    return new_image, sub


def _cropped_stream(out, image, copy, plan, box, decoded: ImageCache) -> pikepdf.Object:
    components, sample = plan
    c0, r0, c1, r1 = box
    width, height = int(image.Width), int(image.Height)
    pixel = components * sample
    data = decoded.get(image, height, width * pixel)
    block = np.ascontiguousarray(data[r0:r1, c0 * pixel : c1 * pixel])
    stream = out.make_stream(zlib.compress(block.tobytes(), 6))
    # Colour space, /Decode, /Intent, /Interpolate… from the copy already inside `out`.
    for key, value in copy.items():
        if key in ("/Filter", "/DecodeParms", "/Width", "/Height", "/Length", "/SMask"):
            continue
        stream[key] = value
    stream.Width, stream.Height = c1 - c0, r1 - r0
    stream.Filter = pikepdf.Name.FlateDecode
    return stream
