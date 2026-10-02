from __future__ import annotations

import asyncio
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Configuração de logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("yesod-prepress-analyzer")

# Modelos Pydantic
class AnalysisRequest(BaseModel):
    job_id: str
    pdf_url: str
    callback_url: str
    production_profile_id: Optional[str] = None


class AnalysisIssueModel(BaseModel):
    rule_code: str
    title: str
    category: str
    severity: str = "informational"
    page: int = 1
    object_id: str = ""
    coordinates: str = ""
    found_value: Optional[str] = None
    expected_value: Optional[str] = None
    description: str
    recommendation: str = ""
    confidence: float = 1.0
    source: str = "color_inspector"
    can_auto_correct: bool = False


class AnalysisCallback(BaseModel):
    job_id: str
    status: str
    progress: int
    issues: list[AnalysisIssueModel] = Field(default_factory=list)
    error_code: Optional[str] = None
    error_message: Optional[str] = None


app = FastAPI(title="Yesod Prepress Analyzer", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


async def send_callback(callback_url: str, payload: AnalysisCallback) -> None:
    logger.info("Enviando callback para %s (status=%s, issues=%d)", callback_url, payload.status, len(payload.issues))
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                callback_url,
                json=payload.model_dump(),
                headers={"Content-Type": "application/json"},
            )
            logger.info("Callback respondido com HTTP %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.error("Falha ao entregar callback para %s: %s", callback_url, exc, exc_info=True)


async def execute_analysis(request: AnalysisRequest) -> None:
    job_id = request.job_id
    pdf_url = request.pdf_url
    callback_url = request.callback_url

    logger.info("Iniciando análise do job %s", job_id)
    temp_path: Optional[Path] = None

    try:
        # 1. Download do PDF
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(pdf_url)
            if resp.status_code >= 400:
                raise ValueError(f"Falha no download do PDF (HTTP {resp.status_code})")
            pdf_bytes = resp.content

        if not pdf_bytes.startswith(b"%PDF"):
            raise ValueError("O arquivo baixado não possui cabeçalho válido de PDF")

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            temp_path = Path(tmp.name)

        issues: list[AnalysisIssueModel] = []

        # 2. Execução da análise via motor / inspectores
        try:
            # Tenta utilizar o motor completo do app se pikepdf/dependências estiverem disponíveis
            from app.contracts.production_profile import ProductionProfile
            from app.analyzer.document_inspector import inspect_document
            from app.rules.registry import run_rules
            from app.core.config import Settings

            settings = Settings()
            profile = ProductionProfile(id=request.production_profile_id or "default")
            context = inspect_document(temp_path, profile, settings)
            engine_issues = run_rules(context)

            for issue in engine_issues:
                sev = issue.severity.value if hasattr(issue.severity, "value") else str(issue.severity)
                if sev == "info":
                    sev = "informational"
                issues.append(
                    AnalysisIssueModel(
                        rule_code=issue.rule_code,
                        title=issue.title,
                        category=issue.category,
                        severity=sev,
                        page=getattr(issue, "page", 1) or 1,
                        object_id=getattr(issue, "object_id", ""),
                        coordinates=getattr(issue, "coordinates", ""),
                        found_value=getattr(issue, "found_value", None),
                        expected_value=getattr(issue, "expected_value", None),
                        description=issue.description,
                        recommendation=getattr(issue, "recommendation", ""),
                        confidence=getattr(issue, "confidence", 100) / 100.0,
                        source=getattr(issue, "source", "color_inspector"),
                        can_auto_correct=getattr(issue, "can_auto_correct", False),
                    )
                )
        except ImportError:
            logger.warning("Módulos internos de inspeção não carregados; aplicando inspeção padrão de spot colors")
            # Inspeção básica direta no stream do PDF para spot colors
            pdf_str = pdf_bytes[:500000].decode("latin1", errors="ignore")
            if "/Separation" in pdf_str or "/DeviceN" in pdf_str:
                issues.append(
                    AnalysisIssueModel(
                        rule_code="spot_color_detected",
                        title="Spot color detected in PDF",
                        category="colors",
                        severity="informational",
                        page=1,
                        object_id="spot_sep_1",
                        coordinates="0,0,100,100",
                        found_value="Spot/Separation",
                        expected_value=None,
                        description="Cores especiais (Separation/DeviceN) identificadas no documento.",
                        recommendation="Verifique se as cores especiais devem ser convertidas para CMYK ou impressas como Pantone.",
                        confidence=0.95,
                        source="color_inspector",
                        can_auto_correct=False,
                    )
                )

        # 3. Notificar sucesso
        callback_payload = AnalysisCallback(
            job_id=job_id,
            status="completed",
            progress=100,
            issues=issues,
            error_code=None,
            error_message=None,
        )
        await send_callback(callback_url, callback_payload)

    except Exception as exc:
        logger.error("Erro na análise do PDF para o job %s: %s", job_id, exc, exc_info=True)
        error_payload = AnalysisCallback(
            job_id=job_id,
            status="completed",
            progress=0,
            issues=[],
            error_code="pdf_invalid",
            error_message=str(exc),
        )
        await send_callback(callback_url, error_payload)
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass


@app.post("/analyze", status_code=status.HTTP_200_OK)
async def analyze(request: AnalysisRequest):
    if not request.job_id or not request.pdf_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="job_id e pdf_url são obrigatórios",
        )

    # Dispara a análise assíncrona sem bloquear a resposta HTTP
    asyncio.create_task(execute_analysis(request))

    return {
        "external_job_id": request.job_id,
        "status": "submitted",
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
