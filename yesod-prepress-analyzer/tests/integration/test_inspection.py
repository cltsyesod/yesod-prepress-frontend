import json
from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2 as pdfium

from app.analyzer.inspection import PLATES, build_inspection
from app.contracts.fix import FixRequest
from app.contracts.production_profile import ProductionProfile
from app.fixes.engine import apply_fixes

CUT = ["CutContour"]


def sample(path: Path) -> Path:
    """A blue rectangle (vector), PROMO in Helvetica (not embedded), a red 20×20 px image
    40 pt wide (36 ppi) and a die line on a CutContour layer."""

    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(200, 100))
    page = pdf.pages[0]
    layer = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name="CutContour"))
    pdf.Root.OCProperties = pikepdf.Dictionary(
        OCGs=[layer], D=pikepdf.Dictionary(ON=[layer], Order=[layer])
    )
    font = pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica
    )
    image = pdf.make_stream(
        bytes([220, 20, 20] * 400),
        Type=pikepdf.Name.XObject,
        Subtype=pikepdf.Name.Image,
        Width=20,
        Height=20,
        ColorSpace=pikepdf.Name.DeviceRGB,
        BitsPerComponent=8,
    )
    page.obj.Resources = pikepdf.Dictionary(
        Font=pikepdf.Dictionary(F1=font),
        XObject=pikepdf.Dictionary(Im=image),
        Properties=pikepdf.Dictionary(MC0=layer),
    )
    page.contents_add(
        b"1 0.5 0 0 k 10 10 60 80 re f "
        b"BT 0 0 0 1 k /F1 14 Tf 80 70 Td (PROMO) Tj ET "
        b"q 40 0 0 40 150 20 cm /Im Do Q "
        b"/OC /MC0 BDC 0 1 0 0 K 1 w 5 5 190 90 re S EMC"
    )
    pdf.save(path)
    return path


def plate_pixels(path: Path, index: int) -> np.ndarray:
    doc = pdfium.PdfDocument(str(path))
    image = np.asarray(doc[index].render(scale=2).to_pil().convert("RGB")).astype(int)
    doc.close()
    return image


def dark(image: np.ndarray, x: float, y: float, height: float = 100) -> bool:
    """Something painted (not paper white) around (x, y) in points, PDF coordinates."""

    row, col = int((height - y) * 2), int(x * 2)
    patch = image[max(0, row - 2) : row + 3, max(0, col - 2) : col + 3]
    return bool((patch.min(axis=2) < 200).any())


def manifest(path: Path) -> dict:
    with pikepdf.open(path) as pdf:
        return json.loads(pdf.attachments["objects.json"].get_file().read_bytes())


def test_object_map_and_plates(tmp_path):
    out = tmp_path / "inspection.pdf"
    summary = build_inspection(sample(tmp_path / "in.pdf"), out, CUT)
    assert summary["pages"] == 1

    data = manifest(out)
    [page] = data["pages"]
    kinds = {item["kind"]: item for item in page["objects"]}
    assert set(kinds) == {"path", "text", "image", "cut"}
    assert kinds["text"]["text"] == "PROMO" and kinds["text"]["font"] == "Helvetica"
    assert kinds["text"]["embedded"] is False and kinds["text"]["sizePt"] == 14
    assert kinds["image"]["px"] == [20, 20] and kinds["image"]["ppi"] == 36
    assert kinds["image"]["box"] == [150, 20, 190, 60]
    assert kinds["cut"]["layer"] == "CutContour" and kinds["cut"]["stroke"] is not None
    assert kinds["path"]["fill"] is not None and kinds["path"]["stroke"] is None

    # One plate per kind, in order, each with only its kind painted.
    with pikepdf.open(out) as pdf:
        assert len(pdf.pages) == len(PLATES)
    images, text, vectors, cut = (plate_pixels(out, i) for i in range(4))
    assert dark(images, 170, 40) and not dark(images, 40, 50) and not dark(images, 5, 50)
    assert not dark(text, 170, 40) and not dark(text, 40, 50)
    assert dark(vectors, 40, 50) and not dark(vectors, 170, 40) and not dark(vectors, 5, 50)
    assert dark(cut, 5, 50) and not dark(cut, 40, 50) and not dark(cut, 170, 40)
    # The text plate paints the word; the others do not.
    assert (text < 200).any() and not (vectors[40:70, 160:230] < 200).any()


def test_generated_bleed_is_listed_once(tmp_path):
    source = sample(tmp_path / "in.pdf")
    with pikepdf.open(source, allow_overwriting_input=True) as pdf:
        pdf.pages[0].obj.TrimBox = pikepdf.Array([0, 0, 200, 100])
        pdf.save(source)
    apply_fixes(
        source,
        tmp_path / "bled.pdf",
        [FixRequest(id="add_bleed", params={"bleedMm": 5})],
        ProductionProfile(id="p", minimum_bleed_mm=5),
    )
    out = tmp_path / "inspection.pdf"
    build_inspection(tmp_path / "bled.pdf", out, CUT)
    [page] = manifest(out)["pages"]
    assert page["generatedBleed"] is True
    assert page["counts"]["image"] == 1 and page["counts"]["text"] == 1
    image = next(item for item in page["objects"] if item["kind"] == "image")
    assert image["box"] == [150, 20, 190, 60]
