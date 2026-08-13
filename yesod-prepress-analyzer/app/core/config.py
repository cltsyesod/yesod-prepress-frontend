from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "yesod-prepress-analyzer"
    environment: str = "development"
    log_level: str = "INFO"
    api_prefix: str = "/v1"

    inbound_signing_secret: SecretStr = SecretStr("change-me-inbound")
    callback_signing_secret: SecretStr = SecretStr("change-me-callback")
    signature_tolerance_seconds: Annotated[int, Field(ge=30, le=3600)] = 300
    request_id_ttl_seconds: Annotated[int, Field(ge=30, le=86_400)] = 600

    valkey_url: str = "redis://valkey:6379/0"
    celery_queue: str = "prepress"
    operational_ttl_seconds: Annotated[int, Field(ge=300)] = 86_400

    download_timeout_seconds: Annotated[float, Field(gt=0, le=600)] = 60.0
    callback_timeout_seconds: Annotated[float, Field(gt=0, le=120)] = 20.0
    callback_max_retries: Annotated[int, Field(ge=0, le=10)] = 4
    max_pdf_bytes: Annotated[int, Field(ge=1_048_576)] = 524_288_000
    max_pages: Annotated[int, Field(ge=1, le=100_000)] = 5_000
    qpdf_timeout_seconds: Annotated[int, Field(ge=1, le=600)] = 60
    pdfium_render_timeout_seconds: Annotated[int, Field(ge=1, le=600)] = 120
    temp_root: str | None = None

    allow_http_downloads: bool = False
    allowed_download_hosts: list[str] = []
    allowed_callback_hosts: list[str] = []
    user_agent: str = "yesod-prepress-analyzer/0.1.0"

    health_public_url: AnyHttpUrl | None = None

    @field_validator("allowed_download_hosts", "allowed_callback_hosts", mode="before")
    @classmethod
    def parse_hosts(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip().lower() for part in value.split(",") if part.strip()]
        return value

    @field_validator("inbound_signing_secret", "callback_signing_secret")
    @classmethod
    def reject_default_secret(cls, value: SecretStr, info):
        # Defaults make local setup convenient, but production must fail closed.
        environment = info.data.get("environment", "development")
        if environment == "production" and value.get_secret_value().startswith("change-me"):
            raise ValueError("signing secrets must be configured in production")
        return value

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
