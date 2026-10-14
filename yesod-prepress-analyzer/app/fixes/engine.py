"""Automatic corrections applied to a copy of the client PDF.

Every fix is conservative: it never converts colours or moves artwork. It writes
page boxes and adds new, clearly separated objects (die line, crop marks). Generated
bleed repeats the artwork's own edge only outside what the file already printed. The
one exception that touches pixels is upscaling, which the operator requests explicitly.
The original file is kept by the caller; the corrected copy is analysed again so
the operator sees the result measured, not assumed.
"""

from __future__ import annotations

from pathlib import Path

import pikepdf
from shapely.geometry import MultiPolygon

from app.analyzer.page_inspector import inspect_pages
from app.contracts.fix import AppliedFix, FixRequest
from app.contracts.production_profile import ProductionProfile
from app.core.exceptions import AnalyzerError
from app.fixes import bleed
from app.fixes.contour import artwork_silhouette, contour_die_line
from app.fixes.geometry import (
    MM,
    Box,
    describe_mm,
    expand,
    intersect,
    normalize,
    target_trim,
    visible_box,
)
from app.fixes.image_pdf import image_to_pdf
from app.fixes.magenta import convert_magenta_strokes
from app.fixes.paths import circle, pdf_path
from app.fixes.rgb_profile import assign_srgb
from app.fixes.upscale import upscale_images
from app.fixes.white import (
    STRATEGY_TEXT,
    WhiteSettingsMissing,
    draw_white,
    white_mask,
    without_cut_lines,
)
from app.fixes.white import settings_for as white_settings

# Order matters: boxes first, because the die line and the marks use the TrimBox; a
# magenta die line converted to the cut separation counts as the die line afterwards.
_ORDER = (
    "upscale_images",
    "assign_rgb_profile",
    "set_page_boxes",
    "add_bleed",
    "convert_magenta_die_line",
    "add_white_underbase",
    "add_contour_cut",
    "add_cut_contour",
    "add_crop_marks",
)
_PATH_TOLERANCE_MM = 0.03  # die-line simplification at final size, before curve fitting


class FixError(AnalyzerError):
    code = "FIX_FAILED"


def _array(box: Box) -> pikepdf.Array:
    return pikepdf.Array([round(value, 4) for value in box])


