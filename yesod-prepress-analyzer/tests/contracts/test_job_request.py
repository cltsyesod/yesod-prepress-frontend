from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
import pytest

from app.contracts.job_request import JobRequest


BASE = {
    "analysisId": "ana-1",
    "projectId": "project-1",
    "fileId": "file-1",
    "versionId": "version-1",
    "downloadUrl": "https://files.example.com/private.pdf?token=secret",
    "productionProfile": {
        "id": "profile-1",
        "colorModeExpected": "CMYK",
        "minimumResolutionDpi": 300,
        "minimumBleedMm": 3,
        "minimumSafetyMarginMm": 3,
        "requiresCutLayer": True,
    },
    "callbackUrl": "https://skip.example.com/backend/v1/analyzer/callback",
}


def test_accepts_existing_skip_camel_case_contract():
    request = JobRequest.model_validate(BASE)
    assert request.analysis_id == "ana-1"
    assert str(request.file.url).startswith("https://files.example.com/")
    assert request.production_profile.minimum_resolution_dpi == 300
    assert request.production_profile.requires_cut_layer is True


def test_accepts_nested_download_source():
    payload = dict(BASE)
    payload.pop("downloadUrl")
    payload["file"] = {
        "url": "https://files.example.com/private.pdf",
        "sha256": "a" * 64,
        "sizeBytes": 1024,
    }
    request = JobRequest.model_validate(payload)
    assert request.file.sha256 == "a" * 64
    assert request.file.size_bytes == 1024


def test_rejects_job_without_private_download_url():
    payload = dict(BASE)
    payload.pop("downloadUrl")
    with pytest.raises(ValidationError):
        JobRequest.model_validate(payload)


def test_accepts_file_access_and_nested_callback_contract():
    payload = dict(BASE)
    payload.pop("downloadUrl")
    payload.pop("callbackUrl")
    payload["fileAccess"] = {
        "downloadUrl": "https://files.example.com/private.pdf",
        "accessToken": "private-token",
        "expiresAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
        "expectedSha256": "b" * 64,
        "expectedMimeType": "application/pdf",
        "maximumSizeBytes": 104857600,
    }
    payload["callback"] = {
        "url": "https://skip.example.com/backend/v1/analyzer/callback"
    }
    request = JobRequest.model_validate(payload)
    assert request.file.access_token == "private-token"
    assert request.file.sha256 == "b" * 64
    assert request.file.maximum_size_bytes == 104857600
    assert str(request.callback_url).endswith("/backend/v1/analyzer/callback")


def test_rejects_expired_file_access():
    payload = dict(BASE)
    payload.pop("downloadUrl")
    payload["fileAccess"] = {
        "downloadUrl": "https://files.example.com/private.pdf",
        "expiresAt": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
        "expectedMimeType": "application/pdf",
    }
    with pytest.raises(ValidationError, match="expired"):
        JobRequest.model_validate(payload)


def test_rejects_invalid_expected_mime():
    payload = dict(BASE)
    payload.pop("downloadUrl")
    payload["fileAccess"] = {
        "downloadUrl": "https://files.example.com/private.pdf",
        "expectedMimeType": "image/png",
    }
    with pytest.raises(ValidationError, match="application/pdf"):
        JobRequest.model_validate(payload)
