import { ArrowRight, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { day, STAGE } from "../format.js";
import { Pill } from "./bits.jsx";

// The buyer's home: every requirement they have raised, and a way to start a new one.
export default function Dashboard({ events, buyer, onOpen, onCreate, reload }) {
  const count = (status) => events.filter((e) => e.status === status).length;
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Welcome back, {buyer.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {events.length} RFx {events.length === 1 ? "event" : "events"}: {count("draft")} in draft, {count("awaiting_replies")} awaiting replies, {count("comparing")} with replies in.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <button onClick={onCreate} className="flex min-h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-5 text-indigo-700 hover:bg-indigo-50">
          <Plus size={28} />
          <div className="mt-2 text-sm font-semibold">Create new RFx</div>
          <div className="mt-1 text-center text-xs text-indigo-600/80">Describe it, speak it, or upload a requirement document</div>
        </button>

        {events.map((e) => (
          <div key={e.key} className="group flex min-h-48 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-300 hover:shadow">
            <div className="flex items-start justify-between gap-2">
              <Pill tone={STAGE[e.status].tone}>{STAGE[e.status].label}</Pill>
              {e.key === "demo" ? (
                <button title="Reset this RFx to its original state (undo corrections, uploads and FX changes)"
                        onClick={async () => { if (confirm("Reset this RFx to its original state?")) { await api.resetDemo(); reload(); } }}
                        className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"><RotateCcw size={14} /></button>
              ) : (
                <button title="Delete this RFx" onClick={async () => { if (confirm("Delete this RFx?")) { await api.deleteEvent(e.key); reload(); } }}
                        className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
              )}
            </div>
            <button onClick={() => onOpen(e)} className="mt-3 flex flex-1 flex-col text-left">
              <div className="line-clamp-2 text-base font-semibold leading-snug text-slate-900">{e.title}</div>
              <div className="mt-1 text-xs text-slate-500">{e.rfx_id || "Not sent yet"}</div>
              <div className="mt-2 line-clamp-2 text-xs text-slate-600">{e.scope}</div>
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3 text-xs text-slate-600">
                <span><b className="text-slate-900">{e.lines}</b> lines</span>
                {e.status !== "draft" && <span><b className="text-slate-900">{e.replies}</b> {e.replies === 1 ? "reply" : "replies"}</span>}
                {e.needs_review > 0 && <span className="text-orange-700"><b>{e.needs_review}</b> to review</span>}
                {e.due_on && <span>Due {day(e.due_on)}</span>}
              </div>
              <div className="mt-3 flex items-center gap-1 text-sm font-medium text-indigo-700">{STAGE[e.status].next} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" /></div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
