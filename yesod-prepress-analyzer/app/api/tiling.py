from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import ValidationError
from redis import Redis

from app.api.jobs import _authenticate
from app.contracts.tiling import TilingRequest
from app.core.config import get_settings
from app.workers.tiling_task import tile_job

router = APIRouter(prefix="/tiling", tags=["tiling"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_tiling(
    request: Request,
    x_yesod_timestamp: str | None = Header(default=None),
    x_yesod_request_id: str | None = Header(default=None),
    x_yesod_signature: str | None = Header(default=None),
) -> dict[str, str]:
    settings = get_settings()
    body = await request.body()
    redis = Redis.from_url(settings.valkey_url, decode_responses=True)
    _authenticate(
        redis=redis,
        settings=settings,
        body=body,
        timestamp=x_yesod_timestamp,
        request_id=x_yesod_request_id,
        signature=x_yesod_signature,
    )
    try:
        payload = TilingRequest.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(include_input=False),
        ) from exc

    # Each export is a new request id, so no idempotency key beyond the signature replay guard.
    task = tile_job.apply_async(args=[payload.model_dump(mode="json")], queue=settings.celery_queue)
    return {"tiling_id": payload.tiling_id, "external_job_id": task.id, "status": "queued"}
