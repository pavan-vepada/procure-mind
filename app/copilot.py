"""The RFx co-pilot: the buyer describes what they need and the model builds a structured RFx with them.

Each turn the model returns a reply plus only the parts of the draft that changed. Code applies the
changes, so the draft on screen is always the stored one, never the model's memory of it.
"""
import json

from pydantic import BaseModel, Field

from app import db
from app.config import settings
from app.extraction.llm import client

EMPTY = {"title": "", "scope": "", "due_on": None, "vendors": [],
         "terms": {"currency": "INR", "price_basis": "", "delivery_location": "", "payment": "", "validity_days": None},
         "line_items": [], "questionnaire": [], "open_points": [], "messages": [], "sent_at": None}


class LineItem(BaseModel):
    line_no: int
    description: str = Field(description="Short item name.")
    specification: str | None = Field(description="Size, grade, material, model or other spec, as the buyer gave it.")
    uom: str | None = Field(description="Unit the buyer orders in: piece, roll, kg, set, ...")
    unit_weight_kg: float | None = Field(description="Weight of one unit in kg, only if the buyer gave it. "
                                                     "Needed only where vendors may quote by weight.")
    annual_qty: int | None = Field(description="Only if the buyer gave it. Never invent a quantity.")


class Question(BaseModel):
    id: str = Field(description="Q1, Q2, ...")
    question: str
    mandatory: bool = Field(description="True if failing it should exclude the vendor from award.")
    requires_document: str | None = Field(description="Evidence to attach, e.g. iso_9001_certificate. Null if none.")


class Terms(BaseModel):
    currency: str
    price_basis: str = Field(description="e.g. 'per piece, delivered Bhiwandi, GST extra'")
    delivery_location: str
    payment: str
    validity_days: int | None


class Turn(BaseModel):
    reply: str = Field(description="What you say to the buyer. Short. At most two questions.")
    title: str | None = Field(description="Null if unchanged.")
    scope: str | None = Field(description="Null if unchanged.")
    due_on: str | None = Field(description="Reply deadline as YYYY-MM-DD. Null if unchanged.")
    terms: Terms | None = Field(description="Full terms if anything in them changed, else null.")
    upsert_line_items: list[LineItem] = Field(description="Lines to add or replace, matched on line_no. Empty if none.")
    remove_line_nos: list[int]
    questionnaire: list[Question] | None = Field(description="The full questionnaire if it changed, else null.")
    vendors: list[str] | None = Field(description="Full invite list if it changed, else null.")
    open_points: list[str] = Field(description="Everything still missing or unconfirmed before this RFx can go out.")


INSTRUCTIONS = """You are a procurement co-pilot helping a category buyer write an RFx in any spend category.
You build the RFx with them through conversation and keep a structured draft up to date.

How to work:
- Take what the buyer gives you and put it in the draft straight away. Ask for what is missing, at most
  two questions per turn, most important first.
- You may propose sensible defaults (questionnaire, payment terms, validity) and add them to the draft, but
  say in your reply that they are proposals for the buyer to confirm.
- Never invent quantities, sizes or weights. If the buyer has not given them, leave them empty and list the
  gap in open_points. If the buyer asks you to propose a typical line list, you may, and you must say the
  quantities are placeholders.
- Push for what makes vendor replies comparable later, because vendors will reply in their own units and
  formats: one stated price basis (unit, delivery point, GST treatment), a unit of measure on every line, a
  currency, an offer validity period, and a reply deadline. In categories where vendors often quote by
  weight (corrugated boxes, films, metals), also ask for the weight of one unit so per-kg quotes can be
  converted; do not ask for weights where they are irrelevant (IT hardware, services).
- Build a short questionnaire. Mark as mandatory only the questions that should exclude a vendor, and say
  what evidence must be attached for each. Propose optional questions on annual turnover, year established,
  credit rating, capacity and lead time, because the buyer's vendor risk view is built from those answers.
- If the buyer uploads a document (a requirement note, an item list, last year's contract), read it and put
  everything it gives into the draft: every line item, quantity, term and requirement. Say what you took
  from it and what it did not contain. Do not fill its gaps with guesses.
- Return only what changed this turn. open_points is always the full current list."""