def _num(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def _param(params: dict, key: str, default: float) -> float:
    try:
        value = float(params.get(key, default))
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


def _separation(pdf: pikepdf.Pdf, name: str, cmyk: list[float]) -> pikepdf.Object:
    tint = pikepdf.Dictionary(
        FunctionType=2, Domain=[0, 1], C0=[0, 0, 0, 0], C1=cmyk, N=1
    )
    space = [pikepdf.Name.Separation, pikepdf.Name("/" + name), pikepdf.Name.DeviceCMYK, tint]
    return pdf.make_indirect(pikepdf.Array(space))


_MARKER = pikepdf.Name("/YesodFixes")


def _already_applied(page: pikepdf.Page, fix_id: str) -> bool:
    """Fixes that draw on the page record themselves, so re-running never duplicates."""

    return any(str(item) == fix_id for item in page.obj.get(_MARKER, []))


def _record(page: pikepdf.Page, fix_id: str) -> None:
    if _MARKER not in page.obj:
        page.obj[_MARKER] = pikepdf.Array()
    page.obj[_MARKER].append(pikepdf.String(fix_id))


def _isolate_existing_content(page: pikepdf.Page, clip: Box | None = None) -> None:
    """Wrap the current content in q/Q (and optionally a clip) before drawing on top."""

    if "/Contents" not in page.obj:
        return
    page.contents_coalesce()
    prefix = b"q\n"
    if clip is not None:
        x0, y0, x1, y1 = clip
        prefix += f"{_num(x0)} {_num(y0)} {_num(x1 - x0)} {_num(y1 - y0)} re W n\n".encode()
    page.contents_add(prefix, prepend=True)
    page.contents_add(b"\nQ\n")


def _set_page_boxes(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    details: list[str] = []
    scale = profile.file_scale
    bleed_pt = profile.minimum_bleed_mm / scale * MM
    for info, page in zip(inspect_pages(pdf, profile.cut_layer_names), pdf.pages, strict=True):
        trim, how = target_trim(info, profile)
        changes: list[str] = []
        if info.trim_box is None:
            page.obj.TrimBox = _array(trim)
            changes.append(f"TrimBox {describe_mm(trim, scale)} ({how})")
        if info.bleed_box is None:
            bleed = intersect(expand(trim, bleed_pt), visible_box(info))
            page.obj.BleedBox = _array(bleed)
            margin = min(
                trim[0] - bleed[0], trim[1] - bleed[1], bleed[2] - trim[2], bleed[3] - trim[3]
            )
            if margin + 0.01 < bleed_pt:
                changes.append(
                    f"BleedBox com {margin / MM * scale:.1f} mm: a página não tem área "
                    "para a sangria pedida"
                )
            else:
                changes.append(f"BleedBox com {profile.minimum_bleed_mm:g} mm")
        if changes:
            details.append(f"Página {info.number}: " + "; ".join(changes))
    return AppliedFix(id="set_page_boxes", label="TrimBox e BleedBox definidos", details=details)


def _add_bleed(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    """Missing bleed generated from the artwork's own edge (stretched or mirrored)."""

    method = str(params.get("method") or bleed.STRETCH)
    if method not in bleed.METHODS:
        raise FixError(f"unknown bleed method: {method}")
    scale = profile.file_scale
    bleed_mm = _param(params, "bleedMm", profile.minimum_bleed_mm) or profile.minimum_bleed_mm
    if bleed_mm <= 0:
        raise FixError("the job asks for no bleed")
    bleed_pt = bleed_mm / scale * MM
    slice_pt = 0.1 / scale * MM  # last 0.1 mm of the artwork, at final size

    details: list[str] = []
    for info, page in zip(inspect_pages(pdf, profile.cut_layer_names), pdf.pages, strict=True):
        if info.die_line_box is not None:
            details.append(f"Página {info.number}: peça com faca, a sangria segue a faca")
            continue
        if _already_applied(page, "add_crop_marks"):
            # The marks live outside the old bleed and would be hidden by the new strips.
            details.append(
                f"Página {info.number}: já tem marcas de corte; gere a sangria antes delas"
            )
            continue
        trim, how = target_trim(info, profile)
        visible = visible_box(info)
        # What the client's file already prints around the trim (at least the trim).
        base = intersect(info.bleed_box, visible) if info.bleed_box else trim
        base = (
            min(base[0], trim[0]),
            min(base[1], trim[1]),
            max(base[2], trim[2]),
            max(base[3], trim[3]),
        )
        wanted = expand(trim, bleed_pt)
        if not bleed.extend_page(pdf, page, base, wanted, visible, method, slice_pt):
            details.append(f"Página {info.number}: já tinha {bleed_mm:g} mm de sangria")
            continue
        outer = (
            min(wanted[0], base[0]),
            min(wanted[1], base[1]),
            max(wanted[2], base[2]),
            max(wanted[3], base[3]),
        )
        page.obj.TrimBox = _array(trim)
        page.obj.BleedBox = _array(outer)
        if any(o < v - 0.01 for o, v in zip(outer[:2], visible[:2], strict=True)) or any(
            o > v + 0.01 for o, v in zip(outer[2:], visible[2:], strict=True)
        ):
            page.obj.MediaBox = _array(outer)
            if "/CropBox" in page.obj:
                page.obj.CropBox = _array(outer)
        _record(page, "add_bleed")
        details.append(
            f"Página {info.number}: {bleed_mm:g} mm de sangria "
            f"{'espelhando' if method == bleed.MIRROR else 'esticando'} a borda da arte "
            f"(formato final {describe_mm(trim, scale)}, {how})"
        )
    how_label = "por espelhamento" if method == bleed.MIRROR else "esticando a borda"
    label = f"Sangria gerada {how_label}"
    return AppliedFix(id="add_bleed", label=label, details=details)


def _assign_rgb_profile(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    """Untagged RGB declared as sRGB; colour values are kept, nothing is converted."""

    report = assign_srgb(pdf)
    details: list[str] = []
    if report.operators:
        details.append(f"{report.operators} cor(es) de vetores e textos marcadas como sRGB")
    if report.images:
        details.append(f"{report.images} imagem(ns) marcada(s) como sRGB, pixels inalterados")
    if report.shadings:
        details.append(f"{report.shadings} degradê(s) marcado(s) como sRGB")
    if report.inline_images:
        details.append(
            f"{report.inline_images} imagem(ns) embutida(s) no conteúdo ficaram sem perfil"
        )
    return AppliedFix(
        id="assign_rgb_profile", label="Perfil sRGB atribuído ao RGB sem perfil", details=details
    )


def _add_cut_contour(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    name = str(params.get("name") or (profile.cut_layer_names or ["CutContour"])[0]).strip()
    if not name:
        raise FixError("cut contour name is empty")
    scale = profile.file_scale
    width_pt = _param(params, "lineWidthPt", 0.25) / scale
    color = _separation(pdf, name, [0, 1, 0, 0])
    layer = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=name))
    overprint = pdf.make_indirect(
        pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, OP=True, op=True, OPM=1)
    )

    details: list[str] = []
    registered = False
    for info, page in zip(inspect_pages(pdf, profile.cut_layer_names), pdf.pages, strict=True):
        if _already_applied(page, "add_cut_contour"):
            details.append(f"Página {info.number}: já tinha faca inserida pelo sistema")
            continue
        if not registered:
            _register_layer(pdf, layer)
            registered = True
        trim, how = target_trim(info, profile)
        cs = page.add_resource(color, pikepdf.Name.ColorSpace, prefix="YesodCut")
        oc = page.add_resource(layer, pikepdf.Name.Properties, prefix="YesodOC")
        gs = page.add_resource(overprint, pikepdf.Name.ExtGState, prefix="YesodGS")
        x0, y0, x1, y1 = trim
        _isolate_existing_content(page)
        page.contents_add(
            (
                f"/OC {oc} BDC q {gs} gs {cs} CS 1 SCN {_num(width_pt)} w 0 J 0 j "
                f"{_num(x0)} {_num(y0)} {_num(x1 - x0)} {_num(y1 - y0)} re S Q EMC\n"
            ).encode()
        )
        _record(page, "add_cut_contour")
        details.append(f"Página {info.number}: faca {describe_mm(trim, scale)} ({how})")
    return AppliedFix(
        id="add_cut_contour", label=f"Faca retangular inserida ({name})", details=details
    )


def _add_contour_cut(
    pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict, source: Path
) -> AppliedFix:
    """Die line that follows the outside of the printed artwork.

    Nothing printed is lost: with offset 0 the line runs on the edge of the artwork,
    a positive offset moves it outward, a negative one inward (operator's choice).
    """

    name = str(params.get("name") or (profile.cut_layer_names or ["CutContour"])[0]).strip()
    scale = profile.file_scale
    try:
        offset_mm = float(params.get("offsetMm", 0) or 0)
    except (TypeError, ValueError):
        offset_mm = 0.0
    offset_pt = offset_mm / scale * MM
    width_pt = _param(params, "lineWidthPt", 0.25) / scale
    cut_holes = bool(params.get("cutHoles", False))
    # Paper-white background is not artwork unless the operator says otherwise.
    white_is_background = params.get("whiteBackground", "ignore") != "keep"
    color = _separation(pdf, name, [0, 1, 0, 0])
    layer = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=name))
    overprint = pdf.make_indirect(
        pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, OP=True, op=True, OPM=1)
    )

    details: list[str] = []
    registered = False
    pages = inspect_pages(pdf, profile.cut_layer_names)
    for index, (info, page) in enumerate(zip(pages, pdf.pages, strict=True)):
        if _already_applied(page, "add_contour_cut") or info.die_line_box is not None:
            details.append(f"Página {info.number}: já tinha faca")
            continue
        visible = visible_box(info)
        # With a finished format, the cut follows the artwork inside it: what lies in the
        # bleed (the client's or one generated by the system) is not part of the piece.
        if info.trim_box is not None:
            region = intersect(normalize(info.trim_box), visible)
        elif info.bleed_box is not None:
            region = intersect(info.bleed_box, visible)
        else:
            region = visible
        silhouette = artwork_silhouette(
            source,
            index,
            region,
            origin=(visible[0], visible[1]),
            file_scale=scale,
            white_is_background=white_is_background,
        )
        if silhouette is None or silhouette.is_empty:
            details.append(f"Página {info.number}: nenhuma arte encontrada para contornar")
            continue
        die = contour_die_line(silhouette, offset_pt, cut_holes=cut_holes)
        polygons = die.geoms if isinstance(die, MultiPolygon) else [die]
        holes = sum(len(polygon.interiors) for polygon in polygons)
        paths = [pdf_path(die, smooth=True, tolerance=_PATH_TOLERANCE_MM / scale * MM) + " S"]
        if not registered:
            _register_layer(pdf, layer)
            registered = True
        cs = page.add_resource(color, pikepdf.Name.ColorSpace, prefix="YesodCut")
        oc = page.add_resource(layer, pikepdf.Name.Properties, prefix="YesodOC")
        gs = page.add_resource(overprint, pikepdf.Name.ExtGState, prefix="YesodGS")
        _isolate_existing_content(page)
        page.contents_add(
            (
                f"/OC {oc} BDC q {gs} gs {cs} CS 1 SCN {_num(width_pt)} w 1 J 1 j "
                + " ".join(paths)
                + " Q EMC\n"
            ).encode()
        )
        # The finished format is the die line; nothing printed sits outside it.
        bounds = intersect(die.bounds, visible)
        if info.trim_box is None:
            page.obj.TrimBox = _array(bounds)
        if info.bleed_box is None:
            page.obj.BleedBox = _array(intersect(expand(bounds, max(offset_pt, 0)), visible))
        _record(page, "add_contour_cut")
        where = (
            "na borda da arte"
            if not offset_mm
            else f"{abs(offset_mm):g} mm {'para fora' if offset_mm > 0 else 'para dentro'} da arte"
        )
        inner = f", {holes} furo(s) interno(s) cortado(s)" if holes else ""
        details.append(
            f"Página {info.number}: {len(polygons)} contorno(s) {where}{inner}, "
            f"formato {describe_mm(bounds, scale)}"
        )
    return AppliedFix(
        id="add_contour_cut", label=f"Faca pelo contorno da arte ({name})", details=details
    )


