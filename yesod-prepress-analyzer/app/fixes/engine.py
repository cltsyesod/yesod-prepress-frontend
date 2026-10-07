"""Automatic corrections applied to a copy of the client PDF.

Every fix is conservative: it never resamples images, converts colours or moves
artwork. It only writes page boxes and adds new, clearly separated objects (die
line, crop marks). The original file is kept by the caller; the corrected copy is
analysed again so the operator sees the result measured, not assumed.
"""

from __future__ import annotations

from pathlib import Path

import pikepdf

from app.analyzer.page_inspector import inspect_pages
from app.contracts.fix import AppliedFix, FixRequest
from app.contracts.production_profile import ProductionProfile
from app.core.exceptions import AnalyzerError
from app.fixes.geometry import MM, Box, describe_mm, expand, intersect, target_trim, visible_box

# Order matters: boxes first, because the die line and the marks use the TrimBox.
_ORDER = ("set_page_boxes", "add_cut_contour", "add_crop_marks")


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
        page.contents_add(
            (f"q {cs} CS 1 SCN {_num(width_pt)} w 0 J " + " ".join(segments) + " S Q\n").encode()
        )
        _record(page, "add_crop_marks")
        details.append(
            f"Página {info.number}: marcas em {describe_mm(trim, scale)} ({how}), "
            f"página ampliada para {describe_mm(outer, scale)}"
        )
    return AppliedFix(id="add_crop_marks", label="Marcas de corte inseridas", details=details)


_FIXES = {
    "set_page_boxes": _set_page_boxes,
    "add_cut_contour": _add_cut_contour,
    "add_crop_marks": _add_crop_marks,
}


def apply_fixes(
    source: Path, destination: Path, fixes: list[FixRequest], profile: ProductionProfile
) -> list[AppliedFix]:
    requested = {fix.id: fix for fix in fixes}
    applied: list[AppliedFix] = []
    try:
        with pikepdf.open(source) as pdf:
            for fix_id in _ORDER:
                if fix_id in requested:
                    applied.append(_FIXES[fix_id](pdf, profile, requested[fix_id].params))
            pdf.save(destination)
    except FixError:
        raise
    except pikepdf.PdfError as exc:
        raise FixError(f"could not rewrite the PDF: {exc}") from exc
    return applied
