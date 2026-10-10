"""Step 2 output: what the model must return. It records what the vendor said and nothing more.

The model never converts units or currency and never does arithmetic. That happens in app/normalize.py,
in plain code, so every number on screen can be traced to a formula.
"""
from typing import Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]


class PriceEntry(BaseModel):
    vendor_item_text: str = Field(description="How the vendor referred to the item(s): code, description, size, or the rule.")
    rfx_line_nos: list[int] = Field(description="RFx line numbers this price applies to. Empty if no line matches.")
    match_basis: str = Field(description="Why these lines: e.g. 'buyer item code', 'size and ply match', 'rule for all 5-ply'.")
    price_type: Literal["explicit", "same_as_last_year", "not_quoted"]
    value: float | None = Field(description="The number exactly as written. Null unless price_type is explicit.")
    currency: str | None = Field(description="ISO code such as INR or USD, as the vendor quoted.")
    unit_basis: Literal["per_piece", "per_100_pieces", "per_1000_pieces", "per_kg", "other"] | None
    unit_text: str | None = Field(description="The unit wording as written, e.g. 'Rate per 100 Nos'.")
    source_document: str
    source_quote: str = Field(description="Short verbatim snippet from the document that contains this price.")
    confidence: Confidence
    confidence_reason: str = Field(description="One sentence. Required detail when not high: what is hard to read or ambiguous.")


class Discount(BaseModel):
    description: str
    percent: float | None
    conditional: bool
    condition: str | None
    source_document: str
    source_quote: str


class Answer(BaseModel):
    question_id: str
    answer: Literal["yes", "no", "partial", "unanswered"]
    answer_text: str = Field(description="The vendor's answer in a few words, including any number they gave.")
    source_document: str | None
    source_quote: str | None


class DocumentInfo(BaseModel):
    filename: str
    doc_type: Literal["quotation", "iso_9001_certificate", "other_certificate", "email", "other"]
    summary: str
    issued_to: str | None = Field(description="For certificates: the company named on it.")
    valid_until: str | None = Field(description="For certificates: expiry date as YYYY-MM-DD, exactly as printed.")


class VendorExtraction(BaseModel):
    vendor_name: str
    prices: list[PriceEntry]
    discounts: list[Discount]
    freight: Literal["included", "excluded", "partly_included", "not_stated"]
    freight_note: str = Field(description="What the vendor said about delivery, duty and freight, in one sentence.")
    payment_terms: str | None
    lead_time_days: int | None
    validity_days: int | None
    answers: list[Answer]
    documents: list[DocumentInfo]
    open_issues: list[str] = Field(description="Things a buyer must clarify with this vendor before comparing or awarding.")
