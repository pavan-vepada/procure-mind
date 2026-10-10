// Thin wrapper over fetch. Every call says which RFx it is about; a 401 sends the user to the password screen.
let currentRfx = "demo";
export const setCurrentRfx = (key) => { currentRfx = key; };

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "X-RFx": currentRfx, ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
  });
  if (response.status === 401) throw new Error("unauthorised");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response;
}
const json = (path, options) => request(path, options).then((r) => r.json());
const post = (path, body) => json(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

async function download(response, filename) {
  const url = URL.createObjectURL(await response.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (password) => post("/login", { password }),
  logout: () => post("/logout"),

  events: () => json("/events"),
  newEvent: () => post("/events"),
  deleteEvent: (key) => json(`/events/${key}`, { method: "DELETE" }),
  resetDemo: () => post("/events/demo/reset"),

  comparison: () => json("/comparison"),
  exportComparison: async () => download(await request("/comparison/export"), "comparison.xlsx"),
  document: (vendorId, filename) => json(`/vendors/${vendorId}/documents/${encodeURIComponent(filename)}`),
  // Links and images cannot send a header, so the RFx goes in the address.
  fileUrl: (vendorId, filename) => `/api/vendors/${vendorId}/files/${encodeURIComponent(filename)}?rfx=${currentRfx}`,
  correct: (vendorId, lineNo, price_inr, note = "") =>
    json(`/quotes/${vendorId}/${lineNo}`, { method: "PATCH", body: JSON.stringify({ price_inr, note }) }),
  setFx: (fx_usd_inr) => json("/settings/fx", { method: "PUT", body: JSON.stringify({ fx_usd_inr }) }),

  upload: (vendorName, emailText, files) => {
    const form = new FormData();
    form.append("vendor_name", vendorName);
    form.append("email_text", emailText);
    for (const file of files) form.append("files", file);
    return json("/vendors/upload", { method: "POST", body: form });
  },
  reread: (vendorId) => post(`/vendors/${vendorId}/reread`),
  removeVendor: (vendorId) => json(`/vendors/${vendorId}`, { method: "DELETE" }),
  clarification: (vendorId) => post(`/vendors/${vendorId}/clarification`),

  draft: () => json("/rfx-draft"),
  draftChat: (message) => post("/rfx-draft/chat", { message }),
  draftUpload: (files, message) => {
    const form = new FormData();
    form.append("message", message);
    for (const file of files) form.append("files", file);
    return json("/rfx-draft/upload", { method: "POST", body: form });
  },
  draftReset: () => json("/rfx-draft", { method: "DELETE" }),
  draftSend: () => post("/rfx-draft/send"),
  exportDraft: async () => download(await request("/rfx-draft/export"), "RFx_line_items.xlsx"),

  chats: () => json("/analyst/chats"),
  chat: (chatId) => json(`/analyst/chats/${chatId}`),
  deleteChat: (chatId) => json(`/analyst/chats/${chatId}`, { method: "DELETE" }),
  ask: (question, chat_id) => post("/analyst", { question, chat_id }),
  exportTable: async (artifact) =>
    download(
      await request("/export", { method: "POST", body: JSON.stringify({ title: artifact.title, columns: artifact.columns, rows: artifact.rows, how: artifact.how, notes: artifact.notes || [] }) }),
      `${artifact.title.replace(/[^\w]+/g, "_")}.xlsx`,
    ),
};
