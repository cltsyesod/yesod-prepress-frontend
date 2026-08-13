import time

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.security import signature_for
from app.main import app


class FakeRedis:
    def __init__(self):
        self.replays: set[str] = set()
        self.status = {
            "analysisId": "analysis-1",
            "externalJobId": "external-1",
            "status": "analyzing",
            "progress": "42",
            "currentStep": "Inspecionando fontes",
            "updatedAt": "2026-08-04T04:00:00+00:00",
        }

    def set(self, name: str, value: str, *, nx: bool = False, ex: int | None = None):
        del value, ex
        if nx and name in self.replays:
            return False
        self.replays.add(name)
        return True

    def hgetall(self, _: str):
        return self.status


def signed_headers(request_id: str, body: bytes = b"") -> dict[str, str]:
    timestamp = str(int(time.time()))
    return {
        "X-Yesod-Timestamp": timestamp,
        "X-Yesod-Request-Id": request_id,
        "X-Yesod-Signature": signature_for("test-secret", timestamp, request_id, body),
    }


def test_status_endpoint_returns_only_safe_technical_fields(monkeypatch):
    redis = FakeRedis()
    settings = Settings(inbound_signing_secret="test-secret")
    monkeypatch.setattr("app.api.jobs.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.jobs.Redis.from_url", lambda *args, **kwargs: redis)

    response = TestClient(app).get(
        "/v1/jobs/external-1", headers=signed_headers("status-request-123")
    )

    assert response.status_code == 200
    assert response.json() == {
        "analysisId": "analysis-1",
        "externalJobId": "external-1",
        "status": "analyzing",
        "progress": 42,
        "currentStep": "Inspecionando fontes",
        "updatedAt": "2026-08-04T04:00:00Z",
    }


def test_status_endpoint_requires_request_id(monkeypatch):
    redis = FakeRedis()
    settings = Settings(inbound_signing_secret="test-secret")
    monkeypatch.setattr("app.api.jobs.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.jobs.Redis.from_url", lambda *args, **kwargs: redis)
    timestamp = str(int(time.time()))
    response = TestClient(app).get(
        "/v1/jobs/external-1",
        headers={"X-Yesod-Timestamp": timestamp, "X-Yesod-Signature": "sha256=invalid"},
    )
    assert response.status_code == 401
    assert "request id" in response.json()["detail"]
