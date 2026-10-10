"""Step 2 of extraction: one model call per vendor reply, returning a VendorExtraction."""
from openai import OpenAI

from app.config import settings
from app.extraction.readers import ReadDoc
from app.extraction.schema import VendorExtraction

# The SDK retries rate limits and server errors with exponential backoff.
client = OpenAI(api_key=settings.openai_api_key, max_retries=4, timeout=180)

INSTRUCTIONS = """You read one vendor's reply to a buyer's RFx and record exactly what the vendor said.

Rules:
- Record prices as written. Do not convert units or currency. Do not calculate anything.
- unit_basis per_piece means "per one unit of the line's unit of measure" (one box, one roll, one laptop).
- Map each price to RFx line numbers using the buyer's item code if present, otherwise size and ply.
  A vendor may use their own codes, their own order and their own descriptions.
- One entry per priced row. If the vendor gives a rule ("all 3-ply at X per kg"), make one entry listing
  every line the rule covers, and leave out lines that a more specific statement covers.
- If the vendor says remaining items are unchanged from a previous period, make one entry with
  price_type same_as_last_year listing those lines. Do not look up or invent the price.
- If the vendor declines specific lines, make a not_quoted entry for them. Lines the vendor never
  mentions get no entry at all. Never fill a gap with a guess.
- Read footnotes, small print and paragraphs as carefully as tables. Discounts, rebates, freight, duty,
  validity and payment terms are often there.
- For images: if a digit is smudged, cut off, or could be read two ways, still give your best reading but
  set confidence to low and say which digit and why. If OCR text is supplied alongside an image, trust the
  image for layout and use the OCR text only as a second opinion on characters.
- source_quote must be copied verbatim from the document.
- For questionnaire answers, use "unanswered" when the vendor did not address the question. Record what
  the vendor claims; separately record what each attached document actually shows, including the expiry
  date on any certificate.
- open_issues: list what stops this quote being compared like for like, or what contradicts itself."""


def _rfx_context(rfx: dict) -> str:
    def spec(l):
        if l.get("specification"):
            return l["specification"]
        return f"{l['ply']}-ply, {l['length_mm']}x{l['width_mm']}x{l['height_mm']} mm" if l.get("ply") else "-"

    rows = [f"{l['line_no']} | {l.get('item_code') or '-'} | {l['description']} | {spec(l)} | "
            f"{l.get('uom') or 'piece'} | {l.get('box_weight_kg') or 'not given'}"
            for l in rfx["line_items"]]
    questions = [f"{q['id']}: {q['question']}" for q in rfx["questionnaire"]]
    return (f"RFx {rfx['rfx_id']}: {rfx['title']}\nRequested basis: {rfx['terms']['price_basis']}\n\n"
            "Line items (line_no | item code | description | specification | unit of measure | weight of one unit in kg):\n" + "\n".join(rows) +
            "\n\nQuestionnaire:\n" + "\n".join(questions))


def extract_vendor(rfx: dict, docs: list[ReadDoc]) -> VendorExtraction:
    content = [{"type": "input_text", "text": _rfx_context(rfx)}]
    for doc in docs:
        header = f"\n===== Document: {doc.filename} (read mode: {doc.mode}) ====="
        if doc.mode == "ocr+vision":
            header += "\nOCR text (rows may be scrambled; the image follows):"
        content.append({"type": "input_text", "text": f"{header}\n{doc.text}"})
        for image in doc.images:
            content.append({"type": "input_image", "image_url": f"data:image/jpeg;base64,{image}", "detail": "high"})
    response = client.responses.parse(
        model=settings.openai_model, instructions=INSTRUCTIONS,
        input=[{"role": "user", "content": content}], text_format=VendorExtraction,
    )
    return response.output_parsed
