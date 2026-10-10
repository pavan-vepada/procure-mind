import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { inr, isImage, itemName, STATUS } from "../format.js";
import { ModePill, Pill } from "./bits.jsx";

const round2 = (n) => (n == null ? "" : Math.round(n * 100) / 100);
const STATUS_TONE = { quoted: "emerald", derived: "indigo", assumed: "amber", missing: "slate", unclear: "rose" };

// Shows the document text with the vendor's own words highlighted, so the buyer can see the evidence.
function SourceText({ text, quote, value }) {
  const mark = useRef(null);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: "center" });
  }, [text, quote]);
  let needle = quote && text.includes(quote) ? quote : null;
  if (!needle && value != null && text.includes(String(value))) needle = String(value);
  if (!needle) return <pre className="whitespace-pre-wrap text-xs text-slate-600">{text}</pre>;
  const at = text.indexOf(needle);
  return (
    <pre className="whitespace-pre-wrap text-xs text-slate-600">
      {text.slice(0, at)}
      <mark ref={mark} className="rounded bg-yellow-200 px-0.5 text-slate-900">{needle}</mark>
      {text.slice(at + needle.length)}
    </pre>
  );
}

export default function CellDrawer({ vendor, line, cell, onClose, reload }) {
  const [doc, setDoc] = useState(null);
  const [price, setPrice] = useState(round2(cell.price_inr));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDoc(null);
    setPrice(round2(cell.price_inr));
    if (cell.source_document) api.document(vendor.vendor_id, cell.source_document).then(setDoc).catch(() => {});
  }, [vendor.vendor_id, cell.line_no, cell.source_document, cell.price_inr]);

  async function save(value) {
    setSaving(true);
    try {
      await api.correct(vendor.vendor_id, line.line_no, value, note);
      await reload();
      onClose();
    } catch (e) {
      alert(e.message);
    }
    setSaving(false);
  }

  const status = STATUS[cell.status];
  const changed = price !== "" && Number(price) !== round2(cell.price_inr);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <aside className="flex h-full w-[520px] flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs text-slate-500">{vendor.name}</div>
            <div className="text-sm font-semibold text-slate-900">Line {line.line_no}: {itemName(line)}</div>
            <div className="text-xs text-slate-500">{line.length_mm && `${line.length_mm} × ${line.width_mm} × ${line.height_mm} mm · `}{line.annual_qty?.toLocaleString("en-IN") ?? "quantity not given;"} pieces a year</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="num text-2xl font-semibold text-slate-900">{cell.price_inr != null ? inr(cell.price_inr) : "No price"}</div>
              <div className="text-xs text-slate-500">per piece{line.last_year_price_inr != null && ` · last year ${inr(line.last_year_price_inr)}`}</div>
            </div>
            <div className="text-right">
              <Pill tone={STATUS_TONE[cell.status]}>{status.label}</Pill>
              <div className="mt-1 max-w-56 text-[11px] text-slate-500">{status.help}</div>
            </div>
          </div>

          {cell.review_reasons.length > 0 && (
            <div className={`rounded-lg border p-3 text-sm ${cell.needs_review ? "border-orange-200 bg-orange-50 text-orange-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} /> {cell.needs_review ? "Check this before relying on it" : "Flag cleared by buyer"}
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{cell.review_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">How this number was reached</div>
            <div className="num mt-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{cell.formula}</div>
          </div>

          {cell.source_quote && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">What the vendor wrote</div>
              <blockquote className="mt-1 border-l-2 border-indigo-300 pl-3 text-sm italic text-slate-700">“{cell.source_quote}”</blockquote>
              <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1 text-xs text-slate-600">
                <dt className="text-slate-400">Matched by</dt><dd>{cell.match_basis}</dd>
                <dt className="text-slate-400">Model confidence</dt><dd className="capitalize">{cell.confidence}</dd>
              </dl>
            </div>
          )}

          {cell.source_document && (
            <div>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Source: {cell.source_document}</div>
                {cell.source_document !== "Email body" && (
                  <a href={api.fileUrl(vendor.vendor_id, cell.source_document)} target="_blank" rel="noreferrer"
                     className="flex items-center gap-1 text-xs text-indigo-700 hover:underline">Open original <ExternalLink size={12} /></a>
                )}
              </div>
              {doc && (
                <div className="mt-1 flex items-start gap-2 text-xs text-slate-500">
                  <ModePill mode={doc.read_mode} /> <span>{doc.read_mode_reason}</span>
                </div>
              )}
              <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                {isImage(cell.source_document) ? (
                  <img src={api.fileUrl(vendor.vendor_id, cell.source_document)} alt="Source document" className="w-full" />
                ) : doc ? (
                  <SourceText text={doc.text || ""} quote={cell.source_quote} value={cell.quoted_value} />
                ) : <div className="p-3 text-xs text-slate-400">Loading…</div>}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your decision (logged)</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-slate-500">₹</span>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
                   className="num w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="per piece" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
                   className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={saving || price === ""} onClick={() => save(Number(price))}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
              {changed ? "Save corrected price" : "Confirm price is right"}
            </button>
            {cell.price_inr != null && (
              <button disabled={saving} onClick={() => save(null)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                Treat as not quoted
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
