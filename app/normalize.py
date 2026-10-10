"""Step 3 of extraction: plain code, no model. Turns what the vendor said into rupees per piece.

Every cell gets a status, a formula a buyer can check, and a list of reasons if it needs review.
  quoted   vendor gave rupees per piece; shown as written
  derived  converted from another unit or currency; the formula shows how
  assumed  vendor gave no number ("same as last year"); filled from last year's contract
  missing  vendor did not quote this line
  unclear  vendor said something we could not turn into a price
"""
from datetime import date

from app.extraction.readers import ReadDoc
from app.extraction.schema import PriceEntry, VendorExtraction

PIECES_PER_UNIT = {"per_piece": 1, "per_100_pieces": 100, "per_1000_pieces": 1000}
OUTLIER_VS_LAST_YEAR = 0.35  # a price this far from last year's is more likely a misread than a real move


def _pick_entry(line_no: int, prices: list[PriceEntry]):
    """Most specific statement wins: 'lines 28 and 29 at X' beats 'all 7-ply at Y'."""
    matches = sorted((p for p in prices if line_no in p.rfx_line_nos), key=lambda p: len(p.rfx_line_nos))
    if not matches:
        return None, None
    conflict = None
    if len(matches) > 1 and len(matches[0].rfx_line_nos) == len(matches[1].rfx_line_nos) \
            and (matches[0].value, matches[0].unit_basis) != (matches[1].value, matches[1].unit_basis):
        conflict = "The vendor gave two different prices for this line."
    return matches[0], conflict


def normalise_line(line: dict, prices: list[PriceEntry], fx_usd_inr: float, docs: dict[str, ReadDoc]) -> dict:
    cell = {"line_no": line["line_no"], "status": "missing", "price_inr": None, "needs_review": False,
            "review_reasons": [], "formula": "Vendor did not quote this line.", "quoted_value": None,
            "quoted_unit": None, "quoted_currency": None, "source_document": None, "source_quote": None,
            "confidence": None, "match_basis": None}
    entry, conflict = _pick_entry(line["line_no"], prices)
    if entry is None:
        return cell
    cell.update(quoted_value=entry.value, quoted_unit=entry.unit_text or entry.unit_basis,
                quoted_currency=entry.currency, source_document=entry.source_document,
                source_quote=entry.source_quote, confidence=entry.confidence, match_basis=entry.match_basis)
    reasons = cell["review_reasons"]
    if conflict:
        reasons.append(conflict)

    if entry.price_type == "not_quoted":
        cell["formula"] = "Vendor declined to quote this line."
        return cell
    if entry.price_type == "same_as_last_year" and line.get("last_year_price_inr") is None:
        cell.update(status="unclear", needs_review=True, formula=f"Vendor wrote \"{entry.source_quote}\" but this RFx holds no previous price.")
        reasons.append("No previous price on file to fill this from. Ask the vendor for a number.")
        return cell
    if entry.price_type == "same_as_last_year":
        cell.update(status="assumed", price_inr=line["last_year_price_inr"],
                    formula=f"Vendor gave no number, only \"{entry.source_quote}\". "
                            f"Filled with last year's contract price of Rs. {line['last_year_price_inr']:.2f}.")
        return cell

    currency = (entry.currency or "INR").upper()
    rate = {"INR": 1.0, "USD": fx_usd_inr}.get(currency)
    no_weight = entry.unit_basis == "per_kg" and not line.get("box_weight_kg")
    if entry.value is None or rate is None or entry.unit_basis in (None, "other") or no_weight:
        cell.update(status="unclear", needs_review=True,
                    formula=f"Could not convert \"{entry.source_quote}\" into rupees per piece.")
        reasons.append("No number could be read." if entry.value is None
                       else "Quoted per kg, but the RFx has no box weight for this line." if no_weight
                       else "Unit or currency not recognised. Only INR and USD are converted.")
        return cell

    steps = [f"{entry.value:g} {currency} {entry.unit_basis.replace('_', ' ')}"]
    price = entry.value
    if entry.unit_basis == "per_kg":
        price *= line["box_weight_kg"]
        steps.append(f"x {line['box_weight_kg']} kg box weight (from RFx spec)")
    elif PIECES_PER_UNIT[entry.unit_basis] > 1:
        price /= PIECES_PER_UNIT[entry.unit_basis]
        steps.append(f"/ {PIECES_PER_UNIT[entry.unit_basis]} pieces")
    if currency == "USD":
        price *= fx_usd_inr
        steps.append(f"x {fx_usd_inr:g} INR per USD")
    converted = len(steps) > 1
    cell.update(status="derived" if converted else "quoted", price_inr=round(price, 4),
                formula=" ".join(steps) + f" = Rs. {price:.2f} per piece" if converted
                else f"Rs. {price:.2f} per piece, as quoted.")

    # Checks that do not rely on the model's opinion of itself.
    if entry.confidence == "low":
        reasons.append(f"The model was unsure of its reading: {entry.confidence_reason}")
    doc = docs.get(entry.source_document)
    if doc and doc.text and round(entry.value, 4) not in doc.numbers():
        reasons.append(f"The number {entry.value:g} was read by the vision model but OCR did not find it in the image."
                       if doc.images else f"The number {entry.value:g} does not appear in the source text.")
    last = line.get("last_year_price_inr")
    if last and abs(price / last - 1) > OUTLIER_VS_LAST_YEAR:
        reasons.append(f"{(price / last - 1) * 100:+.0f}% against last year's Rs. {last:.2f}. "
                       "Check for a unit or reading error.")
    cell["needs_review"] = bool(reasons)
    return cell


def quality_gate(rfx: dict, extraction: VendorExtraction, as_of: date) -> tuple[str, str]:
    """cleared only if every mandatory question is answered yes and any required document is valid today."""
    answers = {a.question_id: a for a in extraction.answers}
    failed, unverified = [], []
    for q in rfx["questionnaire"]:
        if not q.get("mandatory"):
            continue
        answer = answers.get(q["id"])
        if answer is None or answer.answer == "unanswered":
            unverified.append(f"{q['id']} not answered.")
            continue
        if answer.answer == "partial":  # an incomplete answer is something to chase, not a reason to exclude
            unverified.append(f"{q['id']} only partly answered: \"{answer.answer_text}\".")
            continue
        if answer.answer != "yes":
            failed.append(f"{q['id']} answered \"{answer.answer_text}\".")
            continue
        required = q.get("requires_document")
        if required:
            proofs = [d for d in extraction.documents if d.doc_type == required]
            if not proofs:
                unverified.append(f"{q['id']}: vendor says yes but attached no certificate.")
            elif not any(d.valid_until and d.valid_until >= as_of.isoformat() for d in proofs):
                expiry = proofs[0].valid_until or "an unreadable date"
                failed.append(f"{q['id']}: vendor says yes but the attached certificate expired on {expiry}.")
    if failed:
        return "failed", " ".join(failed + unverified)
    if unverified:
        return "unverified", " ".join(unverified)
    return "cleared", "All mandatory questions answered yes, with a valid certificate on file."
