from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery("yesod_prepress", broker=settings.valkey_url, backend=settings.valkey_url)
celery_app.conf.update(
    task_default_queue=settings.celery_queue,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_expires=settings.operational_ttl_seconds,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    timezone="America/Sao_Paulo",
    enable_utc=True,
)
celery_app.autodiscover_tasks(["app.workers"])
