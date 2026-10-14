"""Preflight PDF/X-4 (ISO 15930-7): as exigências do padrão de troca para impressão.

Cada item diz se passa, falha ou não se aplica, com o motivo. Só entram exigências do
padrão que são verificáveis com segurança no próprio arquivo; não substitui um validador
certificado (ex.: callas pdfToolbox / Acrobat Preflight), e o relatório diz isso.
"""

from __future__ import annotations

import pikepdf

from app.analyzer.context import DocumentContext

TOLERANCE = 0.01  # pt
ALLOWED_ANNOTS = {"/TrapNet", "/PrinterMark"}


def _box(value) -> tuple[float, float, float, float] | None:
    try:
        x0, y0, x1, y1 = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def _inside(inner, outer) -> bool:
    return (
        inner[0] >= outer[0] - TOLERANCE
        and inner[1] >= outer[1] - TOLERANCE
        and inner[2] <= outer[2] + TOLERANCE
        and inner[3] <= outer[3] + TOLERANCE
    )


def _overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _intent_space(pdf: pikepdf.Pdf) -> tuple[bool, str | None, str]:
    """(tem intenção GTS_PDFX, espaço do perfil de saída 'CMYK'/'RGB'/'GRAY', nome)."""

    for intent in pdf.Root.get("/OutputIntents", []) or []:
        if intent.get("/S") != "/GTS_PDFX":
            continue
        name = str(intent.get("/OutputConditionIdentifier", "") or intent.get("/Info", ""))
        profile = intent.get("/DestOutputProfile")
        space = None
        if profile is not None:
            try:
                header = profile.read_bytes()[16:20].decode("ascii", "replace").strip()
                space = {"CMYK": "CMYK", "RGB": "RGB", "GRAY": "GRAY"}.get(header.upper())
            except Exception:  # noqa: BLE001 - perfil ilegível conta como ausente
                space = None
        return True, space, name
    return False, None, ""


def _has_javascript(pdf: pikepdf.Pdf) -> bool:
    names = pdf.Root.get("/Names")
    if names is not None and "/JavaScript" in names:
        return True
    action = pdf.Root.get("/OpenAction")
    if isinstance(action, pikepdf.Dictionary) and action.get("/S") == "/JavaScript":
        return True
    return "/AA" in pdf.Root


def _transfer_functions(pdf: pikepdf.Pdf) -> int:
    count = 0
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Dictionary):
            continue
        if obj.get("/Type") != "/ExtGState" and not ({"/TR", "/TR2"} & set(obj.keys())):
            continue
        for key in ("/TR", "/TR2"):
            value = obj.get(key)
            if value is not None and value not in ("/Identity", "/Default"):
                count += 1
    return count


