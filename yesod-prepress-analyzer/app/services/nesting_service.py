from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from app.contracts.nesting import NestingCallback, NestingRequest
from app.core.config import Settings
from app.core.exceptions import AnalyzerError
from app.nesting.imposition import CutLines
from app.nesting.marks import Marks
from app.nesting.planner import PlanItem, PlanOptions, plan
from app.services.callback_client import CallbackClient
from app.services.file_downloader import FileDownloader
from app.services.file_uploader import FileUploader
from app.services.temp_files import job_workspace

logger = logging.getLogger(__name__)


class NestingService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.downloader = FileDownloader(settings)
        self.uploader = FileUploader(settings)
        self.callbacks = CallbackClient(settings)

    async def run(self, request: NestingRequest) -> None:
        sequence = 0

        async def notify(event, status, progress, step, *, summary=None, error="") -> None:
            nonlocal sequence
            sequence += 1
            await self.callbacks.send(
                str(request.callback_url),
                NestingCallback(
                    event=event,
                    event_id=f"evt-{uuid4()}",
                    nestingId=request.nesting_id,
                    sequence=sequence,
                    status=status,
                    progress=progress,
                    currentStep=step,
                    summary=summary or {},
                    errorMessage=error[:4_000],
                ),
            )

        try:
            with job_workspace(f"nest-{request.nesting_id}", self.settings.temp_root) as workspace:
                items: list[PlanItem] = []
                for index, source in enumerate(request.items, start=1):
                    await notify(
                        "progress",
                        "running",
                        5 + int(40 * (index - 1) / len(request.items)),
                        f"Baixando {source.label or 'arquivo'} ({index} de {len(request.items)})",
                    )
                    path = workspace / f"item-{index}.pdf"
                    await self.downloader.download(source.file, path)
                    items.append(
                        PlanItem(
                            key=source.key,
                            path=path,
                            label=source.label,
                            quantity=source.quantity,
                            pages=source.pages,
                            file_scale=source.file_scale,
                            bleed_mm=source.bleed_mm,
                            cut_names=source.cut_names,
                            use_die_line=source.use_die_line,
                        )
                    )

                await notify("progress", "running", 50, "Encaixando as peças")
                material = request.material
                options = PlanOptions(
                    width_mm=material.width_mm,
                    length_mm=material.length_mm,
                    margin_mm=material.margin_mm,
                    gap_mm=material.gap_mm,
                    allow_rotation=request.rotation.allow,
                    rotation_step=request.rotation.step_degrees,
                    cut_lines=CutLines(
                        add=request.cut_lines.add,
                        name=request.cut_lines.name,
                        offset_mm=request.cut_lines.offset_mm,
                        merge_mm=request.cut_lines.merge_mm,
                        cut_holes=request.cut_lines.cut_holes,
                        white_is_background=request.cut_lines.white_background != "keep",
                    ),
                    marks=Marks(
                        registration=request.marks.registration,
                        shape=request.marks.shape,
                        size_mm=request.marks.size_mm,
                        distance_mm=request.marks.distance_mm,
                        spacing_mm=request.marks.spacing_mm,
                        crop_marks=request.marks.crop_marks,
                        slug=request.marks.slug,
                    ),
                    max_roll_length_mm=material.max_roll_length_mm,
                )
                output = workspace / "montagem.pdf"
                # CPU-bound: keep the event loop free for nothing else, but off the main thread.
                summary = await asyncio.to_thread(plan, items, options, output)

                await notify("progress", "running", 90, "Salvando o PDF montado")
                size, sha256 = await self.uploader.upload(str(request.output_upload_url), output)
                summary["output"] = {"sizeBytes": size, "sha256": sha256}
                await notify("completed", "completed", 100, "Montagem concluída", summary=summary)
        except Exception as exc:
            code = exc.code if isinstance(exc, AnalyzerError) else "UNEXPECTED_ERROR"
            logger.exception(
                "nesting failed", extra={"nesting_id": request.nesting_id, "code": code}
            )
            try:
                await notify("failed", "failed", 100, "Falha na montagem", error=str(exc))
            except Exception:
                logger.exception("failed to report nesting failure")
            raise
