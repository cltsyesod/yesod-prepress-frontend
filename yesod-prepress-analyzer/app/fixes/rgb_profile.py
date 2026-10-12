"""Untagged RGB gets a source profile: sRGB is *assigned*, never converted.

DeviceRGB says "some RGB" and leaves each RIP to guess; assigning sRGB (the profile
of cameras, screens and office software, and what RIPs assume by default) makes that
guess explicit and identical everywhere. The colour numbers stay exactly as they were:

- vectors and text: ``r g b rg`` becomes ``/sRGB cs r g b sc`` (and ``RG`` → ``CS``/``SC``);
- images, shadings and ``/DeviceRGB cs``: the colour space name is swapped for the
  ICC-based one, pixels untouched.

Content in pages and in every form XObject they use is rewritten; inline images are
counted and left as they are (rare in print files, and reported to the operator).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pikepdf
from PIL import ImageCms

logger = logging.getLogger(__name__)

_DEVICE_RGB = pikepdf.Name.DeviceRGB


@dataclass
class AssignReport:
    operators: int = 0
    images: int = 0
    shadings: int = 0
    inline_images: int = 0


def srgb_profile_bytes() -> bytes:
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def _icc_space(pdf: pikepdf.Pdf) -> pikepdf.Object:
    icc = pdf.make_stream(srgb_profile_bytes(), N=3, Alternate=_DEVICE_RGB)
    return pdf.make_indirect(pikepdf.Array([pikepdf.Name.ICCBased, icc]))


def _is_device_rgb(value) -> bool:
    return isinstance(value, pikepdf.Name) and value == _DEVICE_RGB


def _swap_space(holder: pikepdf.Object, space: pikepdf.Object) -> bool:
    """DeviceRGB (directly or as the base of an Indexed space) → the ICC space."""

    current = holder.get("/ColorSpace")
    if current is None:
        return False
    if _is_device_rgb(current):
        holder.ColorSpace = space
        return True
    if isinstance(current, pikepdf.Array) and len(current) >= 2:
        if current[0] == pikepdf.Name.Indexed and _is_device_rgb(current[1]):
            current[1] = space
            return True
    return False


def _resource_name(resources: pikepdf.Object, space: pikepdf.Object) -> pikepdf.Name:
    if "/ColorSpace" not in resources:
        resources.ColorSpace = pikepdf.Dictionary()
    spaces = resources.ColorSpace
    for key, value in spaces.items():
        if value.is_indirect and value.objgen == space.objgen:
            return pikepdf.Name(key)
    name, n = "/YesodsRGB", 1
    while name in spaces:
        n += 1
        name = f"/YesodsRGB{n}"
    spaces[name] = space
    return pikepdf.Name(name)


def _needs_space(instructions) -> bool:
    for item in instructions:
        if isinstance(item, pikepdf.ContentStreamInlineImage):
            continue
        op = str(item.operator)
        if op in {"rg", "RG"}:
            return True
        if op in {"cs", "CS"} and item.operands and _is_device_rgb(item.operands[0]):
            return True
    return False


def _rewrite_content(instructions, name: pikepdf.Name, report: AssignReport) -> tuple[list, bool]:
    out: list = []
    changed = False
    for item in instructions:
        if isinstance(item, pikepdf.ContentStreamInlineImage):
            colour = item.iimage.obj.get("/CS", item.iimage.obj.get("/ColorSpace"))
            if colour is not None and str(colour) in {"/RGB", "/DeviceRGB"}:
                report.inline_images += 1
            out.append(item)
            continue
        operands, operator = item.operands, item.operator
        op = str(operator)
        if op in {"rg", "RG"}:
            stroke = op == "RG"
            out.append(
                pikepdf.ContentStreamInstruction([name], pikepdf.Operator("CS" if stroke else "cs"))
            )
            out.append(
                pikepdf.ContentStreamInstruction(
                    list(operands), pikepdf.Operator("SC" if stroke else "sc")
                )
            )
            report.operators += 1
            changed = True
        elif op in {"cs", "CS"} and operands and _is_device_rgb(operands[0]):
            out.append(pikepdf.ContentStreamInstruction([name], operator))
            report.operators += 1
            changed = True
        else:
            out.append(pikepdf.ContentStreamInstruction(operands, operator))
    return out, changed


def _visit_resources(
    pdf: pikepdf.Pdf,
    resources: pikepdf.Object,
    space: pikepdf.Object,
    report: AssignReport,
    seen: set,
) -> None:
    for _, xobject in (resources.get("/XObject") or {}).items():
        if xobject.is_indirect:
            if xobject.objgen in seen:
                continue
            seen.add(xobject.objgen)
        subtype = xobject.get("/Subtype")
        if subtype == pikepdf.Name.Image:
            if _swap_space(xobject, space):
                report.images += 1
        elif subtype == pikepdf.Name.Form:
            _rewrite_form(pdf, xobject, space, report, seen)
    for _, shading in (resources.get("/Shading") or {}).items():
        if _swap_space(shading, space):
            report.shadings += 1
    for _, pattern in (resources.get("/Pattern") or {}).items():
        inner = pattern.get("/Shading")
        if inner is not None and _swap_space(inner, space):
            report.shadings += 1
        elif pattern.get("/PatternType") == 1:
            _rewrite_form(pdf, pattern, space, report, seen)


def _rewrite_form(
    pdf: pikepdf.Pdf,
    form: pikepdf.Object,
    space: pikepdf.Object,
    report: AssignReport,
    seen: set,
) -> None:
    if "/Resources" not in form:
        form.Resources = pikepdf.Dictionary()
    try:
        instructions = list(pikepdf.parse_content_stream(form))
    except Exception:
        logger.debug("unable to parse a form XObject", exc_info=True)
        return
    if _needs_space(instructions):
        name = _resource_name(form.Resources, space)
        out, _ = _rewrite_content(instructions, name, report)
        form.write(pikepdf.unparse_content_stream(out))
    else:
        _rewrite_content(instructions, pikepdf.Name("/Unused"), report)  # counts inline images
    _visit_resources(pdf, form.Resources, space, report, seen)


def assign_srgb(pdf: pikepdf.Pdf) -> AssignReport:
    report = AssignReport()
    space = _icc_space(pdf)
    seen: set = set()
    for page in pdf.pages:
        try:
            instructions = list(pikepdf.parse_content_stream(page))
        except Exception:
            logger.debug("unable to parse a page content stream", exc_info=True)
            continue
        resources = page.resources
        if _needs_space(instructions):
            name = _resource_name(resources, space)
            out, _ = _rewrite_content(instructions, name, report)
            page.obj.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
        else:
            _rewrite_content(instructions, pikepdf.Name("/Unused"), report)  # counts inline images
        _visit_resources(pdf, resources, space, report, seen)
    return report
