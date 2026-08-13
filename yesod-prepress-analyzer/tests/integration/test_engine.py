from pathlib import Path

import pikepdf

from app.analyzer.engine import AnalyzerEngine
from app.contracts.production_profile import ProductionProfile
from app.core.config import Settings


def test_engine_analyzes_real_pdf_objects(tmp_path: Path, monkeypatch):
    path = tmp_path / "job.pdf"
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(200, 300))
    pdf.save(path)

    monkeypatch.setattr(
        "app.analyzer.document_inspector._run_qpdf", lambda *_: (True, "No syntax errors")
    )
    monkeypatch.setattr(
        "app.analyzer.document_inspector._validate_pdfium", lambda *_: (True, 1)
    )
    result = AnalyzerEngine(Settings()).analyze(
        path,
        ProductionProfile(id="profile", minimumBleedMm=3, requiresCutLayer=True),
    )
    codes = {issue.rule_code for issue in result.issues}
    assert "PAGE_TRIMBOX_MISSING" in codes
    assert "PAGE_BLEED_INSUFFICIENT" in codes
    assert "FINISHING_CUT_LAYER" in codes
    assert result.summary["page_count"] == 1
    assert len(result.summary["sha256"]) == 64
