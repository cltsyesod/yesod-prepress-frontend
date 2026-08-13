from __future__ import annotations

import asyncio

from app.contracts.job_request import JobRequest
from app.core.config import get_settings
from app.services.job_service import JobService
from app.workers.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="app.workers.analysis_task.analyze_job",
    autoretry_for=(),
    acks_late=True,
)
def analyze_job(self, payload: dict) -> None:
    request = JobRequest.model_validate(payload)
    asyncio.run(JobService(get_settings()).run(request, self.request.id))
