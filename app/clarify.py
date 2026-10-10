"""Drafts the email a buyer would send back to a vendor to close the gaps in their quote.

This is what the system does when it is not sure: it does not guess, it asks the vendor.
"""
import json

from app import db
from app.config import settings
from app.extraction.llm import client

INSTRUCTIONS = """Write a short, polite email from a category buyer to a vendor asking them to clarify their quote
so it can be compared like for like. Use only the facts given. Ask specific, numbered questions, each answerable
in one line. At most eight questions: group lines that need the same answer into one question and name the
line numbers. Put what blocks an award first (missing prices, quality evidence, freight), and leave out
anything the vendor already answered. Do not mention other vendors or their prices. Plain text, no markdown. First line is 'Subject: ...'."""


def draft_email(vendor_id: str) -> dict:
    conn = db.connect()
    vendor = conn.execute("SELECT * FROM vendors WHERE vendor_id = ?", (vendor_id,)).fetchone()
    rfx = db.get_rfx(conn)
    cells = [dict(r) for r in conn.execute(
        "SELECT q.line_no, l.description, q.status, q.formula, q.review_reasons, q.source_quote FROM quotes q "
        "JOIN line_items l USING (line_no) WHERE q.vendor_id = ? AND (q.needs_review = 1 OR q.status IN "
        "('assumed', 'missing', 'unclear'))", (vendor_id,))]
    facts = {
        "rfx": rfx["title"], "requested_price_basis": rfx["terms"].get("price_basis"),
        "requested_payment": rfx["terms"].get("payment"), "buyer": rfx.get("buyer", {}),
        "vendor": vendor["name"], "contact": json.loads(vendor["email"] or "{}").get("from_name"),
        "quality_gate": vendor["quality_gate"], "quality_gate_reason": vendor["quality_gate_reason"],
        "freight": vendor["freight"], "freight_note": vendor["freight_note"],
        "conditional_rebate": vendor["conditional_discount_condition"], "payment_terms": vendor["payment_terms"],
        "issues_found_when_reading": json.loads(vendor["open_issues"] or "[]"),
        "lines_needing_an_answer": cells,
    }
    response = client.responses.create(model=settings.openai_model, reasoning={"effort": "low"},
                                       instructions=INSTRUCTIONS, input=json.dumps(facts))
    subject, _, body = response.output_text.partition("\n")
    return {"subject": subject.removeprefix("Subject:").strip(), "body": body.strip()}
