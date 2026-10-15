"""Inspection file: the structure of the PDF for the operator to look at, never to print.

One PDF with, for every page, four *plates* (only images, only text, only vectors,
only the die line) and, attached to it as ``objects.json``, the map of the objects
on each page: kind, box in points, layer and what matters for pre-press (pixels and
effective resolution, font and whether it is embedded, fill and stroke colour).

The plates are the page itself with the other kinds switched off in the content
stream (paths ended without painting, images not drawn, text made invisible), so
each one lines up exactly with the page. Images are reduced to screen resolution:
the file is only for viewing.
"""

from __future__ import annotations

import ctypes
import io
import json
import logging
import math
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium
import pypdfium2.raw as raw
from PIL import Image

from app.analyzer.ink_coverage import output_proof
from app.fixes.white import white_plate_png

logger = logging.getLogger(__name__)

PLATES = ("images", "text", "vectors", "cut", "color", "white")
MAX_OBJECTS_PER_PAGE = 3000
_PREVIEW_PIXELS = 1600 * 1600
_PAINT = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*"}
_KIND = {
    raw.FPDF_PAGEOBJ_TEXT: "text",
    raw.FPDF_PAGEOBJ_PATH: "path",
    raw.FPDF_PAGEOBJ_IMAGE: "image",
    raw.FPDF_PAGEOBJ_SHADING: "shading",
}
_COLORSPACES = {
    1: "Gray",
    2: "RGB",
    3: "CMYK",
    4: "CalGray",
    5: "CalRGB",
    6: "Lab",
    7: "ICC",
    8: "Separation",
    9: "DeviceN",
    10: "Indexed",
    11: "Pattern",
}

Matrix = tuple[float, float, float, float, float, float]
_IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _compose(inner: Matrix, outer: Matrix) -> Matrix:
    """Point in `inner`'s space → page space through `outer` (applied after)."""

    a, b, c, d, e, f = inner
    A, B, C, D, E, F = outer
    return (
        a * A + b * C,
        a * B + b * D,
        c * A + d * C,
        c * B + d * D,
        e * A + f * C + E,
        e * B + f * D + F,
    )


def _transform_box(box, m: Matrix) -> list[float]:
    x0, y0, x1, y1 = box
    a, b, c, d, e, f = m
    xs, ys = [], []
    for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        xs.append(a * x + c * y + e)
        ys.append(b * x + d * y + f)
    return [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]


def _is_white(name: str) -> bool:
    """Cor especial da base branca (DTF/DTG): White, Branco, W1…"""

    key = name.casefold()
    return key in {"w", "w1", "wht"} or key.startswith(("white", "branco"))


def _is_cut(name: str | None, cut_names: list[str]) -> bool:
    if not name:
        return False
    key = name.casefold()
    return any(cut.casefold() in key for cut in cut_names) or any(
        word in key for word in ("cut", "corte", "faca", "contour", "kiss")
    )


# --- object map (pdfium) ------------------------------------------------------------


def _wide(fn, *args) -> str:
    out = ctypes.c_ulong()
    buf = (ctypes.c_ushort * 256)()
    if not fn(*args, buf, 512, ctypes.byref(out)):
        return ""
    return bytes(buf)[: out.value].decode("utf-16-le", "ignore").rstrip("\0")


def _layer(handle) -> str | None:
    """Name of the optional-content group (layer) the object is marked with."""

    for index in range(raw.FPDFPageObj_CountMarks(handle)):
        mark = raw.FPDFPageObj_GetMark(handle, index)
        if _wide(raw.FPDFPageObjMark_GetName, mark) != "OC":
            continue
        name = _wide(raw.FPDFPageObjMark_GetParamStringValue, mark, b"Name")
        if name:
            return name
    return None


def _rgba(getter, handle) -> list[int] | None:
    r, g, b, a = (ctypes.c_uint() for _ in range(4))
    if not getter(handle, ctypes.byref(r), ctypes.byref(g), ctypes.byref(b), ctypes.byref(a)):
        return None
    return [r.value, g.value, b.value, a.value]


