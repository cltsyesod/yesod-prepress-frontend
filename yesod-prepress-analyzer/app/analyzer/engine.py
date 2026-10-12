from __future__ import annotations

from pathlib import Path

from app.analyzer.document_inspector import inspect_document
from app.analyzer.file_profile import file_profile
from app.analyzer.result import AnalysisResult
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings
from app.rules.registry import run_rules


class AnalyzerEngine:
    def __init__(self, settings: Settings):
        self.settings = settings

    def analyze(self, path: Path, profile: ProductionProfile) -> AnalysisResult:
        context = inspect_document(path, profile, self.settings)
        result = AnalysisResult(issues=run_rules(context)).finalize(
            page_count=context.page_count, sha256=context.sha256
        )
        # Raio-X do arquivo, mostrado na tela do trabalho ao lado das ocorrências.
        result.summary["fileProfile"] = file_profile(context)
        return result
