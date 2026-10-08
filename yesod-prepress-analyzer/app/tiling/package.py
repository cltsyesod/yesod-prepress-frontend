"""Everything the operator downloads after tiling, built from the request."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pikepdf
from PIL import Image

from app.contracts.tiling import TilingRequest
from app.tiling.crop import CropStats, ImageCache, cropped_source
from app.tiling.cut import plan_cut
from app.tiling.export import (
    TilingError,
    art_frame,
    build_panels,
    check_constraint,
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
    revision = request.revision_number
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
        # The screen validates too; no file leaves here from a layout that cannot be printed.
        check_constraint(tiles, frame, request.constraint)
        cut = plan_cut(source, index, frame, request.cut_settings)

        # All panels in one PDF: the artwork is stored once (ideal to send to the RIP).
        build_panels(
            pdf, index, frame, tiles, request.marks, request.title, total, sides, cut
        ).save(pdf_path)

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
            revision=revision,
        )
        guide.save(guide_path)

        used: set[str] = set()
        decoded = ImageCache()
        crop_stats = CropStats()
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
            for tile in tiles:
                name = safe_file_name(tile.name)
                unique, n = name, 2
                while unique.casefold() in used:
                    unique, n = f"{name}_{n}", n + 1
                used.add(unique.casefold())
                # One file per panel: its images keep only the pixels the panel shows.
                art, art_index = pdf, index
                try:
                    art = cropped_source(
                        pdf, index, frame, printed_area(tile, frame), decoded, crop_stats
                    )
                    art_index = 0
                except (ValueError, pikepdf.PdfError):
                    art, art_index = pdf, index
                single = build_panels(
                    art, art_index, frame, [tile], request.marks, request.title, total, sides, cut
                )
                target = workdir / f"{unique}.pdf"
                single.save(target)
                archive.write(target, f"paineis/{unique}.pdf")
                target.unlink()
                printed = printed_area(tile, frame)
                white = tile.white
                files.append(
                    {
                        "number": tile.number,
                        "id": tile.id,
                        "file": f"{unique}.pdf",
                        "region": tile.region,
                        "column": tile.column,
                        "row": tile.row,
                        "visibleMm": [round(tile.visible.w, 1), round(tile.visible.h, 1)],
                        "printedMm": [round(printed.w, 1), round(printed.h, 1)],
                        "physicalMm": [
                            round(printed.w + white.left + white.right, 1),
                            round(printed.h + white.top + white.bottom, 1),
                        ],
                        "rotation": tile.rotation,
                        "install": tile.install,
                        "neighbours": sides.get(tile.number, {}),
                    }
                )
            archive.write(guide_path, "GUIA_DE_INSTALACAO.pdf")
            archive.writestr("manifesto.csv", manifest_csv(files, request.title, revision))
            archive.writestr(
                "configuracao.json",
                json.dumps(
                    {
                        "title": request.title,
                        "revision": revision,
                        "panels": files,
                        "config": request.config,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )

    return TilingOutput(
        pdf=pdf_path,
        zip=zip_path,
        guide=guide_path,
        summary={
            "panels": total,
            "revision": revision,
            "files": files,
            "cut": {
                "contour": bool(cut and cut.contour is not None),
                "panelEdge": bool(cut and cut.panel_edge),
                "name": cut.name if cut else "",
            },
            "imageCrop": {
                "cropped": crop_stats.cropped,
                "dropped": crop_stats.dropped,
                "kept": crop_stats.kept,
                "keptBecause": sorted(crop_stats.reasons),
            },
        },
    )


_ROTATION = {0: "em pé", 90: "deitado", 180: "em pé 180°", 270: "deitado 180°"}
_SIDES = (("left", "esq."), ("right", "dir."), ("top", "acima"), ("bottom", "abaixo"))


def manifest_csv(files: list[dict], title: str, revision: int) -> str:
    """One line per panel file, ready to open in a spreadsheet (pt-BR: ';' and decimal comma)."""

    def mm(value: float) -> str:
        return f"{value:.1f}".replace(".", ",")

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(
        [
            "Projeto",
            "Revisão",
            "Nº",
            "Posição",
            "Arquivo",
            "Área",
            "Ordem de instalação",
            "Cobre L (mm)",
            "Cobre A (mm)",
            "Impresso L (mm)",
            "Impresso A (mm)",
            "Físico L (mm)",
            "Físico A (mm)",
            "Na mídia",
            "Vizinhos",
        ]
    )
    for f in files:
        around = f["neighbours"]
        near = ", ".join(f"{label} {around[side]:02d}" for side, label in _SIDES if side in around)
        writer.writerow(
            [
                title,
                f"R{revision}",
                f"{f['number']:02d}",
                f.get("id", ""),
                f["file"],
                f["region"],
                f"{f['install']}º" if f.get("install") else "",
                *(mm(v) for v in (*f["visibleMm"], *f["printedMm"], *f["physicalMm"])),
                _ROTATION.get(f["rotation"], ""),
                near,
            ]
        )
    # BOM: Excel opens UTF-8 with accents correctly.
    return "﻿" + buffer.getvalue()
