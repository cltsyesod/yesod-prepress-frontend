from __future__ import annotations

import pikepdf


def inspect_layers(pdf: pikepdf.Pdf) -> set[str]:
    layers: set[str] = set()
    properties = pdf.Root.get("/OCProperties")
    if not properties:
        return layers
    groups = properties.get("/OCGs") or []
    for group in groups:
        name = group.get("/Name") if hasattr(group, "get") else None
        if name:
            layers.add(str(name))
    return layers
