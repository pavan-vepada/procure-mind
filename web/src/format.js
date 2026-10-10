export const inr = (n) =>
  n == null ? "" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const crore = (n) => "₹" + (n / 1e7).toFixed(2) + " cr";

export const day = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

// "5-ply Master carton" for the demo data; unchanged if the description already says the ply.
export const itemName = (l) => (l.ply && !/ply/i.test(l.description) ? `${l.ply}-ply ${l.description}` : l.description);

// One line of spec text, whichever way the RFx recorded it.
export const itemSpec = (l) =>
  l.specification || [l.ply && `${l.ply}-ply`, l.length_mm && `${l.length_mm} × ${l.width_mm} × ${l.height_mm} mm`].filter(Boolean).join(", ");

export const isImage = (filename) => /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(filename || "");

export const GATE = {
  cleared: { label: "Quality gate cleared", short: "Cleared", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  failed: { label: "Quality gate failed", short: "Failed", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  unverified: { label: "Quality gate unverified", short: "Unverified", className: "bg-amber-50 text-amber-700 ring-amber-200" },
};

export const STATUS = {
  quoted: { label: "Quoted", help: "The vendor gave this price in rupees per piece." },
  derived: { label: "Derived", help: "Converted from the vendor's unit or currency. The formula is shown." },
  assumed: { label: "Assumed", help: "The vendor gave no number. Filled from last year's contract." },
  missing: { label: "Not quoted", help: "The vendor did not price this line." },
  unclear: { label: "Unclear", help: "The vendor wrote something we could not turn into a price." },
};

export const MODE_LABEL = { direct: "Direct text", ocr: "OCR", vision: "Vision", "ocr+vision": "OCR + vision", unsupported: "Not read" };

export const STAGE = {
  draft: { label: "Draft", tone: "slate", next: "Continue drafting" },
  awaiting_replies: { label: "Sent, awaiting replies", tone: "amber", next: "Add vendor replies" },
  comparing: { label: "Replies in", tone: "emerald", next: "Open comparison" },
};
