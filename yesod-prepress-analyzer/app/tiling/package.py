"""Everything the operator downloads after tiling, built from the request."""

from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pikepdf
from PIL import Image

from app.contracts.tiling import TilingRequest
from app.tiling.export import (
    TilingError,
    art_frame,
    build_panels,
    neighbours,
    printed_area,
    safe_file_name,
)
from app.tiling.guide import build_guide


@dataclass(slots=True)
class TilingOutput:
    pdf: Path
    zip: Path
    guide: Path
    summary: dict


def build_package(
    request: TilingRequest, source: Path, workdir: Path, background: Image.Image | None = None
) -> TilingOutput:
    tiles = sorted(request.tiles, key=lambda t: t.number)
    sides = neighbours(tiles)
    total = len(tiles)
    files: list[dict] = []
    pdf_path, zip_path, guide_path = (
        workdir / "paineis.pdf",
        workdir / "paineis.zip",
        workdir / "guia.pdf",
    )

    with pikepdf.open(source) as pdf:
        if request.page > len(pdf.pages):
            raise TilingError(f"o arquivo tem {len(pdf.pages)} página(s)")
        index = request.page - 1
        frame = art_frame(pdf.pages[index], request.file_scale)

        # All panels in one PDF: the artwork is stored once (ideal to send to the RIP).
        build_panels(pdf, index, frame, tiles, request.marks, request.title, total, sides).save(
            pdf_path
        )

        guide = build_guide(
            source,
            index,
            frame,
            tiles,
            request.seams,
            sides,
            title=request.title,
            background=request.background,
            background_image=background,
        )
        guide.save(guide_path)

        used: set[str] = set()
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
            for tile in tiles:
                name = safe_file_name(tile.name)
                unique, n = name, 2
                while unique.casefold() in used:
                    unique, n = f"{name}_{n}", n + 1
                used.add(unique.casefold())
                single = build_panels(
                    pdf, index, frame, [tile], request.marks, request.title, total, sides
                )
                target = workdir / f"{unique}.pdf"
                single.save(target)
                archive.write(target, f"paineis/{unique}.pdf")
                target.unlink()
                printed = printed_area(tile, frame)
                files.append(
                    {
                        "number": tile.number,
                        "file": f"{unique}.pdf",
                        "region": tile.region,
                        "column": tile.column,
                        "row": tile.row,
                        "visibleMm": [round(tile.visible.w, 1), round(tile.visible.h, 1)],
                        "printedMm": [round(printed.w, 1), round(printed.h, 1)],
                        "neighbours": sides.get(tile.number, {}),
                    }
                )
            archive.write(guide_path, "GUIA_DE_INSTALACAO.pdf")
            archive.writestr(
                "configuracao.json",
                json.dumps(
                    {"title": request.title, "panels": files, "config": request.config},
                    ensure_ascii=False,
                    indent=2,
                ),
            )

    return TilingOutput(
        pdf=pdf_path,
        zip=zip_path,
        guide=guide_path,
        summary={"panels": total, "files": files},
    )
