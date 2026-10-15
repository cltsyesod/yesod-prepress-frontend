"""Ghent Workgroup GWG 2022 (base PDF/X-4): valores por variante.

Fonte: os perfis oficiais de preflight GWG 2022 publicados pelo Ghent Workgroup
(gwg.org, "2022 Specifications (PDFX-4)"), lidos dos nomes das regras e das constantes
(ReferencePointSize, ReferenceResolutionLow/High) de cada regra. Regras cujo valor não
aparece nos perfis (R0010/R0012 linha preta fina, R0013 cinza em sobreimpressão) não
são conferidas: nada é suposto.

Resolução: abaixo de `low` é erro; entre `low` e `high` é aviso (como nos perfis).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Gwg2022:
    key: str
    name: str
    binding: str  # early, intermediate, late (quando as cores são convertidas)
    black_text_overprint_pt: float | None  # R0009/R0011: texto 100% preto abaixo disto sobreimprime
    rich_black_text: tuple[float, float] | None  # R0015: (K mínimo, tinta total máxima), 0–1
    white_text_pt: float | None  # R0016: texto branco sobre cor, abaixo disto
    multi_text_pt: float | None  # R0017: texto com mais de uma tinta, abaixo disto
    white_line_pt: float | None  # R0018: linha branca sobre cor, mais fina que isto
    multi_line_pt: float | None  # R0019: linha com mais de uma tinta, mais fina que isto
    image_ppi: tuple[float, float] | None  # R0031: (erro até, aviso até)
    lineart_ppi: tuple[float, float] | None  # R0032: imagens 1 bit
    single_image_ppi: tuple[float, float] | None  # R0033: página feita de uma só imagem
    courier: bool  # R0014
    optional_content: bool  # R0034
    ambiguous_spot: bool  # R0023


VARIANTS: dict[str, Gwg2022] = {
    "wide_format": Gwg2022(
        key="wide_format",
        name="GWG 2022 Wide Format Print (comunicação visual)",
        binding="late",
        black_text_overprint_pt=12,
        rich_black_text=None,
        white_text_pt=5,
        multi_text_pt=5,
        white_line_pt=0.15,
        multi_line_pt=0.15,
        image_ppi=(239, 299),
        lineart_ppi=(549, 799),
        single_image_ppi=(239, 300),
        courier=False,
        optional_content=False,
        ambiguous_spot=False,
    ),
    "digital": Gwg2022(
        key="digital",
        name="GWG 2022 Digital Print (impressão digital)",
        binding="intermediate",
        black_text_overprint_pt=None,
        rich_black_text=(0.85, 2.80),
        white_text_pt=5,
        multi_text_pt=5,
        white_line_pt=0.25,
        multi_line_pt=0.25,
        image_ppi=(95, 149),
        lineart_ppi=(349, 599),
        single_image_ppi=(95, 150),
        courier=False,
        optional_content=False,
        ambiguous_spot=False,
    ),
    "sheet": Gwg2022(
        key="sheet",
        name="GWG 2022 SheetCmyk CMYK + RGB (gráfica em folha)",
        binding="intermediate",
        black_text_overprint_pt=12,
        rich_black_text=(0.85, 2.80),
        white_text_pt=8,
        multi_text_pt=8,
        white_line_pt=0.25,
        multi_line_pt=0.25,
        image_ppi=(149, 224),
        lineart_ppi=(549, 799),
        single_image_ppi=(149, 225),
        courier=True,
        optional_content=False,
        ambiguous_spot=False,
    ),
    "packaging_offset": Gwg2022(
        key="packaging_offset",
        name="GWG 2022 Packaging Offset (embalagem)",
        binding="early",
        black_text_overprint_pt=12,
        rich_black_text=(0.85, 2.80),
        white_text_pt=5,
        multi_text_pt=8,
        white_line_pt=0.15,
        multi_line_pt=0.3,
        image_ppi=(239, 299),
        lineart_ppi=(549, 799),
        single_image_ppi=(449, 1200),
        courier=True,
        optional_content=True,
        ambiguous_spot=True,
    ),
}
