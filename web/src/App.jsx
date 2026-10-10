import { ArrowLeft, LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, setCurrentRfx } from "./api.js";
import Analyst from "./components/Analyst.jsx";
import Comparison from "./components/Comparison.jsx";
import Copilot from "./components/Copilot.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Inbox from "./components/Inbox.jsx";
import Login from "./components/Login.jsx";
import { Pill } from "./components/bits.jsx";
import { STAGE } from "./format.js";

const BUYER = { name: "Pavan Vepada", company: "Nimbus Home & Personal Care Ltd." };

// Two levels: the dashboard of all RFx events, and the workspace of one RFx with its four steps.
export default function App() {
  const [signedIn, setSignedIn] = useState(null); // null while checking
  const [events, setEvents] = useState([]);
  const [current, setCurrent] = useState(null); // key of the open RFx, or null on the dashboard
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("rfx");
  const [error, setError] = useState("");

  const guard = useCallback((e) => {
    if (e.message === "unauthorised") setSignedIn(false);
    else setError(e.message);
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      setEvents(await api.events());
      setSignedIn(true);
    } catch (e) {
      guard(e);
    }
  }, [guard]);

  // Reloads the open RFx after anything changes it (a correction, an upload, a new FX rate).
  const reload = useCallback(async () => {
    try {
      const [list, comparison] = [await api.events(), await api.comparison()];
      setEvents(list);
      setData(comparison);
    } catch (e) {
      guard(e);
    }
  }, [guard]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  async function open(key, goTo) {
    setCurrentRfx(key);
    setData(null);
    setCurrent(key);
    await reload();
    setTab(goTo);
  }

  function home() {
    setCurrent(null);
    setData(null);
    loadEvents();
  }

  if (signedIn === false) return <Login onDone={loadEvents} />;
  if (error) return <div className="p-10 text-rose-700">Could not load: {error} <button className="underline" onClick={() => { setError(""); home(); }}>Go back</button></div>;
  if (signedIn === null) return <div className="p-10 text-slate-500">Loading…</div>;

  const event = events.find((e) => e.key === current);
  const sent = event && event.status !== "draft";
  const hasReplies = event?.status === "comparing";
  const tabs = [
    { id: "rfx", label: sent ? "1. The RFx" : "1. Draft RFx", enabled: true },
    { id: "inbox", label: "2. Vendor replies", enabled: sent },
    { id: "comparison", label: "3. Comparison", enabled: hasReplies },
    { id: "analyst", label: "4. Ask the analyst", enabled: hasReplies },
  ];
  const active = tabs.find((t) => t.id === tab)?.enabled ? tab : sent ? "inbox" : "rfx";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-5 border-b border-slate-200 bg-white px-6 py-2.5">
        <button onClick={home} className="text-left">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">Quote Desk</div>
          <div className="text-sm font-semibold text-slate-900">{BUYER.company}</div>
        </button>
        <div className="ml-auto flex items-center gap-3 text-right text-xs text-slate-500">
          <div><div className="font-medium text-slate-700">{BUYER.name}</div><div>Category Buyer, Packaging</div></div>
          <button title="Sign out" onClick={async () => { await api.logout(); setCurrent(null); setSignedIn(false); }} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut size={16} /></button>
        </div>
      </header>

      {!current && (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Dashboard events={events} buyer={BUYER} reload={loadEvents}
                     onOpen={(e) => open(e.key, e.status === "comparing" ? "comparison" : e.status === "draft" ? "rfx" : "inbox")}
                     onCreate={async () => { const created = await api.newEvent(); await open(created.key, "rfx"); }} />
        </main>
      )}

      {current && (!event || !data) && <div className="p-10 text-slate-500">Loading…</div>}

      {current && event && data && (
        <>
          <div className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-2">
            <button onClick={home} className="flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50">
              <ArrowLeft size={14} /> All RFx
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-900">{event.title}</span>
                <Pill tone={STAGE[event.status].tone}>{STAGE[event.status].label}</Pill>
              </div>
              <div className="text-[11px] text-slate-500">{[event.rfx_id, `${event.lines} lines`, sent && `${event.replies} ${event.replies === 1 ? "reply" : "replies"}`].filter(Boolean).join(" · ")}</div>
            </div>
            <nav className="ml-auto flex gap-1">
              {tabs.map((t) => (
                <button key={t.id} disabled={!t.enabled} onClick={() => setTab(t.id)}
                        title={t.enabled ? "" : sent ? "Available once a vendor reply has been read" : "Available once the RFx has been sent"}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-300 ${
                          active === t.id ? "bg-indigo-50 text-indigo-700" : "text-slate-600 enabled:hover:bg-slate-100"}`}>
                  {t.label}
                  {t.id === "comparison" && event.needs_review > 0 && <span className="ml-2 rounded-full bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700">{event.needs_review}</span>}
                </button>
              ))}
            </nav>
          </div>
          <main className="min-h-0 flex-1">
            {active === "rfx" && <Copilot key={current} rfx={data.rfx} onChange={loadEvents} onSent={() => open(current, "inbox")} />}
            {active === "inbox" && <Inbox key={current} data={data} reload={reload} />}
            {active === "comparison" && <Comparison data={data} reload={reload} />}
            {active === "analyst" && <Analyst key={current} />}
          </main>
        </>
      )}
    </div>
  );
}
