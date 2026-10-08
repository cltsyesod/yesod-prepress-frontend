"""Desempenho do analisador com arquivos até o limite do MVP (50 MB por arquivo).

Para cada tamanho, gera uma arte sintética (fachada de 3000 × 1500 mm em 1:10, em TIFF RGB
sem compressão, que é o pior caso para o tamanho) e mede, num processo separado:

1. conversão da imagem em PDF;
2. análise de pré-impressão do PDF;
3. painelamento em 3 × 2 com sobreposição (PDF com todos, ZIP por painel, guia).

Uso: python scripts/benchmark_mvp.py [--sizes 5 15 30 45]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def peak_memory_mb() -> float | None:
    try:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    except ImportError:
        pass
    try:  # Windows
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        kernel32 = ctypes.windll.kernel32
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.K32GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(Counters),
            wintypes.DWORD,
        ]
        kernel32.K32GetProcessMemoryInfo(
            kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
        )
        return counters.PeakWorkingSetSize / 1_048_576
    except Exception:
        return None


def one(size_mb: float) -> dict:
    import numpy as np
    from PIL import Image

    from app.analyzer.engine import AnalyzerEngine
    from app.contracts.production_profile import ProductionProfile
    from app.contracts.tiling import TilingRequest
    from app.core.config import Settings
    from app.fixes.image_pdf import image_to_pdf
    from app.tiling.package import build_package

    work = Path(tempfile.mkdtemp(prefix="bench-"))
    # Fachada 2:1; RGB sem compressão: largura × altura × 3 bytes ≈ tamanho pedido.
    pixels = int(size_mb * 1_048_576 / 3)
    width = int((pixels * 2) ** 0.5)
    height = width // 2
    rng = np.random.default_rng(3)
    gradient = np.linspace(0, 255, width, dtype=np.float32)
    art = np.empty((height, width, 3), dtype=np.uint8)
    art[..., 0] = gradient
    art[..., 1] = gradient[::-1]
    art[..., 2] = rng.integers(0, 255, (height, width), dtype=np.uint8)  # textura de foto
    tiff = work / "fachada.tif"
    # 300 mm no arquivo (1:10) -> 3000 mm no tamanho final.
    Image.fromarray(art).save(tiff, dpi=(width / (300 / 25.4),) * 2)
    del art, gradient

    result: dict = {
        "tamanho_mb": round(tiff.stat().st_size / 1_048_576, 1),
        "pixels": f"{width} × {height}",
    }
    pdf = work / "fachada.pdf"
    start = time.perf_counter()
    image_to_pdf(tiff, pdf)
    result["conversao_s"] = round(time.perf_counter() - start, 2)
    result["pdf_mb"] = round(pdf.stat().st_size / 1_048_576, 1)

    # A análise usa o qpdf (instalado no servidor); sem ele, a etapa fica de fora da medição.
    if shutil.which("qpdf"):
        start = time.perf_counter()
        profile = ProductionProfile.model_validate({"id": "b", "fileScale": 10})
        AnalyzerEngine(Settings()).analyze(pdf, profile)
        result["analise_s"] = round(time.perf_counter() - start, 2)
    else:
        result["analise_s"] = "sem qpdf"

    tiles = []
    for row in range(2):
        for col in range(3):
            x, y = col * 1000, (1 - row) * 750
            left = 20 if col else 0
            bottom = 20 if row == 0 else 0
            tiles.append(
                {
                    "number": len(tiles) + 1,
                    "name": f"fachada_L{row + 1}C{col + 1}",
                    "column": col + 1,
                    "row": row + 1,
                    "visible": {"x": x, "y": y, "w": 1000, "h": 750},
                    "printed": {
                        "x": x - left,
                        "y": y - bottom,
                        "w": 1000 + left,
                        "h": 750 + bottom,
                    },
                }
            )
    request = TilingRequest.model_validate(
        {
            "tilingId": "bench",
            "callbackUrl": "https://example.com/cb",
            "outputs": {
                "pdf": "https://example.com/a",
                "zip": "https://example.com/b",
                "guide": "https://example.com/c",
            },
            "source": {"url": "https://example.com/art.pdf"},
            "fileScale": 10,
            "tiles": tiles,
        }
    )
    start = time.perf_counter()
    output = build_package(request, pdf, work)
    result["paineis_s"] = round(time.perf_counter() - start, 2)
    files = (("pdf_todos_mb", output.pdf), ("zip_mb", output.zip), ("guia_mb", output.guide))
    for key, path in files:
        result[key] = round(path.stat().st_size / 1_048_576, 1)
    result["memoria_pico_mb"] = round(peak_memory_mb() or 0)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", nargs="*", type=float, default=[5, 15, 30, 45])
    parser.add_argument("--one", type=float)
    args = parser.parse_args()
    if args.one is not None:
        print(json.dumps(one(args.one)))
        return
    rows = []
    for size in args.sizes:
        # Um processo por tamanho: o pico de memória medido é só daquele arquivo.
        command = [sys.executable, __file__, "--one", str(size)]
        done = subprocess.run(command, capture_output=True, text=True, check=False)  # noqa: S603
        if done.returncode:
            print(f"{size} MB falhou:\n{done.stderr[-2000:]}")
            continue
        rows.append(json.loads(done.stdout.strip().splitlines()[-1]))
        print(rows[-1], flush=True)
    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
