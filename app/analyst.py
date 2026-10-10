"""The analyst: an agent that answers a buyer's questions about the comparison.

Why an agent and not a pipeline: the questions are open-ended, so the model decides which tool to use
and may take several steps. Why tools: the model never does arithmetic. It writes a query or sets up an
award scenario, code computes the result, and the screen shows both the result and how it was produced.
"""
import json
import sqlite3
from itertools import combinations

from app import db
from app.config import settings
from app.extraction.llm import client

MAX_STEPS = 10
MAX_ROWS = 200

INSTRUCTIONS = """You are a procurement analyst helping a category buyer decide an award. You answer from the
extracted quote data using tools. The buyer may have crores of rupees riding on your answer.

Rules:
- Every number you state must come from a tool result in this conversation. Never calculate in your head
  and never estimate. If the data cannot answer the question, say so and say what is missing.
- Use run_sql for look-ups and comparisons. Use award_scenario for any question about who should get which
  lines or what an award would cost. Use show_table or show_chart when the answer is a table or a chart;
  they run SQL so the buyer sees computed figures, not retyped ones. Do not paste large tables into your text.
- Always say what the answer depends on. If the result rests on assumed prices, cells needing review,
  vendors who excluded freight or duty, a conditional rebate, or a vendor who has not cleared the quality
  gate, state it plainly next to the number. Do not bury it.
- "derived" cells are exact unit or currency conversions done in code and are as reliable as quoted ones.
  Doubt comes from: needs_review cells, assumed cells, missing lines, the quality gate, excluded freight or
  duty, and conditional rebates. USD-derived prices also move with the exchange rate.
- Prices are rupees per unit of the line (per piece, roll, etc.) before GST. Annual value = price x annual quantity.
- Never apply a rebate or a freight estimate unless the buyer asks, and say so when you do.
- Each vendor has a risk profile in the briefing below (overall level and five dimensions, built by rule from
  what the vendor sent). Mention a vendor's risk when an answer would award it lines, and use it when the
  buyer asks about risk. Financial figures in it are the vendor's own claims, not verified. "unknown" means
  the vendor gave no information, which is not the same as low risk.
- When asked for a recommendation, give one, with the reasons, the risks, and what to confirm with which
  vendor before signing. Do not hide behind "it depends".
- Be brief and direct. Lead with the answer. Write large values as Rs. X.XX crore or Rs. X.X lakh, two decimals
  at most. Use short markdown. The buyer already sees any table or chart you show, so do not repeat its rows.

Database (SQLite, read-only):
- quote_values: one row per vendor per line. vendor_id, vendor_name, quality_gate (cleared|failed|unverified),
  freight (included|excluded|partly_included|not_stated), line_no, item_code, description, ply, annual_qty,
  box_weight_kg, status (quoted|derived|assumed|missing|unclear), needs_review (0/1), buyer_override (0/1),
  price_inr (NULL when missing or unclear), annual_value_inr, last_year_price_inr, last_year_value_inr
- quotes: adds formula, review_reasons, quoted_value, quoted_unit, quoted_currency, source_document, source_quote, confidence
- vendors: vendor_id, name, received_at, quality_gate, quality_gate_reason, freight, freight_note,
  conditional_discount_pct, conditional_discount_condition, payment_terms, lead_time_days, validity_days, open_issues
- questionnaire: vendor_id, question_id, question, mandatory (0/1), answer (yes|no|partial|unanswered), answer_text, source_quote
- documents: vendor_id, filename, doc_type, read_mode, read_mode_reason, summary, valid_until
- line_items: line_no, item_code, description, specification, uom, ply, length_mm, width_mm, height_mm, box_weight_kg,
  annual_qty, last_year_price_inr (ply, dimensions, weight and last-year price may be NULL for some RFx events)
Give result columns readable names with AS, for example AS "Vendor"."""