def _text_details(obj, handle, textpage) -> dict:
    size = ctypes.c_float()
    raw.FPDFTextObj_GetFontSize(handle, ctypes.byref(size))
    m = obj.get_matrix().get()
    scale = math.sqrt(abs(m[0] * m[3] - m[1] * m[2])) or 1.0
    font = raw.FPDFTextObj_GetFont(handle)
    name, embedded = "", None
    if font:
        buf = ctypes.create_string_buffer(256)
        length = raw.FPDFFont_GetBaseFontName(font, buf, 256)
        name = buf.raw[: max(0, length - 1)].decode("latin-1", "ignore")
        embedded = bool(raw.FPDFFont_GetIsEmbedded(font))
    count = raw.FPDFTextObj_GetText(handle, textpage, None, 0)
    text = ""
    if count:
        chars = (ctypes.c_ushort * count)()
        raw.FPDFTextObj_GetText(handle, textpage, chars, count * 2)
        text = bytes(chars).decode("utf-16-le", "ignore").rstrip("\0")
    return {
        "text": text.strip()[:120],
        "font": name.split("+", 1)[-1],
        "sizePt": round(size.value * scale, 2),
        "embedded": embedded,
    }


def _image_details(obj, handle, page_handle, box: list[float]) -> dict:
    width, height = ctypes.c_uint(), ctypes.c_uint()
    raw.FPDFImageObj_GetImagePixelSize(handle, ctypes.byref(width), ctypes.byref(height))
    meta = raw.FPDF_IMAGEOBJ_METADATA()
    raw.FPDFImageObj_GetImageMetadata(handle, page_handle, ctypes.byref(meta))
    w_in = (box[2] - box[0]) / 72
    h_in = (box[3] - box[1]) / 72
    ppi = None
    if w_in > 0 and h_in > 0 and width.value and height.value:
        ppi = round(min(width.value / w_in, height.value / h_in), 1)
    return {
        "px": [width.value, height.value],
        "ppi": ppi,  # in the file; the final size divides it by the scale
        "colorSpace": _COLORSPACES.get(meta.colorspace, "?"),
        "bits": meta.bits_per_pixel,
    }


def _path_details(handle) -> dict:
    fill_mode, stroke = ctypes.c_int(), ctypes.c_int()
    raw.FPDFPath_GetDrawMode(handle, ctypes.byref(fill_mode), ctypes.byref(stroke))
    width = ctypes.c_float()
    raw.FPDFPageObj_GetStrokeWidth(handle, ctypes.byref(width))
    return {
        "fill": _rgba(raw.FPDFPageObj_GetFillColor, handle) if fill_mode.value else None,
        "stroke": _rgba(raw.FPDFPageObj_GetStrokeColor, handle) if stroke.value else None,
        "strokeWidthPt": round(width.value, 3) if stroke.value else None,
    }


