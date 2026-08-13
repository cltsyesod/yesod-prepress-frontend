from __future__ import annotations

from io import BytesIO

import pikepdf
from fontTools.ttLib import TTFont

from app.analyzer.context import FontInfo


def _font_descriptor(font: pikepdf.Object) -> pikepdf.Object | None:
    descriptor = font.get("/FontDescriptor")
    if descriptor is not None:
        return descriptor
    descendants = font.get("/DescendantFonts")
    if descendants and len(descendants):
        return descendants[0].get("/FontDescriptor")
    return None


def inspect_fonts(pdf: pikepdf.Pdf) -> list[FontInfo]:
    results: list[FontInfo] = []
    seen: set[tuple[int, str]] = set()
    for page_number, page in enumerate(pdf.pages, start=1):
        resources = page.obj.get("/Resources") or {}
        fonts = resources.get("/Font") if hasattr(resources, "get") else None
        if not fonts:
            continue
        for resource_name, font in fonts.items():
            identity = (page_number, str(resource_name))
            if identity in seen:
                continue
            seen.add(identity)
            base_name = str(font.get("/BaseFont", resource_name)).lstrip("/")
            descriptor = _font_descriptor(font)
            embedded_stream = None
            if descriptor is not None:
                for key in ("/FontFile", "/FontFile2", "/FontFile3"):
                    if descriptor.get(key) is not None:
                        embedded_stream = descriptor.get(key)
                        break
            valid_program: bool | None = None
            if embedded_stream is not None:
                try:
                    data = embedded_stream.read_bytes()
                    # fontTools validates TrueType/OpenType programs; CFF and Type1
                    # are still considered embedded even when TTFont cannot parse them.
                    if data[:4] in {b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf"}:
                        font_program = TTFont(BytesIO(data), lazy=True)
                        font_program.close()
                        valid_program = True
                except Exception:
                    valid_program = False
            results.append(
                FontInfo(
                    page=page_number,
                    object_id=str(resource_name),
                    name=base_name,
                    subtype=str(font.get("/Subtype", "")).lstrip("/"),
                    embedded=embedded_stream is not None,
                    subset="+" in base_name and len(base_name.split("+", 1)[0]) == 6,
                    to_unicode=font.get("/ToUnicode") is not None,
                    valid_font_program=valid_program,
                )
            )
    return results
