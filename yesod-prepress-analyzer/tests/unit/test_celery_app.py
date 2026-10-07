from app.workers.celery_app import celery_app


def test_worker_registers_analysis_task():
    # The worker starts with -A app.workers.celery_app:celery_app; this is what it loads.
    celery_app.loader.import_default_modules()
    assert "app.workers.analysis_task.analyze_job" in celery_app.tasks


def test_worker_registers_nesting_task():
    celery_app.loader.import_default_modules()
    assert "app.workers.nesting_task.nest_job" in celery_app.tasks