TOOLS = [
    {"type": "function", "name": "run_sql", "strict": True,
     "description": "Run one read-only SELECT and get the rows back. For your own look-ups.",
     "parameters": {"type": "object", "additionalProperties": False, "required": ["query"],
                    "properties": {"query": {"type": "string"}}}},
    {"type": "function", "name": "show_table", "strict": True,
     "description": "Run a SELECT and show the result to the buyer as a table they can export to Excel.",
     "parameters": {"type": "object", "additionalProperties": False, "required": ["title", "query"],
                    "properties": {"title": {"type": "string"}, "query": {"type": "string"}}}},
    {"type": "function", "name": "show_chart", "strict": True,
     "description": "Run a SELECT and show the result to the buyer as a chart. x is the label column; "
                    "y lists one or more numeric columns. Column names must match the query's output.",
     "parameters": {"type": "object", "additionalProperties": False,
                    "required": ["title", "query", "chart_type", "x", "y"],
                    "properties": {"title": {"type": "string"}, "query": {"type": "string"},
                                   "chart_type": {"type": "string", "enum": ["bar", "stacked_bar", "line"]},
                                   "x": {"type": "string"}, "y": {"type": "array", "items": {"type": "string"}}}}},
    {"type": "function", "name": "award_scenario", "strict": True,
     "description": "Work out an award: each line goes to the cheapest eligible vendor, under the constraints "
                    "given. Shows the buyer the award by vendor and by line, and returns totals and caveats.",
     "parameters": {"type": "object", "additionalProperties": False,
                    "required": ["title", "gate", "exclude_vendor_ids", "max_vendors", "price_basis",
                                 "apply_rebate_for_vendor_ids", "freight_uplifts"],
                    "properties": {
                        "title": {"type": "string"},
                        "gate": {"type": "string", "enum": ["cleared_only", "cleared_and_unverified", "all"],
                                 "description": "Which vendors are eligible by quality gate."},
                        "exclude_vendor_ids": {"type": "array", "items": {"type": "string"}},
                        "max_vendors": {"type": ["integer", "null"],
                                        "description": "Cap on how many vendors share the award. 1 means single source. Null means no cap."},
                        "price_basis": {"type": "string", "enum": ["all_prices", "firm_prices_only"],
                                        "description": "firm_prices_only ignores assumed prices and cells still needing review."},
                        "apply_rebate_for_vendor_ids": {"type": "array", "items": {"type": "string"},
                                                        "description": "Vendors whose conditional rebate should be treated as earned."},
                        "freight_uplifts": {"type": "array", "description": "Buyer's freight or duty estimates, as a percent added to a vendor's prices.",
                                            "items": {"type": "object", "additionalProperties": False,
                                                      "required": ["vendor_id", "percent"],
                                                      "properties": {"vendor_id": {"type": "string"}, "percent": {"type": "number"}}}}}}},
]


def _query(sql: str) -> tuple[list[str], list[list]]:
    """Runs on a read-only connection, so the model cannot change data whatever it writes."""
    if not sql.lstrip().lower().startswith(("select", "with")):
        raise ValueError("Only SELECT queries are allowed.")
    conn = sqlite3.connect(f"file:{db.path()}?mode=ro", uri=True)
    try:
        cursor = conn.execute(sql)
        columns = [c[0] for c in cursor.description]
        rows = [[round(v, 4) if isinstance(v, float) else (v[:300] if isinstance(v, str) else v) for v in row]
                for row in cursor.fetchmany(MAX_ROWS)]
        return columns, rows
    finally:
        conn.close()