def object_map(path: Path, cut_names: list[str], generated_bleed: list[bool]) -> list[dict]:
    """Objects of every page, in page space. `generated_bleed[i]`: the page was redrawn
    by the bleed fix, whose copies around the artwork are listed once, as one entry."""

    document = pdfium.PdfDocument(str(path))
    pages: list[dict] = []
    try:
        for index in range(len(document)):
            page = document[index]
            textpage = page.get_textpage()
            objects: list[dict] = []
            counts = {"image": 0, "text": 0, "path": 0, "shading": 0, "cut": 0}
            chain: list[Matrix] = []
            skip_below: int | None = None
            bled = index < len(generated_bleed) and generated_bleed[index]
            for obj in page.get_objects(max_depth=32):
                level = obj.level
                if skip_below is not None:
                    if level > skip_below:
                        continue
                    skip_below = None
                del chain[level:]
                parent = chain[level - 1] if level else _IDENTITY
                if obj.type == raw.FPDF_PAGEOBJ_FORM:
                    m = tuple(obj.get_matrix().get())
                    if bled and level == 0 and m != _IDENTITY:
                        skip_below = level  # a stretched or mirrored copy of the artwork
                    chain.append(_compose(m, parent))
                    continue
                kind = _KIND.get(obj.type)
                if kind is None:
                    continue
                handle = obj.raw
                box = _transform_box(obj.get_pos(), parent)
                layer = _layer(handle)
                if kind == "path" and _is_cut(layer, cut_names):
                    kind = "cut"
                counts[kind] += 1
                if len(objects) >= MAX_OBJECTS_PER_PAGE:
                    continue
                item: dict = {"id": f"p{index + 1}-{len(objects) + 1}", "kind": kind, "box": box}
                if layer:
                    item["layer"] = layer
                try:
                    if kind == "text":
                        item.update(_text_details(obj, handle, textpage.raw))
                    elif kind == "image":
                        item.update(_image_details(obj, handle, page.raw, box))
                    elif kind in {"path", "cut"}:
                        item.update(_path_details(handle))
                except Exception:
                    logger.debug("unable to read object details", exc_info=True)
                objects.append(item)
            textpage.close()
            pages.append(
                {
                    "number": index + 1,
                    "objects": objects,
                    "counts": counts,
                    "truncated": sum(counts.values()) > len(objects),
                    "generatedBleed": bled,
                }
            )
    finally:
        document.close()
    return pages


# --- plates (pikepdf) ---------------------------------------------------------------


