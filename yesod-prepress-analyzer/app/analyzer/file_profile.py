"""Raio-X do arquivo: tudo o que a inspeção mediu, num resumo que a tela mostra.

As regras dizem o que está errado; este perfil mostra o que o arquivo É (formato, caixas,
sangria, imagens com o ppi no tamanho final, cores, fontes, faca, estrutura do PDF) e o que
a ficha pede, lado a lado. Os números são os mesmos que as regras usam.
"""

from __future__ import annotations

from collections import Counter

from app.analyzer.context import DocumentContext

PT_TO_MM = 25.4 / 72
_MAX_PAGES = 50
_MAX_IMAGES = 60


def _mm(value: float) -> float:
    return round(value * PT_TO_MM, 1)


def _size(box) -> list[float]:
    return [_mm(box[2] - box[0]), _mm(box[3] - box[1])]


def _clean_font(name: str) -> str:
    # "ABCDEF+Helvetica-Bold" -> "Helvetica-Bold" (prefixo de subconjunto).
    name = name.lstrip("/")
    return name.split("+", 1)[1] if len(name) > 7 and name[6] == "+" else name


def _pages(context: DocumentContext, scale: float) -> list[dict]:
    pages = []
    for page in context.pages[:_MAX_PAGES]:
        trim = page.trim_box or page.crop_box or page.media_box
        size = _size(trim)
        bleed = None
        if page.bleed_box and page.trim_box:
            t, b = page.trim_box, page.bleed_box
            bleed = {
                "left": round((t[0] - b[0]) * PT_TO_MM * scale, 1),
                "bottom": round((t[1] - b[1]) * PT_TO_MM * scale, 1),
                "right": round((b[2] - t[2]) * PT_TO_MM * scale, 1),
                "top": round((b[3] - t[3]) * PT_TO_MM * scale, 1),
            }
        die = page.die_line_box
        pages.append(
            {
                "number": page.number,
                "fileMm": size,
                "finalMm": [round(size[0] * scale, 1), round(size[1] * scale, 1)],
                "mediaMm": _size(page.media_box),
                "hasTrimBox": page.trim_box is not None,
                "hasBleedBox": page.bleed_box is not None,
                "bleedMm": bleed,
                "rotation": page.rotation,
                "dieLine": die is not None,
                "dieLineFinalMm": (
                    [round(v * scale, 1) for v in _size(die)] if die is not None else None
                ),
                "magentaStrokes": page.magenta_strokes,
            }
        )
    return pages


def _images(context: DocumentContext, scale: float) -> dict:
    items = []
    finals = []
    for image in context.images:
        file_ppi = (
            min(image.effective_dpi_x, image.effective_dpi_y)
            if image.effective_dpi_x and image.effective_dpi_y
            else None
        )
        final_ppi = round(file_ppi / scale) if file_ppi else None
        if final_ppi is not None:
            finals.append(final_ppi)
        if len(items) < _MAX_IMAGES:
            items.append(
                {
                    "page": image.page,
                    "px": [image.width_px, image.height_px],
                    "filePpi": round(file_ppi) if file_ppi else None,
                    "finalPpi": final_ppi,
                    "colorSpace": image.color_space,
                    "bits": image.bits_per_component,
                    "transparency": image.has_transparency,
                }
            )
    spaces = Counter(image.color_space for image in context.images)
    return {
        "count": len(context.images),
        "minFinalPpi": min(finals) if finals else None,
        "maxFinalPpi": max(finals) if finals else None,
        "colorSpaces": dict(spaces.most_common()),
        "withTransparency": sum(1 for image in context.images if image.has_transparency),
        "items": items,
    }


def _fonts(context: DocumentContext) -> dict:
    by_name: dict[str, dict] = {}
    for font in context.fonts:
        name = _clean_font(font.name)
        entry = by_name.setdefault(
            name, {"name": name, "type": font.subtype.lstrip("/"), "embedded": True, "pages": []}
        )
        entry["embedded"] = entry["embedded"] and font.embedded
        if font.page not in entry["pages"]:
            entry["pages"].append(font.page)
    items = sorted(by_name.values(), key=lambda f: (f["embedded"], f["name"]))
    return {
        "count": len(items),
        "notEmbedded": sum(1 for f in items if not f["embedded"]),
        "items": items[:80],
    }


def _colors(context: DocumentContext) -> dict:
    colors = context.colors
    technical = {name.casefold() for name in context.profile.cut_layer_names}
    spots = sorted(colors.spot_names)
    return {
        "rgbOperators": colors.rgb_operators,
        "cmykOperators": colors.cmyk_operators,
        "grayOperators": colors.gray_operators,
        "spots": [s for s in spots if s.casefold() not in technical],
        "technicalSpots": [s for s in spots if s.casefold() in technical],
        "maxInkCoverage": round(colors.maximum_declared_ink_coverage, 1),
        "outputIntent": colors.output_intent_identifier,
        "outputIntentValid": colors.output_intent_valid,
    }


def file_profile(context: DocumentContext) -> dict:
    profile = context.profile
    scale = profile.file_scale or 1.0
    return {
        "document": {
            "pdfVersion": context.pdf_version,
            "pdfx": context.pdfx_version,
            "pages": context.page_count,
            "fileBytes": context.file_size,
            "encrypted": context.encrypted,
            "creator": context.metadata.get("xmp:CreatorTool", ""),
            "producer": context.metadata.get("pdf:Producer", ""),
            "title": context.metadata.get("dc:title", ""),
            "structureOk": context.qpdf_ok,
            "rendersOk": context.pdfium_ok,
        },
        "pages": _pages(context, scale),
        "images": _images(context, scale),
        "fonts": _fonts(context),
        "colors": _colors(context),
        "layers": sorted(context.layers),
        "technology": profile.technology,
        "textile": {
            "pages": [page.to_dict() for page in context.facts.get("textile_pages", [])],
            "error": context.facts.get("textile_error", ""),
        }
        if profile.is_textile
        else None,
        # O que a ficha/perfil pede, para comparar lado a lado.
        "targets": {
            "scale": scale,
            "finalWidthMm": profile.final_width_mm,
            "finalHeightMm": profile.final_height_mm,
            "minPpi": profile.minimum_resolution_dpi,
            "minBleedMm": profile.minimum_bleed_mm,
            "rgbPolicy": profile.rgb_policy,
            "maxInkCoverage": profile.maximum_ink_coverage_percent,
            "requiresCutLayer": profile.requires_cut_layer,
            "cutLayerNames": profile.cut_layer_names,
            "requirePdfX": profile.require_pdf_x,
        },
    }
