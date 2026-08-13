from __future__ import annotations

from pathlib import Path

import pikepdf


def create_blank_pdf(destination: Path, *, bleed_mm: float = 0) -> None:
    pdf = pikepdf.Pdf.new()
    page = pdf.add_blank_page(page_size=(595.2756, 841.8898))
    page.obj["/TrimBox"] = pikepdf.Array([0, 0, 595.2756, 841.8898])
    bleed_pt = bleed_mm * 72 / 25.4
    page.obj["/BleedBox"] = pikepdf.Array(
        [-bleed_pt, -bleed_pt, 595.2756 + bleed_pt, 841.8898 + bleed_pt]
    )
    pdf.save(destination)


if __name__ == "__main__":
    fixture_dir = Path(__file__).parents[1] / "tests" / "fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    create_blank_pdf(fixture_dir / "a4-no-bleed.pdf", bleed_mm=0)
    create_blank_pdf(fixture_dir / "a4-3mm-bleed.pdf", bleed_mm=3)
    print(f"Created fixtures in {fixture_dir}")
