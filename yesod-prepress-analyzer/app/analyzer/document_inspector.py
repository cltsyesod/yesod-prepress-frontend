from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium

from app.analyzer.color_inspector import inspect_colors
from app.analyzer.context import DocumentContext
from app.analyzer.font_inspector import inspect_fonts
from app.analyzer.image_inspector import inspect_images
from app.analyzer.layer_inspector import inspect_layers
from app.analyzer.page_inspector import inspect_pages
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings
from app.core.exceptions import InvalidPdfError


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_qpdf(path: Path, timeout: int) -> tuple[bool, str]:
    try:
        # The executable and argument vector are fixed; only our private temp path varies.
        process = subprocess.run(  # noqa: S603
            ["/usr/bin/qpdf", "--check", str(path)],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise InvalidPdfError("qpdf executable is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise InvalidPdfError("qpdf validation timed out") from exc
    output = "\n".join(part.strip() for part in (process.stdout, process.stderr) if part.strip())
    return process.returncode == 0, output[-16_000:]


def _validate_pdfium(path: Path) -> tuple[bool, int]:
    try:
        document = pdfium.PdfDocument(str(path))
        count = len(document)
        # Rendering the first and last page forces PDFium to parse page content.
        for index in sorted({0, max(0, count - 1)}):
            if count:
                page = document[index]
                bitmap = page.render(scale=0.15)
                bitmap.close()
                page.close()
        document.close()
        return True, count
    except Exception as exc:
        raise InvalidPdfError(f"PDFium could not render the document: {exc}") from exc


def inspect_document(path: Path, profile: ProductionProfile, settings: Settings) -> DocumentContext:
    if path.stat().st_size > settings.max_pdf_bytes:
        raise InvalidPdfError("PDF exceeds configured size limit")
    with path.open("rb") as source:
        if source.read(5) != b"%PDF-":
            raise InvalidPdfError("file does not have a PDF signature")

    qpdf_ok, qpdf_output = _run_qpdf(path, settings.qpdf_timeout_seconds)
    pdfium_ok, pdfium_pages = _validate_pdfium(path)
    try:
        pdf = pikepdf.open(path)
    except pikepdf.PasswordError as exc:
        raise InvalidPdfError("encrypted PDF requires a password") from exc
    except pikepdf.PdfError as exc:
        raise InvalidPdfError(f"pikepdf could not open the document: {exc}") from exc

    try:
        if len(pdf.pages) > settings.max_pages:
            raise InvalidPdfError("PDF exceeds configured page limit")
        metadata: dict[str, str] = {}
        with pdf.open_metadata(set_pikepdf_as_editor=False) as xmp:
            for key in (
                "pdfxid:GTS_PDFXVersion",
                "dc:title",
                "xmp:CreatorTool",
                "pdf:Producer",
            ):
                if xmp.get(key):
                    metadata[key] = str(xmp.get(key))
        docinfo_pdfx = str(pdf.docinfo.get("/GTS_PDFXVersion", ""))
        context = DocumentContext(
            path=path,
            profile=profile,
            file_size=path.stat().st_size,
            sha256=_sha256(path),
            pdf_version=str(pdf.pdf_version),
            page_count=len(pdf.pages),
            encrypted=bool(pdf.is_encrypted),
            linearized=bool(pdf.is_linearized),
            pdfx_version=metadata.get("pdfxid:GTS_PDFXVersion", docinfo_pdfx),
            qpdf_ok=qpdf_ok,
            qpdf_output=qpdf_output,
            pdfium_ok=pdfium_ok and pdfium_pages == len(pdf.pages),
            metadata=metadata,
            pages=inspect_pages(pdf),
            images=inspect_images(pdf),
            fonts=inspect_fonts(pdf),
            colors=inspect_colors(pdf),
            layers=inspect_layers(pdf),
        )
        context.facts["spot_names"] = sorted(context.colors.spot_names)
        return context
    finally:
        pdf.close()