class _Plates:
    def __init__(self, pdf: pikepdf.Pdf, cut_names: list[str]):
        self.pdf = pdf
        self.cut_names = cut_names
        self.forms: dict[tuple, pikepdf.Object] = {}
        self.counts: dict[str, int] = {}
        """Objetos de faca e de branco da página atual (contados na passagem de cada placa)."""

    def _layer_name(self, resources, operands) -> str | None:
        if len(operands) < 2 or operands[0] != pikepdf.Name.OC:
            return None
        props = operands[1]
        if isinstance(props, pikepdf.Name):
            props = (resources.get("/Properties") or {}).get(props)
        if isinstance(props, pikepdf.Dictionary):
            name = props.get("/Name")
            return str(name) if name is not None else None
        return None

    def content(self, instructions, resources, plate: str, in_cut: bool) -> bytes:
        """O conteúdo da placa: o resto vira "n" (não pinta). Acompanha a camada e a cor
        especial em uso, para separar faca (camada ou cor de corte) e base branca."""

        out: list = []
        layers: list[bool] = []
        saved: list[tuple] = []
        cut = in_cut
        fill_sep = stroke_sep = None
        spaces = resources.get("/ColorSpace") or {}

        def separation(operand):
            space = spaces.get(operand) if isinstance(operand, pikepdf.Name) else None
            if isinstance(space, pikepdf.Array) and len(space) >= 2 and space[0] == "/Separation":
                return str(space[1]).lstrip("/")
            return None

        def keep_paint(sep) -> bool:
            is_cut = cut or (sep is not None and _is_cut(sep, self.cut_names))
            is_white = sep is not None and _is_white(sep)
            if is_cut or is_white:
                self.count(plate, "cut" if is_cut else "white")
            return {
                "vectors": not is_cut and not is_white,
                "color": not is_cut and not is_white,
                "cut": is_cut,
                "white": is_white and not is_cut,
            }.get(plate, False)

        for item in instructions:
            if isinstance(item, pikepdf.ContentStreamInlineImage):
                if plate in ("images", "color"):
                    out.append(item)
                continue
            operands, operator = item.operands, item.operator
            op = str(operator)
            if op in {"BDC", "BMC"}:
                layers.append(cut)
                if op == "BDC" and _is_cut(self._layer_name(resources, operands), self.cut_names):
                    cut = True
            elif op == "EMC":
                cut = layers.pop() if layers else in_cut
            elif op == "q":
                saved.append((fill_sep, stroke_sep))
            elif op == "Q" and saved:
                fill_sep, stroke_sep = saved.pop()
            elif op == "cs" and operands:
                fill_sep = separation(operands[0])
            elif op == "CS" and operands:
                stroke_sep = separation(operands[0])
            elif op in {"g", "rg", "k"}:
                fill_sep = None
            elif op in {"G", "RG", "K"}:
                stroke_sep = None
            if op in _PAINT:
                sep = stroke_sep if op in {"S", "s"} else fill_sep
                keep = keep_paint(sep)
                out.append(
                    item if keep else pikepdf.ContentStreamInstruction([], pikepdf.Operator("n"))
                )
                continue
            if op == "sh":
                if plate in ("vectors", "color") and not cut:
                    out.append(item)
                continue
            if op == "Tr" and plate not in ("text", "color"):
                # Text stays in the content (it may clip) but is never painted.
                mode = int(operands[0]) if operands else 0
                out.append(pikepdf.ContentStreamInstruction([7 if mode >= 4 else 3], operator))
                continue
            if op == "Do" and operands:
                xobject = (resources.get("/XObject") or {}).get(operands[0])
                if xobject is not None and xobject.get("/Subtype") == pikepdf.Name.Image:
                    white = str(operands[0]) == "/YesodWhiteIm" or (
                        bool(xobject.get("/ImageMask", False))
                        and fill_sep is not None
                        and _is_white(fill_sep)
                    )
                    space = xobject.get("/ColorSpace")
                    if (
                        isinstance(space, pikepdf.Array)
                        and len(space) >= 2
                        and space[0] == "/Separation"
                    ):
                        white = white or _is_white(str(space[1]).lstrip("/"))
                    if white:
                        self.count(plate, "white")
                    if (plate in ("images", "color") and not white) or (plate == "white" and white):
                        out.append(item)
                    continue
            out.append(item)
        data = pikepdf.unparse_content_stream(out)
        return (b"3 Tr\n" + data) if plate not in ("text", "color") else data

    def count(self, plate: str, kind: str) -> None:
        # Conta uma vez por objeto: só na passagem da placa daquele tipo.
        if plate == kind:
            self.counts[kind] = self.counts.get(kind, 0) + 1

    def resources(self, resources, plate: str, in_cut: bool) -> pikepdf.Dictionary:
        """Shallow copy whose forms are replaced by their filtered copies."""

        copy = pikepdf.Dictionary(resources) if resources is not None else pikepdf.Dictionary()
        xobjects = copy.get("/XObject")
        if xobjects is not None:
            filtered = pikepdf.Dictionary(xobjects)
            for name, xobject in xobjects.items():
                if xobject.get("/Subtype") == pikepdf.Name.Form:
                    filtered[name] = self.form(xobject, plate, in_cut)
            copy.XObject = filtered
        return copy

    def form(self, form: pikepdf.Object, plate: str, in_cut: bool) -> pikepdf.Object:
        key = (form.objgen, plate, in_cut)
        if key in self.forms:
            return self.forms[key]
        try:
            instructions = list(pikepdf.parse_content_stream(form))
        except Exception:
            return form
        resources = form.get("/Resources")
        new = self.pdf.make_stream(b"")
        self.forms[key] = new  # before recursing: forms may reference themselves
        for name, value in form.items():
            if name not in {"/Length", "/Filter", "/DecodeParms", "/Resources"}:
                new[name] = value
        new.Resources = self.resources(resources, plate, in_cut)
        new.write(self.content(instructions, resources or pikepdf.Dictionary(), plate, in_cut))
        return new


