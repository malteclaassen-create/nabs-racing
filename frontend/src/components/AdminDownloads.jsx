import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";

// Suggested categories (free text is allowed too — the field is an editable
// combobox). Order here also drives roughly how sections read on the public page.
const CATEGORIES = ["Track", "Safety Car", "Custom Shaders Patch", "Real Penalty", "Car", "Replay", "Other"];
const EMPTY = { title: "", category: "Track", version: "", description: "", installNote: "", fileName: "", sortOrder: 0, published: true };

export default function AdminDownloads() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminDownloads(), []));
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const downloads = data?.downloads || [];
  const diskFiles = data?.diskFiles || [];
  const unregistered = diskFiles.filter((f) => !f.registered);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  function startNew() { setForm(EMPTY); setEditingId(null); }
  function startEdit(d) {
    setEditingId(d.id);
    setMsg(null);
    setForm({
      title: d.title, category: d.category, version: d.version || "", description: d.description || "",
      installNote: d.installNote || "", fileName: d.fileName || "", sortOrder: d.sortOrder || 0, published: d.published,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = { ...form, sortOrder: Number(form.sortOrder) || 0 };
      if (editingId) await api.updateDownload(editingId, body);
      else await api.createDownload(body);
      setMsg({ ok: true, text: editingId ? "Updated." : "Added." });
      startNew();
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(d) {
    if (!window.confirm(`Remove "${d.title}" from the catalogue?\nThe file on disk is NOT deleted.`)) return;
    try {
      await api.deleteDownload(d.id);
      if (editingId === d.id) startNew();
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  if (error) return <ErrorBox message={error} />;

  const inputCls = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-dark placeholder:text-light focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
  const labelCls = "mb-1 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium";

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm text-medium">
        Put the actual files into <code className="rounded bg-card px-1.5 py-0.5 text-xs">backend/downloads/</code> on
        the server (big files won&rsquo;t upload through the browser), then register each one below. Members download
        them from the <b>Downloads</b> page. File sizes are read live from disk.
      </div>

      {/* Files detected on disk */}
      <div className="card p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Files on the server</h3>
        {diskFiles.length === 0 ? (
          <p className="mt-2 text-sm text-light">No files in <code>backend/downloads/</code> yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {diskFiles.map((f) => (
              <li key={f.fileName} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate font-mono text-sm text-dark">{f.fileName}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-xs text-light">{f.sizeText}</span>
                  {f.registered ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">registered</span>
                  ) : (
                    <button
                      onClick={() => { startNew(); set("fileName", f.fileName); set("title", f.fileName.replace(/\.[^.]+$/, "")); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary transition hover:bg-primary/20"
                    >
                      Register
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {unregistered.length > 0 && (
          <p className="mt-2 text-xs text-light">{unregistered.length} file(s) on disk are not yet in the catalogue.</p>
        )}
      </div>

      {/* Create / edit form */}
      <form onSubmit={save} className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
            {editingId ? "Edit entry" : "New entry"}
          </h3>
          {editingId && (
            <button type="button" onClick={startNew} className="text-xs font-semibold text-light hover:text-dark">
              Cancel edit
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Title *</label>
            <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Real Penalty" required />
          </div>
          <div>
            <label className={labelCls}>Category *</label>
            <input list="dl-categories" className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)} required />
            <datalist id="dl-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className={labelCls}>File on server</label>
            <input list="dl-files" className={inputCls} value={form.fileName} onChange={(e) => set("fileName", e.target.value)} placeholder="filename in backend/downloads/" />
            <datalist id="dl-files">{diskFiles.map((f) => <option key={f.fileName} value={f.fileName}>{f.sizeText}</option>)}</datalist>
          </div>
          <div>
            <label className={labelCls}>Version</label>
            <input className={inputCls} value={form.version} onChange={(e) => set("version", e.target.value)} placeholder="e.g. 1.2" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <textarea className={inputCls} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Short description shown on the card." />
        </div>
        <div>
          <label className={labelCls}>Install note</label>
          <input className={inputCls} value={form.installNote} onChange={(e) => set("installNote", e.target.value)} placeholder='e.g. "Uninstall old CSP first"' />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="w-28">
            <label className={labelCls}>Sort order</label>
            <input type="number" className={inputCls} value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm font-semibold text-dark">
            <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} className="h-4 w-4 rounded border-border" />
            Published (visible to members)
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Saving…" : editingId ? "Save changes" : "Add download"}
          </button>
          {msg && <span className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</span>}
        </div>
      </form>

      {/* Existing entries */}
      <div className="card overflow-hidden">
        <h3 className="border-b border-border px-5 py-4 font-display text-base font-extrabold uppercase tracking-tight text-dark">
          Catalogue {downloads.length > 0 && <span className="font-mono text-xs text-light">({downloads.length})</span>}
        </h3>
        {loading ? (
          <p className="p-5 text-sm text-light">Loading…</p>
        ) : downloads.length === 0 ? (
          <p className="p-5 text-sm text-light">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {downloads.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-bold uppercase tracking-tight text-dark">{d.title}</span>
                    <span className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-light">{d.category}</span>
                    {!d.published && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">hidden</span>}
                    {!d.fileExists && !d.externalUrl && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">file missing</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-light">
                    {d.fileName || d.externalUrl || "—"}{d.sizeText ? ` · ${d.sizeText}` : ""}{d.version ? ` · v${d.version}` : ""}
                  </div>
                </div>
                <button onClick={() => startEdit(d)} className="rounded-lg bg-surface2 px-3 py-1.5 text-xs font-semibold text-medium transition hover:bg-border">Edit</button>
                <button onClick={() => remove(d)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-500 transition hover:bg-red-500/10">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
