from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import ValidationError
from redis import Redis

from app.contracts.job_request import JobAccepted, JobRequest, JobStatus
from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError
from app.core.security import verify_and_reserve_request
from app.workers.analysis_task import analyze_job

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _authenticate(
    *,
    redis: Redis,
    settings: Settings,
    body: bytes,
    timestamp: str | None,
    request_id: str | None,
    signature: str | None,
) -> None:
    try:
        verify_and_reserve_request(
            store=redis,
            secret=settings.inbound_signing_secret.get_secret_value(),
            timestamp=timestamp,
            request_id=request_id,
            signature=signature,
            body=body,
            tolerance=settings.signature_tolerance_seconds,
            replay_ttl=settings.request_id_ttl_seconds,
        )
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


def _status_key(external_job_id: str) -> str:
    return f"yesod:external-job:{external_job_id}:status"


@router.post("", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    request: Request,
    x_yesod_timestamp: str | None = Header(default=None),
    x_yesod_request_id: str | None = Header(default=None),
    x_yesod_signature: str | None = Header(default=None),
) -> JobAccepted:
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
        payload = JobRequest.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(include_input=False),
        ) from exc

    accepted_key = f"yesod:analysis:{payload.analysis_id}:accepted"
    existing = redis.get(accepted_key)
    if existing:
        return JobAccepted(
            analysis_id=payload.analysis_id,
            external_job_id=existing,
            duplicate=True,
        )

    task = analyze_job.apply_async(
        args=[payload.model_dump(mode="json")], queue=settings.celery_queue
    )
    if not redis.set(
        accepted_key,
        task.id,
        nx=True,
        ex=settings.operational_ttl_seconds,
    ):
        task.revoke(terminate=False)
        existing = redis.get(accepted_key) or task.id
        return JobAccepted(
            analysis_id=payload.analysis_id,
            external_job_id=existing,
            duplicate=True,
        )
    status_key = _status_key(task.id)
    redis.hset(
        status_key,
        mapping={
            "analysisId": payload.analysis_id,
            "externalJobId": task.id,
            "status": "queued",
            "progress": 0,
            "currentStep": "Aguardando processamento",
            "updatedAt": datetime.now(UTC).isoformat(),
        },
    )
    redis.expire(status_key, settings.operational_ttl_seconds)
    return JobAccepted(analysis_id=payload.analysis_id, external_job_id=task.id)


@router.delete("/{analysis_id}", status_code=status.HTTP_202_ACCEPTED)
async def cancel_job(
    analysis_id: str,
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
    key = f"yesod:analysis:{analysis_id}:cancelled"
    redis.set(key, "1", ex=settings.operational_ttl_seconds)
    return {"analysis_id": analysis_id, "status": "cancellation_requested"}


@router.get("/{external_job_id}", response_model=JobStatus)
async def get_job_status(
    external_job_id: str,
    request: Request,
    x_yesod_timestamp: str | None = Header(default=None),
    x_yesod_request_id: str | None = Header(default=None),
    x_yesod_signature: str | None = Header(default=None),
) -> JobStatus:
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
    stored = redis.hgetall(_status_key(external_job_id))
    if not stored:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return JobStatus.model_validate(stored)
