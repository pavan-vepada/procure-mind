# Kill the Quote Spreadsheet

Prototype for Aerchain's product take-home: draft an RFx, read whatever vendors send back, compare them
side by side, and ask questions of the result in plain language. The brief is in `docs/`.

## Layout

| Path | What it is |
|---|---|
| `app/config.py` | Reads every setting from `.env`. |
| `app/extraction/readers.py` | Step 1: open each file and choose a reading mode (direct, OCR, vision, OCR plus vision). |
| `app/extraction/schema.py` | Step 2: the shape the model must return. |
| `app/extraction/llm.py` | Step 2: the model call and its instructions. |
| `app/normalize.py` | Step 3: plain code that converts to rupees per piece, flags doubts and decides the quality gate. |
| `app/pipeline.py` | Runs steps 1 to 3 for one vendor and saves the result. |
| `app/db.py` | SQLite tables. One database file per RFx, in `data/events/`. |
| `app/clarify.py` | Drafts a clarification email to a vendor from the flagged cells and open points. |
| `app/comparison.py` | Builds the side-by-side comparison and totals from the database. |
| `app/analyst.py` | The analyst agent: its instructions, its four tools and the award-scenario calculation. |
| `app/copilot.py` | The RFx co-pilot: builds a structured draft through conversation, and the outgoing email. |
| `app/api.py` | HTTP endpoints: RFx events, comparison, source documents, buyer corrections, FX rate, analyst, Excel exports, co-pilot, reply upload, clarification email. |
| `app/main.py` | The web server: password gate, API, and the built React app. |
| `web/src/` | React app. `App.jsx` holds the two levels (dashboard, and one RFx with its four steps). One file per screen in `components/`: `Login.jsx`, `Dashboard.jsx` (all RFx events), `Copilot.jsx` (draft RFx), `Inbox.jsx` (vendor replies and upload), `Comparison.jsx` (the grid), `CellDrawer.jsx` (the evidence panel), `Analyst.jsx` (questions). |
| `scripts/ask.py` | Ask the analyst a question from the terminal. |
| `scripts/run_extraction.py` | Runs extraction on the five seed vendors and scores it against the true answers. |
| `scripts/generate_dataset.py` | Fabricates the RFx, the five vendor replies and the true answers. |
| `data/seed/rfx.json` | The RFx: 30 line items, questionnaire, terms, last year's prices. |
| `data/seed/responses/` | One folder per vendor: `email.json` plus the attachments they sent. |
| `data/seed/ground_truth.json` | True values, used only to score extraction. |
| `data/seed/demo.db` | The demo RFx after extraction. The app starts from this, and "reset" restores it. |
| `DECISIONS.md` | What I decided and why. |

## The five vendor replies

| Vendor | Shape | Planted problem |
|---|---|---|
| Shree Balaji Packaging | Excel, own layout | Own item codes and order, priced per 100 pieces |
| Kraftline Industries | PDF on letterhead | 27 of 30 lines, 4% rebate in a footnote |
| PacificCorr Global | Word document | Commercials in a paragraph, USD per kg, port delivery only |
| Maruti Corrugators | Phone photo of a rate card | Angled, one smudged rate, freight extra, ISO certificate expired |
| Om Sai Cartons | One-line email | Two rates per kg, "rest same as last year", freight extra, no certificate |

## Setup

```bash
cp .env.example .env      # then add your OpenAI key
uv sync
sudo apt-get install -y tesseract-ocr        # OCR engine
uv run python scripts/generate_dataset.py   # only needed to regenerate data/seed
PYTHONPATH=. uv run python scripts/run_extraction.py   # read all five replies and print accuracy
```

## Run

```bash
cd web && npm install && npm run build && cd ..   # build the React app once
uv run uvicorn app.main:app --port 8000           # then open http://localhost:8000
```

The password is `APP_PASSWORD` from `.env`. While changing the UI, run `npm run dev` in `web/` and open
http://localhost:5173 instead; it reloads on save and forwards API calls to port 8000.
