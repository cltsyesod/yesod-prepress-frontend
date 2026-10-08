from __future__ import annotations

import hashlib
from pathlib import Path

import httpx

from app.core.config import Settings
from app.core.exceptions import AnalyzerError
from app.core.security import validate_outbound_url


class UploadError(AnalyzerError):
    code = "UPLOAD_FAILED"


class FileUploader:
    """Uploads the corrected PDF to the signed upload URL created by the backend."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ):
        self.settings = settings
        self.transport = transport

    async def upload(
        self, url: str, source: Path, content_type: str = "application/pdf"
    ) -> tuple[int, str]:
        # Same storage as the downloads, so the same allowlist applies.
        validate_outbound_url(
            url,
            self.settings.allowed_download_hosts,
            allow_http=self.settings.allow_http_downloads and not self.settings.is_production,
        )
        data = source.read_bytes()
        headers = {
            "User-Agent": self.settings.user_agent,
            "Content-Type": content_type,
            "x-upsert": "true",
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.settings.download_timeout_seconds),
                follow_redirects=False,
                transport=self.transport,
            ) as client:
                response = await client.put(url, content=data, headers=headers)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise UploadError(
                f"corrected PDF upload rejected (HTTP {exc.response.status_code})"
            ) from None
        except httpx.HTTPError:
            raise UploadError("corrected PDF upload failed") from None
        return len(data), hashlib.sha256(data).hexdigest()