def award_scenario(title, gate, exclude_vendor_ids, max_vendors, price_basis, apply_rebate_for_vendor_ids,
                   freight_uplifts) -> tuple[dict, list[dict]]:
    conn = db.connect()
    lines = [dict(r) for r in conn.execute("SELECT * FROM line_items ORDER BY line_no")]
    vendors = {r["vendor_id"]: dict(r) for r in conn.execute("SELECT * FROM vendors")}
    allowed = {"cleared_only": {"cleared"}, "cleared_and_unverified": {"cleared", "unverified"},
               "all": {"cleared", "unverified", "failed"}}[gate]
    eligible = [v for v, info in vendors.items() if info["quality_gate"] in allowed and v not in exclude_vendor_ids]
    uplift = {u["vendor_id"]: u["percent"] for u in freight_uplifts}

    prices = {}  # (vendor_id, line_no) -> (adjusted price, quote row)
    for q in conn.execute("SELECT * FROM quotes WHERE price_inr IS NOT NULL"):
        if q["vendor_id"] not in eligible:
            continue
        if price_basis == "firm_prices_only" and (q["status"] == "assumed" or q["needs_review"]):
            continue
        price = q["price_inr"] * (1 + uplift.get(q["vendor_id"], 0) / 100)
        if q["vendor_id"] in apply_rebate_for_vendor_ids:
            price *= 1 - (vendors[q["vendor_id"]]["conditional_discount_pct"] or 0) / 100
        prices[(q["vendor_id"], q["line_no"])] = (price, q)

    by_no = {l["line_no"]: l for l in lines}

    def assign(group):
        award = {}
        for line in lines:
            offers = [(prices[(v, line["line_no"])][0], v) for v in group if (v, line["line_no"]) in prices]
            if offers:
                award[line["line_no"]] = min(offers)
        total = sum(p * (by_no[n]["annual_qty"] or 0) for n, (p, _) in award.items())
        return len(lines) - len(award), total, award

    # With a cap on vendor count, try every allowed group: cover the most lines first, then the lowest cost.
    size = min(max_vendors or len(eligible), len(eligible))
    groups = list(combinations(eligible, size)) if eligible else []
    if not groups:
        return {"error": "No vendor is eligible under these constraints.", "eligible": eligible}, []
    uncovered_count, total, award = min((assign(g) for g in groups), key=lambda r: (r[0], r[1]))

    by_vendor, line_rows, caveats = {}, [], {"assumed": 0, "needs_review": 0}
    for line in lines:
        n = line["line_no"]
        if n not in award:
            line_rows.append([n, line["description"], line["annual_qty"], "No eligible quote", None, None, ""])
            continue
        price, vendor_id = award[n]
        quote = prices[(vendor_id, n)][1]
        value = price * (line["annual_qty"] or 0)
        entry = by_vendor.setdefault(vendor_id, {"lines": 0, "value": 0.0})
        entry["lines"] += 1
        entry["value"] += value
        caveats["assumed"] += quote["status"] == "assumed"
        caveats["needs_review"] += quote["needs_review"]
        note = "assumed from last year" if quote["status"] == "assumed" else "needs review" if quote["needs_review"] else ""
        line_rows.append([n, line["description"], line["annual_qty"],
                          vendors[vendor_id]["name"], round(price, 2), round(value), note])

    covered = set(award)
    last_year = sum((l["last_year_price_inr"] or 0) * (l["annual_qty"] or 0) for l in lines if l["line_no"] in covered)
    vendor_rows, notes = [], []
    for vendor_id, entry in sorted(by_vendor.items(), key=lambda kv: -kv[1]["value"]):
        info = vendors[vendor_id]
        vendor_rows.append([info["name"], info["quality_gate"], entry["lines"], round(entry["value"]),
                            round(100 * entry["value"] / total, 1) if total else None, info["freight"], info["payment_terms"] or "Not stated"])
        if info["freight"] != "included":
            notes.append(f"{info['name']}: freight {info['freight']} ({info['freight_note']})"
                         + (f"; {uplift[vendor_id]}% uplift applied as instructed" if vendor_id in uplift else "; no freight cost added"))
        if info["quality_gate"] != "cleared":
            notes.append(f"{info['name']}: quality gate {info['quality_gate']} ({info['quality_gate_reason']})")
        if info["conditional_discount_pct"]:
            applied = vendor_id in apply_rebate_for_vendor_ids
            notes.append(f"{info['name']}: {info['conditional_discount_pct']}% rebate {'APPLIED' if applied else 'not applied'}; "
                         f"condition: {info['conditional_discount_condition']}; awarded value Rs. {entry['value']:,.0f}")
    _, single_total, single_award = min((assign((v,)) for v in eligible), key=lambda r: (r[0], r[1]))
    single_vendor = next(iter(single_award.values()))[1] if single_award else None

    result = {
        "eligible_vendors": [vendors[v]["name"] for v in eligible],
        "total_annual_value_inr": round(total), "lines_awarded": len(award),
        "lines_with_no_eligible_quote": [l["line_no"] for l in lines if l["line_no"] not in covered],
        "last_year_value_same_lines_inr": round(last_year),
        "change_vs_last_year_pct": round(100 * (total / last_year - 1), 2) if last_year else None,
        "by_vendor": [dict(zip(["vendor", "quality_gate", "lines", "annual_value_inr", "share_pct", "freight", "payment_terms"], r)) for r in vendor_rows],
        "best_single_vendor_for_reference": {"vendor": vendors[single_vendor]["name"] if single_vendor else None,
                                             "lines_covered": len(single_award), "annual_value_inr": round(single_total)},
        "awarded_cells_assumed_from_last_year": caveats["assumed"],
        "awarded_cells_needing_review": caveats["needs_review"],
        "caveats": notes,
    }
    params = {"gate": gate, "exclude_vendor_ids": exclude_vendor_ids, "max_vendors": max_vendors,
              "price_basis": price_basis, "apply_rebate_for_vendor_ids": apply_rebate_for_vendor_ids,
              "freight_uplifts": freight_uplifts}
    how = "Each line awarded to the cheapest eligible vendor. Settings: " + json.dumps(params)
    artifacts = [
        {"type": "table", "title": f"{title}: by vendor", "how": how, "notes": notes,
         "columns": ["Vendor", "Quality gate", "Lines", "Annual value (Rs.)", "Share %", "Freight", "Payment terms"], "rows": vendor_rows},
        {"type": "table", "title": f"{title}: by line", "how": how, "notes": notes,
         "columns": ["Line", "Item", "Qty / year", "Awarded to", "Price (Rs.)", "Annual value (Rs.)", "Note"], "rows": line_rows},
    ]
    return result, artifacts


