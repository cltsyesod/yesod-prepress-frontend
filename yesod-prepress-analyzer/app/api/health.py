from __future__ import annotations

import importlib
import shutil

from fastapi import APIRouter, Response, status
from redis import Redis

from app import __version__
from app.core.config import get_settings

router = APIRouter(tags=["health"])


def _module_available(module_name: str) -> bool:
    try:
        importlib.import_module(module_name)
        return True
    except Exception:
        return False


def _icc_available() -> bool:
    try:
        from PIL import ImageCms

        ImageCms.createProfile("sRGB")
        return True
    except Exception:
        return False


def readiness_checks() -> dict[str, bool]:
    settings = get_settings()
    checks = {
        "valkey": False,
        "qpdf": shutil.which("qpdf") is not None,
        "pikepdf": _module_available("pikepdf"),
        "pypdfium2": _module_available("pypdfium2"),
        "icc": _icc_available(),
    }
    try:
        checks["valkey"] = bool(Redis.from_url(settings.valkey_url).ping())
    except Exception:
        checks["valkey"] = False
    return checks


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "yesod-prepress-analyzer", "version": __version__}


@router.get("/ready")
def ready(response: Response) -> dict[str, object]:
    checks = readiness_checks()
    is_ready = all(checks.values())
    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if is_ready else "not_ready", "checks": checks}
