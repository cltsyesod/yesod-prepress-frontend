from __future__ import annotations

from pathlib import Path

from app.analyzer.document_inspector import inspect_document
from app.analyzer.file_profile import file_profile
from app.analyzer.gamut import analyze_gamut
from app.analyzer.ink_coverage import measure_inks
from app.analyzer.result import AnalysisResult
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings
from app.rules.registry import run_rules


class AnalyzerEngine:
    def __init__(self, settings: Settings):
        self.settings = settings

    def analyze(
        self, path: Path, profile: ProductionProfile, color_files: dict | None = None
    ) -> AnalysisResult:
        context = inspect_document(path, profile, self.settings)
        # Gestão de cor: o que muda indo para o perfil de destino (antes das regras).
        try:
            context.facts["gamut"] = analyze_gamut(path, context, color_files or {})
        except Exception as exc:  # noqa: BLE001 - nunca derruba a análise
            context.facts["gamut"] = {"error": str(exc)}
        result = AnalysisResult(issues=run_rules(context)).finalize(
            page_count=context.page_count, sha256=context.sha256
        )
        # Raio-X do arquivo, mostrado na tela do trabalho ao lado das ocorrências.
        result.summary["fileProfile"] = file_profile(context)
        result.summary["fileProfile"]["gamut"] = context.facts.get("gamut") or None
        # Proporção de tintas (separação como num RIP), em todos os módulos.
        try:
            result.summary["fileProfile"]["inks"] = measure_inks(path)
        except Exception as exc:  # noqa: BLE001 - nunca derruba a análise
            result.summary["fileProfile"]["inks"] = {"pages": [], "error": str(exc)}
        return result