def _shrink_images(pdf: pikepdf.Pdf) -> None:
    """Screen-resolution copies of large images (the inspection file is only viewed)."""

    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream) or obj.get("/Subtype") != pikepdf.Name.Image:
            continue
        try:
            width, height = int(obj.Width), int(obj.Height)
            if width * height <= _PREVIEW_PIXELS or obj.get("/ImageMask") or "/Decode" in obj:
                continue
            image = pikepdf.PdfImage(obj).as_pil_image()
            factor = math.sqrt(_PREVIEW_PIXELS / (width * height))
            size = (max(1, int(width * factor)), max(1, int(height * factor)))
            preview = image.convert("RGB").resize(size, Image.Resampling.BILINEAR)
            buffer = io.BytesIO()
            preview.save(buffer, "JPEG", quality=80)
            smask = obj.get("/SMask")
            obj.write(buffer.getvalue(), filter=pikepdf.Name.DCTDecode)
            for key in ("/DecodeParms", "/Intent"):
                if key in obj:
                    del obj[key]
            obj.Width, obj.Height = size
            obj.ColorSpace = pikepdf.Name.DeviceRGB
            obj.BitsPerComponent = 8
            if smask is not None:
                mask = pikepdf.PdfImage(smask).as_pil_image().convert("L").resize(size)
                smask.write(mask.tobytes())
                smask.Width, smask.Height = size
                smask.BitsPerComponent = 8
                for key in ("/Decode", "/DecodeParms"):
                    if key in smask:
                        del smask[key]
        except Exception:
            logger.debug("unable to shrink an image for the inspection file", exc_info=True)


def build_inspection(source: Path, destination: Path, cut_names: list[str]) -> dict:
    """Writes the inspection PDF (plates + objects.json attached). Returns a summary."""

    with pikepdf.open(source) as original:
        bled = [
            any(str(item) == "add_bleed" for item in page.obj.get("/YesodFixes", []))
            for page in original.pages
        ]
        out = pikepdf.Pdf.new()
        plates = _Plates(out, cut_names)
        plate_counts: list[dict[str, int]] = []
        for page in original.pages:
            # The page's own content and resources, read once; every plate starts from them.
            try:
                instructions = list(pikepdf.parse_content_stream(page))
            except Exception:
                instructions = []
            lookups = page.obj.get("/Resources") or pikepdf.Dictionary()
            out.pages.append(page)
            snapshot = {key: value for key, value in out.pages[-1].obj.items() if key != "/Annots"}
            del out.pages[-1]
            for plate in PLATES:
                # A page of its own per plate (pages must not share their dictionary).
                target = pikepdf.Dictionary(snapshot)
                data = plates.content(instructions, lookups, plate, False)
                target.Resources = plates.resources(snapshot.get("/Resources"), plate, False)
                target.Contents = out.make_stream(data)
                out.pages.append(pikepdf.Page(out.make_indirect(target)))
            plate_counts.append(plates.counts)
            plates.counts = {}
        _shrink_images(out)
        pages = object_map(source, cut_names, bled)
        # Faca pela cor de corte e base branca (o mapa do PDFium só vê a camada).
        for info, counts in zip(pages, plate_counts, strict=False):
            info["counts"]["cut"] = max(info["counts"].get("cut", 0), counts.get("cut", 0))
            info["counts"]["white"] = counts.get("white", 0)
        manifest = {"version": 1, "plates": list(PLATES), "pages": pages, "white": []}
        # Base branca gerada pelo sistema: a placa vai como imagem, para a tela mostrar
        # o branco separado (no arquivo ele é invisível fora do RIP: Multiplicar).
        for number, page in enumerate(original.pages, start=1):
            plate = white_plate_png(page)
            if plate:
                name = f"white-{number}.png"
                out.attachments[name] = pikepdf.AttachedFileSpec(
                    out, plate[0], mime_type="image/png"
                )
                manifest["white"].append({"page": number, "file": name, "box": plate[1]})
        # Prova de saída (Ghostscript, sobreimpressão simulada): como o RIP imprimiria.
        manifest["proof"] = []
        try:
            for number, png in output_proof(source):
                name = f"proof-{number}.png"
                out.attachments[name] = pikepdf.AttachedFileSpec(out, png, mime_type="image/png")
                manifest["proof"].append({"page": number, "file": name})
        except Exception:  # noqa: BLE001 - sem prova, a inspeção segue
            manifest["proof"] = []
        out.attachments["objects.json"] = pikepdf.AttachedFileSpec(
            out, json.dumps(manifest, ensure_ascii=False).encode(), mime_type="application/json"
        )
        out.save(
            destination, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate
        )
    return {
        "pages": len(pages),
        "objects": sum(len(p["objects"]) for p in pages),
        "bytes": destination.stat().st_size,
    }
