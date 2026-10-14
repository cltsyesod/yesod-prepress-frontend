"""Proporção de tintas: o arquivo separado como num RIP (Ghostscript, dispositivo tiffsep).

Cada separação (Ciano, Magenta, Amarelo, Preto e cada cor especial: Pantone, Branco,
faca…) vira uma imagem de tons de cinza; dela saem a cobertura média da tinta na página
(quanto da página ela pintaria a 100%), a área que ela toca e, somando as tintas de
processo, a cobertura total máxima. Sobreimpressão e transparência são tratadas pelo
Ghostscript como num RIP. RGB é convertido para CMYK pelo perfil padrão do Ghostscript:
mostra a proporção, não a conversão do RIP da gráfica. Falha nunca derruba a análise.
"""

from __future__ import annotations

import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image

MAX_PIXELS = 4_000_000
MAX_DPI = 72
MIN_DPI = 10
MAX_PAGES = 12
PROCESS = ("Cyan", "Magenta", "Yellow", "Black")
INK_FLOOR = 0.02  # abaixo de 2% de tinta o pixel não conta como "tocado"


def _gs() -> str | None:
    return shutil.which("gs") or shutil.which("gswin64c") or shutil.which("gswin32c")


def _dpi(path: Path) -> float:
    with pikepdf.open(path) as pdf:
        areas = []
        for page in list(pdf.pages)[:MAX_PAGES]:
            box = page.obj.get("/CropBox") or page.obj.get("/MediaBox")
            w, h = (float(box[2]) - float(box[0])) / 72, (float(box[3]) - float(box[1])) / 72
            areas.append(max(w * h, 1e-6))
    return max(MIN_DPI, min(MAX_DPI, math.sqrt(MAX_PIXELS / max(areas))))


def _ink(image_path: Path) -> np.ndarray:
    """Tinta 0–1 por pixel. O tiffsep grava cada separação com 0 = tinta cheia."""

    gray = np.asarray(Image.open(image_path).convert("L"), dtype=np.float32)
    return 1.0 - gray / 255.0


def measure_inks(path: Path, timeout: int = 120) -> dict:
    gs = _gs()
    if not gs:
        return {"pages": [], "error": "Ghostscript não instalado no analisador"}
    dpi = _dpi(path)
    with tempfile.TemporaryDirectory(prefix="inks_") as tmp:
        out = Path(tmp) / "p%d.tif"
        cmd = [
            gs,
            "-q",
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-sDEVICE=tiffsep",
            "-dUseCropBox",
            f"-dLastPage={MAX_PAGES}",
            f"-r{dpi:.2f}",
            f"-sOutputFile={out}",
            str(path),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=timeout)  # noqa: S603
        except subprocess.TimeoutExpired:
            return {"pages": [], "error": "separação demorou demais", "dpi": round(dpi, 1)}
        except subprocess.CalledProcessError as exc:
            message = (exc.stderr or b"").decode(errors="replace").strip()[:300]
            return {"pages": [], "error": f"Ghostscript falhou: {message}", "dpi": round(dpi, 1)}

        pages: dict[int, dict[str, Path]] = {}
        for file in Path(tmp).glob("p*(*).tif"):
            match = re.fullmatch(r"p(\d+)\((.+)\)\.tif", file.name)
            if match:
                pages.setdefault(int(match.group(1)), {})[match.group(2)] = file

        result = []
        for number in sorted(pages):
            separations = pages[number]
            names = [n for n in PROCESS if n in separations] + sorted(
                n for n in separations if n not in PROCESS
            )
            inks, process_sum = [], None
            for name in names:
                ink = _ink(separations[name])
                coverage = float(ink.mean())
                touched = float((ink > INK_FLOOR).mean())
                if name in PROCESS:
                    process_sum = ink if process_sum is None else process_sum + ink
                inks.append(
                    {
                        "name": name,
                        "process": name in PROCESS,
                        "coverage": round(coverage, 4),
                        "area": round(touched, 4),
                        "meanWhereUsed": round(float(ink[ink > INK_FLOOR].mean()), 4)
                        if touched
                        else 0.0,
                    }
                )
            total = sum(i["coverage"] for i in inks)
            for ink in inks:
                ink["share"] = round(ink["coverage"] / total, 4) if total else 0.0
            result.append(
                {
                    "page": number,
                    "inks": inks,
                    "maxProcessTotal": round(float(process_sum.max()) * 100, 1)
                    if process_sum is not None
                    else 0.0,
                }
            )
    return {"pages": result, "error": "", "dpi": round(dpi, 1)}


PROOF_MAX_SIDE_PX = 2400


def output_proof(path: Path, timeout: int = 120) -> list[tuple[int, bytes]]:
    """Prova de saída: a página como o RIP imprimiria (sobreimpressão simulada, cores
    especiais pelas suas alternativas), em PNG para a tela. Lista vazia sem Ghostscript."""

    gs = _gs()
    if not gs:
        return []
    with pikepdf.open(path) as pdf:
        sides = []
        for page in list(pdf.pages)[:MAX_PAGES]:
            box = page.obj.get("/CropBox") or page.obj.get("/MediaBox")
            sides.append(max(float(box[2]) - float(box[0]), float(box[3]) - float(box[1])) / 72)
    dpi = max(MIN_DPI, min(150, PROOF_MAX_SIDE_PX / max(max(sides), 1e-6)))
    with tempfile.TemporaryDirectory(prefix="proof_") as tmp:
        cmd = [
            gs,
            "-q",
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-sDEVICE=png16m",
            "-dOverprint=/simulate",
            "-dUseCropBox",
            "-dTextAlphaBits=4",
            "-dGraphicsAlphaBits=4",
            f"-dLastPage={MAX_PAGES}",
            f"-r{dpi:.2f}",
            f"-sOutputFile={Path(tmp) / 'p%d.png'}",
            str(path),
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=timeout)  # noqa: S603
        files = sorted(Path(tmp).glob("p*.png"), key=lambda f: int(f.stem[1:]))
        return [(int(f.stem[1:]), f.read_bytes()) for f in files]
