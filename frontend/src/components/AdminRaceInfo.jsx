import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";
import Icon, { PICKABLE_ICONS } from "./InfoIcon.jsx";
import { RACE_INFO_DEFAULTS } from "../data/raceInfoDefaults.js";

// Editor for the public Race Info page: the intro line, the "how the
// championship works" cards, the Sporting Regulations and both footnotes.
// Everything is stored as one blob in the backend; while nothing has been
// saved the page shows the built-in defaults (which also pre-fill this form).

const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-dark placeholder:text-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelCls = "mb-1 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium";
const smallBtn = "flex h-7 w-7 items-center justify-center rounded-lg bg-surface2 text-medium transition hover:bg-border disabled:opacity-30";

// content object -> editable form state (rules become one-per-line text).
function toForm(content) {
  const c = content || RACE_INFO_DEFAULTS;
  return {
    subtitle: c.subtitle || "",
    cards: (c.cards || []).map((x) => ({ icon: x.icon || "info", title: x.title || "", text: x.text || "" })),
    pointsFootnote: c.pointsFootnote || "",
    rulebook: (c.rulebook || []).map((g) => ({
      icon: g.icon || "info",
      subject: g.subject || "",
      rulesText: (g.rules || []).join("\n"),
    })),
    rulebookFootnote: c.rulebookFootnote || "",
  };
}

function fromForm(f) {
  return {
    subtitle: f.subtitle.trim(),
    cards: f.cards
      .map((c) => ({ icon: c.icon, title: c.title.trim(), text: c.text.trim() }))
      .filter((c) => c.title && c.text),
    pointsFootnote: f.pointsFootnote.trim(),
    rulebook: f.rulebook
      .map((g) => ({
        icon: g.icon,
        subject: g.subject.trim(),
        rules: g.rulesText.split("\n").map((r) => r.trim()).filter(Boolean),
      }))
      .filter((g) => g.subject && g.rules.length),
    rulebookFootnote: f.rulebookFootnote.trim(),
  };
}

function moveItem(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function IconSelect({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-eyebrow">
        <Icon name={value} className="h-[18px] w-[18px]" />
      </span>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {PICKABLE_ICONS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
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

export default function AdminRaceInfo() {
  const { data, loading, error } = useApi(useCallback(() => api.adminRaceInfo(), []));
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !error && !form) setForm(toForm(data?.content));
  }, [loading, error, data, form]);

  if (error) return <ErrorBox message={error} />;
  if (loading || !form) return <p className="text-sm text-light">Loading…</p>;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setCard = (i, k, v) => set("cards", form.cards.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const setGroup = (i, k, v) => set("rulebook", form.rulebook.map((g, j) => (j === i ? { ...g, [k]: v } : g)));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveRaceInfo(fromForm(form));
      setMsg({ ok: true, text: "Saved. The Race Info page shows the new text right away." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function resetToDefaults() {
    if (!window.confirm("Replace everything in this form with the standard text? Nothing is saved until you press Save.")) return;
    setForm(toForm(RACE_INFO_DEFAULTS));
    setMsg(null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        This is the text of the public <b>Race Info</b> page. Writing tips:{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">**words**</code> makes words bold, and these
        placeholders are filled in live from the season data:{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{rounds}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{counted}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{drop}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{platform}"}</code>{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">{"{era}"}</code>. In the regulations, write
        one rule per line.
      </div>

      {/* intro line */}
      <div className="card space-y-3 p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Page intro</h3>
        <div>
          <label className={labelCls}>Subtitle under the page title</label>
          <textarea className={inputCls} rows={2} value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
        </div>
      </div>

      {/* rule cards */}
      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
            "How the championship works" cards
          </h3>
          <button
            type="button"
            onClick={() => set("cards", [...form.cards, { icon: "info", title: "", text: "" }])}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
          >
            Add card
          </button>
        </div>
        {form.cards.map((c, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="w-56"><IconSelect value={c.icon} onChange={(v) => setCard(i, "icon", v)} /></div>
              <RowControls
                onUp={() => set("cards", moveItem(form.cards, i, -1))}
                onDown={() => set("cards", moveItem(form.cards, i, 1))}
                onRemove={() => set("cards", form.cards.filter((_, j) => j !== i))}
                upDisabled={i === 0}
                downDisabled={i === form.cards.length - 1}
              />
            </div>
            <div>
              <label className={labelCls}>Card title</label>
              <input className={inputCls} value={c.title} onChange={(e) => setCard(i, "title", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Card text</label>
              <textarea className={inputCls} rows={3} value={c.text} onChange={(e) => setCard(i, "text", e.target.value)} />
            </div>
          </div>
        ))}
      </div>

      {/* points footnote */}
      <div className="card space-y-3 p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Points table footnote</h3>
        <textarea className={inputCls} rows={2} value={form.pointsFootnote} onChange={(e) => set("pointsFootnote", e.target.value)} />
      </div>

      {/* sporting regulations */}
      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Sporting Regulations</h3>
          <button
            type="button"
            onClick={() => set("rulebook", [...form.rulebook, { icon: "info", subject: "", rulesText: "" }])}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
          >
            Add section
          </button>
        </div>
        {form.rulebook.map((g, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="w-56"><IconSelect value={g.icon} onChange={(v) => setGroup(i, "icon", v)} /></div>
              <RowControls
                onUp={() => set("rulebook", moveItem(form.rulebook, i, -1))}
                onDown={() => set("rulebook", moveItem(form.rulebook, i, 1))}
                onRemove={() => set("rulebook", form.rulebook.filter((_, j) => j !== i))}
                upDisabled={i === 0}
                downDisabled={i === form.rulebook.length - 1}
              />
            </div>
            <div>
              <label className={labelCls}>Section name (e.g. Tyres, Safety car)</label>
              <input className={inputCls} value={g.subject} onChange={(e) => setGroup(i, "subject", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Rules (one per line)</label>
              <textarea
                className={`${inputCls} font-mono text-[13px]`}
                rows={Math.max(3, Math.min(14, g.rulesText.split("\n").length + 1))}
                value={g.rulesText}
                onChange={(e) => setGroup(i, "rulesText", e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* rulebook footnote */}
      <div className="card space-y-3 p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Regulations footnote</h3>
        <textarea className={inputCls} rows={2} value={form.rulebookFootnote} onChange={(e) => set("rulebookFootnote", e.target.value)} />
      </div>

      {/* actions */}
      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
        <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={resetToDefaults} className="rounded-lg bg-surface2 px-4 py-2.5 text-sm font-semibold text-medium transition hover:bg-border">
          Reset to standard text
        </button>
        {msg && <span className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