def _run_tool(name: str, args: dict, artifacts: list) -> dict:
    try:
        if name == "award_scenario":
            result, made = award_scenario(**args)
            artifacts += made
            return result
        columns, rows = _query(args["query"])
        if name == "run_sql":
            return {"columns": columns, "rows": rows, "truncated": len(rows) == MAX_ROWS}
        if name == "show_chart":
            missing = [c for c in [args["x"], *args["y"]] if c not in columns]
            if missing:
                return {"error": f"Columns {missing} are not in the query output {columns}."}
            artifacts.append({"type": "chart", "title": args["title"], "how": args["query"], "columns": columns,
                              "rows": rows, "chart_type": args["chart_type"], "x": args["x"], "y": args["y"]})
        else:
            artifacts.append({"type": "table", "title": args["title"], "how": args["query"], "columns": columns, "rows": rows})
        return {"shown_to_buyer": True, "columns": columns, "rows": rows}
    except Exception as error:  # hand the error back so the model can fix its own query
        return {"error": str(error)}


def _briefing() -> str:
    """Current state of the data, rebuilt for every question because the buyer may have corrected cells."""
    from app import comparison
    conn = db.connect()
    rows = []
    risks = {v["vendor_id"]: v["risk"] for v in comparison.build(conn)["vendors"]}
    for v in conn.execute("SELECT * FROM vendors ORDER BY received_at"):
        counts = dict(conn.execute("SELECT status, COUNT(*) FROM quotes WHERE vendor_id = ? GROUP BY status", (v["vendor_id"],)).fetchall())
        review = conn.execute("SELECT COUNT(*) FROM quotes WHERE vendor_id = ? AND needs_review = 1", (v["vendor_id"],)).fetchone()[0]
        rows.append(f"- {v['vendor_id']} = {v['name']}: gate {v['quality_gate']}; freight {v['freight']}; "
                    f"rebate {v['conditional_discount_pct'] or 'none'}; cells {counts}; needing review {review}\n"
                    f"  risk {risks[v['vendor_id']]['overall'].upper()}: " + " | ".join(
                        f"{d['name']} = {d['level']} ({' '.join(d['reasons'])})" for d in risks[v["vendor_id"]]["dimensions"]))
    return f"Data as of now (USD rate {db.get_fx(conn):g}):\n" + "\n".join(rows)


def ask(question: str, previous_response_id: str | None = None) -> dict:
    artifacts, steps = [], []
    request = dict(model=settings.openai_model, instructions=INSTRUCTIONS + "\n\n" + _briefing(), tools=TOOLS,
                   reasoning={"effort": "low"})
    response = client.responses.create(**request, input=question, previous_response_id=previous_response_id)
    for _ in range(MAX_STEPS):
        calls = [item for item in response.output if item.type == "function_call"]
        if not calls:
            break
        outputs = []
        for call in calls:
            args = json.loads(call.arguments)
            result = _run_tool(call.name, args, artifacts)
            steps.append({"tool": call.name, "input": args, "error": result.get("error")})
            outputs.append({"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(result, default=str)})
        response = client.responses.create(**request, input=outputs, previous_response_id=response.id)
    return {"answer": response.output_text, "artifacts": artifacts, "steps": steps, "response_id": response.id}


# --- Saved conversations: one RFx can have many, like chats in any assistant ---

def list_chats() -> list[dict]:
    return [dict(r) for r in db.connect().execute(
        "SELECT chat_id, title, updated_at FROM analyst_chats ORDER BY updated_at DESC")]


def get_chat(chat_id: str) -> dict | None:
    row = db.connect().execute("SELECT * FROM analyst_chats WHERE chat_id = ?", (chat_id,)).fetchone()
    return {**dict(row), "messages": json.loads(row["messages"])} if row else None


def ask_in_chat(question: str, chat_id: str | None) -> dict:
    """Answers within a saved conversation, creating it on the first question."""
    from datetime import datetime
    chat = get_chat(chat_id) if chat_id else None
    if chat is None:
        chat = {"chat_id": datetime.now().strftime("c%m%d%H%M%S%f"), "title": question[:70], "messages": [], "response_id": None}
    result = ask(question, chat["response_id"])
    chat["messages"] += [{"role": "user", "text": question},
                         {"role": "analyst", "answer": result["answer"], "artifacts": result["artifacts"], "steps": result["steps"]}]
    conn = db.connect()
    conn.execute("INSERT OR REPLACE INTO analyst_chats VALUES (?,?,?,?,?)",
                 (chat["chat_id"], chat["title"], json.dumps(chat["messages"]), result["response_id"],
                  datetime.now().isoformat(timespec="seconds")))
    conn.commit()
    return {"chat_id": chat["chat_id"], "title": chat["title"], "messages": chat["messages"]}
