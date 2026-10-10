"""Ask the analyst from the terminal.  Run:  PYTHONPATH=. uv run python scripts/ask.py "your question" """
import json
import sys
import time

from app.analyst import ask

start = time.time()
result = ask(sys.argv[1])
for step in result["steps"]:
    print("TOOL", step["tool"], json.dumps(step["input"])[:400], "ERROR " + step["error"] if step["error"] else "")
print("\n" + result["answer"])
for a in result["artifacts"]:
    print(f"\n[{a['type']}] {a['title']} ({len(a['rows'])} rows) {a['columns']}")
    for row in a["rows"][:6]:
        print("   ", row)
print(f"\n{time.time() - start:.0f}s")
