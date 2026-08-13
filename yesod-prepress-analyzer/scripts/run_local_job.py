from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import time

import httpx


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload", help="Path to a JSON job payload")
    parser.add_argument("--url", default="http://localhost:8000/v1/jobs")
    parser.add_argument("--secret", required=True)
    args = parser.parse_args()

    with open(args.payload, "rb") as payload_file:
        body = payload_file.read()
    timestamp = str(int(time.time()))
    request_id = f"local-{time.time_ns()}"
    signature = "sha256=" + hmac.new(
        args.secret.encode(),
        timestamp.encode() + b"." + request_id.encode() + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    response = httpx.post(
        args.url,
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Yesod-Timestamp": timestamp,
            "X-Yesod-Request-Id": request_id,
            "X-Yesod-Signature": signature,
        },
        timeout=30,
    )
    print(response.status_code, json.dumps(response.json(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
