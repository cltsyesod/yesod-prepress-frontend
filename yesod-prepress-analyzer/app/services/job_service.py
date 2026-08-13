from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import uuid4

from redis import Redis

from app.analyzer.engine import AnalyzerEngine
from app.contracts.callback import CallbackEvent, CallbackPayload
from app.contracts.issue import AnalysisIssue
from app.contracts.job_request import JobRequest
from app.core.config import Settings
from app.core.exceptions import AnalyzerError, JobCancelled
from app.services.callback_client import CallbackClient
from app.services.file_downloader import FileDownloader
from app.services.temp_files import job_workspace

logger = logging.getLogger(__name__)


def _chunks(values: list[AnalysisIssue], size: int = 200) -> Iterable[list[AnalysisIssue]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


class JobService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.redis = Redis.from_url(settings.valkey_url, decode_responses=True)
        self.downloader = FileDownloader(settings)
        self.callbacks = CallbackClient(settings)
        self.engine = AnalyzerEngine(settings)

    def _key(self, analysis_id: str, suffix: str) -> str:
        return f"yesod:analysis:{analysis_id}:{suffix}"

    def _cancelled(self, analysis_id: str) -> bool:
        return self.redis.get(self._key(analysis_id, "cancelled")) == "1"

    def _set_status(
        self, analysis_id: str, external_job_id: str, status: str, progress: int, step: str
    ) -> None:
        key = f"yesod:external-job:{external_job_id}:status"
        self.redis.hset(
            key,
            mapping={
                "analysisId": analysis_id,
                "externalJobId": external_job_id,
                "status": status,
                "progress": progress,
                "currentStep": step,
                "updatedAt": datetime.now(UTC).isoformat(),
            },
        )
        self.redis.expire(key, self.settings.operational_ttl_seconds)

    async def run(self, request: JobRequest, external_job_id: str) -> None:
        sequence = 0

        async def notify(
            event: CallbackEvent,
            status: str,
            progress: int,
            step: str,
            *,
            issues: list[AnalysisIssue] | None = None,
            summary: dict[str, object] | None = None,
            error_code: str = "",
            error_message: str = "",
        ) -> None:
            nonlocal sequence
            sequence += 1
            self._set_status(request.analysis_id, external_job_id, status, progress, step)
            payload = CallbackPayload(
                event=event,
                event_id=f"evt-{uuid4()}",
                analysisId=request.analysis_id,
                externalJobId=external_job_id,
                sequence=sequence,
                status=status,
                progress=progress,
                currentStep=step,
                issues=issues or [],
                summary=summary or {},
                errorCode=error_code,
                errorMessage=error_message[:4_000],
            )
            await self.callbacks.send(str(request.callback_url), payload)

        try:
            await notify("progress", "preparing", 2, "Preparando análise")
            if self._cancelled(request.analysis_id):
                raise JobCancelled("job cancelled before download")
            with job_workspace(request.analysis_id, self.settings.temp_root) as workspace:
                pdf_path = workspace / "input.pdf"
                await notify("progress", "downloading", 8, "Baixando PDF privado")
                if request.file is None:  # Defensive guard; the request validator requires it.
                    raise AnalyzerError("validated job has no download source")
                await self.downloader.download(request.file, pdf_path)
                if self._cancelled(request.analysis_id):
                    raise JobCancelled("job cancelled after download")
                await notify("progress", "validating", 20, "Validando estrutura PDF")
                await notify("progress", "extracting", 35, "Inspecionando objetos técnicos")
                result = self.engine.analyze(pdf_path, request.production_profile)
                if self._cancelled(request.analysis_id):
                    raise JobCancelled("job cancelled during analysis")
                await notify("progress", "analyzing", 70, "Aplicando regras de pré-impressão")
                issue_batches = list(_chunks(result.issues))
                for index, batch in enumerate(issue_batches, start=1):
                    progress = min(94, 72 + int(index / max(1, len(issue_batches)) * 20))
                    await notify(
                        "issues", "analyzing", progress, "Enviando ocorrências", issues=batch
                    )
                await notify(
                    "completed",
                    result.final_status,
                    100,
                    "Análise concluída",
                    summary=result.summary,
                )
        except JobCancelled as exc:
            await notify("cancelled", "cancelled", 100, "Análise cancelada", error_message=str(exc))
        except Exception as exc:
            code = exc.code if isinstance(exc, AnalyzerError) else "UNEXPECTED_ERROR"
            logger.exception(
                "analysis job failed",
                extra={"analysis_id": request.analysis_id, "code": code},
            )
            try:
                await notify(
                    "failed",
                    "failed",
                    100,
                    "Falha na análise",
                    error_code=code,
                    error_message=str(exc),
                )
            except Exception:
                logger.exception(
                    "failed to report job failure", extra={"analysis_id": request.analysis_id}
                )
            raise
