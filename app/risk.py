"""Vendor risk, built by rule from what each vendor actually sent. No model call and no outside data.

Five dimensions, each low, medium, high or unknown, each with its reasons. "Unknown" is its own level:
a vendor who told us nothing is not a low risk. Financial figures are the vendor's own claims, unverified.
"""
import re

LEVELS = ["low", "unknown", "medium", "high"]  # ordered by how much attention the buyer should pay
TO_CRORE = {"crore": 1, "lakh": 0.01, "million": 0.1, "billion": 100, "units": 1e-7}
INVESTMENT_GRADE = {"AAA", "AA", "A", "BBB"}


def _worst(levels: list[str]) -> str:
    return max(levels, key=LEVELS.index) if levels else "unknown"


def _dimension(name: str, findings: list[tuple[str, str]], nothing: str) -> dict:
    """findings are (level, reason). With no findings the dimension is unknown, with the reason why."""
    if not findings:
        return {"name": name, "level": "unknown", "reasons": [nothing]}
    known = [level for level, _ in findings if level != "unknown"]
    return {"name": name, "level": _worst(known) if known else "unknown", "reasons": [reason for _, reason in findings]}


def _first_number(text: str | None) -> float | None:
    match = re.search(r"\d[\d,]*\.?\d*", text or "")
    return float(match.group().replace(",", "")) if match else None


def assess(rfx: dict, vendor: dict, financials: dict | None, lines: list[dict], fx_usd_inr: float, as_of_year: int) -> dict:
    cells = list(vendor["cells"].values())
    summary = vendor["summary"]

    # 1. Compliance: the quality gate, restated as a risk.
    compliance = _dimension("Quality and compliance", [(
        {"cleared": "low", "unverified": "medium", "failed": "high"}[vendor["quality_gate"]], vendor["quality_gate_reason"])], "")

    # 2. Financial standing: how much of the vendor's business this contract would be, rating, and age.
    found = []
    f = financials or {}
    turnover_cr = None
    if f.get("turnover_value") and f.get("turnover_unit"):
        rate = {"INR": 1, "USD": fx_usd_inr}.get((f.get("turnover_currency") or "INR").upper())
        if rate:
            turnover_cr = f["turnover_value"] * TO_CRORE[f["turnover_unit"]] * rate
    if turnover_cr:
        share = summary["total_inr"] / 1e7 / turnover_cr * 100
        level = "high" if share > 30 else "medium" if share > 10 else "low"
        found.append((level, f"Declared turnover Rs. {turnover_cr:,.0f} crore. Everything it quoted here would be {share:.0f}% of that"
                             + (": the vendor would depend heavily on this contract." if level == "high" else ".")))
    grade = re.search(r"\b(AAA|AA|A|BBB|BB|B|C|D)[+-]?(?![A-Za-z])", (f.get("credit_rating") or "").upper().replace("CRISIL", "").replace("ICRA", "").replace("CARE", ""))
    if grade:
        ok = grade.group(1) in INVESTMENT_GRADE
        found.append(("low" if ok else "high", f"Credit rating {f['credit_rating']} ({'investment grade' if ok else 'below investment grade'})."))
    elif f.get("states_unrated") or turnover_cr:
        found.append(("unknown", "No credit rating."))
    if f.get("established_year"):
        age = as_of_year - f["established_year"]
        found.append(("medium" if age < 5 else "low", f"Operating since {f['established_year']} ({age} years)."))
    financial = _dimension("Financial standing", found, "The vendor gave no turnover, rating or history.")
    financial["note"] = "Vendor-declared, not verified."

    # 3. Supply: lead time, share of the vendor's capacity, and import exposure.
    found = []
    lead = vendor.get("lead_time_days")
    if lead:
        found.append(("high" if lead > 30 else "medium" if lead > 14 else "low", f"Lead time {lead} days."))
    need_tonnes = sum((l["annual_qty"] or 0) * (l["box_weight_kg"] or 0) for l in lines) / 12 / 1000
    capacity = next((a for a in vendor["answers"].values()
                     if "capacity" in a["question"].lower() and re.search(r"ton|mt\b", (a["question"] + a["answer_text"]).lower())), None)
    capacity_t = _first_number(capacity["answer_text"]) if capacity and capacity["answer"] != "unanswered" else None
    if capacity_t and need_tonnes:
        share = need_tonnes / capacity_t * 100
        found.append(("high" if share > 50 else "medium" if share > 25 else "low",
                      f"The full requirement (about {need_tonnes:.0f} t a month) is {share:.0f}% of its stated capacity of {capacity_t:,.0f} t."))
    if any(c["quoted_currency"] == "USD" for c in cells):
        found.append(("medium", "Quoted in USD: the rupee price moves with the exchange rate."))
    supply = _dimension("Supply and delivery", found, "No lead time or capacity stated.")

    # 4. Commercial terms against what the RFx asked for.
    found = []
    asked_days = _first_number(rfx["terms"].get("payment"))
    terms = (vendor.get("payment_terms") or "").lower()
    if not terms:
        found.append(("unknown", "Payment terms not stated."))
    elif "letter of credit" in terms or "advance" in terms or re.search(r"\blc\b", terms):
        found.append(("high", f"Wants payment secured or up front (\"{vendor['payment_terms'].rstrip('.')}\"); the RFx asked for {rfx['terms'].get('payment')}."))
    elif asked_days and (_first_number(terms) or asked_days) < asked_days:
        found.append(("medium", f"Offers {_first_number(terms):.0f} days credit against {asked_days:.0f} requested."))
    else:
        found.append(("low", "Accepts the requested payment terms."))
    if vendor["freight"] != "included":
        found.append(("medium", f"Price is not delivered: freight {vendor['freight'].replace('_', ' ')}."))
    validity = vendor.get("validity_days")
    if validity and validity < 30:
        found.append(("medium", f"Offer valid for only {validity} days."))
    commercial = _dimension("Commercial terms", found, "")

    # 5. How firm the quote itself is.
    found = []
    priced = summary["lines_priced"]
    assumed, review = summary["assumed"], summary["needs_review"]
    missing = len(lines) - priced
    soft = assumed + review
    if soft:
        found.append(("high" if soft > 0.3 * len(lines) else "medium",
                      ", ".join(x for x in [f"{assumed} prices assumed from last year" if assumed else "", f"{review} prices need review" if review else ""] if x) + "."))
    else:
        found.append(("low", "Every price it gave is firm."))
    if missing:
        found.append(("low", f"{missing} of {len(lines)} lines not quoted: those need another source."))
    firmness = _dimension("Quote firmness", found, "")

    dimensions = [compliance, financial, supply, commercial, firmness]
    levels = [d["level"] for d in dimensions]
    overall = "high" if "high" in levels else "medium" if "medium" in levels or "unknown" in levels else "low"
    return {"overall": overall, "incomplete": "unknown" in levels, "dimensions": dimensions}