def get_draft(conn) -> dict:
    row = conn.execute("SELECT value FROM app_settings WHERE key = 'rfx_draft'").fetchone()
    return json.loads(row["value"]) if row else json.loads(json.dumps(EMPTY))


def save_draft(conn, draft: dict):
    conn.execute("INSERT OR REPLACE INTO app_settings VALUES ('rfx_draft', ?)", (json.dumps(draft),))
    conn.commit()


def chat(message: str, docs: list | None = None) -> dict:
    """One turn. docs are files the buyer uploaded this turn, already opened by the same readers extraction uses."""
    conn = db.connect()
    draft = get_draft(conn)
    current = {k: v for k, v in draft.items() if k not in ("messages", "sent_at")}
    history = [{"role": "assistant" if m["role"] == "copilot" else "user", "content": m["text"]}
               for m in draft["messages"][-12:]]
    names = ", ".join(d.filename for d in docs or [])
    shown = (message + "\n" if message else "") + (f"[Uploaded: {names}]" if names else "")
    content = [{"type": "input_text", "text": message or "Please draft the RFx from the attached document."}]
    for doc in docs or []:
        content.append({"type": "input_text", "text": f"\n===== Uploaded document: {doc.filename} =====\n{doc.text}"})
        content += [{"type": "input_image", "image_url": f"data:image/jpeg;base64,{image}", "detail": "high"} for image in doc.images]
    history.append({"role": "user", "content": content})
    draft["messages"].append({"role": "user", "text": shown})
    response = client.responses.parse(
        model=settings.openai_model, reasoning={"effort": "low"}, text_format=Turn,
        instructions=INSTRUCTIONS + "\n\nCurrent draft:\n" + json.dumps(current), input=history)
    turn: Turn = response.output_parsed

    for field in ("title", "scope", "due_on", "vendors"):
        if getattr(turn, field) is not None:
            draft[field] = getattr(turn, field)
    if turn.terms:
        draft["terms"] = turn.terms.model_dump()
    if turn.questionnaire is not None:
        draft["questionnaire"] = [q.model_dump() for q in turn.questionnaire]
    lines = {l["line_no"]: l for l in draft["line_items"] if l["line_no"] not in turn.remove_line_nos}
    lines.update({l.line_no: l.model_dump() for l in turn.upsert_line_items})
    draft["line_items"] = [lines[n] for n in sorted(lines)]
    draft["open_points"] = turn.open_points
    draft["messages"].append({"role": "copilot", "text": turn.reply})
    save_draft(conn, draft)
    return draft


def outgoing_email(draft: dict) -> dict:
    """The email that would go to vendors. Built by code from the draft, so it says exactly what the draft says."""
    terms = draft["terms"]
    questions = "\n".join(f"  {q['id']}. {q['question']}" + (" (mandatory)" if q["mandatory"] else "") for q in draft["questionnaire"])
    body = (f"Dear Supplier,\n\nWe invite your quotation for: {draft['title']}.\n\n{draft['scope']}\n\n"
            f"Please quote all {len(draft['line_items'])} line items in the attached sheet.\n"
            f"Price basis: {terms['price_basis']}\nCurrency: {terms['currency']}\nPayment: {terms['payment']}\n"
            f"Offer validity: {terms['validity_days'] or 'please state'} days\nReply by: {draft['due_on'] or 'to be confirmed'}\n\n"
            f"Please also answer the following and attach supporting documents:\n{questions}\n\n"
            "You may reply in your own format. Regards,\nCategory Buyer, Packaging")
    return {"subject": f"RFQ: {draft['title']}", "body": body, "to": draft["vendors"],
            "attachment": "RFx_line_items.xlsx"}
