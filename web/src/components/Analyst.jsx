import { ChevronDown, ChevronRight, Download, MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";

const STARTERS = [
  "What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?",
  "Which numbers in this comparison should I not rely on yet, and why?",
  "Chart each vendor's total for the lines that everyone quoted.",
  "What must I confirm with each vendor before I can award?",
];
const COLOURS = ["#4f46e5", "#0d9488", "#d97706", "#db2777", "#64748b", "#7c3aed"];
const TOOL_LABEL = { run_sql: "Looked up data", show_table: "Built a table", show_chart: "Built a chart", award_scenario: "Ran an award scenario" };

const compact = (n) =>
  typeof n !== "number" ? n : Math.abs(n) >= 1e7 ? (n / 1e7).toFixed(2) + " cr" : Math.abs(n) >= 1e5 ? (n / 1e5).toFixed(1) + " L" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const cellText = (v) => (v == null ? "" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));

function TableArtifact({ artifact }) {
  const [all, setAll] = useState(false);
  const rows = all ? artifact.rows : artifact.rows.slice(0, 8);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="text-sm font-medium text-slate-800">{artifact.title}</div>
        <button onClick={() => api.exportTable(artifact)} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          <Download size={12} /> Excel
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>{artifact.columns.map((c) => <th key={c} className="whitespace-nowrap bg-slate-50 px-3 py-1.5 text-left font-medium text-slate-600">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                {row.map((v, j) => <td key={j} className={`px-3 py-1.5 ${typeof v === "number" ? "num text-right" : ""}`}>{cellText(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {artifact.rows.length > 8 && (
        <button onClick={() => setAll(!all)} className="w-full border-t border-slate-100 py-1.5 text-xs text-indigo-700 hover:bg-slate-50">
          {all ? "Show fewer" : `Show all ${artifact.rows.length} rows`}
        </button>
      )}
    </div>
  );
}

function ChartArtifact({ artifact }) {
  const data = artifact.rows.map((row) => Object.fromEntries(artifact.columns.map((c, i) => [c, row[i]])));
  const Chart = artifact.chart_type === "line" ? LineChart : BarChart;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-sm font-medium text-slate-800">{artifact.title}</div>
      <ResponsiveContainer width="100%" height={280}>
        <Chart data={data} margin={{ left: 10, right: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey={artifact.x} tick={{ fontSize: 11 }} interval={0} tickFormatter={(v) => (String(v).length > 16 ? String(v).slice(0, 15) + "…" : v)} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={60} />
          <Tooltip formatter={(v) => compact(v)} />
          {artifact.y.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {artifact.y.map((key, i) =>
            artifact.chart_type === "line" ? (
              <Line key={key} dataKey={key} stroke={COLOURS[i % COLOURS.length]} strokeWidth={2} dot={false} />
            ) : (
              <Bar key={key} dataKey={key} fill={COLOURS[i % COLOURS.length]} stackId={artifact.chart_type === "stacked_bar" ? "a" : undefined} radius={[3, 3, 0, 0]} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

// Shows which tools ran and with what input, so the buyer can audit the answer.
function Steps({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="text-xs text-slate-500">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-slate-700">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} How this was worked out ({steps.length} {steps.length === 1 ? "step" : "steps"})
      </button>
      {open && (
        <ol className="mt-2 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="font-medium text-slate-700">{i + 1}. {TOOL_LABEL[s.tool] || s.tool}{s.error && <span className="ml-2 text-rose-600">failed, then retried: {s.error}</span>}</div>
              <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-600">{s.input.query || JSON.stringify(s.input, null, 2)}</pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Conversations are saved per RFx: start a new one any time, or go back to an earlier one.
export default function Analyst() {
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(null); // null = a new conversation not yet saved
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    api.chats().then(setChats).catch(() => {});
  }, []);
  // Braces matter: newer browsers return a promise from scrollIntoView, and an effect must not return one.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy]);

  function newChat() {
    setChatId(null);
    setMessages([]);
  }

  async function openChat(id) {
    const chat = await api.chat(id);
    setChatId(id);
    setMessages(chat.messages);
  }

  async function removeChat(id) {
    await api.deleteChat(id);
    setChats(await api.chats());
    if (id === chatId) newChat();
  }

  async function send(question) {
    if (!question.trim() || busy) return;
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: question }]);
    try {
      const chat = await api.ask(question, chatId);
      setChatId(chat.chat_id);
      setMessages(chat.messages);
      setChats(await api.chats());
    } catch (e) {
      setMessages((m) => [...m, { role: "analyst", answer: `Something went wrong: ${e.message}. Please ask again.`, artifacts: [], steps: [] }]);
    }
    setBusy(false);
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="p-3">
          <button onClick={newChat} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            <Plus size={15} /> New conversation
          </button>
        </div>
        <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Earlier conversations</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 && <div className="px-2 py-2 text-xs text-slate-400">None yet for this RFx.</div>}
          {chats.map((c) => (
            <div key={c.chat_id} className={`group flex items-center rounded-md ${c.chat_id === chatId ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
              <button onClick={() => openChat(c.chat_id)} disabled={busy} className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left">
                <MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-400" />
                <span className="min-w-0">
                  <span className={`line-clamp-2 text-sm ${c.chat_id === chatId ? "font-medium text-indigo-800" : "text-slate-700"}`}>{c.title}</span>
                  <span className="text-[11px] text-slate-400">{new Date(c.updated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </span>
              </button>
              <button title="Delete conversation" onClick={() => removeChat(c.chat_id)} className="mr-1 hidden rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 group-hover:block"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
            {messages.length === 0 && (
              <div className="pt-10">
                <h2 className="text-lg font-semibold text-slate-900">Ask anything about these quotes</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Answers are computed from the extracted data. Every answer shows the query or scenario behind it, and every table exports to Excel.
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {STARTERS.map((q) => (
                    <button key={q} onClick={() => send(q)} className="rounded-lg border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 hover:border-indigo-300 hover:bg-indigo-50">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-2xl rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{m.text}</div>
                </div>
              ) : (
                <div key={i} className="space-y-3">
                  <div className="answer rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.answer}</ReactMarkdown>
                  </div>
                  {m.artifacts.map((a, j) => (a.type === "chart" ? <ChartArtifact key={j} artifact={a} /> : <TableArtifact key={j} artifact={a} />))}
                  <Steps steps={m.steps} />
                </div>
              ),
            )}
            {busy && <div className="animate-pulse text-sm text-slate-500">Working on it: querying the quote data…</div>}
            <div ref={bottom} />
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="border-t border-slate-200 bg-white px-6 py-3">
          <div className="mx-auto flex max-w-4xl gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question about the quotes…"
                   className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            <button disabled={busy || !text.trim()} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
              <Send size={14} /> Ask
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
