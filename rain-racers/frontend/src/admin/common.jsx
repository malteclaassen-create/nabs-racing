import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

// Loads an admin list and hands out a reload; errors land in `error`.
export function useAdminList(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!url) return Promise.resolve();
    return api
      .get(url)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(setError);
  }, [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

// Runs an admin action with a busy flag and a message for the result.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const run = useCallback(async (fn, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      const out = await fn();
      if (okText) setMessage({ ok: true, text: okText });
      return out;
    } catch (e) {
      setMessage({ ok: false, text: e.message });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, run, setMessage };
}

export function Message({ message }) {
  if (!message) return null;
  return <p className={`text-sm ${message.ok ? "text-emerald-400" : "text-red-300"}`}>{message.text}</p>;
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Section({ title, children, actions }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const confirmDelete = (what) => window.confirm(`Delete ${what}? This cannot be undone.`);

// <input type="datetime-local"> wants local time without a zone.
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
