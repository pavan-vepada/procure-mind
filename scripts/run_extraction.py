"""Runs real extraction on the seed vendor replies and scores it against the true answers.

Run:  uv run python scripts/run_extraction.py            (all five vendors)
      uv run python scripts/run_extraction.py maruti     (one vendor)
      uv run python scripts/run_extraction.py --score    (score what is already in the database)
"""
import json
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app import db
from app.pipeline import process_vendor

SEED = Path("data/seed")
STATUS_FOR = {"quoted": ("quoted", "derived"), "assumed_same_as_last_year": ("assumed",), "not_quoted": ("missing",)}


def score(conn) -> dict:
    truth = json.loads((SEED / "ground_truth.json").read_text())["vendors"]
    report = {}
    print(f"\n{'vendor':14s} {'correct':>8s} {'flagged':>8s} {'wrong':>6s} {'wrong and not flagged':>22s}   gate")
    for vendor_id, expected in truth.items():
        rows = {r["line_no"]: r for r in conn.execute("SELECT * FROM quotes WHERE vendor_id = ?", (vendor_id,))}
        vendor = conn.execute("SELECT * FROM vendors WHERE vendor_id = ?", (vendor_id,)).fetchone()
        if not rows:
            continue
        correct, flagged, wrong, silent = 0, 0, [], []
        for line_no, want in expected["lines"].items():
            got = rows[int(line_no)]
            ok = got["status"] in STATUS_FOR[want["status"]]
            if ok and want["inr_per_piece"] is not None:
                ok = got["price_inr"] is not None and abs(got["price_inr"] / want["inr_per_piece"] - 1) < 0.002
            correct += ok
            flagged += got["needs_review"]
            if not ok:
                wrong.append(int(line_no))
                if not got["needs_review"]:
                    silent.append(int(line_no))
        gate_ok = (vendor["quality_gate"] == "cleared") == expected["clears_quality_gate"]
        report[vendor_id] = {"lines": len(expected["lines"]), "correct": correct, "flagged": flagged,
                             "wrong": wrong, "wrong_not_flagged": silent, "gate_correct": gate_ok,
                             "model": vendor["model"]}
        print(f"{vendor_id:14s} {correct:>5d}/30 {flagged:>8d} {len(wrong):>6d} {str(silent):>22s}   "
              f"{vendor['quality_gate']} ({'ok' if gate_ok else 'WRONG'})")
    Path("data/accuracy.json").write_text(json.dumps(report, indent=2))
    return report


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    conn = db.connect()
    db.load_rfx(conn, json.loads((SEED / "rfx.json").read_text()))
    conn.commit()
    if "--score" not in sys.argv:
        vendors = args or sorted(p.name for p in (SEED / "responses").iterdir())

        def run(vendor_id):
            own = db.connect()  # one connection per thread
            process_vendor(own, vendor_id, SEED / "responses" / vendor_id)
            print(f"extracted {vendor_id}")

        with ThreadPoolExecutor(max_workers=5) as pool:
            list(pool.map(run, vendors))
    score(conn)
    if "--score" not in sys.argv and not args:
        conn.close()
        shutil.copy(db.path(), db.DEMO_SNAPSHOT)  # this becomes the state the hosted demo starts from
        print(f"saved snapshot to {db.DEMO_SNAPSHOT}")


if __name__ == "__main__":
    main()
