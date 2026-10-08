from __future__ import annotations

import asyncio

from app.contracts.nesting import NestingRequest
from app.core.config import get_settings
from app.services.nesting_service import NestingService
from app.workers.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="app.workers.nesting_task.nest_job",
    autoretry_for=(),
    acks_late=True,
)
def nest_job(self, payload: dict) -> None:
    request = NestingRequest.model_validate(payload)
    asyncio.run(NestingService(get_settings()).run(request))
