"""Builds the side-by-side comparison from the database. The screen and the analyst both read from here."""
import json

from app import db


def build(conn) -> dict:
    lines = [dict(r) for r in conn.execute("SELECT * FROM line_items ORDER BY line_no")]
    qty = {l["line_no"]: l["annual_qty"] or 0 for l in lines}
    vendors = []
    for v in conn.execute("SELECT * FROM vendors ORDER BY received_at"):
        vendor = {k: v[k] for k in v.keys() if k not in ("extraction", "email", "folder")}
        vendor["open_issues"] = json.loads(v["open_issues"] or "[]")
        vendor["email"] = json.loads(v["email"] or "{}")
        vendor["documents"] = [dict(r) for r in conn.execute(
            "SELECT filename, doc_type, read_mode, read_mode_reason, ocr_confidence, summary, valid_until "
            "FROM documents WHERE vendor_id = ? ORDER BY doc_id", (v["vendor_id"],))]
        vendor["answers"] = {r["question_id"]: dict(r) for r in conn.execute(
            "SELECT * FROM questionnaire WHERE vendor_id = ?", (v["vendor_id"],))}
        cells = {}
        for r in conn.execute("SELECT * FROM quotes WHERE vendor_id = ?", (v["vendor_id"],)):
            cell = dict(r)
            cell["review_reasons"] = json.loads(cell["review_reasons"] or "[]")
            cells[r["line_no"]] = cell
        vendor["cells"] = cells
        priced = [c for c in cells.values() if c["price_inr"] is not None]
        vendor["summary"] = {
            "lines_priced": len(priced),
            "total_inr": sum(c["price_inr"] * qty[c["line_no"]] for c in priced),
            "needs_review": sum(c["needs_review"] for c in cells.values()),
            "assumed": sum(c["status"] == "assumed" for c in cells.values()),
        }
        vendors.append(vendor)

    # Like-for-like basket: only the lines every vendor priced, so totals can be compared fairly.
    common = [l["line_no"] for l in lines
              if vendors and all(v["cells"].get(l["line_no"], {}).get("price_inr") is not None for v in vendors)]
    for v in vendors:
        v["summary"]["common_basket_inr"] = sum(v["cells"][n]["price_inr"] * qty[n] for n in common)
    return {"rfx": db.get_rfx(conn), "fx_usd_inr": db.get_fx(conn), "lines": lines, "vendors": vendors,
            "common_lines": common,
            "last_year_total_inr": sum((l["last_year_price_inr"] or 0) * (l["annual_qty"] or 0) for l in lines)}
