"""Reads one vendor reply end to end: files -> reading mode -> model extraction -> normalisation -> database."""
import json
from datetime import date, datetime
from pathlib import Path

from app import db
from app.config import settings
from app.extraction.llm import extract_vendor
from app.extraction.readers import ReadDoc, read_file
from app.extraction.schema import VendorExtraction
from app.normalize import normalise_line, quality_gate


def read_reply(folder: Path) -> tuple[dict, list[ReadDoc]]:
    email_path = folder / "email.json"
    email = json.loads(email_path.read_text()) if email_path.exists() else {}
    docs = []
    if email.get("body"):
        docs.append(ReadDoc("Email body", "direct", "Email text: read directly.",
                            f"From: {email['from_name']} <{email['from_email']}>\n"
                            f"Subject: {email['subject']}\n\n{email['body']}"))
    for path in sorted(folder.iterdir()):
        if path.name != "email.json":
            docs += read_file(path)
    return email, docs


def write_quotes(conn, vendor_id: str, extraction: VendorExtraction, docs: dict[str, ReadDoc]):
    """Also called when the FX rate changes. Cells the buyer has corrected are left alone."""
    rfx, fx = db.get_rfx(conn), db.get_fx(conn)
    kept = {r["line_no"] for r in conn.execute(
        "SELECT line_no FROM quotes WHERE vendor_id = ? AND buyer_override = 1", (vendor_id,))}
    conn.execute("DELETE FROM quotes WHERE vendor_id = ? AND buyer_override = 0", (vendor_id,))
    cells = [normalise_line(line, extraction.prices, fx, docs)
             for line in rfx["line_items"] if line["line_no"] not in kept]
    # Misreads in a photo come in runs (one slipped row shifts every rate below it), so two
    # implausible prices from the same image put every row of that image up for review.
    for name, doc in docs.items():
        from_image = [c for c in cells if c["source_document"] == name and doc.images]
        if sum("against last year" in " ".join(c["review_reasons"]) for c in from_image) >= 2:
            for c in from_image:
                c["needs_review"] = True
                c["review_reasons"].append("Other rows read from this image look misaligned, so check every row.")
    for c in cells:
        conn.execute(
            "INSERT INTO quotes (vendor_id, line_no, status, price_inr, needs_review, review_reasons, formula, "
            "quoted_value, quoted_unit, quoted_currency, source_document, source_quote, confidence, match_basis) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (vendor_id, c["line_no"], c["status"], c["price_inr"], int(c["needs_review"]),
             json.dumps(c["review_reasons"]), c["formula"], c["quoted_value"], c["quoted_unit"],
             c["quoted_currency"], c["source_document"], c["source_quote"], c["confidence"], c["match_basis"]))


def process_vendor(conn, vendor_id: str, folder: Path) -> VendorExtraction:
    rfx = db.get_rfx(conn)
    email, docs = read_reply(folder)
    extraction = extract_vendor(rfx, docs)
    gate, gate_reason = quality_gate(rfx, extraction, date.today())
    conditional = next((d for d in extraction.discounts if d.conditional and d.percent), None)

    for table in ("vendors", "documents", "quotes", "questionnaire"):
        conn.execute(f"DELETE FROM {table} WHERE vendor_id = ?", (vendor_id,))
    conn.execute(
        "INSERT INTO vendors VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (vendor_id, extraction.vendor_name, email.get("received_at"), str(folder), json.dumps(email),
         gate, gate_reason, extraction.freight, extraction.freight_note,
         conditional.percent if conditional else None, conditional.condition if conditional else None,
         extraction.payment_terms, extraction.lead_time_days, extraction.validity_days,
         json.dumps(extraction.open_issues), extraction.model_dump_json(),
         datetime.now().isoformat(timespec="seconds"), settings.openai_model))
    info = {d.filename: d for d in extraction.documents}
    for doc in docs:
        meta = info.get(doc.filename)
        conn.execute(
            "INSERT INTO documents (vendor_id, filename, doc_type, read_mode, read_mode_reason, ocr_confidence, "
            "text, summary, valid_until) VALUES (?,?,?,?,?,?,?,?,?)",
            (vendor_id, doc.filename, meta.doc_type if meta else None, doc.mode, doc.reason, doc.ocr_confidence,
             doc.text, meta.summary if meta else None, meta.valid_until if meta else None))
    answers = {a.question_id: a for a in extraction.answers}
    for q in rfx["questionnaire"]:
        a = answers.get(q["id"])
        conn.execute("INSERT INTO questionnaire VALUES (?,?,?,?,?,?,?,?)", (
            vendor_id, q["id"], q["question"], int(q.get("mandatory", False)),
            a.answer if a else "unanswered", a.answer_text if a else "", a.source_document if a else None,
            a.source_quote if a else None))
    write_quotes(conn, vendor_id, extraction, {d.filename: d for d in docs})
    db.log(conn, "system", "extracted", f"{extraction.vendor_name}: {len(docs)} documents read")
    conn.commit()
    return extraction
