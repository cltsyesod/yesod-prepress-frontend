from __future__ import annotations

import asyncio

from app.contracts.tiling import TilingRequest
from app.core.config import get_settings
from app.services.tiling_service import TilingService
from app.workers.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="app.workers.tiling_task.tile_job",
    autoretry_for=(),
    acks_late=True,
)
def tile_job(self, payload: dict) -> None:
    request = TilingRequest.model_validate(payload)
    asyncio.run(TilingService(get_settings()).run(request))
