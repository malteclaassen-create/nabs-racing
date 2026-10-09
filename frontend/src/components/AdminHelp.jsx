import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Field } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { HELP_DEFAULTS } from "../data/helpDefaults.js";
import { UnsavedHint, useUnsavedGuard } from "../hooks/useUnsavedGuard.js";

// Editor for the public Help & troubleshooting page (/help). Same pattern as
// the Home FAQ editor (AdminWelcomeFaq.jsx), one level deeper: topics, each
// with its own questions. Stored as one blob (backend lib/helpFaq.js); while
// nothing is saved the page shows data/helpDefaults.js.

const smallBtn =
  "flex h-7 w-7 items-center justify-center rounded-lg bg-surface2 text-medium transition hover:bg-border disabled:opacity-30";
const addBtn = "rounded-lg bg-link/10 px-3 py-1.5 text-xs font-bold text-link transition hover:bg-link/20";

function toForm(content) {
  const topics = content?.topics?.length ? content.topics : HELP_DEFAULTS.topics;
  return topics.map((t) => ({ title: t.title || "", items: (t.items || []).map((x) => ({ q: x.q || "", a: x.a || "" })) }));
}

function fromForm(topics) {
  return {
    topics: topics
      .map((t) => ({
        title: t.title.trim(),
        items: t.items.map((x) => ({ q: x.q.trim(), a: x.a.trim() })).filter((x) => x.q && x.a),
      }))
      .filter((t) => t.title && t.items.length),
  };
}

function move(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function RowControls({ onUp, onDown, onRemove, upDisabled, downDisabled, what }) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onUp} disabled={upDisabled} className={smallBtn} title={`Move ${what} up`}>
        <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <button type="button" onClick={onDown} disabled={downDisabled} className={smallBtn} title={`Move ${what} down`}>
        <ArrowDown className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <button type="button" onClick={onRemove} className={`${smallBtn} text-bad hover:bg-red-500/10`} title={`Remove ${what}`}>
        <X className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export default function AdminHelp() {
  const ask = useAsk();
  const { data, loading, error } = useApi(useCallback(() => api.adminHelpFaq(), []));
  const [form, setForm] = useState(null);
  const [savedForm, setSavedForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !error && !form) {
      const f = toForm(data?.content);
      setForm(f);
      setSavedForm(f);
    }
  }, [loading, error, data, form]);
  const dirty = !!form && !!savedForm && JSON.stringify(form) !== JSON.stringify(savedForm);
  useUnsavedGuard(dirty, "Help page");

  if (error) return <ErrorBox message={error} />;
  if (loading || !form) return <p className="text-sm text-light">Loading…</p>;

  const setTopic = (ti, patch) => setForm((f) => f.map((t, j) => (j === ti ? { ...t, ...patch } : t)));
  const setItems = (ti, fn) => setForm((f) => f.map((t, j) => (j === ti ? { ...t, items: fn(t.items) } : t)));
  const setItem = (ti, ii, k, v) => setItems(ti, (items) => items.map((x, j) => (j === ii ? { ...x, [k]: v } : x)));

  async function removeTopic(ti) {
    const t = form[ti];
    if (
      t.items.length &&
      !(await ask({
        title: `Remove "${t.title || "this topic"}" and its ${t.items.length} question${t.items.length === 1 ? "" : "s"}?`,
        body: "Nothing is saved until you press Save.",
        danger: true,
        confirmLabel: "Remove topic",
      }))
    )
      return;
    setForm((f) => f.filter((_, j) => j !== ti));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const sent = form;
    try {
      await api.saveHelpFaq(fromForm(sent));
      setSavedForm(sent);
      setMsg({ ok: true, text: "Saved. The help page shows it right away." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefaults() {
    if (
      !(await ask({
        title: "Replace everything in this form with the standard help?",
        body: "Nothing is saved until you press Save.",
        danger: true,
        confirmLabel: "Reset form",
      }))
    )
      return;
    setForm(toForm(null));
    setMsg(null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        The{" "}
        <Link to="/help" className="font-semibold text-link hover:underline">
          Help page
        </Link>{" "}
        is where you send people instead of answering the same question again. Every question gets its own link
        (there is a <b>Copy link</b> button under each answer), so you can paste the exact answer in Discord. Writing
        tips: <code className="rounded bg-card px-1.5 py-0.5 text-xs">**words**</code> makes words bold,{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">[Content Check](/content-check)</code> makes a link,
        and an empty line starts a new paragraph. Changing a question&rsquo;s wording changes its link.
      </div>

      {form.map((t, ti) => (
        <div key={ti} className="card space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <Field label="Topic" className="flex-1">
              <input className="input" value={t.title} onChange={(e) => setTopic(ti, { title: e.target.value })} />
            </Field>
            <div className="pt-6">
              <RowControls
                what="topic"
                onUp={() => setForm(move(form, ti, -1))}
                onDown={() => setForm(move(form, ti, 1))}
                onRemove={() => removeTopic(ti)}
                upDisabled={ti === 0}
                downDisabled={ti === form.length - 1}
              />
            </div>
          </div>

          {t.items.map((it, ii) => (
            <div key={ii} className="space-y-3 rounded-xl border border-border p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <Field label="Question" className="flex-1">
                  <input className="input" value={it.q} onChange={(e) => setItem(ti, ii, "q", e.target.value)} />
                </Field>
                <div className="pt-6">
                  <RowControls
                    what="question"
                    onUp={() => setItems(ti, (items) => move(items, ii, -1))}
                    onDown={() => setItems(ti, (items) => move(items, ii, 1))}
                    onRemove={() => setItems(ti, (items) => items.filter((_, j) => j !== ii))}
                    upDisabled={ii === 0}
                    downDisabled={ii === t.items.length - 1}
                  />
                </div>
              </div>
              <Field label="Answer">
                <textarea className="input" rows={4} value={it.a} onChange={(e) => setItem(ti, ii, "a", e.target.value)} />
              </Field>
            </div>
          ))}
          {t.items.length === 0 && <p className="text-sm text-light">No questions yet. A topic without questions is not shown.</p>}

          <button type="button" onClick={() => setItems(ti, (items) => [...items, { q: "", a: "" }])} className={addBtn}>
            Add question
          </button>
        </div>
      ))}

      <button type="button" onClick={() => setForm([...form, { title: "", items: [{ q: "", a: "" }] }])} className={addBtn}>
        Add topic
      </button>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
        <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-onbrand transition hover:bg-primary-dark disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={resetToDefaults} className="rounded-lg bg-surface2 px-4 py-2.5 text-sm font-semibold text-medium transition hover:bg-border">
          Reset to standard help
        </button>
        <UnsavedHint dirty={dirty} />
        {msg && <span className={`text-sm font-medium ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
