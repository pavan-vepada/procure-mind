// Small shared pieces of UI.
import { GATE, MODE_LABEL } from "../format.js";

export function GateBadge({ gate, short }) {
  const g = GATE[gate] || GATE.unverified;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${g.className}`}>
      {short ? g.short : g.label}
    </span>
  );
}

export function ModePill({ mode }) {
  const colour = mode === "direct" ? "bg-slate-100 text-slate-600" : "bg-violet-50 text-violet-700";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${colour}`}>{MODE_LABEL[mode] || mode}</span>;
}

export function Pill({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-700",
    orange: "bg-orange-50 text-orange-700",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
    indigo: "bg-indigo-50 text-indigo-700",
  };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}
