import json

import httpx
import pytest

from app.contracts.callback import CallbackPayload
from app.core.config import Settings
from app.core.security import signature_for
from app.services.callback_client import CallbackClient


def test_callback_serializes_camel_case_contract():
    payload = CallbackPayload(
        event="progress",
        event_id="event-12345678",
        analysisId="analysis-1",
        externalJobId="job-1",
        sequence=1,
        status="analyzing",
        progress=50,
        currentStep="Analisando páginas",
        errorCode="",
        errorMessage="",
    )
    serialized = payload.model_dump(mode="json")
    assert serialized["analysisId"] == "analysis-1"
    assert serialized["externalJobId"] == "job-1"
    assert serialized["currentStep"] == "Analisando páginas"
    assert "external_job_id" not in serialized
    assert "current_step" not in serialized


@pytest.mark.asyncio
async def test_callback_request_uses_request_id_in_signature(monkeypatch):
    monkeypatch.setattr(
        "app.services.callback_client.validate_outbound_url",
        lambda *args, **kwargs: "skip.example.com",
    )
    observed: dict[str, str | bytes] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        observed["body"] = request.content
        observed["timestamp"] = request.headers["X-Yesod-Timestamp"]
        observed["request_id"] = request.headers["X-Yesod-Request-Id"]
        observed["signature"] = request.headers["X-Yesod-Signature"]
        return httpx.Response(202)

    payload = CallbackPayload(
        event="completed",
        event_id="callback-event-123",
        analysisId="analysis-1",
        externalJobId="job-1",
        sequence=1,
        status="completed",
        progress=100,
        currentStep="Concluído",
    )
    client = CallbackClient(
        Settings(callback_signing_secret="callback-secret"),
        transport=httpx.MockTransport(handler),
    )
    await client.send("https://skip.example.com/backend/v1/analyzer/callback", payload)

    assert json.loads(observed["body"])["externalJobId"] == "job-1"
    assert observed["signature"] == signature_for(
        "callback-secret",
        observed["timestamp"],
        observed["request_id"],
        observed["body"],
    )
