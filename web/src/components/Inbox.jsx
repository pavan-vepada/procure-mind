import { Copy, MailQuestion, Paperclip, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api.js";
import { day } from "../format.js";
import { GateBadge, ModePill } from "./bits.jsx";

// The stubbed mail channel: what each vendor sent, and how the system chose to read each file.
// Lets anyone add a vendor reply of their own. It goes through the same extraction as the seeded ones.
function AddReply({ onClose, onDone }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.upload(name, text, files);
      await onDone(result.vendor_id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30" onClick={busy ? undefined : onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-[520px] rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Add a vendor reply</h3>
        <p className="mt-1 text-sm text-slate-600">
          Any shape: Excel, PDF, Word, a photo, or just pasted email text. It is read live by the same pipeline and added to the comparison.
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name (optional, read from the documents if blank)"
               className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Email text (optional)"
                  className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input type="file" multiple onChange={(e) => setFiles([...e.target.files])}
               accept=".xlsx,.xlsm,.pdf,.docx,.txt,.csv,.jpg,.jpeg,.png,.webp" className="mt-3 block w-full text-sm text-slate-600" />
        {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={busy || (!files.length && !text.trim())} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? "Reading the reply… about 30 seconds" : "Read this reply"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Inbox({ data, reload }) {
  const [selected, setSelected] = useState(data.vendors[0]?.vendor_id);
  const [adding, setAdding] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [clarify, setClarify] = useState({}); // vendor_id -> { busy } or { subject, body }

  async function draftClarification(vendorId) {
    setClarify((c) => ({ ...c, [vendorId]: { busy: true } }));
    try {
      const email = await api.clarification(vendorId);
      setClarify((c) => ({ ...c, [vendorId]: email }));
    } catch (e) {
      alert(e.message);
      setClarify((c) => ({ ...c, [vendorId]: undefined }));
    }
  }

  async function reread(vendorId) {
    setRereading(true);
    try {
      await api.reread(vendorId);
      await reload();
    } catch (e) {
      alert(e.message);
    }
    setRereading(false);
  }

  async function remove(vendorId) {
    await api.removeVendor(vendorId);
    await reload();
    setSelected(data.vendors[0]?.vendor_id);
  }

  const vendor = data.vendors.find((v) => v.vendor_id === selected);
  const accuracy = data.accuracy && Object.values(data.accuracy);

  return (
    <div className="flex h-full">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-xs text-slate-500">
          RFx sent {day(data.rfx.issued_on)}{data.rfx.due_on && ` · replies due ${day(data.rfx.due_on)}`}
          <button onClick={() => setAdding(true)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-indigo-300 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
            <Plus size={14} /> Add a vendor reply
          </button>
        </div>
        {data.vendors.map((v) => (
          <button
            key={v.vendor_id}
            onClick={() => setSelected(v.vendor_id)}
            className={`block w-full border-b border-slate-100 px-4 py-3 text-left ${
              v.vendor_id === selected ? "bg-indigo-50" : "hover:bg-slate-50"
            }`}
          >
            <div className="flex justify-between text-sm font-medium text-slate-900">
              <span className="truncate">{v.email.from_name || v.name}</span>
              <span className="shrink-0 text-xs font-normal text-slate-500">{day(v.received_at)}</span>
            </div>
            <div className="truncate text-xs text-slate-600">{v.email.subject || "Uploaded reply"}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Paperclip size={12} /> {(v.email.attachments || []).length} · {v.name}
            </div>
          </button>
        ))}
        {accuracy && (
          <div className="m-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Extraction check</div>
            <p className="mt-1">
              Because this dataset is fabricated, the true prices are known. Scored against them, the system read{" "}
              <b>{accuracy.reduce((n, a) => n + a.correct, 0)} of {accuracy.reduce((n, a) => n + a.lines, 0)}</b> cells
              correctly, with <b>{accuracy.reduce((n, a) => n + a.wrong_not_flagged.length, 0)}</b> wrong and not flagged.
            </p>
          </div>
        )}
      </aside>

      {vendor && (
        <section className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{vendor.email.subject || vendor.name}</h2>
                  <div className="text-xs text-slate-500">
                    {vendor.email.from_name} &lt;{vendor.email.from_email}&gt; · {new Date(vendor.received_at).toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <GateBadge gate={vendor.quality_gate} />
                  <div className="flex gap-2">
                    <button onClick={() => reread(vendor.vendor_id)} disabled={rereading} title="Runs the extraction again on the original files. A fresh model call, nothing cached."
                            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <RefreshCw size={12} className={rereading ? "animate-spin" : ""} /> {rereading ? "Reading…" : "Read again"}
                    </button>
                    {vendor.vendor_id.startsWith("upload_") && (
                      <button onClick={() => remove(vendor.vendor_id)} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">
                        <Trash2 size={12} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <pre className="mt-4 whitespace-pre-wrap font-sans text-sm text-slate-700">{vendor.email.body}</pre>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">How each document was read</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {vendor.documents.map((d) => (
                  <div key={d.filename} className="py-3">
                    <div className="flex items-center gap-2 text-sm">
                      {d.filename === "Email body" ? (
                        <span className="font-medium text-slate-800">{d.filename}</span>
                      ) : (
                        <a href={api.fileUrl(vendor.vendor_id, d.filename)} target="_blank" rel="noreferrer"
                           className="font-medium text-indigo-700 hover:underline">{d.filename}</a>
                      )}
                      <ModePill mode={d.read_mode} />
                      {d.ocr_confidence != null && <span className="text-xs text-slate-500">OCR confidence {d.ocr_confidence}%</span>}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{d.read_mode_reason}</div>
                    {d.summary && <div className="mt-1 text-sm text-slate-700">{d.summary}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">To clarify with this vendor</h3>
              <div className="mt-1 text-xs text-slate-500">{vendor.quality_gate_reason}</div>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {vendor.open_issues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
              <button onClick={() => draftClarification(vendor.vendor_id)} disabled={clarify[vendor.vendor_id]?.busy}
                      className="mt-4 flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                <MailQuestion size={15} /> {clarify[vendor.vendor_id]?.busy ? "Drafting…" : "Draft a clarification email"}
              </button>
              {clarify[vendor.vendor_id]?.body && (
                <div className="mt-4 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm">
                    <span><b>Subject:</b> {clarify[vendor.vendor_id].subject}</span>
                    <button onClick={() => navigator.clipboard.writeText(clarify[vendor.vendor_id].body)} className="flex items-center gap-1 text-xs text-indigo-700 hover:underline"><Copy size={12} /> Copy</button>
                  </div>
                  <pre className="whitespace-pre-wrap px-3 py-2 font-sans text-sm text-slate-700">{clarify[vendor.vendor_id].body}</pre>
                  <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">Drafted from the flagged cells and open points. Not sent: the buyer reviews and sends it.</div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      {!vendor && (
        <section className="flex flex-1 items-center justify-center p-10 text-center">
          <div className="max-w-md">
            <h2 className="text-base font-semibold text-slate-900">Waiting for vendor replies</h2>
            <p className="mt-2 text-sm text-slate-600">
              Email is stubbed in this prototype, so replies do not arrive on their own. Add one as a file or as pasted text and it will be read and placed in the comparison.
            </p>
            <button onClick={() => setAdding(true)} className="mt-4 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Add a vendor reply</button>
          </div>
        </section>
      )}
      {adding && (
        <AddReply onClose={() => setAdding(false)}
                  onDone={async (vendorId) => { await reload(); setSelected(vendorId); setAdding(false); }} />
      )}
    </div>
  );
}
