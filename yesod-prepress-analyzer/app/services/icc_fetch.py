"""Baixa os perfis ICC do perfil de produção (link assinado da biblioteca da empresa).

Mesma proteção do download da arte: só hosts permitidos, sem redirecionamento, tamanho
limitado e conferência da assinatura "acsp" do cabeçalho ICC.
"""

from __future__ import annotations

from pathlib import Path

import httpx

from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings
from app.core.exceptions import DownloadError
from app.core.security import validate_outbound_url

MAX_ICC_BYTES = 20 * 1024 * 1024


async def fetch_icc(url: str, destination: Path, settings: Settings) -> Path:
    validate_outbound_url(
        url,
        settings.allowed_download_hosts,
        allow_http=settings.allow_http_downloads and not settings.is_production,
    )
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(settings.download_timeout_seconds), follow_redirects=False
    ) as client:
        response = await client.get(url, headers={"User-Agent": settings.user_agent})
        response.raise_for_status()
        data = response.content
    if len(data) > MAX_ICC_BYTES:
        raise DownloadError("perfil ICC maior que o limite")
    if len(data) < 128 or data[36:40] != b"acsp":
        raise DownloadError("o arquivo recebido não é um perfil ICC")
    destination.write_bytes(data)
    return destination


async def fetch_color_profiles(
    profile: ProductionProfile, folder: Path, settings: Settings
) -> dict[str, Path | str]:
    """{'output': caminho, 'rgb': caminho} ou {'error': motivo}; vazio sem perfis."""

    files: dict[str, Path | str] = {}
    try:
        if profile.color.output:
            files["output"] = await fetch_icc(
                str(profile.color.output.url), folder / "out.icc", settings
            )
        if profile.color.rgb_source:
            files["rgb"] = await fetch_icc(
                str(profile.color.rgb_source.url), folder / "rgb.icc", settings
            )
    except Exception as exc:  # noqa: BLE001 - sem perfil, a análise segue e avisa
        return {"error": str(exc)}
    return files