def _convert_magenta(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    """Plain-magenta strokes become the cut separation: the RIP cuts them instead of printing."""

    name = str(params.get("name") or (profile.cut_layer_names or ["CutContour"])[0]).strip()
    color = _separation(pdf, name, [0, 1, 0, 0])
    details: list[str] = []
    for info, page in zip(inspect_pages(pdf, profile.cut_layer_names), pdf.pages, strict=True):
        if info.die_line_box is not None or not info.magenta_strokes:
            continue
        count = convert_magenta_strokes(pdf, page, color)
        details.append(f"Página {info.number}: {count} linha(s) magenta convertida(s) em {name}")
    return AppliedFix(
        id="convert_magenta_die_line", label=f"Faca magenta convertida em {name}", details=details
    )


def _upscale(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    target = _param(params, "targetPpi", float(profile.minimum_resolution_dpi))
    max_factor = _param(params, "maxFactor", 4.0) or 4.0
    done, skipped = upscale_images(pdf, target, profile.file_scale, max_factor)
    details = [
        f"Pág. {item.page} {item.name}: {item.before[0]}×{item.before[1]} → "
        f"{item.after[0]}×{item.after[1]} px, {item.ppi_before:.0f} → {item.ppi_after:.0f} ppi "
        "no tamanho final"
        + (" (limite de ampliação atingido)" if item.ppi_after + 0.5 < target else "")
        for item in done
    ]
    details += [f"Não ampliada: {reason}" for reason in skipped]
    for number in sorted({item.page for item in done}):
        _record(pdf.pages[number - 1], "upscale_images")
    if done:
        details.append("Ampliação cumpre o ppi, mas não recupera detalhe (nitidez do original)")
    return AppliedFix(id="upscale_images", label="Imagens ampliadas (Lanczos)", details=details)


def _register_layer(pdf: pikepdf.Pdf, layer: pikepdf.Object) -> None:
    root = pdf.Root
    if "/OCProperties" not in root:
        root.OCProperties = pikepdf.Dictionary(
            OCGs=pikepdf.Array(), D=pikepdf.Dictionary(Order=pikepdf.Array(), ON=pikepdf.Array())
        )
    props = root.OCProperties
    if "/OCGs" not in props:
        props.OCGs = pikepdf.Array()
    props.OCGs.append(layer)
    if "/D" not in props:
        props.D = pikepdf.Dictionary()
    for key in ("/Order", "/ON"):
        if key not in props.D:
            props.D[key] = pikepdf.Array()
        props.D[key].append(layer)


def _add_crop_marks(pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict) -> AppliedFix:
    scale = profile.file_scale
    # Sizes are given at final size and drawn at file scale.
    length = _param(params, "lengthMm", 5.0) / scale * MM
    gap = _param(params, "gapMm", 2.0) / scale * MM
    width_pt = _param(params, "lineWidthPt", 0.25) / scale
    registration = _separation(pdf, "All", [1, 1, 1, 1])

    details: list[str] = []
    for info, page in zip(inspect_pages(pdf, profile.cut_layer_names), pdf.pages, strict=True):
        if _already_applied(page, "add_crop_marks"):
            details.append(f"Página {info.number}: já tinha marcas de corte do sistema")
            continue
        trim, how = target_trim(info, profile)
        bleed = info.bleed_box or trim
        x0, y0, x1, y1 = trim
        # Marks start outside the bleed so they never touch the artwork.
        reach = max(x0 - bleed[0], y0 - bleed[1], bleed[2] - x1, bleed[3] - y1, 0.0) + gap
        outer = expand(trim, reach + length + gap)

        _isolate_existing_content(page, clip=intersect(bleed, visible_box(info)))
        if info.trim_box is None:
            page.obj.TrimBox = _array(trim)
        if info.bleed_box is None:
            page.obj.BleedBox = _array(trim)
        page.obj.MediaBox = _array(outer)
        if "/CropBox" in page.obj:
            page.obj.CropBox = _array(outer)

        cs = page.add_resource(registration, pikepdf.Name.ColorSpace, prefix="YesodReg")
        segments = []
        for x in (x0, x1):
            for y, direction in ((y0, -1), (y1, 1)):
                start, end = y + direction * reach, y + direction * (reach + length)
                segments.append(f"{_num(x)} {_num(start)} m {_num(x)} {_num(end)} l")
        for y in (y0, y1):
            for x, direction in ((x0, -1), (x1, 1)):
                start, end = x + direction * reach, x + direction * (reach + length)
                segments.append(f"{_num(start)} {_num(y)} m {_num(end)} {_num(y)} l")
        extras = []
        if params.get("registrationTargets"):
            # Registration targets (circle + cross) at the middle of each side, in the
            # same band as the marks: outside the bleed, never over the artwork.
            r = min(length / 2, 3 * MM / scale)
            middle = reach + length / 2
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            targets = ((cx, y0 - middle), (cx, y1 + middle), (x0 - middle, cy), (x1 + middle, cy))
            for tx, ty in targets:
                extras.append(
                    circle(tx, ty, r * 0.6)
                    + f" {_num(tx - r)} {_num(ty)} m {_num(tx + r)} {_num(ty)} l"
                    + f" {_num(tx)} {_num(ty - r)} m {_num(tx)} {_num(ty + r)} l"
                )
        page.contents_add(
            (
                f"q {cs} CS 1 SCN {_num(width_pt)} w 0 J "
                + " ".join(segments + extras)
                + " S Q\n"
            ).encode()
        )
        text = str(params.get("slug") or "").strip()
        if text:
            label = _slug(page, text, x0, x1, y0 - reach - length, length, scale)
            if label:
                page.contents_add(label.encode("cp1252", "replace"))
        _record(page, "add_crop_marks")
        details.append(
            f"Página {info.number}: marcas em {describe_mm(trim, scale)} ({how}), "
            f"página ampliada para {describe_mm(outer, scale)}"
        )
    return AppliedFix(id="add_crop_marks", label="Marcas de corte inseridas", details=details)


def _slug(
    page: pikepdf.Page, text: str, x0: float, x1: float, y: float, band: float, scale: float
) -> str:
    """Identification text below the bottom crop-mark band, between the corner marks."""

    size = min(6.0 / scale, band * 0.8)
    inset = 2 * MM / scale
    room = x1 - x0 - 2 * inset
    # Helvetica averages about half an em per character; cut the text to the room.
    fits = max(0, int(room / (size * 0.55)))
    if fits < 4:
        return ""
    text = text if len(text) <= fits else text[: fits - 1] + "…"
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    font = pikepdf.Dictionary(
        Type=pikepdf.Name.Font,
        Subtype=pikepdf.Name.Type1,
        BaseFont=pikepdf.Name.Helvetica,
        Encoding=pikepdf.Name.WinAnsiEncoding,
    )
    name = page.add_resource(font, pikepdf.Name.Font, prefix="YesodSlug")
    at = f"{_num(x0 + inset)} {_num(y + band * 0.1)}"
    return f"q BT {name} {_num(size)} Tf 0 0 0 1 k {at} Td ({safe}) Tj ET Q\n"


def _add_white(
    pdf: pikepdf.Pdf, profile: ProductionProfile, params: dict, rendered: Path
) -> AppliedFix:
    try:
        settings = white_settings(profile, params)
    except WhiteSettingsMissing as exc:
        raise FixError(str(exc)) from exc
    if settings.strategy == "none":
        raise FixError("Peça clara e o perfil diz sem branco: nada a gerar")
    layer = pdf.make_indirect(
        pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=f"Branco ({settings.spot_name})")
    )
    # A faca que vem na arte não é estampa: mede o branco numa cópia sem ela.
    measured = rendered.with_name(f"{rendered.stem}_semfaca.pdf")
    removed = without_cut_lines(rendered, measured, profile.cut_layer_names)
    details = [f"{removed} traço(s) de faca sem branco"] if removed else []
    try:
        _draw_white_pages(pdf, profile, settings, measured, layer, details)
    finally:
        measured.unlink(missing_ok=True)
    _register_layer(pdf, layer)
    sign = "spread" if settings.offset_mm > 0 else "choke"
    return AppliedFix(
        id="add_white_underbase",
        label=(
            f"Base branca \"{settings.spot_name}\" gerada ({settings.density_percent:g}%, "
            f"{sign} {abs(settings.offset_mm):g} mm, a partir de {settings.threshold_percent:g}% "
            "de opacidade"
            + (f"; {STRATEGY_TEXT[settings.strategy]}" if settings.strategy != "full" else "")
            + ")"
        ),
        details=details,
    )


def _draw_white_pages(pdf, profile, settings, rendered, layer, details) -> None:
    for index, page in enumerate(pdf.pages):
        if _already_applied(page, "add_white_underbase"):
            continue
        mask, _, box = white_mask(rendered, index, profile, settings)
        _isolate_existing_content(page)
        marked = draw_white(pdf, page, mask, box, settings, layer)
        _record(page, "add_white_underbase")
        details.append(f"página {index + 1}: {marked} px de branco")


_FIXES = {
    "upscale_images": _upscale,
    "set_page_boxes": _set_page_boxes,
    "add_bleed": _add_bleed,
    "assign_rgb_profile": _assign_rgb_profile,
    "convert_magenta_die_line": _convert_magenta,
    "add_cut_contour": _add_cut_contour,
    "add_crop_marks": _add_crop_marks,
}


def apply_fixes(
    source: Path, destination: Path, fixes: list[FixRequest], profile: ProductionProfile
) -> list[AppliedFix]:
    requested = {fix.id: fix for fix in fixes}
    applied: list[AppliedFix] = []
    if "image_to_pdf" in requested:
        # A client image becomes a PDF first; the other fixes then work on that PDF.
        converted = destination.with_name(f"{destination.stem}_imagem.pdf")
        applied.append(image_to_pdf(source, converted))
        source = converted
    try:
        with pikepdf.open(source) as pdf:
            for fix_id in _ORDER:
                if fix_id == "add_white_underbase" and fix_id in requested:
                    rendered = source
                    if applied:
                        rendered = destination.with_name(f"{destination.stem}_branco.pdf")
                        pdf.save(rendered)
                    try:
                        applied.append(
                            _add_white(pdf, profile, requested[fix_id].params, rendered)
                        )
                    finally:
                        if rendered != source:
                            rendered.unlink(missing_ok=True)
                elif fix_id == "add_contour_cut" and fix_id in requested:
                    # The artwork is rendered from the file as it is at this point, so the
                    # page boxes it is measured against are the ones the render shows
                    # (generated bleed moves the page corner).
                    rendered = source
                    if applied:
                        rendered = destination.with_name(f"{destination.stem}_contorno.pdf")
                        pdf.save(rendered)
                    try:
                        applied.append(
                            _add_contour_cut(pdf, profile, requested[fix_id].params, rendered)
                        )
                    finally:
                        if rendered != source:
                            rendered.unlink(missing_ok=True)
                elif fix_id in requested:
                    applied.append(_FIXES[fix_id](pdf, profile, requested[fix_id].params))
            pdf.save(destination)
    except FixError:
        raise
    except pikepdf.PdfError as exc:
        raise FixError(f"could not rewrite the PDF: {exc}") from exc
    return applied
