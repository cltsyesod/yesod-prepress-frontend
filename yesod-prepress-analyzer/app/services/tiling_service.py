from __future__ import annotations

import asyncio
import io
import logging
from uuid import uuid4

import httpx
import pypdfium2
from PIL import Image

from app.contracts.tiling import TilingCallback, TilingRequest
from app.core.config import Settings
from app.core.exceptions import AnalyzerError
from app.core.security import validate_outbound_url
from app.services.callback_client import CallbackClient
from app.services.file_downloader import FileDownloader
from app.services.file_uploader import FileUploader, UploadError
from app.services.temp_files import job_workspace
from app.tiling.package import build_package

logger = logging.getLogger(__name__)

_REFERENCE_MAX_BYTES = 60 * 1024 * 1024
_REFERENCE_TYPES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}


class ReferenceError(AnalyzerError):
    code = "REFERENCE_DOWNLOAD_FAILED"


class TilingService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.downloader = FileDownloader(settings)
        self.uploader = FileUploader(settings)
        self.callbacks = CallbackClient(settings)

    async def _reference(self, url: str) -> Image.Image:
        """The vehicle/building picture used only in the installation guide."""

        validate_outbound_url(
            url,
            self.settings.allowed_download_hosts,
            allow_http=self.settings.allow_http_downloads and not self.settings.is_production,
        )
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.settings.download_timeout_seconds),
                follow_redirects=False,
            ) as client:
                response = await client.get(url, headers={"User-Agent": self.settings.user_agent})
                response.raise_for_status()
        except httpx.HTTPError:
            raise ReferenceError("não foi possível baixar a imagem de referência") from None
        kind = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if kind not in _REFERENCE_TYPES or len(response.content) > _REFERENCE_MAX_BYTES:
            raise ReferenceError("imagem de referência inválida (use PNG, JPEG, WebP ou PDF)")
        if kind == "application/pdf":
            document = pypdfium2.PdfDocument(response.content)
            try:
                return document[0].render(scale=2, draw_annots=False).to_pil().convert("RGBA")
            finally:
                document.close()
        picture = Image.open(io.BytesIO(response.content))
        picture.load()
        return picture.convert("RGBA")

    async def run(self, request: TilingRequest) -> None:
        sequence = 0

        async def notify(event, status, progress, step, *, summary=None, error="") -> None:
            nonlocal sequence
            sequence += 1
            await self.callbacks.send(
                str(request.callback_url),
                TilingCallback(
                    event=event,
                    event_id=f"evt-{uuid4()}",
                    tilingId=request.tiling_id,
                    sequence=sequence,
                    status=status,
                    progress=progress,
                    currentStep=step,
                    summary=summary or {},
                    errorMessage=error[:4_000],
                ),
            )

        try:
            with job_workspace(f"tile-{request.tiling_id}", self.settings.temp_root) as workspace:
                await notify("progress", "running", 5, "Baixando a arte")
                source = workspace / "arte.pdf"
                await self.downloader.download(request.source, source)
                background = None
                if request.background is not None:
                    await notify("progress", "running", 15, "Baixando a imagem de referência")
                    background = await self._reference(str(request.background.url))

                await notify("progress", "running", 30, "Gerando os painéis e o guia")
                output = await asyncio.to_thread(
                    build_package, request, source, workspace, background
                )

                await notify("progress", "running", 80, "Salvando os arquivos")
                outputs = request.outputs
                pdf_size, _ = await self.uploader.upload(str(outputs.pdf), output.pdf)
                guide_size, _ = await self.uploader.upload(str(outputs.guide), output.guide)
                warnings = []
                try:
                    zip_size, _ = await self.uploader.upload(
                        str(outputs.zip), output.zip, content_type="application/zip"
                    )
                except UploadError:
                    # Every panel file carries the whole artwork; with very large art the
                    # package can pass the storage limit. The single PDF still has all panels.
                    zip_size = 0
                    warnings.append(
                        "O pacote .zip ficou grande demais para o armazenamento; use o PDF "
                        "com todos os painéis (uma página por painel)."
                    )
                # Each panel on its own, so one panel can be downloaded without the rest.
                uploaded: list[int] = []
                targets = [(n, url) for n, url in outputs.panels.items() if n in output.panels]
                for done, (number, url) in enumerate(targets, start=1):
                    try:
                        await self.uploader.upload(str(url), output.panels[number])
                        uploaded.append(number)
                    except UploadError:
                        logger.warning("panel upload failed", extra={"panel": number})
                    if done % 5 == 0 or done == len(targets):
                        await notify(
                            "progress",
                            "running",
                            80 + int(18 * done / len(targets)),
                            f"Salvando os painéis ({done} de {len(targets)})",
                        )
                if targets and len(uploaded) < len(targets):
                    warnings.append(
                        "Alguns painéis não puderam ser salvos separadamente; "
                        "eles estão no PDF com todos e no .zip."
                    )
                summary = {
                    **output.summary,
                    "sizes": {"pdf": pdf_size, "guide": guide_size, "zip": zip_size},
                    "panelFiles": sorted(uploaded),
                    "warnings": warnings,
                }
                await notify("completed", "completed", 100, "Painéis prontos", summary=summary)
        except Exception as exc:
            code = exc.code if isinstance(exc, AnalyzerError) else "UNEXPECTED_ERROR"
            logger.exception("tiling failed", extra={"tiling_id": request.tiling_id, "code": code})
            try:
                await notify("failed", "failed", 100, "Falha no painelamento", error=str(exc))
            except Exception:
                logger.exception("failed to report tiling failure")
            raise
