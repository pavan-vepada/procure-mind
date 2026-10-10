"""Step 1 of extraction: turn each file into something a model can read, and say how and why.

Four reading modes:
  direct      the file already holds text (Excel, Word, digital PDF, email body)
  ocr         an image of prose that OCR reads confidently; send the OCR text only
  vision      an image OCR cannot read well; send the image only
  ocr+vision  an image of a table: vision keeps rows aligned, OCR numbers cross-check each digit
"""
import base64
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
import pytesseract
from docx import Document
from openpyxl import load_workbook
from PIL import Image

OCR_MIN_CONFIDENCE = 60   # below this, OCR text would mislead more than help
TABLE_MIN_NUMBERS = 8     # this many decimal numbers means the image is a price table
MAX_IMAGE_SIDE = 2000
NUMBER = re.compile(r"\d[\d,]*\.?\d*")


@dataclass
class ReadDoc:
    filename: str
    mode: str
    reason: str
    text: str = ""
    images: list[str] = field(default_factory=list)  # base64 JPEGs sent to the vision model
    ocr_confidence: float | None = None

    def numbers(self) -> set[float]:
        """Every number present in the text. Used to check that extracted prices exist in the source."""
        found = set()
        for token in NUMBER.findall(self.text):
            try:
                found.add(round(float(token.replace(",", "")), 4))
            except ValueError:
                pass
        return found


def _excel(path):
    out = []
    for ws in load_workbook(path, data_only=True).worksheets:
        out.append(f"[Sheet: {ws.title}]")
        for row in ws.iter_rows(values_only=True):
            if any(c is not None for c in row):
                out.append(" | ".join("" if c is None else str(c) for c in row))
    return "\n".join(out)


def _word(path):
    doc = Document(path)
    out = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        out += [" | ".join(c.text.strip() for c in row.cells) for row in table.rows]
    return "\n".join(out)


def _image(filename, image: Image.Image) -> ReadDoc:
    image = image.convert("RGB")
    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    confs = [float(c) for c, t in zip(data["conf"], data["text"]) if t.strip() and float(c) >= 0]
    confidence = round(sum(confs) / len(confs), 1) if confs else 0.0
    text = pytesseract.image_to_string(image)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    encoded = base64.b64encode(buffer.getvalue()).decode()
    decimals = len(re.findall(r"\d+\.\d{2}", text))

    if confidence < OCR_MIN_CONFIDENCE or len(confs) < 10:
        return ReadDoc(filename, "vision", f"OCR confidence is only {confidence}%, so its text is not used. "
                       "The image goes straight to the vision model.", "", [encoded], confidence)
    if decimals >= TABLE_MIN_NUMBERS:
        return ReadDoc(filename, "ocr+vision", f"OCR reads the words well ({confidence}%) but loses which rate "
                       "belongs to which row. The vision model reads the table, and OCR's numbers are used to "
                       "cross-check each price.", text, [encoded], confidence)
    return ReadDoc(filename, "ocr", f"Image of plain text that OCR reads confidently ({confidence}%). "
                   "The OCR text is sent to the model.", text, [], confidence)


def read_file(path: Path) -> list[ReadDoc]:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        return [ReadDoc(path.name, "direct", "Spreadsheet: cell values are read exactly as typed.", _excel(path))]
    if suffix == ".docx":
        return [ReadDoc(path.name, "direct", "Word document: the text is read directly.", _word(path))]
    if suffix in (".txt", ".eml", ".csv", ".md"):
        return [ReadDoc(path.name, "direct", "Plain text: read directly.", path.read_text(errors="replace"))]
    if suffix == ".pdf":
        pdf = pymupdf.open(path)
        text = "\n".join(page.get_text() for page in pdf)
        if len(text.strip()) >= 50 * pdf.page_count:
            return [ReadDoc(path.name, "direct", "Digital PDF with a text layer: the text is read directly.", text)]
        docs = []  # a scanned PDF is just images in a wrapper
        for i, page in enumerate(pdf, start=1):
            pix = page.get_pixmap(dpi=170)
            doc = _image(f"{path.name} (page {i})", Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
            doc.reason = "Scanned PDF with no text layer. " + doc.reason
            docs.append(doc)
        return docs
    if suffix in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"):
        return [_image(path.name, Image.open(path))]
    return [ReadDoc(path.name, "unsupported", f"File type {suffix} is not supported, so it was not read.")]
