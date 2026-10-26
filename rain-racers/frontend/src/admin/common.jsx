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

// A picture of a series, season or round: the current one, upload a new one
// (PNG, JPG or WebP up to 3 MB) or remove it. `endpoint` takes the upload
// (POST) and the removal (DELETE); `onChange` gets the saved row.
export function PictureField({ url, endpoint, onChange, label = "Picture", hint }) {
  const { busy, message, run } = useAction();
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const saved = await run(() => api.post(endpoint, form), "Picture saved.");
    if (saved) onChange?.(saved);
  }
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          <img src={url} alt="" className="h-16 w-28 rounded-lg border border-line object-cover" />
        ) : (
          <span className="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">none</span>
        )}
        <label className={`btn-ghost cursor-pointer py-1.5 ${busy ? "opacity-50" : ""}`}>
          {url ? "Replace" : "Upload"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} disabled={busy} />
        </label>
        {url && (
          <button
            type="button"
            className="btn-ghost py-1.5"
            disabled={busy}
            onClick={async () => {
              const saved = await run(() => api.del(endpoint), "Picture removed.");
              if (saved) onChange?.(saved);
            }}
          >
            Remove
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <Message message={message} />
    </div>
  );
}
