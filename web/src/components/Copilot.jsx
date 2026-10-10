import { Download, Mic, Paperclip, RotateCcw, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { itemSpec } from "../format.js";
import { Pill } from "./bits.jsx";

const STARTERS = [
  "I need an annual rate contract for corrugated boxes for our Bhiwandi warehouse from 1 November. About 30 SKUs across 3-ply, 5-ply and 7-ply, roughly ₹4 crore a year. Five vendors.",
  "I need 120 laptops and 40 monitors for the new Pune office by December. Three vendors, delivered and installed.",
];

// The buyer talks on the left; the structured RFx builds on the right.
const Recognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function Copilot({ rfx, onSent, onChange }) {
  const [draft, setDraft] = useState(null);
  const [listening, setListening] = useState(false);

  // The brief says the buyer "talks" an RFx into existence, so where the browser allows it they can speak.
  function dictate() {
    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.onresult = (e) => setText((t) => (t ? t + " " : "") + e.results[0][0].transcript);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    api.draft().then(setDraft);
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [draft?.messages.length, busy]);

  // Sends typed text, uploaded files, or both. Files are read on the server and handed to the co-pilot.
  async function send(message, files = []) {
    if ((!message.trim() && !files.length) || busy) return;
    setText("");
    setBusy(true);
    const shown = [message.trim(), files.length ? `[Uploaded: ${files.map((f) => f.name).join(", ")}]` : ""].filter(Boolean).join("\n");
    setDraft((d) => ({ ...d, messages: [...d.messages, { role: "user", text: shown }] }));
    try {
      setDraft(files.length ? await api.draftUpload(files, message) : await api.draftChat(message));
      onChange?.();
    } catch (e) {
      alert(e.message);
      setDraft(await api.draft());
    }
    setBusy(false);
  }

  if (!draft) return <div className="p-10 text-slate-500">Loading…</div>;
  // Once sent, this tab shows the RFx as it went out. The demo RFx was loaded already sent.
  const sent = Boolean(rfx);
  const view = sent ? { ...draft, ...rfx, vendors: rfx.vendors || draft.vendors, open_points: [], terms: { ...draft.terms, ...rfx.terms } } : draft;
  const empty = !view.title && view.line_items.length === 0;

  return (
    <div className="flex h-full">
      {(!sent || draft.messages.length > 0) && (
      <section className="flex w-[440px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {draft.messages.length === 0 && (
            <div>
              <h2 className="text-base font-semibold text-slate-900">Describe what you need to buy</h2>
              <p className="mt-1 text-sm text-slate-600">Type it, speak it, or upload a requirement document (Word, PDF, Excel or a photo). The RFx builds on the right as you go.</p>
              <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-4 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
                <Paperclip size={16} /> Upload a requirement document
                <input type="file" multiple hidden accept=".docx,.pdf,.xlsx,.xlsm,.txt,.csv,.jpg,.jpeg,.png,.webp" onChange={(e) => { send("", [...e.target.files]); e.target.value = ""; }} />
              </label>
              <div className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-400">Or start with</div>
              <div className="mt-2 space-y-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-slate-200 p-3 text-left text-sm text-slate-700 hover:border-indigo-300 hover:bg-indigo-50">{s}</button>
                ))}
              </div>
            </div>
          )}
          {draft.messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.role === "user" ? "rounded-br-sm bg-indigo-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"}`}>{m.text}</div>
            </div>
          ))}
          {busy && <div className="animate-pulse text-sm text-slate-500">Reading and updating the draft…</div>}
          <div ref={bottom} />
        </div>
        {sent ? <div className="border-t border-slate-200 p-3 text-xs text-slate-500">This RFx has been sent, so the conversation is closed.</div> : (
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 border-t border-slate-200 p-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Tell the co-pilot what to add or change…"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
                    className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <div className="flex flex-col justify-end gap-1.5">
            <label title="Upload a requirement document" className="cursor-pointer rounded-lg border border-slate-300 p-2.5 text-slate-600 hover:bg-slate-50">
              <Paperclip size={16} />
              <input type="file" multiple hidden accept=".docx,.pdf,.xlsx,.xlsm,.txt,.csv,.jpg,.jpeg,.png,.webp" onChange={(e) => { send(text, [...e.target.files]); e.target.value = ""; }} />
            </label>
            {Recognition && (
              <button type="button" onClick={dictate} title="Speak instead of typing"
                      className={`rounded-lg border p-2.5 ${listening ? "animate-pulse border-rose-300 bg-rose-50 text-rose-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}><Mic size={16} /></button>
            )}
            <button disabled={busy || !text.trim()} className="rounded-lg bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-40"><Send size={16} /></button>
          </div>
        </form>
        )}
      </section>
      )}

      <section className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{sent ? <>RFx as sent {rfx.issued_on && <Pill tone="emerald">Sent {rfx.issued_on}</Pill>}</> : "RFx draft"}</div>
              <h2 className="text-lg font-semibold text-slate-900">{view.title || "Untitled RFx"}</h2>
            </div>
            <div className="flex shrink-0 gap-2">
              {!sent && (
                <>
                  <button onClick={async () => setDraft(await api.draftReset())} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><RotateCcw size={14} /> Start over</button>
                  <button disabled={empty} onClick={() => api.exportDraft()} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Download size={14} /> Excel</button>
                  <button disabled={view.line_items.length === 0} onClick={() => setPreview(true)} className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"><Send size={14} /> Review and send</button>
                </>
              )}
            </div>
          </div>

          {empty ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Nothing here yet. Start the conversation on the left.</div>
          ) : (
            <>
              {view.open_points.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">Still open before this can go out ({view.open_points.length})</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{view.open_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Scope and terms</div>
                <p className="mt-1 text-sm text-slate-700">{view.scope || "No scope yet."}</p>
                <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
                  {[["Price basis", view.terms.price_basis], ["Delivery", view.terms.delivery_location], ["Currency", view.terms.currency], ["Payment", view.terms.payment],
                    ["Offer validity", view.terms.validity_days && `${view.terms.validity_days} days`], ["Reply by", view.due_on], ["Vendors invited", (view.vendors || []).join(", ") || (sent ? "5 vendors" : "")]].map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className={v ? "text-slate-800" : "text-amber-700"}>{v || "Not set"}</dd></div>
                  ))}
                </dl>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Line items ({view.line_items.length})</div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500">{["#", "Description", "Specification", "Unit", "Unit weight", "Qty / year"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {view.line_items.map((l) => (
                      <tr key={l.line_no} className="border-t border-slate-100">
                        <td className="num px-4 py-1.5 text-slate-400">{l.line_no}</td>
                        <td className="px-4 py-1.5">{l.description}</td>
                        <td className="px-4 py-1.5 text-slate-600">{itemSpec(l) || <Missing />}</td>
                        <td className="px-4 py-1.5">{l.uom || "piece"}</td>
                        <td className="num px-4 py-1.5">{l.unit_weight_kg ?? l.box_weight_kg ? `${l.unit_weight_kg ?? l.box_weight_kg} kg` : <span className="text-slate-400">n/a</span>}</td>
                        <td className="num px-4 py-1.5">{l.annual_qty ? l.annual_qty.toLocaleString("en-IN") : <Missing />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Questionnaire ({view.questionnaire.length})</div>
                <ol className="mt-2 space-y-2 text-sm text-slate-700">
                  {view.questionnaire.map((q) => (
                    <li key={q.id} className="flex gap-2">
                      <span className="w-7 shrink-0 text-slate-400">{q.id}</span>
                      <span>{q.question} {q.mandatory && <Pill tone="rose">Mandatory</Pill>} {q.requires_document && <Pill>Attach: {q.requires_document.replaceAll("_", " ")}</Pill>}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </section>

      {preview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30" onClick={() => setPreview(false)}>
          <div className="w-[640px] rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Review the email before it goes out</h3>
            <div className="mt-3 rounded-lg border border-slate-200 text-sm">
              <div className="border-b border-slate-200 px-3 py-2 text-slate-600"><b>To:</b> {draft.email.to.join(", ") || <span className="text-amber-700">No vendors named yet</span>}</div>
              <div className="border-b border-slate-200 px-3 py-2 text-slate-600"><b>Subject:</b> {draft.email.subject}</div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-slate-700">{draft.email.body}</pre>
              <div className="border-t border-slate-200 px-3 py-2 text-slate-600"><b>Attached:</b> {draft.email.attachment}</div>
            </div>
            {draft.open_points.length > 0 && <div className="mt-3 text-sm text-amber-700">{draft.open_points.length} points are still open. You can send anyway.</div>}
            <p className="mt-3 text-xs text-slate-500">
              Sending is stubbed in this prototype: no email leaves the system. The RFx becomes live, and vendor replies are added under "Vendor replies" as files or pasted text.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPreview(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Back</button>
              <button onClick={async () => { try { await api.draftSend(); setPreview(false); onSent(); } catch (e) { alert(e.message); } }} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Send to vendors</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Missing() {
  return <span className="text-amber-700">missing</span>;
}
