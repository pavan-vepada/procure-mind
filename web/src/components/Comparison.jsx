import { AlertTriangle, Check, Download, FileText, Minus, UserCheck, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api.js";
import { crore, day, inr, itemName } from "../format.js";
import { GateBadge, ModePill, Pill } from "./bits.jsx";
import CellDrawer from "./CellDrawer.jsx";

const FREIGHT = {
  included: { text: "Included", tone: "emerald" },
  excluded: { text: "Excluded", tone: "amber" },
  partly_included: { text: "Partly included", tone: "amber" },
  not_stated: { text: "Not stated", tone: "amber" },
};
const ANSWER_ICON = {
  yes: <Check size={14} className="text-emerald-600" />,
  no: <X size={14} className="text-rose-600" />,
  partial: <Minus size={14} className="text-amber-600" />,
};

function SectionRow({ title, span, note }) {
  return (
    <tr>
      <td colSpan={span} className="sticky left-0 border-y border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {title} {note && <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">{note}</span>}
      </td>
    </tr>
  );
}

function LabelCell({ children, sub }) {
  return (
    <td colSpan={3} className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
      {children}
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </td>
  );
}

function PriceCell({ cell, cheapest, onClick }) {
  const base = "block w-full rounded-md px-2 py-1 text-right ring-1 ring-transparent hover:ring-indigo-300";
  if (!cell || cell.price_inr == null) {
    return (
      <button onClick={onClick} className={`${base} text-xs italic ${cell?.status === "unclear" ? "bg-rose-50 text-rose-700" : "text-slate-400"}`}>
        {cell?.status === "unclear" ? "unclear" : "not quoted"}
      </button>
    );
  }
  const original = cell.status === "derived" ? `${cell.quoted_value} ${cell.quoted_currency === "USD" ? "USD " : ""}${cell.quoted_unit || ""}` : null;
  const tone = cell.needs_review
    ? "bg-orange-50 ring-orange-300"
    : cell.status === "assumed"
      ? "bg-amber-50"
      : cheapest ? "bg-emerald-50" : "";
  return (
    <button onClick={onClick} className={`${base} ${tone}`}>
      <div className={`num flex items-center justify-end gap-1 text-sm ${cheapest ? "font-semibold text-emerald-800" : "text-slate-900"}`}>
        {cell.needs_review ? <AlertTriangle size={13} className="text-orange-500" /> : null}
        {cell.buyer_override ? <UserCheck size={13} className="text-indigo-500" /> : null}
        {inr(cell.price_inr)}
      </div>
      {cell.status === "assumed" && <div className="text-[10px] text-amber-700">assumed: last year</div>}
      {original && <div className="truncate text-[10px] text-slate-400" title={original}>from {original}</div>}
    </button>
  );
}

