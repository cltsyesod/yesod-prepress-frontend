from __future__ import annotations

from datetime import UTC, datetime

from pydantic import (
    AliasChoices,
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.contracts.production_profile import ProductionProfile


class DownloadSource(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    url: AnyHttpUrl = Field(validation_alias=AliasChoices("url", "downloadUrl", "fileUrl"))
    sha256: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$")
    size_bytes: int | None = Field(
        default=None, ge=1, validation_alias=AliasChoices("sizeBytes", "size_bytes")
    )
    filename: str | None = None
    access_token: str | None = Field(
        default=None, repr=False, validation_alias=AliasChoices("accessToken", "access_token")
    )
    expires_at: datetime | None = Field(
        default=None, validation_alias=AliasChoices("expiresAt", "expires_at")
    )
    expected_mime_type: str = Field(
        default="application/pdf",
        validation_alias=AliasChoices("expectedMimeType", "expected_mime_type"),
    )
    maximum_size_bytes: int | None = Field(
        default=None,
        ge=1,
        validation_alias=AliasChoices("maximumSizeBytes", "maximum_size_bytes"),
    )

    @field_validator("expected_mime_type")
    @classmethod
    def require_pdf_mime(cls, value: str) -> str:
        normalized = value.split(";", 1)[0].strip().lower()
        if normalized != "application/pdf":
            raise ValueError("expectedMimeType must be application/pdf")
        return normalized

    @model_validator(mode="after")
    def require_unexpired_access(self) -> DownloadSource:
        if self.expires_at is not None:
            expires_at = self.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at <= datetime.now(UTC):
                raise ValueError("private file access has expired")
            self.expires_at = expires_at
        return self


class FileAccess(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    download_url: AnyHttpUrl = Field(
        validation_alias=AliasChoices("downloadUrl", "download_url")
    )
    access_token: str | None = Field(default=None, repr=False, alias="accessToken")
    expires_at: datetime | None = Field(default=None, alias="expiresAt")
    expected_sha256: str | None = Field(
        default=None, pattern=r"^[a-fA-F0-9]{64}$", alias="expectedSha256"
    )
    expected_mime_type: str = Field(default="application/pdf", alias="expectedMimeType")
    maximum_size_bytes: int | None = Field(default=None, ge=1, alias="maximumSizeBytes")


class CallbackTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: AnyHttpUrl


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    analysis_id: str = Field(
        min_length=1, validation_alias=AliasChoices("analysisId", "analysis_id", "jobId")
    )
    project_id: str = Field(
        min_length=1, validation_alias=AliasChoices("projectId", "project_id")
    )
    file_id: str = Field(min_length=1, validation_alias=AliasChoices("fileId", "file_id"))
    version_id: str = Field(
        default="", validation_alias=AliasChoices("versionId", "version_id")
    )
    production_profile: ProductionProfile = Field(
        validation_alias=AliasChoices("productionProfile", "production_profile")
    )
    callback_url: AnyHttpUrl | None = Field(
        default=None, validation_alias=AliasChoices("callbackUrl", "callback_url")
    )
    callback: CallbackTarget | None = None
    file: DownloadSource | None = None
    file_access: FileAccess | None = Field(default=None, alias="fileAccess")
    download_url: AnyHttpUrl | None = Field(
        default=None, validation_alias=AliasChoices("downloadUrl", "download_url", "fileUrl")
    )
    file_sha256: str | None = Field(
        default=None,
        pattern=r"^[a-fA-F0-9]{64}$",
        validation_alias=AliasChoices("fileSha256", "file_sha256", "sha256"),
    )
    file_size_bytes: int | None = Field(
        default=None,
        ge=1,
        validation_alias=AliasChoices("fileSizeBytes", "file_size_bytes", "sizeBytes"),
    )

    @model_validator(mode="after")
    def require_download_source(self) -> JobRequest:
        if self.file is None and self.file_access is not None:
            self.file = DownloadSource(
                url=self.file_access.download_url,
                sha256=self.file_access.expected_sha256,
                accessToken=self.file_access.access_token,
                expiresAt=self.file_access.expires_at,
                expectedMimeType=self.file_access.expected_mime_type,
                maximumSizeBytes=self.file_access.maximum_size_bytes,
            )
        elif self.file is None and self.download_url is not None:
            self.file = DownloadSource(
                url=self.download_url,
                sha256=self.file_sha256,
                size_bytes=self.file_size_bytes,
            )
        if self.file is None:
            raise ValueError("fileAccess, file.url or downloadUrl is required")
        if self.callback_url is None and self.callback is not None:
            self.callback_url = self.callback.url
        if self.callback_url is None:
            raise ValueError("callback.url or callbackUrl is required")
        return self


class JobAccepted(BaseModel):
    analysis_id: str
    external_job_id: str
    status: str = "queued"
    duplicate: bool = False


class JobStatus(BaseModel):
    analysisId: str
    externalJobId: str
    status: str
    progress: int = Field(ge=0, le=100)
    currentStep: str
    updatedAt: datetime
