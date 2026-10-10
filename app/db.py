"""SQLite storage. Tables are flat and plainly named because the analyst agent queries them with SQL.

Each RFx has its own database file, so events cannot leak into each other and the analyst can only
ever see the RFx the buyer is looking at. The current RFx is set per request (see app/api.py).
"""
import json
import shutil
import sqlite3
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path

from app.config import settings

DEMO = "demo"                                  # the pre-loaded RFx with five vendor replies
DEMO_SNAPSHOT = Path("data/seed/demo.db")      # its extracted state, committed so the hosted app starts ready
current_event: ContextVar[str] = ContextVar("current_event", default=DEMO)

SCHEMA = """
CREATE TABLE IF NOT EXISTS rfx (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS line_items (
    line_no INTEGER PRIMARY KEY, item_code TEXT, description TEXT, ply INTEGER,
    length_mm INTEGER, width_mm INTEGER, height_mm INTEGER, box_weight_kg REAL,
    annual_qty INTEGER, last_year_price_inr REAL, specification TEXT, uom TEXT);
CREATE TABLE IF NOT EXISTS vendors (
    vendor_id TEXT PRIMARY KEY, name TEXT, received_at TEXT, folder TEXT, email TEXT,
    quality_gate TEXT,            -- cleared | failed | unverified
    quality_gate_reason TEXT,
    freight TEXT,                 -- included | excluded | partly_included | not_stated
    freight_note TEXT,
    conditional_discount_pct REAL, conditional_discount_condition TEXT,
    payment_terms TEXT, lead_time_days INTEGER, validity_days INTEGER,
    open_issues TEXT, extraction TEXT, extracted_at TEXT, model TEXT);
CREATE TABLE IF NOT EXISTS documents (
    doc_id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id TEXT, filename TEXT, doc_type TEXT,
    read_mode TEXT, read_mode_reason TEXT, ocr_confidence REAL, text TEXT, summary TEXT, valid_until TEXT);
CREATE TABLE IF NOT EXISTS quotes (
    vendor_id TEXT, line_no INTEGER,
    status TEXT,                  -- quoted | derived | assumed | missing | unclear
    price_inr REAL,               -- per piece, before any conditional discount; NULL if missing or unclear
    needs_review INTEGER, review_reasons TEXT, formula TEXT,
    quoted_value REAL, quoted_unit TEXT, quoted_currency TEXT,
    source_document TEXT, source_quote TEXT, confidence TEXT, match_basis TEXT,
    buyer_override INTEGER DEFAULT 0,
    PRIMARY KEY (vendor_id, line_no));
CREATE TABLE IF NOT EXISTS questionnaire (
    vendor_id TEXT, question_id TEXT, question TEXT, mandatory INTEGER,
    answer TEXT,                  -- yes | no | partial | unanswered
    answer_text TEXT, source_document TEXT, source_quote TEXT,
    PRIMARY KEY (vendor_id, question_id));
-- One row per vendor per line with everything a question usually needs, so the analyst's SQL stays simple.
CREATE VIEW IF NOT EXISTS quote_values AS
    SELECT q.vendor_id, v.name AS vendor_name, v.quality_gate, v.freight,
           q.line_no, l.item_code, l.description, l.ply, l.annual_qty, l.box_weight_kg,
           q.status, q.needs_review, q.buyer_override, q.price_inr,
           q.price_inr * l.annual_qty AS annual_value_inr,
           l.last_year_price_inr, l.last_year_price_inr * l.annual_qty AS last_year_value_inr
    FROM quotes q JOIN line_items l USING (line_no) JOIN vendors v USING (vendor_id);
-- Analyst conversations for this RFx, so the buyer can start a new one and come back to old ones.
CREATE TABLE IF NOT EXISTS analyst_chats (
    chat_id TEXT PRIMARY KEY, title TEXT, messages TEXT, response_id TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, action TEXT, detail TEXT);
"""


def events_dir() -> Path:
    folder = Path(settings.data_dir) / "events"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def path(event: str | None = None) -> Path:
    return events_dir() / f"{event or current_event.get()}.db"


def restore_demo(force: bool = False):
    """Puts the demo RFx back to its freshly extracted state. Runs at start-up and from the reset button."""
    if DEMO_SNAPSHOT.exists() and (force or not path(DEMO).exists()):
        shutil.copy(DEMO_SNAPSHOT, path(DEMO))


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(path())
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    if "uom" not in [c[1] for c in conn.execute("PRAGMA table_info(line_items)")]:  # databases made before these columns
        conn.execute("ALTER TABLE line_items ADD COLUMN specification TEXT")
        conn.execute("ALTER TABLE line_items ADD COLUMN uom TEXT")
    return conn


def load_rfx(conn, rfx: dict):
    conn.execute("INSERT OR REPLACE INTO rfx (id, data) VALUES (1, ?)", (json.dumps(rfx),))
    conn.execute("DELETE FROM line_items")
    for l in rfx["line_items"]:
        conn.execute("INSERT INTO line_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
            l["line_no"], l.get("item_code"), l["description"], l.get("ply"), l.get("length_mm"), l.get("width_mm"),
            l.get("height_mm"), l.get("box_weight_kg"), l.get("annual_qty"), l.get("last_year_price_inr"),
            l.get("specification"), l.get("uom") or "piece"))
    conn.execute("INSERT OR IGNORE INTO app_settings VALUES ('fx_usd_inr', ?)", (str(settings.fx_usd_inr),))


def get_rfx(conn) -> dict | None:
    """None while the RFx is still a draft."""
    row = conn.execute("SELECT data FROM rfx WHERE id = 1").fetchone()
    return json.loads(row["data"]) if row else None


def get_fx(conn) -> float:
    row = conn.execute("SELECT value FROM app_settings WHERE key = 'fx_usd_inr'").fetchone()
    return float(row["value"]) if row else settings.fx_usd_inr


def log(conn, actor: str, action: str, detail: str):
    conn.execute("INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)",
                 (datetime.now().isoformat(timespec="seconds"), actor, action, detail))
