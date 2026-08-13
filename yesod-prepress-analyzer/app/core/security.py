from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import socket
import time
from typing import Protocol
from urllib.parse import urlsplit

from app.core.exceptions import AuthenticationError, UnsafeUrlError


REQUEST_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"


class ReplayStore(Protocol):
    def set(self, name: str, value: str, *, nx: bool, ex: int) -> object: ...


def validate_request_id(request_id: str | None) -> str:
    if not request_id or re.fullmatch(REQUEST_ID_PATTERN, request_id) is None:
        raise AuthenticationError("invalid or missing request id")
    return request_id


def signature_for(secret: str, timestamp: str, request_id: str, body: bytes) -> str:
    message = (
        timestamp.encode("ascii")
        + b"."
        + request_id.encode("ascii")
        + b"."
        + body
    )
    return "sha256=" + hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify_signature(
    *,
    secret: str,
    timestamp: str | None,
    request_id: str | None,
    signature: str | None,
    body: bytes,
    tolerance: int,
) -> None:
    if not timestamp or not signature:
        raise AuthenticationError("missing signature headers")
    valid_request_id = validate_request_id(request_id)
    try:
        request_time = int(timestamp)
    except ValueError as exc:
        raise AuthenticationError("invalid signature timestamp") from exc
    if abs(int(time.time()) - request_time) > tolerance:
        raise AuthenticationError("signature timestamp outside tolerance")
    expected = signature_for(secret, timestamp, valid_request_id, body)
    if not hmac.compare_digest(expected, signature):
        raise AuthenticationError("invalid request signature")


def verify_and_reserve_request(
    *,
    store: ReplayStore,
    secret: str,
    timestamp: str | None,
    request_id: str | None,
    signature: str | None,
    body: bytes,
    tolerance: int,
    replay_ttl: int,
) -> None:
    verify_signature(
        secret=secret,
        timestamp=timestamp,
        request_id=request_id,
        signature=signature,
        body=body,
        tolerance=tolerance,
    )
    valid_request_id = validate_request_id(request_id)
    request_digest = hashlib.sha256(valid_request_id.encode("ascii")).hexdigest()
    ttl = max(tolerance, replay_ttl)
    if not store.set(f"yesod:request:{request_digest}", "1", nx=True, ex=ttl):
        raise AuthenticationError("request id has already been used")


def _is_public_ip(value: str) -> bool:
    ip = ipaddress.ip_address(value)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_outbound_url(url: str, allowed_hosts: list[str], allow_http: bool = False) -> str:
    parsed = urlsplit(url)
    if parsed.username or parsed.password:
        raise UnsafeUrlError("credentials in URL are not allowed")
    if parsed.scheme not in ({"https", "http"} if allow_http else {"https"}):
        raise UnsafeUrlError("URL scheme is not allowed")
    if not parsed.hostname:
        raise UnsafeUrlError("URL host is required")
    host = parsed.hostname.lower().rstrip(".")
    if allowed_hosts and host not in allowed_hosts:
        raise UnsafeUrlError("URL host is not allowlisted")
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, parsed.port or 443)}
    except socket.gaierror as exc:
        raise UnsafeUrlError("URL host could not be resolved") from exc
    if not addresses or not all(_is_public_ip(address) for address in addresses):
        raise UnsafeUrlError("URL resolves to a non-public address")
    return host