def check_pdfx4(pdf: pikepdf.Pdf, context: DocumentContext) -> dict:
    checks: list[dict] = []

    def add(check_id: str, label: str, ok: bool | None, detail: str, severity: str = "error"):
        checks.append(
            {"id": check_id, "label": label, "ok": ok, "detail": detail, "severity": severity}
        )

    add(
        "encryption",
        "Sem criptografia",
        not context.encrypted,
        "O arquivo está protegido" if context.encrypted else "Arquivo sem proteção",
    )

    has_intent, space, name = _intent_space(pdf)
    add(
        "output_intent",
        "Perfil de saída (Output Intent PDF/X)",
        has_intent and (space is not None or bool(name)),
        f"{name or 'perfil incorporado'} ({space or 'sem ICC'})"
        if has_intent
        else "Nenhum perfil de saída declarado",
    )

    missing_trim, bad_nesting = [], []
    for page in context.pages:
        media = _box(page.media_box)
        trim = _box(page.trim_box) or _box(page.art_box)
        bleed = _box(page.bleed_box)
        if trim is None:
            missing_trim.append(page.number)
            continue
        if media and not _inside(trim, media):
            bad_nesting.append(page.number)
        if bleed and (not _inside(trim, bleed) or (media and not _inside(bleed, media))):
            bad_nesting.append(page.number)
    add(
        "trimbox",
        "TrimBox (ou ArtBox) em todas as páginas",
        not missing_trim,
        "Faltando nas páginas " + ", ".join(map(str, missing_trim))
        if missing_trim
        else "Presente",
    )
    add(
        "boxes",
        "Caixas coerentes (Trim ⊂ Bleed ⊂ Media)",
        not bad_nesting,
        "Fora de ordem nas páginas " + ", ".join(map(str, sorted(set(bad_nesting))))
        if bad_nesting
        else "Coerentes",
    )

    not_embedded = sorted({f.name for f in context.fonts if not f.embedded})
    add(
        "fonts",
        "Todas as fontes incorporadas",
        not not_embedded,
        "Não incorporadas: " + ", ".join(not_embedded) if not_embedded else "Incorporadas",
    )

    rgb = context.colors.rgb_operators > 0 or any(
        "RGB" in image.color_space and "ICC" not in image.color_space for image in context.images
    )
    cmyk = context.colors.cmyk_operators > 0 or any(
        "CMYK" in image.color_space and "ICC" not in image.color_space for image in context.images
    )
    if not has_intent or space is None:
        add("device_color", "Cores de dispositivo compatíveis com o perfil de saída", None,
            "Depende do perfil de saída (ausente)")
    elif space == "CMYK":
        add("device_color", "Cores de dispositivo compatíveis com o perfil de saída", not rgb,
            "RGB sem perfil ICC com saída CMYK" if rgb else "Compatíveis")
    else:
        add("device_color", "Cores de dispositivo compatíveis com o perfil de saída", not cmyk,
            f"CMYK sem perfil ICC com saída {space}" if cmyk else "Compatíveis")

    transfer = _transfer_functions(pdf)
    add("transfer", "Sem funções de transferência", transfer == 0,
        f"{transfer} função(ões) de transferência" if transfer else "Nenhuma")

    add("javascript", "Sem JavaScript nem ações automáticas", not _has_javascript(pdf),
        "Contém JavaScript/ações" if _has_javascript(pdf) else "Nenhum")

    bad_annots = []
    for number, page in enumerate(pdf.pages, start=1):
        info = context.pages[number - 1] if number <= len(context.pages) else None
        area = _box(info.bleed_box or info.trim_box or info.media_box) if info else None
        for annot in page.obj.get("/Annots", []) or []:
            subtype = str(annot.get("/Subtype", ""))
            rect = _box(annot.get("/Rect", []))
            if subtype not in ALLOWED_ANNOTS and rect and area and _overlaps(rect, area):
                bad_annots.append(f"pág. {number} {subtype.lstrip('/')}")
    add("annotations", "Sem anotações sobre a área impressa", not bad_annots,
        ", ".join(bad_annots[:5]) if bad_annots else "Nenhuma")

    names = pdf.Root.get("/Names")
    embedded = names is not None and "/EmbeddedFiles" in names
    add("embedded_files", "Sem arquivos anexados", not embedded,
        "Há arquivos anexados" if embedded else "Nenhum", "warning")

    version = context.pdf_version or ""
    try:
        newer = float(version) > 1.6
    except ValueError:
        newer = False
    add("version", "Versão do PDF (PDF/X-4 se baseia no PDF 1.6)", not newer,
        f"PDF {version}", "warning")

    declared = context.pdfx_version or ""
    add("declared", "Identificação PDF/X-4 nos metadados", declared.startswith("PDF/X-4"),
        declared or "Não declarado", "warning")
    trapped = str(pdf.docinfo.get("/Trapped", "")) if pdf.docinfo is not None else ""
    add("trapped", "Trapping declarado (True/False)", trapped in ("/True", "/False"),
        trapped.lstrip("/") or "Não declarado", "warning")

    errors = [c for c in checks if c["ok"] is False and c["severity"] == "error"]
    warnings = [c for c in checks if c["ok"] is False and c["severity"] == "warning"]
    return {
        "standard": "PDF/X-4 (ISO 15930-7)",
        "declared": declared,
        "conforms": not errors,
        "errors": len(errors),
        "warnings": len(warnings),
        "checks": checks,
    }
