from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.contracts.job_request import DownloadSource
from app.core.config import Settings
from app.core.exceptions import DownloadError
from app.core.security import validate_outbound_url
from app.fixes.image_pdf import sniff


class FileDownloader:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ):
        self.settings = settings
        self.transport = transport

    async def download(self, source: DownloadSource, destination: Path) -> tuple[int, str]:
        if source.expires_at is not None and source.expires_at <= datetime.now(UTC):
            raise DownloadError("private file access expired before download")
        validate_outbound_url(
            str(source.url),
            self.settings.allowed_download_hosts,
            allow_http=self.settings.allow_http_downloads and not self.settings.is_production,
        )
        digest = hashlib.sha256()
        size = 0
        timeout = httpx.Timeout(self.settings.download_timeout_seconds)
        headers = {"User-Agent": self.settings.user_agent, "Accept": source.expected_mime_type}
        if source.access_token:
            headers["Authorization"] = f"Bearer {source.access_token}"
        job_limit = min(
            self.settings.max_pdf_bytes,
            source.maximum_size_bytes or self.settings.max_pdf_bytes,
        )
        try:
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=False, transport=self.transport
            ) as client:
                async with client.stream("GET", str(source.url), headers=headers) as response:
                    response.raise_for_status()
                    response_mime = response.headers.get("content-type", "").split(";", 1)[0]
                    if response_mime.strip().lower() != source.expected_mime_type:
                        raise DownloadError("remote file MIME type does not match the signed job")
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > job_limit:
                        raise DownloadError("remote PDF exceeds configured size limit")
                    with destination.open("xb") as output:
                        async for chunk in response.aiter_bytes(1024 * 1024):
                            size += len(chunk)
                            if size > job_limit:
                                raise DownloadError("download exceeded configured size limit")
                            digest.update(chunk)
                            output.write(chunk)
        except DownloadError:
            destination.unlink(missing_ok=True)
            raise
        except (httpx.HTTPError, OSError, ValueError):
            destination.unlink(missing_ok=True)
            raise DownloadError("private PDF download failed") from None

        actual_sha = digest.hexdigest()
        if source.size_bytes is not None and source.size_bytes != size:
            destination.unlink(missing_ok=True)
            raise DownloadError("downloaded size does not match signed job metadata")
        if source.sha256 is not None and source.sha256.lower() != actual_sha:
            destination.unlink(missing_ok=True)
            raise DownloadError("downloaded SHA-256 does not match signed job metadata")
        if size < 5:
            destination.unlink(missing_ok=True)
            raise DownloadError("downloaded file is empty")
        # The content must really be what the signed job says (PDF, TIFF, JPEG or PNG).
        if sniff(destination) != source.expected_mime_type:
            destination.unlink(missing_ok=True)
            raise DownloadError(
                "downloaded file is not a PDF"
                if source.expected_mime_type == "application/pdf"
                else "downloaded file does not match its image type"
            )
        return size, actual_sha
