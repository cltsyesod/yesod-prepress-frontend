"""Cut lines per panel, per-panel image cropping and position accuracy of the panels."""

import io
import re
import zipfile
import zlib
from pathlib import Path

import numpy as np
import pikepdf
import pypdfium2
import pytest
from PIL import Image

from app.contracts.tiling import TilingRequest
from app.tiling.package import build_package

MM = 72 / 25.4


def request(tiles_mm: list[tuple[float, float, float, float]], **extra) -> TilingRequest:
    """Panels side by side on a 3000 x 1500 mm artwork (1:10), with `extra` fields."""

    tiles = []
    for i, (x, w, left, right) in enumerate(tiles_mm):
        tiles.append(
            {
                "number": i + 1,
                "name": f"painel {i + 1:02d}",
                "column": i + 1,
                "visible": {"x": x, "y": 0, "w": w, "h": 1500},
                "printed": {"x": x - left, "y": 0, "w": w + left + right, "h": 1500},
            }
        )
    payload = {
        "tilingId": "t1",
        "callbackUrl": "https://example.com/cb",
        "outputs": {
            "pdf": "https://example.com/a",
            "zip": "https://example.com/b",
            "guide": "https://example.com/c",
        },
        "source": {"url": "https://example.com/art.pdf"},
        "fileScale": 10,
        "tiles": tiles,
        **extra,
    }
    return TilingRequest.model_validate(payload)


THREE = [(0, 1000, 0, 0), (1000, 1000, 20, 0), (2000, 1000, 20, 0)]


def _page(path: Path, content: bytes, resources: dict | None = None) -> Path:
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(300 * MM, 150 * MM))
    page = pdf.pages[0]
    if resources:
        page.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(resources))
    page.contents_add(content)
    pdf.save(path)
    return path


def _content(page) -> str:
    contents = page.obj.Contents
    streams = contents if isinstance(contents, pikepdf.Array) else [contents]
    return b"".join(s.read_bytes() for s in streams).decode("latin-1")


def _cut_pieces(page) -> tuple[int, bool]:
    """Open/closed contour pieces and whether there is a rectangle, in the cut block."""

    text = _content(page)
    block = re.search(r"CS 1 SCN .*? S Q", text, re.S)
    if not block:
        return 0, False
    return block.group(0).count(" m "), " re" in block.group(0)


def test_contour_cut_is_split_between_the_panels(tmp_path):
    # A shape from 500 to 2500 mm wide, 500 to 1000 mm tall (final size) on blank paper.
    source = _page(tmp_path / "shape.pdf", b"0 0 0 1 k 141.73 141.73 566.93 141.73 re f")
    req = request(THREE, cut={"contour": True, "panelEdge": True})
    out = build_package(req, source, tmp_path)
    with pikepdf.open(out.pdf) as pdf:
        pieces = [_cut_pieces(page) for page in pdf.pages]
        assert [p for p, _ in pieces] == [1, 2, 1]  # a U, two strokes, a U
        assert all(rect for _, rect in pieces)
        space = pdf.pages[0].Resources.ColorSpace
        assert any(str(space[k][1]) == "/CutContour" for k in space.keys())
    assert out.summary["cut"] == {"contour": True, "panelEdge": True, "name": "CutContour"}


def test_closed_cut_gives_each_panel_a_closed_piece(tmp_path):
    source = _page(tmp_path / "shape.pdf", b"0 0 0 1 k 141.73 141.73 566.93 141.73 re f")
    req = request(THREE, cut={"contour": True, "closeAtEdge": True})
    out = build_package(req, source, tmp_path)
    with pikepdf.open(out.pdf) as pdf:
        for page in pdf.pages:
            block = re.search(r"CS 1 SCN .*? S Q", _content(page), re.S).group(0)
            # One closed piece per panel (the shape crosses all three).
            assert block.count(" m ") == 1 and block.count(" h") == 1


def test_each_panel_is_kept_for_its_own_upload(tmp_path):
    source = _page(tmp_path / "shape.pdf", b"0 0 0 1 k 141.73 141.73 566.93 141.73 re f")
    out = build_package(request(THREE), source, tmp_path)
    assert sorted(out.panels) == [1, 2, 3]
    with pikepdf.open(out.panels[2]) as single:
        assert len(single.pages) == 1


def test_report_of_shortened_labels_and_no_room_for_marks(tmp_path):
    source = _page(tmp_path / "shape.pdf", b"0 0 0 1 k 141.73 141.73 566.93 141.73 re f")
    req = request(THREE)
    req.tiles[0].label_top = "Etiqueta muito longa " * 60
    out = build_package(req, source, tmp_path)
    assert out.summary["finishing"] == {"labelsShortened": ["1"], "noRoomForMarks": False}
    req = request(THREE)
    req.marks.margin_mm = 1
    out = build_package(req, source, tmp_path)
    assert out.summary["finishing"]["noRoomForMarks"] is True


def test_panel_upload_urls_are_read_by_number():
    req = request(
        THREE,
        outputs={
            "pdf": "https://example.com/a",
            "zip": "https://example.com/b",
            "guide": "https://example.com/c",
            "panels": {"1": "https://example.com/p1", "2": "https://example.com/p2"},
        },
    )
    assert sorted(req.outputs.panels) == [1, 2]


