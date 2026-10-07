from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import ValidationError
from redis import Redis

from app.api.jobs import _authenticate
from app.contracts.nesting import NestingRequest
from app.core.config import get_settings
from app.workers.nesting_task import nest_job

router = APIRouter(prefix="/nesting", tags=["nesting"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_nesting(
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
        payload = NestingRequest.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(include_input=False),
        ) from exc

    key = f"yesod:nesting:{payload.nesting_id}:accepted"
    existing = redis.get(key)
    if existing:
        return {"nesting_id": payload.nesting_id, "external_job_id": existing, "status": "queued"}
    task = nest_job.apply_async(args=[payload.model_dump(mode="json")], queue=settings.celery_queue)
    redis.set(key, task.id, ex=settings.operational_ttl_seconds)
    return {"nesting_id": payload.nesting_id, "external_job_id": task.id, "status": "queued"}
