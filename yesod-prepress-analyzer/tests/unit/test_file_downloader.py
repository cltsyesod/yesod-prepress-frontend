from pathlib import Path

import httpx
import pytest

from app.contracts.job_request import DownloadSource
from app.core.config import Settings
from app.core.exceptions import DownloadError
from app.services.file_downloader import FileDownloader


@pytest.mark.asyncio
async def test_job_specific_size_limit_is_enforced(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "app.services.file_downloader.validate_outbound_url", lambda *args, **kwargs: "files.test"
    )

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/pdf", "content-length": "20"},
            content=b"%PDF-" + b"0" * 15,
        )

    source = DownloadSource(
        url="https://files.test/private.pdf",
        expectedMimeType="application/pdf",
        maximumSizeBytes=10,
    )
    downloader = FileDownloader(Settings(), transport=httpx.MockTransport(handler))
    with pytest.raises(DownloadError, match="size limit"):
        await downloader.download(source, tmp_path / "input.pdf")


@pytest.mark.asyncio
async def test_access_token_is_sent_only_when_provided(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "app.services.file_downloader.validate_outbound_url", lambda *args, **kwargs: "files.test"
    )
    observed_authorization: list[str | None] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        observed_authorization.append(request.headers.get("authorization"))
        return httpx.Response(
            200,
            headers={"content-type": "application/pdf"},
            content=b"%PDF-test",
        )

    downloader = FileDownloader(Settings(), transport=httpx.MockTransport(handler))
    await downloader.download(
        DownloadSource(url="https://files.test/with-token.pdf", accessToken="token-value"),
        tmp_path / "with-token.pdf",
    )
    await downloader.download(
        DownloadSource(url="https://files.test/without-token.pdf"),
        tmp_path / "without-token.pdf",
    )
    assert observed_authorization == ["Bearer token-value", None]
