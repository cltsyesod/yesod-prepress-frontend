from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.core.config import get_settings
from app.core.exceptions import AnalyzerError
from app.core.logging import configure_logging


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    yield


settings = get_settings()
app = FastAPI(
    title="Yesod Prepress Analyzer",
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.include_router(health_router)
app.include_router(jobs_router, prefix=settings.api_prefix)


@app.exception_handler(AnalyzerError)
async def analyzer_error_handler(_, exc: AnalyzerError):
    return JSONResponse(status_code=400, content={"code": exc.code, "detail": str(exc)})
