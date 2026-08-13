from __future__ import annotations

from app.analyzer.context import DocumentContext
from app.contracts.issue import AnalysisIssue
from app.rules.base import Rule


class PdfSyntaxRule(Rule):
    code = "FILE_PDF_SYNTAX"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if context.qpdf_ok:
            return []
        return [
            self.issue(
                context,
                title="Estrutura PDF inconsistente",
                category="Arquivo",
                found_value=context.qpdf_output or "qpdf retornou erro",
                expected_value="PDF estruturalmente válido",
                description="O qpdf encontrou erros ou inconsistências estruturais no arquivo.",
                recommendation=(
                    "Reexporte o PDF a partir do aplicativo de origem e valide novamente."
                ),
                source="qpdf",
            )
        ]


class PdfiumRenderRule(Rule):
    code = "FILE_PDFIUM_RENDER"
    default_severity = "critical"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if context.pdfium_ok:
            return []
        return [
            self.issue(
                context,
                title="Falha de renderização",
                category="Arquivo",
                found_value="PDFium não conseguiu renderizar o documento",
                expected_value="Todas as páginas renderizáveis",
                description="O mecanismo PDFium não conseguiu interpretar uma ou mais páginas.",
                recommendation="Reexporte o arquivo e remova objetos PDF corrompidos.",
                source="pdfium",
            )
        ]


class PdfVersionRule(Rule):
    code = "FILE_PDF_VERSION"
    default_severity = "informational"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        try:
            major, minor = (int(part) for part in context.pdf_version.split(".", 1))
        except (ValueError, TypeError):
            return []
        if (major, minor) <= (1, 7):
            return []
        return [
            self.issue(
                context,
                title="Versão PDF recente",
                category="Arquivo",
                found_value=context.pdf_version,
                expected_value="PDF 1.7 ou compatível com o RIP",
                description="A versão do PDF pode não ser suportada por RIPs legados.",
                recommendation="Confirme a compatibilidade do RIP ou exporte como PDF 1.7/PDF-X.",
            )
        ]


class PdfXRule(Rule):
    code = "FILE_PDFX_REQUIRED"
    default_severity = "warning"

    def evaluate(self, context: DocumentContext) -> list[AnalysisIssue]:
        if not context.profile.require_pdf_x or context.pdfx_version:
            return []
        return [
            self.issue(
                context,
                title="PDF/X não identificado",
                category="Arquivo",
                found_value="Sem identificação PDF/X",
                expected_value="Arquivo conforme PDF/X",
                description=(
                    "O perfil de produção exige PDF/X, mas o identificador não foi encontrado."
                ),
                recommendation="Exporte novamente usando o padrão PDF/X solicitado pela produção.",
            )
        ]