export default function Comparison({ data, reload }) {
  const { lines, vendors, rfx } = data;
  const [open, setOpen] = useState(null); // { vendorId, lineNo }
  const [onlyReview, setOnlyReview] = useState(false);
  const [fx, setFx] = useState(String(data.fx_usd_inr));
  const [busy, setBusy] = useState(false);
  const span = 3 + vendors.length;
  const reviewCount = vendors.reduce((n, v) => n + v.summary.needs_review, 0);

  async function applyFx() {
    setBusy(true);
    try {
      await api.setFx(Number(fx));
      await reload();
    } catch (e) {
      alert(e.message);
    }
    setBusy(false);
  }

  const shown = onlyReview ? lines.filter((l) => vendors.some((v) => v.cells[l.line_no]?.needs_review)) : lines;
  const openVendor = open && vendors.find((v) => v.vendor_id === open.vendorId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-6 py-2.5 text-xs text-slate-600">
        <span>All prices in <b>₹ per unit</b>, before GST. Click any cell to see where it came from.</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100" /> Cheapest on the line</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-100" /> Assumed, not quoted</span>
        <span className="flex items-center gap-1.5"><AlertTriangle size={13} className="text-orange-500" /> Needs review</span>
        <span className="flex items-center gap-1.5"><UserCheck size={13} className="text-indigo-500" /> Checked by buyer</span>
        <div className="ml-auto flex items-center gap-4">
          <button onClick={() => api.exportComparison()} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50"><Download size={12} /> Export to Excel</button>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Only lines needing review ({reviewCount})
          </label>
          <div className="flex items-center gap-1.5">
            1 USD = ₹
            <input value={fx} onChange={(e) => setFx(e.target.value)} className="num w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right" />
            <button onClick={applyFx} disabled={busy || Number(fx) === data.fx_usd_inr}
                    className="rounded bg-slate-800 px-2 py-0.5 text-white disabled:opacity-30">
              {busy ? "…" : "Apply"}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0" style={{ minWidth: 430 + vendors.length * 170 }}>
          <colgroup>
            <col style={{ width: 280 }} /><col style={{ width: 72 }} /><col style={{ width: 78 }} />
            {vendors.map((v) => <col key={v.vendor_id} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-500">Line item</th>
              <th className="sticky top-0 z-20 border-b border-slate-200 bg-white px-2 py-2 text-right text-xs font-medium text-slate-500">Qty / year</th>
              <th className="sticky top-0 z-20 border-b border-slate-200 bg-white px-2 py-2 text-right text-xs font-medium text-slate-500">Last year</th>
              {vendors.map((v) => (
                <th key={v.vendor_id} className="sticky top-0 z-20 border-b border-l border-slate-200 bg-white px-3 py-2 text-left align-top">
                  <div className="text-sm font-semibold leading-tight text-slate-900">{v.name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span title={v.quality_gate_reason}><GateBadge gate={v.quality_gate} short /></span>
                    <span className="text-[11px] font-normal text-slate-500">{day(v.received_at)}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionRow title="Totals" span={span} note={`annual value at RFx quantities${data.last_year_total_inr ? ` · last year ${crore(data.last_year_total_inr)}` : ""}`} />
            <tr>
              <LabelCell sub="Not comparable when line counts differ">Everything the vendor priced</LabelCell>
              {vendors.map((v) => (
                <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-right">
                  <div className="num text-sm font-semibold text-slate-900">{crore(v.summary.total_inr)}</div>
                  <div className={`text-[11px] ${v.summary.lines_priced < lines.length ? "text-amber-700" : "text-slate-500"}`}>
                    {v.summary.lines_priced} of {lines.length} lines
                    {v.summary.assumed > 0 && `, ${v.summary.assumed} assumed`}
                  </div>
                </td>
              ))}
            </tr>
            <tr>
              <LabelCell sub={`The ${data.common_lines.length} lines every vendor priced`}>Like-for-like basket</LabelCell>
              {vendors.map((v) => {
                const best = Math.min(...vendors.map((x) => x.summary.common_basket_inr));
                return (
                  <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-right">
                    <div className={`num text-sm font-semibold ${v.summary.common_basket_inr === best ? "text-emerald-700" : "text-slate-900"}`}>
                      {crore(v.summary.common_basket_inr)}
                    </div>
                  </td>
                );
              })}
            </tr>

            <SectionRow title="Commercial terms" span={span} note={`RFx asked for: ${rfx.terms.price_basis}; payment ${rfx.terms.payment || "not stated"}`} />
            <tr>
              <LabelCell>Freight to warehouse</LabelCell>
              {vendors.map((v) => (
                <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
                  <Pill tone={FREIGHT[v.freight]?.tone}>{FREIGHT[v.freight]?.text || v.freight}</Pill>
                  <div className="mt-1 line-clamp-2" title={v.freight_note}>{v.freight_note}</div>
                </td>
              ))}
            </tr>
            <tr>
              <LabelCell sub="Shown separately; not applied to the prices below">Conditional rebate</LabelCell>
              {vendors.map((v) => (
                <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
                  {v.conditional_discount_pct ? (
                    <>
                      <Pill tone="indigo">{v.conditional_discount_pct}% if conditions met</Pill>
                      <div className="mt-1 line-clamp-2" title={v.conditional_discount_condition}>{v.conditional_discount_condition}</div>
                    </>
                  ) : <span className="text-slate-400">None</span>}
                </td>
              ))}
            </tr>
            {[["Payment terms", (v) => v.payment_terms], ["Lead time", (v) => v.lead_time_days && `${v.lead_time_days} days`], ["Offer validity", (v) => v.validity_days && `${v.validity_days} days`]].map(([label, get]) => (
              <tr key={label}>
                <LabelCell>{label}</LabelCell>
                {vendors.map((v) => (
                  <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-xs text-slate-700">
                    {get(v) || <span className="text-amber-700">Not stated</span>}
                  </td>
                ))}
              </tr>
            ))}

            <SectionRow title="Questionnaire" span={span} note={rfx.quality_gate} />
            {rfx.questionnaire.map((q) => (
              <tr key={q.id}>
                <LabelCell>
                  <span className="text-xs">{q.question}</span>
                  {q.mandatory && <span className="ml-1.5"><Pill tone="rose">Mandatory</Pill></span>}
                </LabelCell>
                {vendors.map((v) => {
                  const a = v.answers[q.id];
                  return (
                    <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-xs text-slate-700" title={a?.source_quote || ""}>
                      {a && a.answer !== "unanswered" ? (
                        <div className="flex items-start gap-1.5"><span className="mt-0.5 shrink-0">{ANSWER_ICON[a.answer]}</span><span className="line-clamp-2">{a.answer_text}</span></div>
                      ) : <span className="text-amber-700">Not answered</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <LabelCell sub="What the evidence shows, decided by rule">Quality gate</LabelCell>
              {vendors.map((v) => (
                <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
                  <GateBadge gate={v.quality_gate} short />
                  <div className="mt-1">{v.quality_gate_reason}</div>
                </td>
              ))}
            </tr>
            <tr>
              <LabelCell sub="Open the original, see how it was read">Documents received</LabelCell>
              {vendors.map((v) => (
                <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-3 py-2 align-top text-xs">
                  {v.documents.filter((d) => d.filename !== "Email body").map((d) => (
                    <div key={d.filename} className="mb-1 flex items-center gap-1.5" title={d.read_mode_reason}>
                      <FileText size={12} className="shrink-0 text-slate-400" />
                      <a href={api.fileUrl(v.vendor_id, d.filename)} target="_blank" rel="noreferrer" className="truncate text-indigo-700 hover:underline">{d.filename}</a>
                      <ModePill mode={d.read_mode} />
                    </div>
                  ))}
                  {v.documents.length <= 1 && <span className="text-amber-700">Email only, no attachments</span>}
                </td>
              ))}
            </tr>

            <SectionRow title="Line items" span={span} note={onlyReview ? `showing ${shown.length} of ${lines.length}` : ""} />
            {shown.map((l) => {
              const prices = vendors.map((v) => v.cells[l.line_no]?.price_inr).filter((p) => p != null);
              const min = Math.min(...prices);
              return (
                <tr key={l.line_no} className="group">
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 group-hover:bg-slate-50">
                    <div className="flex gap-2 text-sm text-slate-800">
                      <span className="num w-5 shrink-0 text-right text-slate-400">{l.line_no}</span>
                      <span className="truncate">{itemName(l)}</span>
                    </div>
                    <div className="truncate pl-7 text-[11px] text-slate-500">{[l.specification || (l.length_mm && `${l.length_mm} × ${l.width_mm} × ${l.height_mm} mm`), l.box_weight_kg && `${l.box_weight_kg} kg`, l.item_code].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="num border-b border-slate-100 bg-white px-2 text-right text-xs text-slate-600 group-hover:bg-slate-50">{l.annual_qty?.toLocaleString("en-IN") ?? "n/a"}</td>
                  <td className="num border-b border-slate-100 bg-white px-2 text-right text-xs text-slate-600 group-hover:bg-slate-50">{inr(l.last_year_price_inr)}</td>
                  {vendors.map((v) => {
                    const cell = v.cells[l.line_no];
                    return (
                      <td key={v.vendor_id} className="border-b border-l border-slate-100 bg-white px-1.5 py-1 group-hover:bg-slate-50">
                        <PriceCell cell={cell} cheapest={prices.length > 1 && cell?.price_inr != null && cell.price_inr === min}
                                   onClick={() => setOpen({ vendorId: v.vendor_id, lineNo: l.line_no })} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && openVendor && (
        <CellDrawer vendor={openVendor} line={lines.find((l) => l.line_no === open.lineNo)}
                    cell={openVendor.cells[open.lineNo]} onClose={() => setOpen(null)} reload={reload} />
      )}
    </div>
  );
}
