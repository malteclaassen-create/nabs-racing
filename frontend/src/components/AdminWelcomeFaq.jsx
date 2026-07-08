import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";
import { WELCOME_FAQ_DEFAULTS } from "../data/welcomeFaqDefaults.js";

// Editor for the public Welcome-page FAQ (the "Frequently asked" section shown
// to logged-out visitors). Stored as one blob in the backend; while nothing is
// saved the page shows its built-in, season-aware default questions.

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-dark placeholder:text-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelCls = "mb-1 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium";
const smallBtn =
  "flex h-7 w-7 items-center justify-center rounded-lg bg-surface2 text-medium transition hover:bg-border disabled:opacity-30";

function toForm(content) {
  const list = Array.isArray(content) && content.length ? content : WELCOME_FAQ_DEFAULTS;
  return list.map((x) => ({ q: x.q || "", a: x.a || "" }));
}

function fromForm(items) {
  return items.map((x) => ({ q: x.q.trim(), a: x.a.trim() })).filter((x) => x.q && x.a);
}

function moveItem(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function RowControls({ onUp, onDown, onRemove, upDisabled, downDisabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onUp} disabled={upDisabled} className={smallBtn} title="Move up">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      <button type="button" onClick={onDown} disabled={downDisabled} className={smallBtn} title="Move down">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
      </button>
      <button type="button" onClick={onRemove} className={`${smallBtn} text-red-500 hover:bg-red-500/10`} title="Remove">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

export default function AdminWelcomeFaq() {
  const { data, loading, error } = useApi(useCallback(() => api.adminWelcomeFaq(), []));
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !error && !form) setForm(toForm(data?.content));
  }, [loading, error, data, form]);

  if (error) return <ErrorBox message={error} />;
  if (loading || !form) return <p className="text-sm text-light">Loading…</p>;

  const setItem = (i, k, v) => setForm((f) => f.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveWelcomeFaq(fromForm(form));
      setMsg({ ok: true, text: "Saved. The home page shows the new FAQ right away." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function resetToDefaults() {
    if (!window.confirm("Replace everything in this form with the standard FAQ? Nothing is saved until you press Save.")) return;
    setForm(toForm(WELCOME_FAQ_DEFAULTS));
    setMsg(null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        This is the <b>Frequently asked</b> section on the public home page (shown to visitors who aren&rsquo;t
        logged in). Writing tips: <code className="rounded bg-card px-1.5 py-0.5 text-xs">**words**</code> makes
        words bold, and these placeholders are filled in live from the season data:{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{platform}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{era}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{rounds}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{counted}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{drop}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{seasons}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{pointsFirst}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{pointsLast}"}</code>.
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Questions</h3>
          <button
            type="button"
            onClick={() => setForm([...form, { q: "", a: "" }])}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
          >
            Add question
          </button>
        </div>
        {form.map((it, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <label className={labelCls}>Question</label>
                <input className={inputCls} value={it.q} onChange={(e) => setItem(i, "q", e.target.value)} />
              </div>
              <div className="pt-6">
                <RowControls
                  onUp={() => setForm(moveItem(form, i, -1))}
                  onDown={() => setForm(moveItem(form, i, 1))}
                  onRemove={() => setForm(form.filter((_, j) => j !== i))}
                  upDisabled={i === 0}
                  downDisabled={i === form.length - 1}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Answer</label>
              <textarea className={inputCls} rows={3} value={it.a} onChange={(e) => setItem(i, "a", e.target.value)} />
            </div>
          </div>
        ))}
        {form.length === 0 && <p className="text-sm text-light">No questions. Add one, or reset to the standard FAQ.</p>}
      </div>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
        <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={resetToDefaults} className="rounded-lg bg-surface2 px-4 py-2.5 text-sm font-semibold text-medium transition hover:bg-border">
          Reset to standard FAQ
        </button>
        {msg && <span className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
