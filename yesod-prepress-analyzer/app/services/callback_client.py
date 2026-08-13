from __future__ import annotations

import asyncio
import json
import time

import httpx

from app.contracts.callback import CallbackPayload
from app.core.config import Settings
from app.core.exceptions import CallbackError
from app.core.security import signature_for, validate_outbound_url


class CallbackClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    async def send(self, url: str, payload: CallbackPayload) -> None:
        validate_outbound_url(
            url,
            self.settings.allowed_callback_hosts,
            allow_http=self.settings.allow_http_downloads and not self.settings.is_production,
        )
        body = json.dumps(
            payload.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        timestamp = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "User-Agent": self.settings.user_agent,
            "X-Yesod-Timestamp": timestamp,
            "X-Yesod-Request-Id": payload.event_id,
            "X-Yesod-Signature": signature_for(
                self.settings.callback_signing_secret.get_secret_value(),
                timestamp,
                payload.event_id,
                body,
            ),
            "X-Yesod-Event-Id": payload.event_id,
            "Idempotency-Key": payload.event_id,
        }
        timeout = httpx.Timeout(self.settings.callback_timeout_seconds)
        last_error: Exception | None = None
        for attempt in range(self.settings.callback_max_retries + 1):
            try:
                async with httpx.AsyncClient(
                    timeout=timeout, follow_redirects=False, transport=self.transport
                ) as client:
                    response = await client.post(url, content=body, headers=headers)
                if response.status_code in {200, 201, 202, 204, 409}:
                    return
                if response.status_code < 500 and response.status_code != 429:
                    raise CallbackError(
                        f"callback rejected payload with HTTP {response.status_code}"
                    )
                last_error = CallbackError(f"callback returned HTTP {response.status_code}")
            except (httpx.HTTPError, CallbackError) as exc:
                last_error = exc
                if isinstance(exc, CallbackError) and "rejected" in str(exc):
                    break
            if attempt < self.settings.callback_max_retries:
                await asyncio.sleep(min(2**attempt, 8))
        raise CallbackError(str(last_error or "callback failed"))