def test_no_cut_by_default(tmp_path):
    source = _page(tmp_path / "shape.pdf", b"0 0 0 1 k 141.73 141.73 566.93 141.73 re f")
    out = build_package(request(THREE), source, tmp_path)
    with pikepdf.open(out.pdf) as pdf:
        assert _cut_pieces(pdf.pages[0]) == (0, False)


def _image_art(tmp_path: Path, jpeg: bool) -> Path:
    # 30 px blocks of random colours: a wrong crop or shift shows, rendering noise does not.
    rng = np.random.default_rng(7)
    blocks = rng.integers(0, 255, size=(10, 20, 3), dtype=np.uint8)
    pixels = np.kron(blocks, np.ones((30, 30, 1), dtype=np.uint8))
    pdf = pikepdf.Pdf.new()
    if jpeg:
        buffer = io.BytesIO()
        Image.fromarray(pixels).save(buffer, format="JPEG", quality=95)
        image = pdf.make_stream(buffer.getvalue())
        image.Filter = pikepdf.Name.DCTDecode
    else:
        image = pdf.make_stream(zlib.compress(pixels.tobytes()))
        image.Filter = pikepdf.Name.FlateDecode
    image.Type, image.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    image.Width, image.Height = 600, 300
    image.ColorSpace, image.BitsPerComponent = pikepdf.Name.DeviceRGB, 8
    pdf.add_blank_page(page_size=(300 * MM, 150 * MM))
    page = pdf.pages[0]
    page.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=image))
    page.contents_add(f"q {300 * MM:.4f} 0 0 {150 * MM:.4f} 0 0 cm /Im0 Do Q".encode())
    path = tmp_path / "photo.pdf"
    pdf.save(path)
    return path


def _render(path: Path, index: int) -> np.ndarray:
    document = pypdfium2.PdfDocument(str(path))
    try:
        return np.asarray(document[index].render(scale=0.2).to_pil().convert("RGB"), dtype=np.int16)
    finally:
        document.close()


@pytest.mark.parametrize("jpeg", [False, True])
def test_panel_files_keep_only_their_pixels(tmp_path, jpeg):
    source = _image_art(tmp_path, jpeg)
    req = request(THREE)
    out = build_package(req, source, tmp_path)
    crop = out.summary["imageCrop"]
    # Lossless images are cropped; a JPEG is kept whole, byte for byte.
    assert (crop["cropped"], crop["kept"]) == ((0, 3) if jpeg else (3, 0))
    with zipfile.ZipFile(out.zip) as archive:
        archive.extract("paineis/painel_02.pdf", tmp_path)
    single = tmp_path / "paineis" / "painel_02.pdf"
    with pikepdf.open(single) as pdf:
        widths = [
            int(x.Width)
            for x in pdf.objects
            if isinstance(x, pikepdf.Stream) and x.get("/Subtype") == pikepdf.Name.Image
        ]
    # Panel 2 shows 1020 of 3000 mm: about a third of the 600 px, plus a 2 px margin.
    assert widths and max(widths) <= (600 if jpeg else 210)
    # The same picture as the panel in the file with the whole artwork. Where an image
    # pixel edge falls exactly between two screen pixels, the renderer may pick either
    # side (a single column at a colour edge): allow that, nothing else.
    full, cropped = _render(out.pdf, 1), _render(single, 0)
    assert full.shape == cropped.shape
    difference = np.abs(full - cropped).max(axis=2)
    assert np.median(difference) == 0
    assert (difference > 10).mean() < 0.005


def test_panel_position_is_exact_at_1000_mm(tmp_path):
    # Hairlines every 500 mm (final size) across a 3000 mm artwork drawn at 1:10.
    lines = " ".join(f"{x * MM / 10:.4f} 0 0.1 {150 * MM:.4f} re" for x in range(500, 3000, 500))
    source = _page(tmp_path / "ruler.pdf", f"0 0 0 1 k {lines} f".encode())
    req = request(THREE)
    req.marks.margin_mm = 10
    out = build_package(req, source, tmp_path)
    # 4 pixels per millimetre.
    document = pypdfium2.PdfDocument(str(out.pdf))
    try:
        for index, (x, w, left, right) in enumerate(THREE):
            page = document[index]
            gray = np.asarray(page.render(scale=4 / MM).to_pil().convert("L"), dtype=np.int16)
            row = gray[gray.shape[0] // 2]
            dark = np.flatnonzero(row < 128)
            runs = np.split(dark, np.flatnonzero(np.diff(dark) > 1) + 1)
            # Centre of each line, in mm from the left of the page (the line is 0.35 mm wide).
            found = [(run[0] + run[-1] + 1) / 2 / 4 - 0.175 for run in runs if len(run)]
            # Lines inside the print window; one exactly on the cut edge is not printed.
            start, end = x - left, x + w + right
            inside = [line for line in range(500, 3000, 500) if start <= line < end - 0.5]
            expected = [10 + (line - start) for line in inside]
            assert len(found) == len(expected)
            for got, want in zip(found, expected, strict=True):
                assert abs(got - want) <= 0.5, (index, got, want)
    finally:
        document.close()
