import time

import pytest

from app.core.exceptions import AuthenticationError
from app.core.security import signature_for, verify_and_reserve_request, verify_signature


class MemoryReplayStore:
    def __init__(self):
        self.values: dict[str, tuple[str, int]] = {}

    def set(self, name: str, value: str, *, nx: bool, ex: int):
        if nx and name in self.values:
            return False
        self.values[name] = (value, ex)
        return True


def signed_request(body: bytes = b'{"analysisId":"ana-1"}'):
    timestamp = str(int(time.time()))
    request_id = "request-12345678"
    signature = signature_for("secret", timestamp, request_id, body)
    return timestamp, request_id, signature, body


def test_valid_signature_is_accepted():
    timestamp, request_id, signature, body = signed_request()
    verify_signature(
        secret="secret",
        timestamp=timestamp,
        request_id=request_id,
        signature=signature,
        body=body,
        tolerance=300,
    )


def test_request_id_is_required():
    timestamp, _, _, body = signed_request()
    with pytest.raises(AuthenticationError, match="request id"):
        verify_signature(
            secret="secret",
            timestamp=timestamp,
            request_id=None,
            signature="sha256=invalid",
            body=body,
            tolerance=300,
        )


def test_invalid_signature_is_rejected():
    timestamp, request_id, _, body = signed_request()
    with pytest.raises(AuthenticationError, match="invalid request signature"):
        verify_signature(
            secret="secret",
            timestamp=timestamp,
            request_id=request_id,
            signature="sha256=" + "0" * 64,
            body=body,
            tolerance=300,
        )


def test_expired_timestamp_is_rejected():
    body = b"payload"
    timestamp = str(int(time.time()) - 600)
    request_id = "expired-12345678"
    signature = signature_for("secret", timestamp, request_id, body)
    with pytest.raises(AuthenticationError, match="outside tolerance"):
        verify_signature(
            secret="secret",
            timestamp=timestamp,
            request_id=request_id,
            signature=signature,
            body=body,
            tolerance=300,
        )


def test_request_id_replay_is_rejected_and_ttl_covers_tolerance():
    store = MemoryReplayStore()
    timestamp, request_id, signature, body = signed_request()
    kwargs = {
        "store": store,
        "secret": "secret",
        "timestamp": timestamp,
        "request_id": request_id,
        "signature": signature,
        "body": body,
        "tolerance": 300,
        "replay_ttl": 60,
    }
    verify_and_reserve_request(**kwargs)
    assert next(iter(store.values.values()))[1] == 300
    with pytest.raises(AuthenticationError, match="already been used"):
        verify_and_reserve_request(**kwargs)
