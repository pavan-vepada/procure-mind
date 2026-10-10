import { useState } from "react";
import { api } from "../api.js";

// A sample buyer sign-in. Only the password is checked; the email shows who the demo buyer is.
export default function Login({ onDone }) {
  const [email, setEmail] = useState("pavan.vepada@nimbus.example");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      await api.login(password);
      onDone();
    } catch {
      setError("That password is not right.");
    }
  }

  return (
    <div className="flex h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-indigo-700 p-12 text-white lg:flex">
        <div className="text-sm font-semibold uppercase tracking-widest">Quote Desk</div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">From RFx to award,<br />without the spreadsheet.</h1>
          <p className="mt-4 max-w-md text-indigo-100">
            Draft an RFx by talking. Let vendors reply in any format. Compare every quote line by line, and ask questions of the result.
          </p>
        </div>
        <div className="text-xs text-indigo-200">Prototype. Vendor data is fabricated.</div>
      </div>
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <form onSubmit={submit} className="w-96 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Buyer sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Nimbus Home & Personal Care Ltd.</p>
          <label className="mt-6 block text-xs font-medium text-slate-600">Work email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <label className="mt-4 block text-xs font-medium text-slate-600">Password</label>
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
                 className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
          <button className="mt-6 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700">Sign in</button>
        </form>
      </div>
    </div>
  );
}
