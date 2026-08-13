from __future__ import annotations

import logging
from io import BytesIO

import pikepdf
from PIL import ImageCms

from app.analyzer.context import ColorInfo

logger = logging.getLogger(__name__)


def _resource_spots(page: pikepdf.Page) -> set[str]:
    names: set[str] = set()
    resources = page.obj.get("/Resources") or {}
    color_spaces = resources.get("/ColorSpace") if hasattr(resources, "get") else None
    if not color_spaces:
        return names
    for _, value in color_spaces.items():
        try:
            if isinstance(value, pikepdf.Array) and str(value[0]) in {"/Separation", "/DeviceN"}:
                if str(value[0]) == "/Separation":
                    names.add(str(value[1]).lstrip("/"))
                else:
                    names.update(str(item).lstrip("/") for item in value[1])
        except Exception:
            logger.debug("unable to inspect a color-space resource", exc_info=True)
            continue
    return names


def inspect_colors(pdf: pikepdf.Pdf) -> ColorInfo:
    info = ColorInfo()
    for page in pdf.pages:
        info.spot_names.update(_resource_spots(page))
        try:
            instructions = pikepdf.parse_content_stream(page)
        except Exception:
            logger.debug("unable to parse a page color content stream", exc_info=True)
            continue
        for operands, operator in instructions:
            op = str(operator)
            if op in {"rg", "RG"}:
                info.rgb_operators += 1
            elif op in {"k", "K"}:
                info.cmyk_operators += 1
                try:
                    coverage = sum(float(value) for value in operands[:4]) * 100
                    info.maximum_declared_ink_coverage = max(
                        info.maximum_declared_ink_coverage, coverage
                    )
                except (TypeError, ValueError):
                    pass
            elif op in {"g", "G"}:
                info.gray_operators += 1

    intents = pdf.Root.get("/OutputIntents")
    if intents and len(intents):
        intent = intents[0]
        info.output_intent_identifier = str(
            intent.get("/OutputConditionIdentifier", intent.get("/Info", ""))
        )
        profile = intent.get("/DestOutputProfile")
        if profile is not None:
            try:
                ImageCms.getOpenProfile(BytesIO(profile.read_bytes()))
                info.output_intent_valid = True
            except Exception:
                info.output_intent_valid = False
    return info
